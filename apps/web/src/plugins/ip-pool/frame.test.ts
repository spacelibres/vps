import { describe, expect, it } from "vitest";
import { encodeFrame } from "./frame";

/** 十六进制字符串 → 便于对拍字节。 */
function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("encodeFrame（length-delimited protobuf 帧）", () => {
  it("u32 大端长度前缀 + protobuf 载荷（index/ok/status）", () => {
    // field1 varint=1、field2 bool=1、field3 varint=200（两字节 c8 01）
    // → 08 01 | 10 01 | 18 c8 01；长度 7。
    const frame = encodeFrame({ index: 1, ok: true, status: 200 });
    expect(hex(frame)).toBe("000000070801100118c801");
  });

  it("body 为原始字节（不做 base64），零值字段不编码", () => {
    // 仅 field5 bytes：2a 03 1f 8b 08；长度 5。
    const frame = encodeFrame({ body: Uint8Array.from([0x1f, 0x8b, 0x08]) });
    expect(hex(frame)).toBe("000000052a031f8b08");
  });

  it("末帧 done=true", () => {
    // field6 bool=1：30 01；长度 2。
    const frame = encodeFrame({ done: true });
    expect(hex(frame)).toBe("000000023001");
  });

  it("encoding 字符串字段", () => {
    // field4 string="gzip"：22 04 67 7a 69 70；长度 6。
    const frame = encodeFrame({ encoding: "gzip" });
    expect(hex(frame)).toBe("000000062204677a6970");
  });

  it("大 body 的长度前缀与实际载荷一致", () => {
    const body = Uint8Array.from({ length: 1000 }, (_, i) => i & 0xff);
    const frame = encodeFrame({ index: 3, body });
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getUint32(0, false)).toBe(frame.length - 4);
    // 长度前缀之后的载荷尾部应为原始 body 字节。
    expect(hex(frame.subarray(frame.length - 1000))).toBe(hex(body));
  });
});
