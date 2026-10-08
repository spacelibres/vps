import { fetchConfig } from "./config";
import { dispatchWorkerCount, hotIpFor } from "./plan";
import { getStore } from "./store";
import { EMPTY_DISPATCH_STATUS, type DispatchStatus } from "./types";
import { ensurePoolWarm, getHotPool } from "./warm";

/**
 * 「经热池派发」作业：外部（本机）请求 tile0，服务端用**已预热的常驻热连接**
 * 逐条出网取数据，结果写入统计并生成弹道（经 SSE 推送）。
 *
 * 只走热 IP（绿色通道）：该 IP 没有热连接就报错，不做冷建连。
 *
 * 并发**有界**（默认 256）：worker 数 = `min(cap, count, 热 IP 数)`，
 * 每个 worker 从共享队列取下一个请求、按下标轮询整张热 IP 表 —— 所有热 IP 都参与，
 * 但同时在飞的请求有上限（实测无限并发只会拉长每个请求、拖低总吞吐）。
 */

export interface StartDispatchOptions {
  url?: string;
  /** 请求总数。 */
  count: number;
  /** 在飞请求上限；`0` = 不设上限。缺省用 `IP_POOL_DISPATCH_CONCURRENCY`（默认 256）。 */
  concurrency?: number;
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

/** 启动一次派发（后台运行，立即返回进度快照）。 */
export function startDispatch(options: StartDispatchOptions): DispatchStatus {
  if (job.running) return job;

  const cfg = fetchConfig();
  const url = options.url ?? cfg.targetUrl;
  const count = Math.floor(options.count);
  const cap = Math.floor(options.concurrency ?? cfg.dispatchConcurrency);

  ensurePoolWarm();
  const pool = getHotPool();
  const hot = pool.hotIpList();
  if (hot.length === 0) {
    throw new Error("无热连接可用：热池尚未预热完成（稍后重试）");
  }

  const workers = dispatchWorkerCount(count, hot.length, cap);
  job = {
    running: true,
    url,
    total: count,
    done: 0,
    success: 0,
    failed: 0,
    hot: hot.length,
    concurrency: workers,
    startedAt: Date.now(),
  };

  void runDispatch({ pool, hot, url, count, workers }).finally(() => {
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
  workers: number;
}

async function runDispatch({ pool, hot, url, count, workers }: RunDispatchArgs): Promise<void> {
  const cfg = fetchConfig();
  const store = getStore();
  let next = 0;
  let seq = 0;

  const work = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= count) return;
      const ip = hot[hotIpFor(index, hot.length)]!;
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
  };

  await Promise.all(Array.from({ length: workers }, () => work()));
}
