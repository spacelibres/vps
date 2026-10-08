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

  it("端点大致落在起止点", () => {
    expect(points[0]![0]).toBeCloseTo(0, 3);
    expect(points[0]![1]).toBeCloseTo(0, 3);
    expect(points[points.length - 1]![0]).toBeCloseTo(90, 1);
    expect(points[points.length - 1]![1]).toBeCloseTo(0, 1);
  });

  it("中点拱起（偏离大圆直线）", () => {
    const mid = points[Math.floor(points.length / 2)]!;
    // 90° 跨度、30km 高度、2.5 夸张系数 → 拱高约 0.279°（与 arc.js 公式一致）
    expect(Math.abs(mid[1])).toBeGreaterThan(0.1);
    expect(Math.abs(mid[1])).toBeCloseTo(0.279, 2);
  });
});
