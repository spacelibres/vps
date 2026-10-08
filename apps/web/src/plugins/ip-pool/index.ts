/**
 * 插件：IP 池 · 航线（id: ip-pool）
 *
 * | 动作 | method | needsVps | 输入 | 输出 |
 * |---|---|---|---|---|
 * | ingest | POST | false | `IngestInput` | `IngestResult`（本插件 types） |
 * | stats | GET | false | `{}` | `StatsSnapshot`（本插件 types） |
 * | pool | GET | false | `{}` | `PoolPayload`（本插件 types） |
 * | snapshot | POST | false | `{}` | `{ events, rowsMerged, revision }` |
 * | dispatch | POST | false | `{ url?, count, concurrency? }` | `DispatchStatus`（本插件 types） |
 * | dispatchStatus | GET | false | `{}` | `DispatchStatus`（本插件 types） |
 * | resetStats | POST | false | `{}` | `ResetStatsResult`（本插件 types） |
 * | stream | GET | false | `{}` | `Response`（SSE，`raw: true`） |
 *
 * 本插件只做 IP 池管理、请求统计与航线可视化：不主动发起抓取，
 * 事件由外部发送方经 `ingest` / `snapshot` 接入；`dispatch` 由外部触发，
 * 复用**已预热的热连接**出网。
 */
import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { IP_POOL_META } from "./descriptor";
import { dispatchStatus, isDispatchRunning, startDispatch } from "./dispatch";
import { applyFileSnapshot, snapshotFilesFromEnv } from "./snapshot";
import { createSseResponse } from "./sse";
import { getStore } from "./store";
import type {
  DispatchStatus,
  FetchFlightPath,
  IngestInput,
  ResetStatsResult,
  StatsSnapshot,
} from "./types";
import { ipPoolViews } from "./view";
import { ensurePoolWarm, hotIpList } from "./warm";

const attemptSchema = z.object({
  requestId: z.string().min(1),
  url: z.string().default(""),
  attempt: z.number().int().nonnegative().default(1),
  ip: z.string().optional(),
  outcome: z.enum(["success", "http_error", "transport_error", "no_hot_ip"]),
  httpStatus: z.number().int().optional(),
  durationMs: z.number().nonnegative().default(0),
  bytes: z.number().nonnegative().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  at: z.number().default(() => Date.now()),
});

const requestSchema = z.object({
  requestId: z.string().min(1),
  url: z.string().default(""),
  outcome: z.enum(["success", "failed"]),
  attempts: z.number().int().nonnegative().default(1),
  totalDurationMs: z.number().nonnegative().default(0),
  finalIp: z.string().optional(),
  finalStatus: z.number().int().optional(),
  ipsUsed: z.array(z.string()).default([]),
  bytes: z.number().nonnegative().optional(),
  at: z.number().default(() => Date.now()),
});

const waypointSchema = z.object({
  role: z.enum(["origin", "proxy", "target"]),
  lat: z.number(),
  lng: z.number(),
  label: z.string().default(""),
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().optional(),
  ip: z.string().optional(),
  hostname: z.string().optional(),
});

const flightPathSchema = z.object({
  requestId: z.string().min(1),
  url: z.string().default(""),
  targetHostname: z.string().default(""),
  dnsMode: z.enum(["hostpin", "system"]).default("hostpin"),
  pinnedIp: z.string().optional(),
  waypoints: z.array(waypointSchema).min(2),
  legs: z
    .array(
      z.object({
        fromIndex: z.number().int(),
        toIndex: z.number().int(),
        durationMs: z.number().nonnegative().default(0),
      }),
    )
    .default([]),
  totalDurationMs: z.number().nonnegative().default(0),
  bodyBytes: z.number().nonnegative().optional(),
  httpStatus: z.number().int().optional(),
  viaHot: z.boolean().optional(),
  http2: z.boolean().optional(),
  colorKey: z.string().optional(),
});

const ingestSchema = z.object({
  hostname: z.string().optional(),
  origin: z
    .object({
      lat: z.number(),
      lng: z.number(),
      city: z.string().optional(),
      region: z.string().optional(),
      country: z.string().optional(),
      label: z.string().optional(),
    })
    .optional(),
  attempts: z.array(attemptSchema).default([]),
  requests: z.array(requestSchema).default([]),
  flightPaths: z.array(flightPathSchema).default([]),
});

type ParsedIngest = z.infer<typeof ingestSchema>;

/** 补全 `colorKey`（`pinnedIp ?? requestId`）。 */
function normalizeFlightPaths(paths: ParsedIngest["flightPaths"]): FetchFlightPath[] {
  return paths.map((p) => ({
    ...p,
    colorKey: p.colorKey ?? p.pinnedIp ?? p.requestId,
  }));
}

/** 入口 A：HTTP 接入一批真实请求事件（幂等）。 */
export const ingestAction = defineAction({
  id: "ingest",
  label: "接入请求事件",
  description: "接收外部发送方推送的真实请求事件（attempts / requests / flightPaths）",
  method: "POST",
  needsVps: false,
  input: ingestSchema,
  run: (_ctx, input) => {
    const payload: IngestInput = {
      hostname: input.hostname,
      origin: input.origin,
      attempts: input.attempts,
      requests: input.requests,
      flightPaths: normalizeFlightPaths(input.flightPaths),
    };
    return Promise.resolve(getStore().ingest(payload));
  },
});

/** 出口：统计快照（池子聚合 + 每 IP 统计 + 最近事件）。 */
export const statsAction = defineAction({
  id: "stats",
  input: z.object({}),
  label: "统计快照",
  method: "GET",
  needsVps: false,
  run: () => {
    ensurePoolWarm();
    const snap = getStore().snapshot();
    const { aggregate: _aggregate, ...pool } = snap.pool;
    const payload: StatsSnapshot = { ...snap, pool, hotIps: hotIpList() };
    return Promise.resolve(payload);
  },
});

/** 出口：仅 IP 池聚合（供侧栏树使用，比 stats 轻）。 */
export const poolAction = defineAction({
  id: "pool",
  input: z.object({}),
  label: "IP 池聚合",
  method: "GET",
  needsVps: false,
  run: () => {
    const snap = getStore().snapshot();
    return Promise.resolve({
      hostname: snap.hostname,
      updatedAt: snap.updatedAt,
      pool: snap.pool,
    });
  },
});

/** 入口 B：重新应用文件快照（`IP_POOL_EVENTS_FILE` / `IP_POOL_STATS_FILE`）。 */
export const snapshotAction = defineAction({
  id: "snapshot",
  input: z.object({}),
  label: "重载文件快照",
  description: "从环境变量指定的 JSONL 事件文件 / 统计 YAML 重新导入",
  method: "POST",
  needsVps: false,
  run: () => {
    const store = getStore();
    const applied = applyFileSnapshot(store, snapshotFilesFromEnv());
    return Promise.resolve({ ...applied, revision: store.revision });
  },
});

/**
 * 派发：让外部（本机）触发一次「经热池出网」作业。
 * 复用已预热的常驻热连接逐条请求，结果写统计 + 生成弹道。
 * 后台异步运行，立即返回进度快照；`count` 为请求总数。
 */
const dispatchSchema = z.object({
  /** 目标 URL；缺省用配置的 `IP_POOL_TARGET_URL`。 */
  url: z.string().optional(),
  count: z.number().int().positive().max(1_000_000),
  /** 在飞请求上限；`0` = 不设上限（会拖慢每个请求）。缺省用 `IP_POOL_DISPATCH_CONCURRENCY`（默认 256）。 */
  concurrency: z.number().int().min(0).max(4096).optional(),
});

export const dispatchAction = defineAction({
  id: "dispatch",
  label: "经热池派发",
  description: "用已预热的常驻热连接对指定 URL 发起 count 次请求（异步，结果计入统计）",
  method: "POST",
  needsVps: false,
  input: dispatchSchema,
  run: (_ctx, input): Promise<DispatchStatus> => {
    if (isDispatchRunning()) return Promise.resolve(dispatchStatus());
    return Promise.resolve(
      startDispatch({ url: input.url, count: input.count, concurrency: input.concurrency }),
    );
  },
});

/** 出口：派发作业进度。 */
export const dispatchStatusAction = defineAction({
  id: "dispatchStatus",
  input: z.object({}),
  label: "派发进度",
  method: "GET",
  needsVps: false,
  run: (): Promise<DispatchStatus> => Promise.resolve(dispatchStatus()),
});

/**
 * 重置统计：清空所有 IP 计数与最近事件并落盘。
 * 远程 SSE 客户端通过 `resetEpoch` 变化收到 `reset` 事件后清空本地脉冲/采样/日志。
 * 热连接属运行时状态，不受影响。
 */
export const resetStatsAction = defineAction({
  id: "resetStats",
  input: z.object({}),
  label: "重置统计",
  method: "POST",
  needsVps: false,
  run: (): Promise<ResetStatsResult> => {
    const store = getStore();
    const { clearedIps } = store.reset();
    return Promise.resolve({ clearedIps, resetEpoch: store.resetEpoch });
  },
});

/** 出口 C：SSE 实时流。 */
export const streamAction = defineAction({
  id: "stream",
  input: z.object({}),
  label: "实时流（SSE）",
  method: "GET",
  needsVps: false,
  raw: true,
  run: () => Promise.resolve(createSseResponse()),
});

/**
 * 本插件的全部服务端动作（含 `node:fs` 依赖，属服务端模块）。
 * 客户端只使用 {@link ./descriptor}。
 */
export const ipPoolActions: readonly PluginAction[] = [
  ingestAction,
  dispatchAction,
  dispatchStatusAction,
  resetStatsAction,
  statsAction,
  poolAction,
  snapshotAction,
  streamAction,
];

/**
 * IP 池插件：管理 Google 前端 IP 池、统计请求表现、绘制航线。
 * 只消费外部经 `ingest` / `snapshot` 接入的事件；`dispatch` 由外部触发，
 * 复用**已预热的热连接**出网，不在插件内做测试性抓取。
 */
export class IpPoolPlugin extends BasePlugin {
  readonly id = IP_POOL_META.id;
  readonly name = IP_POOL_META.name;
  override readonly description = IP_POOL_META.description;
  override readonly icon = IP_POOL_META.icon;
  override readonly order = IP_POOL_META.order;
  readonly actions = ipPoolActions;
  readonly views = ipPoolViews;
}

export default IpPoolPlugin;
