import { describe, expect, it } from "vitest";
import { hashId, ipColor, mapDisplayArc } from "./flight";

describe("hashId", () => {
  it("稳定且非负", () => {
    expect(hashId("1.1.1.1")).toBe(hashId("1.1.1.1"));
    expect(hashId("1.1.1.1")).toBeGreaterThanOrEqual(0);
  });
});

describe("ipColor", () => {
  it("同一 IP 颜色稳定", () => {
    expect(ipColor("108.177.104.136")).toBe(ipColor("108.177.104.136"));
  });

  it("不同 IP 颜色不同", () => {
    expect(ipColor("1.1.1.1")).not.toBe(ipColor("2.2.2.2"));
    expect(ipColor("1.1.1.1")).not.toBe(ipColor("1.1.1.2"));
  });

  it("输出合法 hsl", () => {
    expect(ipColor("x")).toMatch(/^hsl\(/);
  });
});

describe("mapDisplayArc", () => {
  const points = mapDisplayArc({ lat: 0, lng: 0 }, { lat: 0, lng: 90 });

  it("点数在合理范围", () => {
    expect(points.length).toBeGreaterThanOrEqual(2);
    expect(points.length).toBeLessThanOrEqual(49);
  });

  it("端点精确落在起止点", () => {
    expect(points[0]![0]).toBeCloseTo(0, 3);
    expect(points[0]![1]).toBeCloseTo(0, 3);
    expect(points[points.length - 1]![0]).toBeCloseTo(90, 3);
    expect(points[points.length - 1]![1]).toBeCloseTo(0, 3);
  });

  it("中点拱起且受限（弦长 90° → 拱高 90×0.16=14.4°）", () => {
    const mid = points[Math.floor(points.length / 2)]!;
    expect(mid[1]).toBeGreaterThan(0);
    expect(mid[1]).toBeCloseTo(14.4, 1);
  });

  it("不同弦长下拱高单调随弦长增长且不超过上限", () => {
    const short = mapDisplayArc({ lat: 0, lng: 0 }, { lat: 0, lng: 20 });
    const long = mapDisplayArc({ lat: 0, lng: 0 }, { lat: 0, lng: 120 });
    const shortMid = short[Math.floor(short.length / 2)]![1];
    const longMid = long[Math.floor(long.length / 2)]![1];
    expect(longMid).toBeGreaterThan(shortMid);
    expect(longMid).toBeLessThanOrEqual(26.001);
  });

  it("高纬航线在软上限内不越界（不逾北极圈）", () => {
    // 洛杉矶 → 都柏林（跨大西洋，若用大圆会拱至更高纬）
    const arc = mapDisplayArc(
      { lat: 34.0443, lng: -118.2509 },
      { lat: 53.35, lng: -6.26 },
    );
    const maxLat = Math.max(...arc.map(([, lat]) => lat));
    expect(maxLat).toBeLessThanOrEqual(56.001);
    expect(maxLat).toBeLessThan(66.5);
  });

  it("端点本身超软上限时拱高归零（不额外凸出）", () => {
    const to = { lat: 64, lng: 24 };
    const arc = mapDisplayArc({ lat: 34.0443, lng: -118.2509 }, to);
    const maxLat = Math.max(...arc.map(([, lat]) => lat));
    expect(maxLat).toBeCloseTo(to.lat, 6);
  });
});
