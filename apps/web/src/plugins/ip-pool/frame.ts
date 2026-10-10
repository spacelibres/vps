import protobuf from "protobufjs";

/**
 * 面板 → 本地 的**二进制帧流**协议（length-delimited protobuf）。
 *
 * 与 `fetchUpstreamStream`（NDJSON + base64）逐条语义等价，但：
 *  - 不再 JSON 包裹、不再 base64：`body` 直接是上游**原始字节**（gzip 即 gzip）；
 *  - 帧结构由 proto 定义，双方（TS / Go）按同一 schema 编解码，避免 JSON 解析开销。
 *
 * 帧格式：`[u32 大端 长度][StreamFrame 字节]`，重复；末帧 `done=true`（可带面板级 `error`）。
 *
 * 权威 schema 见 SpaceXWay `fetch/proto/panel.proto`（字段号必须保持一致）。
 */

const PROTO = `
syntax = "proto3";
package ippool;
message StreamFrame {
  uint32 index    = 1;
  bool   ok       = 2;
  uint32 status   = 3;
  string encoding = 4;
  bytes  body     = 5;
  bool   done     = 6;
  string error    = 7;
  string ip       = 8;
}`;

const streamFrame = protobuf.parse(PROTO).root.lookupType("ippool.StreamFrame");

/** 单帧内容。`body` 为上游原始字节（**不做 base64**）。 */
export interface FrameInput {
  /** 请求在批内的下标（回填用）。末帧可省。 */
  index?: number;
  ok?: boolean;
  status?: number;
  /** 响应 `content-encoding`（服务器压缩时为 `gzip`；缺省无）。 */
  encoding?: string;
  /** 上游原始响应字节。 */
  body?: Uint8Array;
  /** 末帧标记。 */
  done?: boolean;
  /** 面板级错误（`done=true` 时有效）。 */
  error?: string;
  /** 出网热 IP（监控用）。 */
  ip?: string;
}

/** 把一帧编码为 `[u32 大端长度][protobuf 字节]`。 */
export function encodeFrame(input: FrameInput): Uint8Array {
  const message = streamFrame.encode(
    streamFrame.create({
      index: input.index ?? 0,
      ok: input.ok ?? false,
      status: input.status ?? 0,
      encoding: input.encoding ?? "",
      body: input.body ?? new Uint8Array(0),
      done: input.done ?? false,
      error: input.error ?? "",
      ip: input.ip ?? "",
    }),
  ).finish();
  const out = new Uint8Array(4 + message.length);
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint32(0, message.length, false);
  out.set(message, 4);
  return out;
}
