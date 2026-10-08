import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { buildFlightPath } from "./flight";
import { originFromEnv } from "./origin";
import {
  aggregatePool,
  loadPoolRecords,
  type HostPinRecord,
  type PoolCountryNode,
} from "./pool";
import type {
  FetchAttemptRecord,
  FetchCounterBucket,
  FetchFlightPath,
  FetchRequestRecord,
  FetchRouteOrigin,
  IngestInput,
  IngestResult,
  IpFetchStatRow,
  StoreSnapshot,
  StoreSummary,
} from "./types";

export interface StoreOptions {
  hostname: string;
  /** 池文件（kh.google.com.yaml）路径。 */
  poolFile: string;
  /** 统计落盘目录。 */
  dataDir: string;
  maxRecentAttempts?: number;
  maxRecentRequests?: number;
  maxRecentFlightPaths?: number;
  /** 定时兜底刷盘间隔（毫秒）。 */
  flushIntervalMs?: number;
  /** 记账后去抖刷盘延迟（毫秒）。 */
  debounceMs?: number;
  /** 弹道起点；缺省时依次回落文件持久值 / `IP_POOL_ORIGIN`。 */
  origin?: FetchRouteOrigin | null;
}

export interface PersistedFileShape {
  hostname: string;
  updatedAt: string;
  /** 弹道起点（持久化，避免 Store 重建后丢失）。 */
  origin?: FetchRouteOrigin | null;
  ips: Record<string, IpFetchStatRow>;
}

const sumBucket = (
  bucket: FetchCounterBucket,
  row: IpFetchStatRow,
): void => {
  bucket.attempts += row.requests;
  bucket.success += row.success;
  bucket.failed += row.failed;
  bucket.totalDurationMs += row.totalDurationMs;
  bucket.totalBytes = (bucket.totalBytes ?? 0) + row.totalBytes;
};

function emptyBucket(): FetchCounterBucket {
  return { attempts: 0, success: 0, failed: 0, totalDurationMs: 0, totalBytes: 0 };
}

function finalizeBucket(bucket: FetchCounterBucket): void {
  bucket.avgDurationMs =
    bucket.attempts > 0 ? Math.round(bucket.totalDurationMs / bucket.attempts) : 0;
}

/**
 * IP 池 + 请求统计的内存状态，**必须落盘**。
 *
 * 落盘位置：`{dataDir}/{hostname}.yaml`，格式
 * `{ hostname, updatedAt, ips: Record<ip, IpFetchStatRow> }`。
 */
export class IpPoolStore {
  readonly hostname: string;
  private readonly poolFile: string;
  private readonly dataFile: string;
  private readonly dataDir: string;

  private readonly maxRecentAttempts: number;
  private readonly maxRecentRequests: number;
  private readonly maxRecentFlightPaths: number;
  private readonly flushIntervalMs: number;
  private readonly debounceMs: number;

  private pool: HostPinRecord[] = [];
  private poolIndex = new Map<string, HostPinRecord>();
  private aggregate: PoolCountryNode[] = [];

  private readonly byIp = new Map<string, IpFetchStatRow>();
  private readonly byCountry = new Map<string, FetchCounterBucket>();
  private readonly byRegion = new Map<string, FetchCounterBucket>();
  private recentAttempts: FetchAttemptRecord[] = [];
  private recentRequests: FetchRequestRecord[] = [];
  private recentFlightPaths: FetchFlightPath[] = [];

  private origin: FetchRouteOrigin | null = null;

  private readonly seenAttempts = new Set<string>();
  private readonly seenRequests = new Set<string>();
  private readonly seenFlightPaths = new Set<string>();

  revision = 0;
  /** 重置次数（递增）；SSE 用它广播 `reset`。 */
  resetEpoch = 0;
  updatedAt = new Date().toISOString();

  private dirty = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: StoreOptions) {
    this.hostname = options.hostname;
    this.poolFile = options.poolFile;
    this.dataDir = options.dataDir;
    this.dataFile = path.join(options.dataDir, `${options.hostname}.yaml`);
    this.origin = options.origin ?? null;
    this.maxRecentAttempts = options.maxRecentAttempts ?? 400;
    this.maxRecentRequests = options.maxRecentRequests ?? 200;
    this.maxRecentFlightPaths = options.maxRecentFlightPaths ?? 200;
    this.flushIntervalMs = options.flushIntervalMs ?? 15_000;
    this.debounceMs = options.debounceMs ?? 2_000;

    this.loadPool();
    this.loadStats();
    // 起点优先级：构造参数 > 文件持久值 > `IP_POOL_ORIGIN`
    if (!this.origin) this.origin = originFromEnv() ?? null;

    if (this.flushIntervalMs > 0) {
      this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
      this.flushTimer.unref?.();
    }
  }

  private loadPool(): void {
    if (!existsSync(this.poolFile)) {
      throw new Error(`找不到 IP 池文件：${this.poolFile}`);
    }
    this.pool = loadPoolRecords(this.poolFile);
    this.poolIndex = new Map();
    for (const record of this.pool) {
      if (!this.poolIndex.has(record.ip)) this.poolIndex.set(record.ip, record);
    }
    this.aggregate = aggregatePool(this.pool);
  }

  private loadStats(): void {
    if (!existsSync(this.dataFile)) return;
    try {
      const doc = parseYaml(readFileSync(this.dataFile, "utf8")) as PersistedFileShape | null;
      for (const [ip, row] of Object.entries(doc?.ips ?? {})) {
        this.byIp.set(ip, { ...row, totalBytes: row.totalBytes ?? 0 });
      }
      this.updatedAt = doc?.updatedAt ?? this.updatedAt;
      if (!this.origin && doc?.origin) this.origin = doc.origin;
      this.rebuildBuckets();
    } catch (err) {
      console.error(`[ip-pool] 读取统计文件失败：${this.dataFile}`, err);
    }
  }

  /** 由 byIp 重建 byCountry / byRegion（加载后使用）。 */
  private rebuildBuckets(): void {
    this.byCountry.clear();
    this.byRegion.clear();
    for (const row of this.byIp.values()) {
      if (row.country) {
        const bucket = this.byCountry.get(row.country) ?? emptyBucket();
        sumBucket(bucket, row);
        this.byCountry.set(row.country, bucket);
      }
      if (row.region) {
        const bucket = this.byRegion.get(row.region) ?? emptyBucket();
        sumBucket(bucket, row);
        this.byRegion.set(row.region, bucket);
      }
    }
    for (const bucket of this.byCountry.values()) finalizeBucket(bucket);
    for (const bucket of this.byRegion.values()) finalizeBucket(bucket);
  }

  private geoFor(ip: string | undefined): IpFetchStatRow | undefined {
    if (!ip) return undefined;
    const record = this.poolIndex.get(ip);
    if (!record) return undefined;
    return {
      requests: 0,
      success: 0,
      failed: 0,
      totalBytes: 0,
      totalDurationMs: 0,
      city: record.city,
      region: record.region,
      country: record.country,
      loc: record.loc,
    };
  }

  /** 记账一次尝试。 */
  private applyAttempt(attempt: FetchAttemptRecord): void {
    if (!attempt.ip) return;
    let row = this.byIp.get(attempt.ip);
    if (!row) {
      const geo = this.geoFor(attempt.ip);
      row = geo ?? { requests: 0, success: 0, failed: 0, totalBytes: 0, totalDurationMs: 0 };
      this.byIp.set(attempt.ip, row);
    }
    // 事件里的地理信息优先补全缺项。
    row.city ??= attempt.city;
    row.region ??= attempt.region;
    row.country ??= attempt.country;

    const ok = attempt.outcome === "success";
    row.requests += 1;
    if (ok) row.success += 1;
    else row.failed += 1;
    row.totalBytes += attempt.bytes ?? 0;
    row.totalDurationMs += Math.max(0, attempt.durationMs);
    row.avgDurationMs = row.requests > 0 ? Math.round(row.totalDurationMs / row.requests) : 0;

    if (row.country) {
      const bucket = this.byCountry.get(row.country) ?? emptyBucket();
      bucket.attempts += 1;
      bucket.success += ok ? 1 : 0;
      bucket.failed += ok ? 0 : 1;
      bucket.totalDurationMs += Math.max(0, attempt.durationMs);
      bucket.totalBytes = (bucket.totalBytes ?? 0) + (attempt.bytes ?? 0);
      finalizeBucket(bucket);
      this.byCountry.set(row.country, bucket);
    }
    if (row.region) {
      const bucket = this.byRegion.get(row.region) ?? emptyBucket();
      bucket.attempts += 1;
      bucket.success += ok ? 1 : 0;
      bucket.failed += ok ? 0 : 1;
      bucket.totalDurationMs += Math.max(0, attempt.durationMs);
      bucket.totalBytes = (bucket.totalBytes ?? 0) + (attempt.bytes ?? 0);
      finalizeBucket(bucket);
      this.byRegion.set(row.region, bucket);
    }
  }

  private pushRecent<T>(list: T[], item: T, cap: number): void {
    list.push(item);
    if (list.length > cap) list.splice(0, list.length - cap);
  }

  /** 接入一批事件（幂等）。 */
  ingest(input: IngestInput): IngestResult {
    if (input.origin) this.origin = input.origin;

    let attempts = 0;
    let requests = 0;
    let flightPaths = 0;
    let duplicates = 0;

    for (const attempt of input.attempts ?? []) {
      const key = `${attempt.requestId}#${attempt.attempt}`;
      if (this.seenAttempts.has(key)) {
        duplicates += 1;
        continue;
      }
      this.seenAttempts.add(key);
      this.applyAttempt(attempt);
      this.pushRecent(this.recentAttempts, attempt, this.maxRecentAttempts);
      attempts += 1;
    }

    const incomingRequests: FetchRequestRecord[] = [];
    for (const request of input.requests ?? []) {
      if (this.seenRequests.has(request.requestId)) {
        duplicates += 1;
        continue;
      }
      this.seenRequests.add(request.requestId);
      this.pushRecent(this.recentRequests, request, this.maxRecentRequests);
      incomingRequests.push(request);
      requests += 1;
    }

    // 显式提供的航路
    for (const path of input.flightPaths ?? []) {
      if (this.seenFlightPaths.has(path.requestId)) {
        duplicates += 1;
        continue;
      }
      this.seenFlightPaths.add(path.requestId);
      this.pushRecent(this.recentFlightPaths, path, this.maxRecentFlightPaths);
      flightPaths += 1;
    }

    // 未提供航路时，由请求记录合成
    for (const request of incomingRequests) {
      if (this.seenFlightPaths.has(request.requestId)) continue;
      const geo = this.geoFor(request.finalIp);
      const synthesized = buildFlightPath({
        request,
        targetHostname: this.hostname,
        origin: this.origin,
        targetGeo: geo
          ? { city: geo.city, region: geo.region, country: geo.country, loc: geo.loc }
          : null,
      });
      if (!synthesized) continue;
      this.seenFlightPaths.add(request.requestId);
      this.pushRecent(this.recentFlightPaths, synthesized, this.maxRecentFlightPaths);
      flightPaths += 1;
    }

    if (attempts || requests || flightPaths) {
      this.revision += 1;
      this.updatedAt = new Date().toISOString();
      this.markDirty();
    }

    return {
      hostname: this.hostname,
      accepted: { attempts, requests, flightPaths, duplicates },
      revision: this.revision,
    };
  }

  summary(): StoreSummary {
    let totalRequests = 0;
    let totalSuccess = 0;
    let totalFailed = 0;
    let totalAttempts = 0;
    let totalBytes = 0;
    for (const row of this.byIp.values()) {
      totalRequests += row.requests;
      totalSuccess += row.success;
      totalFailed += row.failed;
      totalBytes += row.totalBytes;
    }
    for (const bucket of this.byCountry.values()) totalAttempts += bucket.attempts;
    return {
      totalRequests,
      totalSuccess,
      totalFailed,
      totalAttempts,
      totalBytes,
      byCountry: Object.fromEntries(this.byCountry),
      byRegion: Object.fromEntries(this.byRegion),
    };
  }

  private poolStats() {
    const ips = new Set(this.pool.map((r) => r.ip));
    let ipv4 = 0;
    let ipv6 = 0;
    const cities = new Set<string>();
    for (const record of this.pool) {
      if (record.family === "ipv4") ipv4 += 1;
      else ipv6 += 1;
    }
    for (const country of this.aggregate) {
      for (const city of country.cities) cities.add(`${country.country}/${city.city}`);
    }
    return {
      total: ips.size,
      ipv4,
      ipv6,
      countries: this.aggregate.length,
      cities: cities.size,
      aggregate: this.aggregate,
    };
  }

  snapshot(): StoreSnapshot {
    const rows = [...this.byIp.entries()]
      .map(([ip, row]) => ({ ip, ...row }))
      .sort((a, b) => b.requests - a.requests || a.ip.localeCompare(b.ip));
    return {
      hostname: this.hostname,
      updatedAt: this.updatedAt,
      origin: this.origin,
      pool: this.poolStats(),
      summary: this.summary(),
      rows,
      recentRequests: this.recentRequests,
      recentAttempts: this.recentAttempts,
      recentFlightPaths: this.recentFlightPaths,
      revision: this.revision,
      resetEpoch: this.resetEpoch,
    };
  }

  /**
   * 重置统计：清空所有计数与最近事件，并落盘。
   * @returns 被清除的 IP 数
   */
  reset(): { clearedIps: number } {
    const clearedIps = this.byIp.size;
    this.byIp.clear();
    this.byCountry.clear();
    this.byRegion.clear();
    this.recentAttempts = [];
    this.recentRequests = [];
    this.recentFlightPaths = [];
    this.seenAttempts.clear();
    this.seenRequests.clear();
    this.seenFlightPaths.clear();
    this.resetEpoch += 1;
    this.revision += 1;
    this.updatedAt = new Date().toISOString();
    this.markDirty();
    this.flush();
    return { clearedIps };
  }

  /**
   * 合并一批外部统计行（入口 B：文件快照导入）。
   * `mode="max"` 时保留请求数更大的一行；`"overwrite"` 时直接覆盖。
   */
  mergeRows(ips: Record<string, IpFetchStatRow>, mode: "max" | "overwrite" = "max"): number {
    let merged = 0;
    for (const [ip, row] of Object.entries(ips)) {
      const existing = this.byIp.get(ip);
      if (!existing || mode === "overwrite" || row.requests > existing.requests) {
        this.byIp.set(ip, { ...row, totalBytes: row.totalBytes ?? 0 });
        merged += 1;
      }
    }
    if (merged > 0) {
      this.rebuildBuckets();
      this.revision += 1;
      this.updatedAt = new Date().toISOString();
      this.markDirty();
    }
    return merged;
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }

  /** 立即刷盘（原子写：临时文件 + rename）。 */
  flush(): void {
    if (!this.dirty) return;
    try {
      mkdirSync(this.dataDir, { recursive: true });
      const payload: PersistedFileShape = {
        hostname: this.hostname,
        updatedAt: this.updatedAt,
        origin: this.origin ?? undefined,
        ips: Object.fromEntries(this.byIp),
      };
      const tmp = `${this.dataFile}.tmp`;
      writeFileSync(tmp, stringifyYaml(payload), "utf8");
      renameSync(tmp, this.dataFile);
      this.dirty = false;
    } catch (err) {
      console.error(`[ip-pool] 统计刷盘失败：${this.dataFile}`, err);
    }
  }

  dispose(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flush();
  }
}

/** 依次尝试若干候选路径，返回第一个存在的。 */
function firstExisting(candidates: string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1]!;
}

/** 解析池文件路径（依次尝试若干候选，可用 `IP_POOL_FILE` 覆盖）。 */
export function resolvePoolFile(): string {
  if (process.env.IP_POOL_FILE) return process.env.IP_POOL_FILE;
  const cwd = process.cwd();
  return firstExisting([
    path.join(cwd, "config", "kh.google.com.yaml"),
    path.join(cwd, "kh.google.com.yaml"),
    path.join(cwd, "..", "..", "kh.google.com.yaml"),
    path.join(cwd, "..", "kh.google.com.yaml"),
  ]);
}

let store: IpPoolStore | null = null;

/** 取进程内单例 Store（按 `IP_POOL_HOSTNAME`，默认 `kh.google.com`）。 */
export function getStore(): IpPoolStore {
  if (store) return store;
  const hostname = process.env.IP_POOL_HOSTNAME ?? "kh.google.com";
  store = new IpPoolStore({
    hostname,
    poolFile: resolvePoolFile(),
    dataDir: process.env.IP_POOL_DATA_DIR ?? path.join(process.cwd(), "data", "ip-stats"),
  });
  return store;
}
