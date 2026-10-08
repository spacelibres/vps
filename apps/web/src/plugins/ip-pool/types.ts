/**
 * 本插件的领域类型（借鉴 GeoClaw `src/fetch` 的模型）。
 * 纯类型模块：**客户端安全**，不含任何 node/fs 依赖。
 */

import type { GeoPoint } from "./geo";

// ── IP 池 ────────────────────────────────────────────────

/** 地址族。 */
export type HostPinFamily = "ipv4" | "ipv6";

/** YAML 中单条 IP 记录（借鉴 GeoClaw 的 HostPinRecord）。 */
export interface HostPinRecord {
  ip: string;
  family: HostPinFamily;
  hostname?: string;
  city?: string;
  region?: string;
  country?: string;
  /** 原始 "lat,lng" 字符串 */
  loc?: string;
  org?: string;
  timezone?: string;
}

/** 池子聚合：单个 IP 节点。 */
export interface PoolIpNode {
  ip: string;
  family: HostPinFamily;
  hostname?: string;
  org?: string;
  timezone?: string;
  loc?: string;
  point: GeoPoint | null;
}

/** 池子聚合：城市节点。 */
export interface PoolCityNode {
  city: string;
  region?: string;
  total: number;
  ips: PoolIpNode[];
}

/** 池子聚合：国家节点。 */
export interface PoolCountryNode {
  country: string;
  total: number;
  cities: PoolCityNode[];
}

// ── 请求事件 ─────────────────────────────────────────────

export type FetchAttemptOutcome =
  | "success"
  | "http_error"
  | "transport_error"
  | "no_hot_ip";

/** 每次「尝试」记录（= GeoClaw FetchAttemptRecord）。 */
export interface FetchAttemptRecord {
  requestId: string;
  url: string;
  attempt: number;
  ip?: string;
  outcome: FetchAttemptOutcome;
  httpStatus?: number;
  durationMs: number;
  bytes?: number;
  city?: string;
  region?: string;
  country?: string;
  at: number;
}

/** 一次「业务请求」的最终结果（= GeoClaw FetchRequestRecord）。 */
export interface FetchRequestRecord {
  requestId: string;
  url: string;
  outcome: "success" | "failed";
  attempts: number;
  totalDurationMs: number;
  finalIp?: string;
  finalStatus?: number;
  ipsUsed: string[];
  bytes?: number;
  at: number;
}

// ── 统计 ─────────────────────────────────────────────────

/** 单 IP 累计统计（= GeoClaw IpFetchStatRow）。 */
export interface IpFetchStatRow {
  requests: number;
  success: number;
  failed: number;
  totalBytes: number;
  totalDurationMs: number;
  avgDurationMs?: number;
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
}

/** 计数器桶（= GeoClaw FetchCounterBucket）。 */
export interface FetchCounterBucket {
  attempts: number;
  success: number;
  failed: number;
  totalDurationMs: number;
  totalBytes?: number;
  avgDurationMs?: number;
}

/** 请求统计汇总。 */
export interface StoreSummary {
  totalRequests: number;
  totalSuccess: number;
  totalFailed: number;
  totalAttempts: number;
  totalBytes: number;
  byCountry: Record<string, FetchCounterBucket>;
  byRegion: Record<string, FetchCounterBucket>;
}

// ── 弹道 ─────────────────────────────────────────────────

/** 弹道起点（= GeoClaw FetchRouteOrigin）。 */
export interface FetchRouteOrigin {
  lat: number;
  lng: number;
  city?: string;
  region?: string;
  country?: string;
  label?: string;
}

/** 地图航点（= GeoClaw FlightWaypoint）。 */
export interface FlightWaypoint {
  role: "origin" | "proxy" | "target";
  lat: number;
  lng: number;
  label: string;
  city?: string;
  region?: string;
  country?: string;
  ip?: string;
  hostname?: string;
}

/** 航段（= GeoClaw FlightLeg）。 */
export interface FlightLeg {
  fromIndex: number;
  toIndex: number;
  durationMs: number;
}

/** 单次请求的飞行路线（= GeoClaw FetchFlightPath）。 */
export interface FetchFlightPath {
  requestId: string;
  url: string;
  targetHostname: string;
  dnsMode: "hostpin" | "system";
  pinnedIp?: string;
  waypoints: FlightWaypoint[];
  legs: FlightLeg[];
  totalDurationMs: number;
  bodyBytes?: number;
  httpStatus?: number;
  viaHot?: boolean;
  http2?: boolean;
  /** 着色键：`pinnedIp ?? finalIp ?? requestId`，前端按它取色。 */
  colorKey: string;
}

// ── 接口 ─────────────────────────────────────────────────

/** `ingest` 动作的输入。 */
export interface IngestInput {
  hostname?: string;
  origin?: FetchRouteOrigin;
  attempts?: FetchAttemptRecord[];
  requests?: FetchRequestRecord[];
  flightPaths?: FetchFlightPath[];
}

/** `ingest` 动作的返回。 */
export interface IngestResult {
  hostname: string;
  accepted: {
    attempts: number;
    requests: number;
    flightPaths: number;
    duplicates: number;
  };
  revision: number;
}

/** 池子计数（不含庞大的 aggregate）。 */
export interface PoolCounts {
  total: number;
  ipv4: number;
  ipv6: number;
  countries: number;
  cities: number;
}

/** `stats` 动作返回：快照但不含池子聚合（聚合由 `pool` 动作单独提供）。 */
export type StatsSnapshot = Omit<StoreSnapshot, "pool"> & { pool: PoolCounts };

/** `pool` 动作返回：计数 + 聚合树。 */
export interface PoolPayload {
  hostname: string;
  updatedAt: string;
  pool: PoolCounts & { aggregate: PoolCountryNode[] };
}

/** `fetch` 动作的返回。 */
export interface FetchActionResult {
  requestId: string;
  url: string;
  outcome: "success" | "http_error" | "transport_error";
  ok: boolean;
  status?: number;
  statusText?: string;
  bytes: number;
  durationMs: number;
  waitMs?: number;
  contentType?: string;
  server?: string;
  pinnedIp?: string;
  error?: string;
  /** 是否已计入统计（写入 Store）。 */
  recorded: boolean;
}

/** `fetchBatch` / `batchStatus` 动作的返回：一次全池（或指定范围）抓取作业的进度。 */
export interface FetchBatchStatus {
  /** 是否正在运行。 */
  running: boolean;
  /** 本次作业的 IP 总数。 */
  total: number;
  /** 已完成数（成功 + HTTP 错误 + 传输错误）。 */
  done: number;
  success: number;
  httpError: number;
  transportError: number;
  /** 实际并发上限。 */
  concurrency: number;
  /** 作业起始 / 结束时刻（UNIX ms）；未开始为 0。 */
  startedAt: number;
  finishedAt?: number;
  /** 最近一次失败的简述。 */
  lastError?: string;
}

/** 空作业（尚未跑过任何批量抓取）。 */
export const EMPTY_BATCH_STATUS: FetchBatchStatus = {
  running: false,
  total: 0,
  done: 0,
  success: 0,
  httpError: 0,
  transportError: 0,
  concurrency: 0,
  startedAt: 0,
};

/** SSE `snapshot` 事件的形状。 */
export interface StreamSnapshot {
  hostname: string;
  updatedAt: string;
  origin: FetchRouteOrigin | null;
  summary: StoreSummary;
  recentRequests: FetchRequestRecord[];
  recentAttempts: FetchAttemptRecord[];
  recentFlightPaths: FetchFlightPath[];
  revision: number;
}

/** SSE `pulse` 事件的形状。 */
export interface StreamPulse {
  revision: number;
  summary: StoreSummary;
  attempts: FetchAttemptRecord[];
  requests: FetchRequestRecord[];
  flightPaths: FetchFlightPath[];
}

/** 地图上的一条脉冲航线（预绘骨架 / 点亮）。 */
export interface RoutePulse {
  id: string;
  color: string;
  idleColor: string;
  latlngs: Array<{ lat: number; lng: number }>;
  bornAt: number;
  drawMs: number;
  holdMs: number;
  fadeMs: number;
  pinnedIp?: string;
  active: boolean;
}
export interface StoreSnapshot {
  hostname: string;
  updatedAt: string;
  origin: FetchRouteOrigin | null;
  pool: {
    total: number;
    ipv4: number;
    ipv6: number;
    countries: number;
    cities: number;
    aggregate: PoolCountryNode[];
  };
  summary: StoreSummary;
  rows: Array<IpFetchStatRow & { ip: string }>;
  recentRequests: FetchRequestRecord[];
  recentAttempts: FetchAttemptRecord[];
  recentFlightPaths: FetchFlightPath[];
  revision: number;
}
