import { describe, expect, it } from "vitest";
import { dispatchWorkerCount, hotIpFor } from "./plan";

describe("dispatchWorkerCount", () => {
  it("有界并发：不超过 cap，也不超过可用热 IP / 请求数", () => {
    expect(dispatchWorkerCount(10000, 3458, 256)).toBe(256);
    expect(dispatchWorkerCount(10000, 3458, 4096)).toBe(3458);
    expect(dispatchWorkerCount(10, 3458, 256)).toBe(10);
    expect(dispatchWorkerCount(10000, 100, 256)).toBe(100);
  });

  it("cap<=0 表示不设上限（min(count, hot)）", () => {
    expect(dispatchWorkerCount(10000, 3458, 0)).toBe(3458);
    expect(dispatchWorkerCount(10, 3458, 0)).toBe(10);
  });

  it("无请求或无热 IP 时为 0", () => {
    expect(dispatchWorkerCount(0, 3458, 256)).toBe(0);
    expect(dispatchWorkerCount(10000, 0, 256)).toBe(0);
  });
});

describe("hotIpFor", () => {
  it("轮询整表，每张都参与", () => {
    expect(hotIpFor(0, 3)).toBe(0);
    expect(hotIpFor(1, 3)).toBe(1);
    expect(hotIpFor(3, 3)).toBe(0);
    expect(hotIpFor(10, 3)).toBe(1);
  });

  it("空表返回 0", () => {
    expect(hotIpFor(5, 0)).toBe(0);
  });
});
