import { createClient, type BrowserProfile, type Client } from "node-wreq";
import { pickFairHotIp } from "./hot-picker";
import type { HostPinRecord } from "./types";

/**
 * 每个 IP 一条**常驻热连接**（移植自 `GeoClaw/src/fetch/HotConnectionPool.ts`）。
 *
 * 要点：
 *  - 用 `createClient({ dns.hosts, connectionGroup: ip, poolIdleTimeout, poolMaxIdlePerHost })`
 *    为单个 IP 建一个可复用的 node-wreq `Client`——**握手只做一次**，之后请求复用 keep-alive 连接；
 *  - 预热/探活一次成功（HTTP 200）即入热池；传输失败移出热池、退避后由后台重热；
 *  - `403/429` 入「冷池」暂不参与，200 后再释放；
 *  - 可选保活：空闲接近窗口时发一次轻量请求续命。
 *
 * 与冷路径（每次请求都新建连接）相比，重复跑同一批 IP 时握手开销基本消失。
 */

export type HotSlotState = "pending" | "warming" | "hot" | "failed" | "denied";

export interface HotPoolOptions {
  hostname: string;
  /** 预热 URL（本项目即抓取目标 URL）。 */
  warmupUrl: string;
  browser: string;
  proxy?: string;
  /** 单次请求超时（毫秒）。 */
  timeoutMs: number;
  /** 预热 / 重热 / 保活并发。 */
  warmConcurrency: number;
  successStatus?: number;
  deniedStatuses?: readonly number[];
  /** 后台重热间隔（毫秒）；`0` 关闭。 */
  reheatIntervalMs?: number;
  /** 失败后重热退避（毫秒）。 */
  backoffMs?: number;
  /** node-wreq 连接池空闲超时；`false` = 不额外限制。 */
  poolIdleTimeout?: number | false;
  poolMaxIdlePerHost?: number;
  /** 保活空闲窗口（毫秒）；`0` 关闭保活。 */
  idleExpireMs?: number;
  keepAliveConcurrency?: number;
}

export interface HotPoolStats {
  total: number;
  hot: number;
  pending: number;
  warming: number;
  failed: number;
  denied: number;
}

export interface HotProbeResult {
  ip: string;
  status: number;
  bytes: number;
  durationMs: number;
  /** `hot` = 复用了已建立的连接；`new` = 本次现场建连。 */
  via: "hot" | "new";
}

interface Slot {
  ip: string;
  family: HostPinRecord["family"];
  state: HotSlotState;
  client?: Client;
  lastStatus?: number;
  lastError?: string;
  lastUsedAt: number;
  nextReheatAt: number;
  assignCount: number;
}

const DEFAULTS = {
  successStatus: 200,
  deniedStatuses: [403, 429] as readonly number[],
  reheatIntervalMs: 5000,
  backoffMs: 0,
  poolIdleTimeout: false as number | false,
  poolMaxIdlePerHost: 1,
  idleExpireMs: 60_000,
  keepAliveConcurrency: 32,
};

export class HotConnectionPool {
  private readonly options: HotPoolOptions;
  private readonly successStatus: number;
  private readonly deniedStatuses: readonly number[];
  private readonly reheatIntervalMs: number;
  private readonly backoffMs: number;
  private readonly poolIdleTimeout: number | false;
  private readonly poolMaxIdlePerHost: number;
  private readonly idleExpireMs: number;
  private readonly keepAliveConcurrency: number;
  private readonly slots = new Map<string, Slot>();
  private readonly hotIps: string[] = [];
  private readonly deniedIps = new Set<string>();
  private reheatTimer: ReturnType<typeof setInterval> | undefined;

  constructor(options: HotPoolOptions) {
    this.options = options;
    this.successStatus = options.successStatus ?? DEFAULTS.successStatus;
    this.deniedStatuses = options.deniedStatuses ?? DEFAULTS.deniedStatuses;
    this.reheatIntervalMs = options.reheatIntervalMs ?? DEFAULTS.reheatIntervalMs;
    this.backoffMs = options.backoffMs ?? DEFAULTS.backoffMs;
    this.poolIdleTimeout = options.poolIdleTimeout ?? DEFAULTS.poolIdleTimeout;
    this.poolMaxIdlePerHost = options.poolMaxIdlePerHost ?? DEFAULTS.poolMaxIdlePerHost;
    this.idleExpireMs = options.idleExpireMs ?? DEFAULTS.idleExpireMs;
    this.keepAliveConcurrency = options.keepAliveConcurrency ?? DEFAULTS.keepAliveConcurrency;
  }

  /** 注册池内 IP（幂等）。 */
  register(records: readonly HostPinRecord[]): void {
    for (const record of records) {
      if (this.slots.has(record.ip)) continue;
      this.slots.set(record.ip, {
        ip: record.ip,
        family: record.family,
        state: "pending",
        lastUsedAt: 0,
        nextReheatAt: 0,
        assignCount: 0,
      });
    }
  }

  /** 启动后台重热 + 保活（幂等）。 */
  startBackground(): void {
    if (this.reheatTimer || this.reheatIntervalMs <= 0) return;
    this.reheatTimer = setInterval(() => {
      void this.maintain();
    }, this.reheatIntervalMs);
    this.reheatTimer.unref?.();
  }

  stats(): HotPoolStats {
    let hot = 0;
    let pending = 0;
    let warming = 0;
    let failed = 0;
    let denied = 0;
    for (const slot of this.slots.values()) {
      if (slot.state === "hot") hot += 1;
      else if (slot.state === "pending") pending += 1;
      else if (slot.state === "warming") warming += 1;
      else if (slot.state === "denied") denied += 1;
      else failed += 1;
    }
    return { total: this.slots.size, hot, pending, warming, failed, denied };
  }

  hotCount(): number {
    return this.hotIps.length;
  }

  /** 取一条热 IP（公平选路，可偏向复用最近连接）。 */
  pickHot(warmSlack = 0): string | undefined {
    const candidates = this.hotIps
      .map((ip) => this.slots.get(ip))
      .filter((slot): slot is Slot => Boolean(slot?.client))
      .map((slot) => ({ ip: slot.ip, lastUsedAt: slot.lastUsedAt, assignCount: slot.assignCount }));
    return pickFairHotIp(candidates, { warmSlack });
  }

  /**
   * 预热全部待热/失败 IP（按 `warmConcurrency`）。
   * 返回预热后的统计。
   */
  async warmAll(): Promise<HotPoolStats> {
    const targets = [...this.slots.values()].filter((s) => s.state !== "hot");
    await runConcurrent(targets, this.options.warmConcurrency, async (slot) => {
      await this.warmOne(slot.ip);
    });
    return this.stats();
  }

  /**
   * 探活 / 抓取单个 IP：优先复用热连接，否则现场建连。
   * 成功（200）转为热连接；`403/429` 入冷池；传输错误移出热池。
   */
  async probe(ip: string, url: string = this.options.warmupUrl): Promise<HotProbeResult> {
    const slot = this.slots.get(ip);
    if (!slot) throw new Error(`热池未登记的 IP：${ip}`);

    const reuse = slot.client;
    const via: "hot" | "new" = reuse ? "hot" : "new";
    const client = reuse ?? this.createClient(ip);
    slot.assignCount += 1;

    const started = Date.now();
    try {
      const res = await client.get(url, { timeout: this.options.timeoutMs });
      const buf = new Uint8Array(await res.arrayBuffer());
      const durationMs = Date.now() - started;
      slot.lastStatus = res.status;

      if (res.status === this.successStatus) {
        if (!reuse) {
          slot.client?.close();
          slot.client = client;
        }
        slot.state = "hot";
        slot.lastError = undefined;
        slot.lastUsedAt = Date.now();
        this.deniedIps.delete(ip);
        this.addHot(ip);
        return { ip, status: res.status, bytes: buf.length, durationMs, via };
      }

      // 非 200：不接管新连接。
      if (!reuse) client.close();
      if (this.deniedStatuses.includes(res.status)) {
        slot.state = "denied";
        this.deniedIps.add(ip);
        this.evictHot(ip);
      } else {
        slot.state = "failed";
        slot.nextReheatAt = Date.now() + this.backoffMs;
      }
      return { ip, status: res.status, bytes: buf.length, durationMs, via };
    } catch (err) {
      // 传输层失败：丢弃该连接（热连接坏了 / 新连接没建成）。
      slot.client?.close();
      slot.client = undefined;
      this.evictHot(ip);
      slot.state = "failed";
      slot.lastError = err instanceof Error ? err.message : String(err);
      slot.nextReheatAt = Date.now() + this.backoffMs;
      if (!reuse) client.close();
      throw err;
    }
  }

  close(): void {
    if (this.reheatTimer) clearInterval(this.reheatTimer);
    this.reheatTimer = undefined;
    for (const slot of this.slots.values()) {
      slot.client?.close();
      slot.client = undefined;
    }
    this.hotIps.length = 0;
  }

  // ── 内部 ─────────────────────────────────────────────────
  private createClient(ip: string): Client {
    return createClient({
      browser: this.options.browser as BrowserProfile,
      ...(this.options.proxy ? { proxy: this.options.proxy } : {}),
      dns: { hosts: { [this.options.hostname]: [ip] } },
      poolIdleTimeout: this.poolIdleTimeout,
      poolMaxIdlePerHost: this.poolMaxIdlePerHost,
      connectionGroup: ip,
      timeout: this.options.timeoutMs,
    });
  }

  private async warmOne(ip: string): Promise<void> {
    const slot = this.slots.get(ip);
    if (!slot) return;
    slot.state = "warming";
    slot.client?.close();
    slot.client = undefined;
    this.evictHot(ip);

    const client = this.createClient(ip);
    try {
      const res = await client.get(this.options.warmupUrl, { timeout: this.options.timeoutMs });
      const outcome =
        res.status === this.successStatus ? "hot" : this.deniedStatuses.includes(res.status) ? "denied" : "retry";
      await res.arrayBuffer().catch(() => undefined);
      slot.lastStatus = res.status;

      if (outcome === "hot") {
        slot.client = client;
        slot.state = "hot";
        slot.lastError = undefined;
        slot.lastUsedAt = Date.now();
        this.deniedIps.delete(ip);
        this.addHot(ip);
        return;
      }
      client.close();
      if (outcome === "denied") {
        slot.state = "denied";
        this.deniedIps.add(ip);
        return;
      }
      slot.state = "failed";
      slot.nextReheatAt = Date.now() + this.backoffMs;
    } catch (err) {
      client.close();
      slot.state = "failed";
      slot.lastError = err instanceof Error ? err.message : String(err);
      slot.nextReheatAt = Date.now() + this.backoffMs;
    }
  }

  /** 后台维护：重热退避到期的失败 IP；对空闲热连接保活。 */
  private async maintain(): Promise<void> {
    const now = Date.now();
    const failed = [...this.slots.values()].filter(
      (slot) => slot.state === "failed" && slot.nextReheatAt <= now,
    );
    if (failed.length > 0) {
      await runConcurrent(failed, this.options.warmConcurrency, async (slot) => {
        await this.warmOne(slot.ip);
      });
    }
    if (this.idleExpireMs > 0) {
      await this.keepAliveIdle(now);
    }
  }

  private async keepAliveIdle(now: number): Promise<void> {
    const keepAfter = Math.floor(this.idleExpireMs * 0.75);
    const idle = this.hotIps
      .map((ip) => this.slots.get(ip))
      .filter((slot): slot is Slot => Boolean(slot?.client))
      .filter((slot) => now - slot.lastUsedAt >= keepAfter);
    if (idle.length === 0) return;
    await runConcurrent(idle, this.keepAliveConcurrency, async (slot) => {
      try {
        const res = await slot.client!.get(this.options.warmupUrl, {
          timeout: this.options.timeoutMs,
        });
        await res.arrayBuffer().catch(() => undefined);
        if (res.status === this.successStatus) {
          slot.lastUsedAt = Date.now();
        } else {
          slot.client?.close();
          slot.client = undefined;
          this.evictHot(slot.ip);
          slot.state = "failed";
          slot.nextReheatAt = Date.now() + this.backoffMs;
        }
      } catch {
        slot.client?.close();
        slot.client = undefined;
        this.evictHot(slot.ip);
        slot.state = "failed";
        slot.nextReheatAt = Date.now() + this.backoffMs;
      }
    });
  }

  private addHot(ip: string): void {
    if (!this.hotIps.includes(ip)) this.hotIps.push(ip);
  }

  private evictHot(ip: string): void {
    const index = this.hotIps.indexOf(ip);
    if (index >= 0) this.hotIps.splice(index, 1);
  }
}

/** 有界并发执行（与 `mapPool` 同语义，独立此处避免循环依赖）。 */
async function runConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const size = items.length;
  if (size === 0) return;
  const requested = Math.floor(concurrency);
  const limit = requested <= 0 ? size : Math.min(requested, size);
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const index = next++;
        if (index >= size) return;
        await fn(items[index]!, index);
      }
    }),
  );
}
