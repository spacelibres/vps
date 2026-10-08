import { fetchConfig } from "./config";
import { mapPool } from "./concurrency";
import { fetchOnce } from "./fetch";
import { loadPoolRecords } from "./pool";
import { getStore } from "./store";
import { EMPTY_BATCH_STATUS, type FetchBatchStatus, type HostPinFamily, type HostPinRecord } from "./types";

export { mapPool };


export interface FetchBatchOptions {
  url?: string;
  /** 指定 IP 列表；缺省则用整个池（受 `family` / `limit` 约束）。 */
  ips?: string[];
  family?: "all" | HostPinFamily;
  limit?: number;
  concurrency?: number;
  browser?: string;
  timeoutMs?: number;
}

const MAX_CONCURRENCY = 64;
const DEFAULT_CONCURRENCY = 16;

let job: FetchBatchStatus = { ...EMPTY_BATCH_STATUS };

/** 当前（或最近一次）批量抓取作业的进度快照。 */
export function batchStatus(): FetchBatchStatus {
  return job;
}

export function isBatchRunning(): boolean {
  return job.running;
}

/** 依据作业选项确定要抓取的 IP 列表。 */
export function resolveBatchTargets(options: FetchBatchOptions): HostPinRecord[] {
  if (options.ips && options.ips.length > 0) {
    return options.ips.map((ip) => ({ ip, family: ip.includes(":") ? "ipv6" : "ipv4" }));
  }
  const cfg = fetchConfig();
  const family = options.family ?? "all";
  let records = loadPoolRecords(cfg.poolFile);
  if (family !== "all") records = records.filter((r) => r.family === family);
  if (options.limit !== undefined) records = records.slice(0, options.limit);
  return records;
}

/**
 * 启动一次批量抓取（**后台运行**，立即返回进度快照）。
 * 每个 IP 钉住后抓取一次，结果逐条写入 Store（SSE 实时推送弹道）。
 * 已有作业在跑时直接返回其快照（不重复启动）。
 */
export function startBatch(options: FetchBatchOptions): FetchBatchStatus {
  if (job.running) return job;

  const cfg = fetchConfig();
  const targets = resolveBatchTargets(options);
  const concurrency = Math.max(
    1,
    Math.min(Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY, MAX_CONCURRENCY),
  );
  const url = options.url ?? cfg.targetUrl;
  const browser = options.browser ?? cfg.browser;
  const timeoutMs = options.timeoutMs ?? cfg.timeoutMs;

  job = {
    running: true,
    total: targets.length,
    done: 0,
    success: 0,
    httpError: 0,
    transportError: 0,
    concurrency,
    startedAt: Date.now(),
  };

  void runBatch({ targets, url, browser, timeoutMs, concurrency }).finally(() => {
    job.running = false;
    job.finishedAt = Date.now();
    getStore().flush();
  });

  return job;
}

interface RunBatchArgs {
  targets: readonly HostPinRecord[];
  url: string;
  browser: string;
  timeoutMs: number;
  concurrency: number;
}

async function runBatch({ targets, url, browser, timeoutMs, concurrency }: RunBatchArgs): Promise<void> {
  const cfg = fetchConfig();
  const store = getStore();
  let seq = 0;

  await mapPool(targets, concurrency, async (record) => {
    const at = Date.now();
    const requestId = `batch-${at.toString(36)}-${(seq++).toString(36)}-${record.ip}`;
    let outcome: "success" | "http_error" | "transport_error" = "transport_error";
    let status: number | undefined;
    let bytes: number | undefined;
    let durationMs: number | undefined;
    let error: string | undefined;

    try {
      const result = await fetchOnce({
        url,
        proxy: cfg.proxy,
        browser,
        timeoutMs,
        pin: { hostname: cfg.hostname, ip: record.ip },
      });
      outcome = result.ok ? "success" : "http_error";
      status = result.status;
      bytes = result.bytes;
      durationMs = result.durationMs;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const elapsed = durationMs ?? Date.now() - at;
    store.ingest({
      origin: cfg.origin,
      attempts: [
        {
          requestId,
          url,
          attempt: 1,
          ip: record.ip,
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
          finalIp: record.ip,
          finalStatus: status,
          ipsUsed: [record.ip],
          bytes,
          at,
        },
      ],
    });

    job.done += 1;
    if (outcome === "success") job.success += 1;
    else if (outcome === "http_error") job.httpError += 1;
    else {
      job.transportError += 1;
      job.lastError = `${record.ip}: ${error ?? "transport_error"}`;
    }
  });
}
