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

  // RPS 用 Store 的**累计计数**求差（不能从 `recentAttempts` 数：那是上限 400 的环形缓冲，
  // 会把这个数字死死压在 400/秒）。
  let prevRpsAt = Date.now();
  let prevTotalRequests = 0;
  let prevTotalSuccess = 0;
  let prevTotalFailed = 0;

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
      prevRpsAt = Date.now();
      prevTotalRequests = snap.summary.totalRequests;
      prevTotalSuccess = snap.summary.totalSuccess;
      prevTotalFailed = snap.summary.totalFailed;

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
        const sum = s.summary;
        let rps = 0;
        let rpsOk = 0;
        let rpsFail = 0;
        const dtRps = (now - prevRpsAt) / 1000;
        if (dtRps > 0.2) {
          rps = Math.max(0, Math.round((sum.totalRequests - prevTotalRequests) / dtRps));
          rpsOk = Math.max(0, Math.round((sum.totalSuccess - prevTotalSuccess) / dtRps));
          rpsFail = Math.max(0, Math.round((sum.totalFailed - prevTotalFailed) / dtRps));
          prevTotalRequests = sum.totalRequests;
          prevTotalSuccess = sum.totalSuccess;
          prevTotalFailed = sum.totalFailed;
          prevRpsAt = now;
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
          rps,
          rpsOk,
          rpsFail,
          rxBps,
          txBps,
          hot: hotIpList().length,
          poolTotal: s.pool.total,
          totalRequests: sum.totalRequests,
        };
        write("metrics", metrics);

        if (!attempts.length && !requests.length && !flightPaths.length) return;
        for (const a of attempts) sentAttempts.add(attemptKey(a));
        for (const r of requests) sentRequests.add(r.requestId);
        for (const p of flightPaths) sentPaths.add(p.requestId);
        // 去重集合只用于避开窗口内重复；窗口本身有限，超过阈値就清空（最多重发一小批，无副作用）。
        if (sentAttempts.size > 20_000) sentAttempts.clear();
        if (sentRequests.size > 20_000) sentRequests.clear();
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
