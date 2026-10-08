import { fetchConfig } from "./config";
import { buildUpstreamUrl, type UpstreamRequest } from "./rocktree";
import { getStore } from "./store";
import type { UpstreamFetchPayload, UpstreamFetchResult } from "./types";
import { ensurePoolWarm, getHotPool } from "./warm";

/**
 * 上游抓取：外部（如本机下载器）只发**结构化参数**，服务端拼 URL、
 * 用**已预热的常驻热连接**出网，返回服务器原始字节（base64）。
 *
 * 只走热 IP；服务器回 gzip 时我们不做透明解压，`encoding="gzip"` 由调用方自行解压。
 */

/** 单批最多请求数。 */
export const MAX_UPSTREAM_BATCH = 256;
/** 单条响应体上限（超过则报错，避免 base64 爆内存）。 */
const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** 批内并发上限。 */
const BATCH_CONCURRENCY = 32;

/** 热 IP 轮询游标（进程内）。 */
let cursor = 0;

export async function fetchUpstream(
  requests: readonly UpstreamRequest[],
): Promise<UpstreamFetchPayload> {
  const cfg = fetchConfig();
  const store = getStore();
  ensurePoolWarm();
  const pool = getHotPool();
  const hot = pool.hotIpList();
  if (hot.length === 0) {
    throw new Error("无热连接可用：热池尚未预热完成（稍后重试）");
  }

  const results = new Array<UpstreamFetchResult>(requests.length);
  const workers = Math.max(1, Math.min(requests.length, BATCH_CONCURRENCY));
  let next = 0;
  let seq = 0;

  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (;;) {
        const i = next++;
        if (i >= requests.length) return;
        const req = requests[i]!;
        const at = Date.now();

        let url = "";
        try {
          url = buildUpstreamUrl(req);
        } catch (err) {
          results[i] = {
            ok: false,
            url: "",
            ip: "",
            status: 0,
            bytes: 0,
            durationMs: 0,
            error: err instanceof Error ? err.message : String(err),
          };
          continue;
        }

        const ip = hot[cursor++ % hot.length]!;
        const requestId = `upstream-${at.toString(36)}-${(seq++).toString(36)}-${ip}`;
        let outcome: "success" | "http_error" | "transport_error" = "transport_error";
        let status: number | undefined;
        let bytes: number | undefined;
        let durationMs: number | undefined;
        let bodyBase64: string | undefined;
        let encoding: string | undefined;
        let error: string | undefined;

        try {
          const r = await pool.dispatch(ip, url, cfg.dispatchTimeoutMs);
          status = r.status;
          bytes = r.bytes;
          durationMs = r.durationMs;
          encoding = r.encoding;
          outcome = r.status === 200 ? "success" : "http_error";
          if (r.body.length > MAX_BODY_BYTES) {
            error = `响应体过大（${r.body.length} 字节）`;
          } else {
            bodyBase64 = Buffer.from(r.body).toString("base64");
          }
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }

        const elapsed = durationMs ?? Date.now() - at;
        store.ingest({
          origin: cfg.origin,
          attempts: [
            {
              requestId,
              url,
              attempt: 1,
              ip,
              outcome,
              httpStatus: status,
              durationMs: elapsed,
              bytes,
              at,
            },
          ],
          requests: [
            {
              requestId,
              url,
              outcome: outcome === "success" ? "success" : "failed",
              attempts: 1,
              totalDurationMs: elapsed,
              finalIp: ip,
              finalStatus: status,
              ipsUsed: [ip],
              bytes,
              at,
            },
          ],
        });

        results[i] = {
          ok: outcome === "success",
          url,
          ip,
          status: status ?? 0,
          bytes: bytes ?? 0,
          durationMs: elapsed,
          bodyBase64,
          encoding,
          error,
        };
      }
    }),
  );

  store.flush();
  return { results };
}
