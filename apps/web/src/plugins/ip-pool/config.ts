import { parseOrigin } from "./origin";
import { resolvePoolFile } from "./store";

/** 抓取相关配置（全部来自环境变量，含合理默认值）。 */
export interface IpPoolFetchConfig {
  hostname: string;
  targetUrl: string;
  /** node-wreq 的浏览器指纹 profile（如 `chrome_136`）。 */
  browser: string;
  /** 代理 URL；直连不通时必填（如 `socks5h://127.0.0.1:20170`）。 */
  proxy?: string;
  timeoutMs: number;
  /** 弹道起点（`IP_POOL_ORIGIN="lat,lng[,label]"`）。 */
  origin?: { lat: number; lng: number; label?: string };
  poolFile: string;
}

const DEFAULT_TARGET_URL = "https://kh.google.com/rt/earth/PlanetoidMetadata";
const DEFAULT_BROWSER = "chrome_136";
const DEFAULT_TIMEOUT_MS = 20_000;

function parseOriginEnv(raw: string | undefined): IpPoolFetchConfig["origin"] {
  return parseOrigin(raw);
}

/** 读取环境变量得到抓取配置。 */
export function fetchConfig(): IpPoolFetchConfig {
  return {
    hostname: process.env.IP_POOL_HOSTNAME ?? "kh.google.com",
    targetUrl: process.env.IP_POOL_TARGET_URL ?? DEFAULT_TARGET_URL,
    browser: process.env.IP_POOL_BROWSER ?? DEFAULT_BROWSER,
    proxy:
      process.env.IP_POOL_PROXY ??
      process.env.ALL_PROXY ??
      process.env.HTTPS_PROXY ??
      process.env.https_proxy,
    timeoutMs: Number(process.env.IP_POOL_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    origin: parseOriginEnv(process.env.IP_POOL_ORIGIN),
    poolFile: resolvePoolFile(),
  };
}
