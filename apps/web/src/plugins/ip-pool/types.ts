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
export type StatsSnapshot = Omit<StoreSnapshot, "pool"> & {
  pool: PoolCounts;
  /** 已建立常驻热连接的 IP（绿色通道）。运行时信息，不落盘。 */
  hotIps?: string[];
};

/** `pool` 动作返回：计数 + 聚合树。 */
export interface PoolPayload {
  hostname: string;
  updatedAt: string;
  pool: PoolCounts & { aggregate: PoolCountryNode[] };
}

/** `dispatch` / `dispatchStatus` 动作的返回：一次「经热池派发」作业的进度。 */
export interface DispatchStatus {
  /** 是否正在运行。 */
  running: boolean;
  url: string;
  /** 本次作业请求总数。 */
  total: number;
  /** 已完成数。 */
  done: number;
  success: number;
  failed: number;
  /** 本次实际参与的热 IP 数。 */
  hot: number;
  startedAt: number;
  finishedAt?: number;
  elapsedMs?: number;
  /** 完成速率（个 / 秒）。 */
  rps?: number;
  /** 最近一次失败简述。 */
  lastError?: string;
}

/** 空作业（尚未派发过）。 */
export const EMPTY_DISPATCH_STATUS: DispatchStatus = {
  running: false,
  url: "",
  total: 0,
  done: 0,
  success: 0,
  failed: 0,
  hot: 0,
  startedAt: 0,
};

/** SSE `metrics` 事件：请求速率 + 网卡流量 + 热池（约每秒一帧）。 */
export interface StreamMetrics {
  ts: number;
  /** 本采样窗口内的请求数（个/秒）。 */
  rps: number;
  rpsOk: number;
  rpsFail: number;
  /** 网卡收发速率（字节/秒）；无数据为 null。 */
  rxBps: number | null;
  txBps: number | null;
  /** 热池：已建连 IP 数。 */
  hot: number;
  poolTotal: number;
  /** 累计请求数（用于前端对齐）。 */
  totalRequests: number;
}

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
  /** 重置次数；变化即代表前端应清空本地脉冲/采样/日志。 */
  resetEpoch: number;
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
  /** 该 IP 已建立常驻热连接（绿色通道）。 */
  hot?: boolean;
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
  resetEpoch: number;
}

/** `resetStats` 动作的返回。 */
export interface ResetStatsResult {
  clearedIps: number;
  resetEpoch: number;
}
