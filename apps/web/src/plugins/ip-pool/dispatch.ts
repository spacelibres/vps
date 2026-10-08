import { fetchConfig } from "./config";
import { planDispatch } from "./plan";
import { getStore } from "./store";
import { EMPTY_DISPATCH_STATUS, type DispatchStatus } from "./types";
import { ensurePoolWarm, getHotPool } from "./warm";

/**
 * 「经热池派发」作业：外部（本机）请求 tile0，服务端用**已预热的常驻热连接**
 * 逐条出网取数据，结果写入统计并生成弹道（经 SSE 推送）。
 *
 * 只走热 IP（绿色通道）：该 IP 没有热连接就报错，不做冷建连。
 */

export interface StartDispatchOptions {
  url?: string;
  /** 请求总数。 */
  count: number;
}

let job: DispatchStatus = { ...EMPTY_DISPATCH_STATUS };

/** 当前（或最近一次）派发作业的进度快照。 */
export function dispatchStatus(): DispatchStatus {
  const now = job.running ? Date.now() : (job.finishedAt ?? Date.now());
  const elapsedMs = job.startedAt ? Math.max(0, now - job.startedAt) : 0;
  const rps = elapsedMs > 0 ? Math.round((job.done / elapsedMs) * 1000 * 10) / 10 : 0;
  return { ...job, elapsedMs, rps };
}

export function isDispatchRunning(): boolean {
  return job.running;
}

/**
 * 启动一次派发（后台运行，立即返回进度快照）。
 * 每个热 IP 一个 worker，复用其 keep-alive 连接逐条请求。
 */
export function startDispatch(options: StartDispatchOptions): DispatchStatus {
  if (job.running) return job;

  const cfg = fetchConfig();
  const url = options.url ?? cfg.targetUrl;
  const count = Math.floor(options.count);

  ensurePoolWarm();
  const pool = getHotPool();
  const hot = pool.hotIpList();
  if (hot.length === 0) {
    throw new Error("无热连接可用：热池尚未预热完成（稍后重试）");
  }

  job = {
    running: true,
    url,
    total: count,
    done: 0,
    success: 0,
    failed: 0,
    hot: hot.length,
    startedAt: Date.now(),
  };

  void runDispatch({ pool, hot, url, count }).finally(() => {
    job.running = false;
    job.finishedAt = Date.now();
    getStore().flush();
  });

  return job;
}

interface RunDispatchArgs {
  pool: ReturnType<typeof getHotPool>;
  hot: readonly string[];
  url: string;
  count: number;
}

async function runDispatch({ pool, hot, url, count }: RunDispatchArgs): Promise<void> {
  const cfg = fetchConfig();
  const store = getStore();
  const plan = planDispatch(count, hot.length);
  let seq = 0;

  await Promise.all(
    hot.map(async (ip, index) => {
      for (let n = 0; n < (plan[index] ?? 0); n += 1) {
        const at = Date.now();
        const requestId = `dispatch-${at.toString(36)}-${(seq++).toString(36)}-${ip}`;
        let outcome: "success" | "http_error" | "transport_error" = "transport_error";
        let status: number | undefined;
        let bytes: number | undefined;
        let durationMs: number | undefined;

        try {
          const result = await pool.dispatch(ip, url);
          status = result.status;
          bytes = result.bytes;
          durationMs = result.durationMs;
          outcome = result.status === 200 ? "success" : "http_error";
        } catch (err) {
          job.lastError = `${ip}: ${err instanceof Error ? err.message : String(err)}`;
        }

        const elapsed = durationMs ?? Date.now() - at;
        store.ingest({
          origin: cfg.origin,
          attempts: [
            {
              requestId,
              url,
              attempt: 1,
              ip,
              outcome,
              httpStatus: status,
              durationMs: elapsed,
              bytes,
              at,
            },
          ],
          requests: [
            {
              requestId,
              url,
              outcome: outcome === "success" ? "success" : "failed",
              attempts: 1,
              totalDurationMs: elapsed,
              finalIp: ip,
              finalStatus: status,
              ipsUsed: [ip],
              bytes,
              at,
            },
          ],
        });

        job.done += 1;
        if (outcome === "success") job.success += 1;
        else job.failed += 1;
      }
    }),
  );
}
