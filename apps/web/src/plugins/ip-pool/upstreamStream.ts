import type { UpstreamRequest } from "./rocktree";
import { getStore } from "./store";
import type { UpstreamStreamLine } from "./types";
import { runUpstreamRequests } from "./upstream";

/**
 * 流式上游抓取（NDJSON）：每完成一条立即写出一行 JSON，最后写 `{"done":true,"count":N}`。
 *
 * 与批式 `fetchUpstream` 同一套逐条逻辑，但**不把整批拼成一个巨大 JSON 再 base64 编码**：
 * 面板单核事件循环因此不会被 NodeData 大载荷（单批可达数 MB）卡住、Caddy 不再 502。
 * 调用方（本机 download/taskserver）按行解析，并以行内 `i` 回填到对应请求。
 */
export function fetchUpstreamStream(requests: readonly UpstreamRequest[]): Response {
  const encoder = new TextEncoder();
  const store = getStore();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (line: UpstreamStreamLine): boolean => {
        if (cancelled) return false;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
          return true;
        } catch {
          cancelled = true;
          return false;
        }
      };

      runUpstreamRequests(requests, (i, o) => {
        write({ i, ...o.result });
      })
        .then(() => {
          store.flush();
          if (write({ done: true, count: requests.length })) controller.close();
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          if (write({ done: true, count: requests.length, error: message })) controller.close();
        });
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
