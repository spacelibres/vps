import { getStore } from "./store";

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;

function attemptKey(a: { requestId: string; attempt: number }): string {
  return `${a.requestId}#${a.attempt}`;
}

/**
 * 构造 SSE 响应：首帧 `snapshot`（轻量：不含庞大的池子聚合），
 * 之后每次 Store 变更推 `pulse`（仅新增的 attempt/request/flightPath）。
 */
export function createSseResponse(): Response {
  const store = getStore();
  const encoder = new TextEncoder();
  const sentAttempts = new Set<string>();
  const sentRequests = new Set<string>();
  const sentPaths = new Set<string>();

  let poll: ReturnType<typeof setInterval> | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stop = () => {
    closed = true;
    if (poll) clearInterval(poll);
    if (beat) clearInterval(beat);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (event: string, data: unknown): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
          return true;
        } catch {
          stop();
          return false;
        }
      };

      const snap = store.snapshot();
      for (const a of snap.recentAttempts) sentAttempts.add(attemptKey(a));
      for (const r of snap.recentRequests) sentRequests.add(r.requestId);
      for (const p of snap.recentFlightPaths) sentPaths.add(p.requestId);

      write("hello", { hostname: store.hostname, ts: Date.now() });
      write("snapshot", {
        hostname: store.hostname,
        updatedAt: snap.updatedAt,
        origin: snap.origin,
        summary: snap.summary,
        recentRequests: snap.recentRequests,
        recentAttempts: snap.recentAttempts,
        recentFlightPaths: snap.recentFlightPaths,
        revision: snap.revision,
      });

      poll = setInterval(() => {
        if (closed) return;
        const s = store.snapshot();
        const attempts = s.recentAttempts.filter((a) => !sentAttempts.has(attemptKey(a)));
        const requests = s.recentRequests.filter((r) => !sentRequests.has(r.requestId));
        const flightPaths = s.recentFlightPaths.filter((p) => !sentPaths.has(p.requestId));
        if (!attempts.length && !requests.length && !flightPaths.length) return;
        for (const a of attempts) sentAttempts.add(attemptKey(a));
        for (const r of requests) sentRequests.add(r.requestId);
        for (const p of flightPaths) sentPaths.add(p.requestId);
        write("pulse", {
          revision: s.revision,
          summary: s.summary,
          attempts,
          requests,
          flightPaths,
        });
      }, POLL_MS);
      poll.unref?.();

      beat = setInterval(() => write("ping", { ts: Date.now() }), HEARTBEAT_MS);
      beat.unref?.();
    },
    cancel() {
      stop();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
