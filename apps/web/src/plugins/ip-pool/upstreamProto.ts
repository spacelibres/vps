import type { UpstreamRequest } from "./rocktree";
import { getStore } from "./store";
import { encodeFrame } from "./frame";
import { runUpstreamRequests } from "./upstream";

/**
 * 上游抓取（二进制帧流）：逐条把结果编码为 length-delimited protobuf 帧写出。
 *
 * 与 `fetchUpstreamStream`（NDJSON + base64）语义一致，但 **body 直接是上游原始字节**
 * （gzip 即 gzip，不做 base64），省去 JSON 解析与 base64 的 ~33% 膨胀。
 * 帧定义见 {@link ./frame}；权威 schema 见 SpaceXWay `fetch/proto/panel.proto`。
 */
export function fetchUpstreamProto(requests: readonly UpstreamRequest[]): Response {
  const store = getStore();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (bytes: Uint8Array): boolean => {
        if (cancelled) return false;
        try {
          controller.enqueue(bytes);
          return true;
        } catch {
          cancelled = true;
          return false;
        }
      };

      runUpstreamRequests(
        requests,
        (i, o) => {
          write(
            encodeFrame({
              index: i,
              ok: o.result.ok,
              status: o.result.status,
              encoding: o.result.encoding,
              body: o.body,
              error: o.result.error,
              ip: o.result.ip,
            }),
          );
        },
        { encodeBase64: false },
      )
        .then(() => {
          store.flush();
          if (write(encodeFrame({ done: true }))) controller.close();
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          if (write(encodeFrame({ done: true, error: message }))) controller.close();
        });
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-protobuf",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
