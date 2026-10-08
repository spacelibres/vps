import type { FetchRouteOrigin } from "./types";

/**
 * 解析弹道起点字符串 `"lat,lng[,label]"`。
 * 纯逻辑（无 `node:*`、无 DOM），可被服务端与客户端复用。
 */
export function parseOrigin(raw: string | undefined): FetchRouteOrigin | undefined {
  if (!raw) return undefined;
  const [latRaw, lngRaw, label] = raw.split(",");
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  return { lat, lng, label: label?.trim() || undefined };
}

/** 从环境变量 `IP_POOL_ORIGIN` 读取弹道起点。 */
export function originFromEnv(): FetchRouteOrigin | undefined {
  return parseOrigin(process.env.IP_POOL_ORIGIN);
}
