/**
 * 插件：IP 池 · 航线（id: ip-pool）
 *
 * | 动作 | method | needsVps | 输入 | 输出 |
 * |---|---|---|---|---|
 * | ingest | POST | false | `IngestInput` | `IngestResult`（本插件 types） |
 * | stats | GET | false | `{}` | `StatsSnapshot`（本插件 types） |
 * | pool | GET | false | `{}` | `PoolPayload`（本插件 types） |
 * | snapshot | POST | false | `{}` | `{ events, rowsMerged, revision }` |
 * | fetch | POST | false | `{ url?, ip?, browser?, noPin?, timeoutMs? }` | `FetchActionResult`（本插件 types） |
 * | fetchBatch | POST | false | `{ url?, ips?, family?, limit?, concurrency?, browser?, timeoutMs? }` | `FetchBatchStatus`（本插件 types） |
 * | batchStatus | GET | false | `{}` | `FetchBatchStatus`（本插件 types） |
 * | stream | GET | false | `{}` | `Response`（SSE，`raw: true`） |
 *
 * 本插件的 `fetch` / `fetchBatch` 动作会用 node-wreq 真实抓取（浏览器指纹 + 可钉池内 IP），
 * 结果写入统计即成为弹道数据源；其余动作只消费事件、不发起请求。
 */
import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { batchStatus, isBatchRunning, startBatch } from "./batch";
import { fetchConfig } from "./config";
import { IP_POOL_META } from "./descriptor";
import { fetchOnce, type PinnedFetchResult } from "./fetch";
import { getHostPinPool } from "./host-pin";
import { applyFileSnapshot, snapshotFilesFromEnv } from "./snapshot";
import { createSseResponse } from "./sse";
import { getStore } from "./store";
import type {
  FetchActionResult,
  FetchBatchStatus,
  FetchFlightPath,
  IngestInput,
  StatsSnapshot,
} from "./types";
import { ipPoolViews } from "./view";

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
    const snap = getStore().snapshot();
    const { aggregate: _aggregate, ...pool } = snap.pool;
    const payload: StatsSnapshot = { ...snap, pool };
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

const fetchSchema = z.object({
  url: z.string().optional(),
  ip: z.string().optional(),
  browser: z.string().optional(),
  noPin: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

/**
 * 一期核心：用 node-wreq 真实抓取一次（浏览器指纹 + 可钉池内 IP），
 * 结果写入统计，从而成为弹道与统计的真实数据源。
 */
export const fetchAction = defineAction({
  id: "fetch",
  label: "抓取一次",
  description: "按 IP 池钉住某台前端 IP、带浏览器指纹真实抓取一次并计入统计",
  method: "POST",
  needsVps: false,
  input: fetchSchema,
  run: async (_ctx, input): Promise<FetchActionResult> => {
    const cfg = fetchConfig();
    const store = getStore();
    const url = input.url ?? cfg.targetUrl;
    let pin: { hostname: string; ip: string } | null = null;
    if (!input.noPin) {
      if (input.ip) {
        pin = { hostname: cfg.hostname, ip: input.ip };
      } else {
        const resolved = getHostPinPool({
          hostname: cfg.hostname,
          poolFile: cfg.poolFile,
        }).resolveForUrl(url);
        pin = { hostname: resolved.hostname, ip: resolved.pinnedIp };
      }
    }

    const requestId = `fetch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const at = Date.now();
    const startedAt = at;
    let result: PinnedFetchResult | null = null;
    let outcome: FetchActionResult["outcome"] = "transport_error";
    let error: string | undefined;

    try {
      result = await fetchOnce({
        url,
        proxy: cfg.proxy,
        browser: input.browser ?? cfg.browser,
        timeoutMs: input.timeoutMs ?? cfg.timeoutMs,
        pin,
      });
      outcome = result.ok ? "success" : "http_error";
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    const ip = result?.pinnedIp ?? pin?.ip;
    const durationMs = result?.durationMs ?? Date.now() - startedAt;
    store.ingest({
      origin: cfg.origin,
      attempts: [
        {
          requestId,
          url,
          attempt: 1,
          ip,
          outcome,
          httpStatus: result?.status,
          durationMs,
          bytes: result?.bytes,
          at,
        },
      ],
      requests: [
        {
          requestId,
          url,
          outcome: outcome === "success" ? "success" : "failed",
          attempts: 1,
          totalDurationMs: durationMs,
          finalIp: ip,
          finalStatus: result?.status,
          ipsUsed: ip ? [ip] : [],
          bytes: result?.bytes,
          at,
        },
      ],
    });
    store.flush();

    return {
      requestId,
      url,
      outcome,
      ok: result?.ok ?? false,
      status: result?.status,
      statusText: result?.statusText,
      bytes: result?.bytes ?? 0,
      durationMs,
      waitMs: result?.waitMs,
      contentType: result?.contentType,
      server: result?.server,
      pinnedIp: ip,
      error,
      recorded: true,
    };
  },
});

const fetchBatchSchema = z.object({
  url: z.string().optional(),
  ips: z.array(z.string()).optional(),
  family: z.enum(["all", "ipv4", "ipv6"]).default("all"),
  limit: z.number().int().positive().max(5000).optional(),
  concurrency: z.number().int().min(1).max(64).default(16),
  browser: z.string().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
});

/**
 * 批量抓取：对全池（或指定 IP / 地址族 / 限量）逐 IP 钉住后抓取一次。
 * **后台运行**，立即返回作业进度；逐条结果写入 Store，经 SSE 实时推送弹道。
 */
export const fetchBatchAction = defineAction({
  id: "fetchBatch",
  label: "全池抓取",
  description: "对 IP 池内每个 IP 钉住后各抓取一次（有界并发，后台运行）",
  method: "POST",
  needsVps: false,
  input: fetchBatchSchema,
  run: (_ctx, input): Promise<FetchBatchStatus> => {
    if (isBatchRunning()) return Promise.resolve(batchStatus());
    return Promise.resolve(
      startBatch({
        url: input.url,
        ips: input.ips,
        family: input.family,
        limit: input.limit,
        concurrency: input.concurrency,
        browser: input.browser,
        timeoutMs: input.timeoutMs,
      }),
    );
  },
});

/** 出口：批量抓取作业进度。 */
export const batchStatusAction = defineAction({
  id: "batchStatus",
  input: z.object({}),
  label: "全池抓取进度",
  method: "GET",
  needsVps: false,
  run: (): Promise<FetchBatchStatus> => Promise.resolve(batchStatus()),
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
  fetchAction,
  fetchBatchAction,
  batchStatusAction,
  statsAction,
  poolAction,
  snapshotAction,
  streamAction,
];

/**
 * IP 池插件：管理 Google 前端 IP 池、统计真实请求表现、绘制弹道航线。
 * `fetch` / `fetchBatch` 用 node-wreq 按池内 IP 发起真实抓取（指纹 + 钉 IP + 代理），
 * 其余动作只消费已落盘的真实事件，不额外发起请求。
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
