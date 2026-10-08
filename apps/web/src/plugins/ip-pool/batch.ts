import { fetchConfig } from "./config";
import { mapPool } from "./concurrency";
import { HotConnectionPool } from "./hot-pool";
import { loadPoolRecords } from "./pool";
import { getStore } from "./store";
import { EMPTY_BATCH_STATUS, type FetchBatchStatus, type HostPinFamily, type HostPinRecord } from "./types";

export { mapPool };

/** 热池运维（预热/重热/保活）并发；业务下载由任务并发（`concurrency`）决定。 */
const WARM_CONCURRENCY = 200;

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

const MAX_CONCURRENCY = 4096;
/** 默认**全速**（不限并发）；需要限流时显式传 `concurrency > 0`。 */
const DEFAULT_CONCURRENCY = 0;

let job: FetchBatchStatus = { ...EMPTY_BATCH_STATUS };

/** 当前（或最近一次）批量抓取作业的进度快照（附加实时吞吐与热池指标）。 */
export function batchStatus(): FetchBatchStatus {
  const now = job.running ? Date.now() : (job.finishedAt ?? Date.now());
  const elapsedMs = job.startedAt ? Math.max(0, now - job.startedAt) : 0;
  const ratePerSec = elapsedMs > 0 ? Math.round((job.done / elapsedMs) * 1000 * 10) / 10 : 0;
  return { ...job, elapsedMs, ratePerSec, pool: hotPool?.stats() };
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

// ── 进程内单例热池（跨批次复用连接）──────────────────────
let hotPool: HotConnectionPool | null = null;

function ensureHotPool(cfg: ReturnType<typeof fetchConfig>, url: string, browser: string, timeoutMs: number) {
  if (!hotPool) {
    hotPool = new HotConnectionPool({
      hostname: cfg.hostname,
      warmupUrl: url,
      browser,
      proxy: cfg.proxy,
      timeoutMs,
      connectTimeoutMs: cfg.connectTimeoutMs,
      coldTimeoutMs: cfg.coldTimeoutMs,
      warmConcurrency: WARM_CONCURRENCY,
    });
    hotPool.startBackground();
  }
  return hotPool;
}

/** 供其它动作（如单次 `fetch`）复用热池。 */
export function hotPoolStats(): FetchBatchStatus["pool"] {
  return hotPool?.stats();
}

/** 当前已建立热连接的 IP 列表（供绿色通道可视化）。 */
export function hotIpList(): string[] {
  return hotPool?.hotIpList() ?? [];
}

/**
 * 启动一次批量抓取（**后台运行**，立即返回进度快照）。
 * 每个 IP 走自己的**常驻热连接**（首次建连，之后复用 keep-alive），
 * 结果逐条写入 Store（SSE 实时推送弹道）。
 */
export function startBatch(options: FetchBatchOptions): FetchBatchStatus {
  if (job.running) return job;

  const cfg = fetchConfig();
  const targets = resolveBatchTargets(options);
  // `concurrency <= 0`（默认）→ 全速：不限并发，一次性铺开全部目标。
  const requested = Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY;
  const concurrency =
    requested <= 0 ? targets.length : Math.min(requested, MAX_CONCURRENCY, targets.length);
  const url = options.url ?? cfg.targetUrl;
  const browser = options.browser ?? cfg.browser;
  const timeoutMs = options.timeoutMs ?? cfg.timeoutMs;

  // 登记**全池**（不只是本次目标），让后续批次复用已建立的连接。
  const pool = ensureHotPool(cfg, url, browser, timeoutMs);
  try {
    pool.register(loadPoolRecords(cfg.poolFile));
  } catch {
    pool.register(targets);
  }

  job = {
    running: true,
    total: targets.length,
    done: 0,
    success: 0,
    httpError: 0,
    transportError: 0,
    hotReused: 0,
    coldOpened: 0,
    concurrency,
    pool: pool.stats(),
    startedAt: Date.now(),
  };

  void runBatch({ targets, url, timeoutMs, concurrency, pool }).finally(() => {
    job.running = false;
    job.finishedAt = Date.now();
    job.pool = pool.stats();
    getStore().flush();
  });

  return job;
}

interface RunBatchArgs {
  targets: readonly HostPinRecord[];
  url: string;
  timeoutMs: number;
  concurrency: number;
  pool: HotConnectionPool;
}

async function runBatch({ targets, url, timeoutMs, concurrency, pool }: RunBatchArgs): Promise<void> {
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
      const result = await pool.probe(record.ip, url);
      status = result.status;
      bytes = result.bytes;
      durationMs = result.durationMs;
      outcome = result.status === 200 ? "success" : "http_error";
      if (result.via === "hot") job.hotReused = (job.hotReused ?? 0) + 1;
      else job.coldOpened = (job.coldOpened ?? 0) + 1;
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
