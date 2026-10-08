import { fetch as wreqFetch } from "node-wreq";
import type { BrowserProfile } from "node-wreq";

/** 一次带指纹（可钉 IP）的 GET 结果。 */
export interface PinnedFetchResult {
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  bytes: number;
  /** 首字节时间（node-wreq `timings.wait`），缺失时回退为墙钟耗时。 */
  durationMs: number;
  waitMs?: number;
  contentType?: string;
  server?: string;
  /** 实际钉住的 IP（未钉则为 undefined）。 */
  pinnedIp?: string;
}

export interface FetchOnceArgs {
  url: string;
  /** node-wreq 浏览器指纹 profile（控制 TLS ClientHello / HTTP2 / 头顺序）。 */
  browser?: string;
  /** 代理 URL（如 `socks5h://127.0.0.1:20170`）。 */
  proxy?: string;
  timeoutMs?: number;
  /** 钉住的 IP；`null`/省略表示走系统 DNS。 */
  pin?: { hostname: string; ip: string } | null;
}

/**
 * 用 node-wreq 做一次 GET：可带浏览器 TLS 指纹、可钉住目标 IP。
 * 借鉴 `GeoClaw/src/fetch/WebFetch.ts` 的调用形态（`browser` / `dns.hosts` / `onStats`）。
 */
export async function fetchOnce(args: FetchOnceArgs): Promise<PinnedFetchResult> {
  const started = Date.now();
  let waitMs: number | undefined;

  const res = await wreqFetch(args.url, {
    method: "GET",
    ...(args.browser ? { browser: args.browser as BrowserProfile } : {}),
    ...(args.proxy ? { proxy: args.proxy } : {}),
    ...(args.timeoutMs !== undefined ? { timeout: args.timeoutMs } : {}),
    ...(args.pin ? { dns: { hosts: { [args.pin.hostname]: [args.pin.ip] } } } : {}),
    onStats: (stats: unknown) => {
      waitMs = (stats as { timings?: { wait?: number } }).timings?.wait;
    },
  });

  const buf = new Uint8Array(await res.arrayBuffer());
  return {
    url: args.url,
    status: res.status,
    statusText: res.statusText,
    ok: res.ok,
    bytes: buf.length,
    durationMs: waitMs ?? Date.now() - started,
    waitMs,
    contentType: res.headers.get("content-type") ?? undefined,
    server: res.headers.get("server") ?? undefined,
    pinnedIp: args.pin?.ip,
  };
}
