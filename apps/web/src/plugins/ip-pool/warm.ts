import { fetchConfig } from "./config";
import { HotConnectionPool, type HotPoolStats } from "./hot-pool";
import { loadPoolRecords } from "./pool";

/**
 * 进程内单例热连接池（整池常驻热连接）。
 *
 * 只负责「保持连接」：打开面板即在后台预热**整池**，让每个 IP 都建立可复用的
 * keep-alive 连接（绿色通道）；失败的 IP 由热池后台 `maintain` 持续重热。
 *
 * 不在本插件里发起任何**业务抓取**：抓取派发属于独立的 fetch 插件，本插件只做
 * 池子管理、请求统计与航线可视化。
 */

/** 预热 / 重热 / 保活并发。 */
const WARM_CONCURRENCY = 200;

let hotPool: HotConnectionPool | null = null;
let warmStarted = false;

function ensureHotPool(): HotConnectionPool {
  if (!hotPool) {
    const cfg = fetchConfig();
    hotPool = new HotConnectionPool({
      hostname: cfg.hostname,
      warmupUrl: cfg.targetUrl,
      browser: cfg.browser,
      proxy: cfg.proxy,
      timeoutMs: cfg.timeoutMs,
      connectTimeoutMs: cfg.connectTimeoutMs,
      coldTimeoutMs: cfg.coldTimeoutMs,
      warmConcurrency: WARM_CONCURRENCY,
    });
    hotPool.startBackground();
  }
  return hotPool;
}

/** 热池运行状态快照。 */
export function hotPoolStats(): HotPoolStats | undefined {
  return hotPool?.stats();
}

/** 当前已建立热连接的 IP 列表（供绿色通道可视化）。 */
export function hotIpList(): string[] {
  return hotPool?.hotIpList() ?? [];
}

/**
 * 确保**整池**在后台预热（进程内只做一次初始全量预热）。
 * 面板打开即触发，整个池子逐渐变为常驻热连接；`IP_POOL_AUTO_WARM=0` 可关闭。
 */
export function ensurePoolWarm(): void {
  if (warmStarted) return;
  const cfg = fetchConfig();
  if (!cfg.autoWarm) return;
  const pool = ensureHotPool();
  try {
    pool.register(loadPoolRecords(cfg.poolFile));
  } catch {
    return;
  }
  warmStarted = true;
  void pool.warmAll();
}
