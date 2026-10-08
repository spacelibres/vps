import { readNicTotals } from "./net";
import { getStore } from "./store";
import type { StreamMetrics } from "./types";
import { hotIpList } from "./warm";

const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;

function attemptKey(a: { requestId: string; attempt: number }): string {
  return `${a.requestId}#${a.attempt}`;
}

/**
 * 构造 SSE 响应。
 *
 * 事件：
 *  - 首帧 `snapshot`（轻量：不含庞大的池子聚合）；
 *  - 每次 Store 变更推 `pulse`（仅新增的 attempt/request/flightPath）；
 *  - 每 `POLL_MS` 推 `metrics`（请求速率 RPS + 网卡 rx/tx + 热池计数）。
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
  let lastEpoch = store.resetEpoch;

  let prevNic = readNicTotals();
  let prevNicAt = Date.now();

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
        resetEpoch: snap.resetEpoch,
      });

      poll = setInterval(() => {
        if (closed) return;
        const s = store.snapshot();

        // 统计被重置：通知客户端清空本地脉冲/采样/日志，并重置去重集合。
        if (s.resetEpoch !== lastEpoch) {
          lastEpoch = s.resetEpoch;
          sentAttempts.clear();
          sentRequests.clear();
          sentPaths.clear();
          write("reset", { resetEpoch: s.resetEpoch, summary: s.summary, revision: s.revision });
        }

        const attempts = s.recentAttempts.filter((a) => !sentAttempts.has(attemptKey(a)));
        const requests = s.recentRequests.filter((r) => !sentRequests.has(r.requestId));
        const flightPaths = s.recentFlightPaths.filter((p) => !sentPaths.has(p.requestId));

        // ── metrics：RPS + 网卡 + 热池 ──
        const now = Date.now();
        let rpsOk = 0;
        let rpsFail = 0;
        for (const a of attempts) {
          if (a.outcome === "success") rpsOk += 1;
          else rpsFail += 1;
        }
        let rxBps: number | null = null;
        let txBps: number | null = null;
        const nic = readNicTotals();
        if (nic && prevNic) {
          const dt = (now - prevNicAt) / 1000;
          if (dt > 0.2) {
            rxBps = Math.max(0, (nic.rxBytes - prevNic.rxBytes) / dt);
            txBps = Math.max(0, (nic.txBytes - prevNic.txBytes) / dt);
          }
        }
        if (nic) {
          prevNic = nic;
          prevNicAt = now;
        }
        const metrics: StreamMetrics = {
          ts: now,
          rps: rpsOk + rpsFail,
          rpsOk,
          rpsFail,
          rxBps,
          txBps,
          hot: hotIpList().length,
          poolTotal: s.pool.total,
          totalRequests: s.summary.totalRequests,
        };
        write("metrics", metrics);

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
