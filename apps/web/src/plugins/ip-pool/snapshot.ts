import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { IpPoolStore } from "./store";
import type {
  FetchAttemptRecord,
  FetchFlightPath,
  FetchRequestRecord,
  IngestInput,
  IpFetchStatRow,
} from "./types";

export interface EventsFileResult extends IngestInput {
  /** 解析失败/跳过的行数。 */
  skipped: number;
}

function detectKind(obj: Record<string, unknown>): "attempt" | "request" | "flightPath" | "origin" | null {
  const declared = obj.kind ?? obj.type;
  if (declared === "attempt" || declared === "request" || declared === "flightPath" || declared === "origin") {
    return declared;
  }
  if (Array.isArray(obj.waypoints)) return "flightPath";
  if (typeof obj.attempt === "number" && typeof obj.outcome === "string") return "attempt";
  if (Array.isArray(obj.ipsUsed) || typeof obj.totalDurationMs === "number") return "request";
  if (typeof obj.lat === "number" && typeof obj.lng === "number") return "origin";
  return null;
}

/**
 * 入口 B：读取 JSONL 事件文件（每行一个事件；带 `kind` 字段或自动识别）。
 */
export function readEventsFile(file: string): EventsFileResult {
  const result: EventsFileResult = { attempts: [], requests: [], flightPaths: [], skipped: 0 };
  if (!existsSync(file)) return result;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      result.skipped += 1;
      continue;
    }
    const kind = detectKind(obj);
    if (kind === "attempt") result.attempts!.push(obj as unknown as FetchAttemptRecord);
    else if (kind === "request") result.requests!.push(obj as unknown as FetchRequestRecord);
    else if (kind === "flightPath") result.flightPaths!.push(obj as unknown as FetchFlightPath);
    else if (kind === "origin") result.origin = obj as unknown as IngestInput["origin"];
    else result.skipped += 1;
  }
  return result;
}

export interface StatsFileResult {
  hostname?: string;
  updatedAt?: string;
  ips: Record<string, IpFetchStatRow>;
}

/**
 * 入口 B：读取统计 YAML（兼容本插件落盘格式与 GeoClaw 的
 * `{ hostname, updatedAt, ips: Record<ip, IpFetchStatRow> }`）。
 */
export function readStatsFile(file: string): StatsFileResult {
  if (!existsSync(file)) return { ips: {} };
  try {
    const doc = parseYaml(readFileSync(file, "utf8")) as {
      hostname?: string;
      updatedAt?: string;
      ips?: Record<string, IpFetchStatRow>;
    } | null;
    return { hostname: doc?.hostname, updatedAt: doc?.updatedAt, ips: doc?.ips ?? {} };
  } catch {
    return { ips: {} };
  }
}

export interface ApplySnapshotOptions {
  eventsFile?: string | null;
  statsFile?: string | null;
}

export interface ApplySnapshotResult {
  events: { attempts: number; requests: number; flightPaths: number; skipped: number };
  rowsMerged: number;
}

/** 把文件快照应用进 Store（入口 B）。 */
export function applyFileSnapshot(
  store: IpPoolStore,
  options: ApplySnapshotOptions,
): ApplySnapshotResult {
  const events = { attempts: 0, requests: 0, flightPaths: 0, skipped: 0 };
  if (options.eventsFile) {
    const parsed = readEventsFile(options.eventsFile);
    const res = store.ingest(parsed);
    events.attempts = res.accepted.attempts;
    events.requests = res.accepted.requests;
    events.flightPaths = res.accepted.flightPaths;
    events.skipped = parsed.skipped;
  }
  let rowsMerged = 0;
  if (options.statsFile) {
    const parsed = readStatsFile(options.statsFile);
    rowsMerged = store.mergeRows(parsed.ips);
  }
  return { events, rowsMerged };
}

/** 环境变量配置的快照文件（可选）。 */
export function snapshotFilesFromEnv(): ApplySnapshotOptions {
  return {
    eventsFile: process.env.IP_POOL_EVENTS_FILE ?? null,
    statsFile: process.env.IP_POOL_STATS_FILE ?? null,
  };
}
