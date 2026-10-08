import { createClient, type BrowserProfile, type Client } from "node-wreq";
import type { HostPinRecord } from "./types";

/**
 * 每个 IP 一条**常驻热连接**（移植自 `GeoClaw/src/fetch/HotConnectionPool.ts`）。
 *
 * 只负责「保持连接」：为每个 IP 建一个可复用的 node-wreq `Client`，
 * 预热一次成功（HTTP 200）即入热池、之后复用 keep-alive；传输失败移出热池、退避后重热。
 *
 * 本类**不做业务抓取派发**——抓取属于独立的 fetch 插件，本插件只保持整池热连接。
 */

export type HotSlotState = "pending" | "warming" | "hot" | "failed" | "denied";

export interface HotPoolOptions {
  hostname: string;
  /** 预热 URL。 */
  warmupUrl: string;
  browser: string;
  proxy?: string;
  /** 单次请求总超时（毫秒）。 */
  timeoutMs: number;
  /** 连接建立超时（毫秒）；不可达 IP 快速失败。 */
  connectTimeoutMs?: number;
  /** 冷探活（尚未入热池）的请求超时（毫秒）；比 `timeoutMs` 短，避免死 IP 拖尾。 */
  coldTimeoutMs?: number;
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

/** 一次「经热连接派发」的结果。 */
export interface HotDispatchResult {
  ip: string;
  status: number;
  bytes: number;
  durationMs: number;
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
  connectTimeoutMs: 4000,
  coldTimeoutMs: 6000,
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
  private readonly connectTimeoutMs: number;
  private readonly coldTimeoutMs: number;
  private readonly slots = new Map<string, Slot>();
  private readonly hotIps: string[] = [];
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
    this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULTS.connectTimeoutMs;
    this.coldTimeoutMs = options.coldTimeoutMs ?? DEFAULTS.coldTimeoutMs;
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

  /** 当前已建立热连接的 IP 列表（绿色通道）。 */
  hotIpList(): string[] {
    return [...this.hotIps];
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
   * 用**指定热 IP 的常驻连接**发一次请求（绿色通道）。
   * 只走已建连的热连接；该 IP 未处于热状态直接报错。
   * `403/429` 丢弃该连接并退出热池；传输失败同样丢弃、由后台重热。
   */
  async dispatch(ip: string, url: string = this.options.warmupUrl): Promise<HotDispatchResult> {
    const slot = this.slots.get(ip);
    if (!slot) throw new Error(`热池未登记的 IP：${ip}`);
    const client = slot.client;
    if (!client) throw new Error(`IP 无热连接：${ip}`);

    const started = Date.now();
    try {
      const res = await client.get(url, { timeout: this.options.timeoutMs });
      const buf = new Uint8Array(await res.arrayBuffer());
      const durationMs = Date.now() - started;
      slot.lastStatus = res.status;
      if (res.status === this.successStatus) {
        slot.lastUsedAt = Date.now();
      } else if (this.deniedStatuses.includes(res.status)) {
        slot.client = undefined;
        client.close();
        slot.state = "denied";
        this.evictHot(ip);
      }
      return { ip, status: res.status, bytes: buf.length, durationMs };
    } catch (err) {
      slot.client?.close();
      slot.client = undefined;
      this.evictHot(ip);
      slot.state = "failed";
      slot.lastError = err instanceof Error ? err.message : String(err);
      slot.nextReheatAt = Date.now() + this.backoffMs;
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
      connectTimeout: this.connectTimeoutMs,
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
      const res = await client.get(this.options.warmupUrl, { timeout: this.coldTimeoutMs });
      const outcome =
        res.status === this.successStatus ? "hot" : this.deniedStatuses.includes(res.status) ? "denied" : "retry";
      await res.arrayBuffer().catch(() => undefined);
      slot.lastStatus = res.status;

      if (outcome === "hot") {
        slot.client = client;
        slot.state = "hot";
        slot.lastError = undefined;
        slot.lastUsedAt = Date.now();
        this.addHot(ip);
        return;
      }
      client.close();
      if (outcome === "denied") {
        slot.state = "denied";
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

/** 有界并发执行（`concurrency <= 0` 表示不限并发）。 */
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
