import { describe, expect, it } from "vitest";
import {
  activatePulses,
  buildSeedPulses,
  DEFAULT_TIMING,
  FAIL_ROUTE_COLOR,
  IDLE_ROUTE_COLOR,
  pruneDeadPulses,
  pulseRouteKey,
} from "./pulses";
import type { RoutePulse } from "./types";

const ARC = {
  earthRadiusKm: 6371,
  leoAltitudeMinKm: 12,
  leoAltitudeMaxKm: 48,
  orbitDisplayExaggeration: 2.5,
};
const ORIGIN = { lat: 0, lng: 0, label: "origin" };

describe("buildSeedPulses", () => {
  it("同坐标只生成一条骨架，且为灰色未激活", () => {
    const pulses = buildSeedPulses({
      origin: ORIGIN,
      ips: [
        { ip: "1.1.1.1", lat: 32.7, lng: -96.8 },
        { ip: "1.1.1.2", lat: 32.7, lng: -96.8 },
        { ip: "2.2.2.2", lat: 36.1, lng: -95.9 },
      ],
      timing: DEFAULT_TIMING,
      arc: ARC,
    });
    expect(pulses).toHaveLength(2);
    expect(pulses.every((p) => p.color === IDLE_ROUTE_COLOR && !p.active)).toBe(true);
    expect(pulses[0]!.latlngs.length).toBeGreaterThan(2);
  });
});

describe("activatePulses", () => {
  it("点亮为彩色并按 IP 取色", () => {
    const pulses = buildSeedPulses({
      origin: ORIGIN,
      ips: [{ ip: "1.1.1.1", lat: 32.7, lng: -96.8 }],
      timing: DEFAULT_TIMING,
      arc: ARC,
    });
    const map = new Map(pulses.map((p) => [p.id, p]));
    const catalog = new Map([["1.1.1.1", { lat: 32.7, lng: -96.8 }]]);
    const changed = activatePulses(map, [{ id: "r1", ip: "1.1.1.1", ok: true }], {
      origin: ORIGIN,
      catalog,
      timing: DEFAULT_TIMING,
      arc: ARC,
      now: 1000,
    });
    expect(changed).toBe(1);
    const pulse = map.get(pulseRouteKey(32.7, -96.8, "1.1.1.1"))!;
    expect(pulse.active).toBe(true);
    expect(pulse.color.startsWith("hsl(")).toBe(true);
    expect(pulse.bornAt).toBe(1000);
  });

  it("失败用红色", () => {
    const map = new Map<string, RoutePulse>();
    activatePulses(map, [{ id: "r2", ip: "9.9.9.9", lat: 10, lng: 20, ok: false }], {
      origin: ORIGIN,
      catalog: new Map(),
      timing: DEFAULT_TIMING,
      arc: ARC,
      now: 0,
    });
    expect([...map.values()][0]!.color).toBe(FAIL_ROUTE_COLOR);
  });

  it("无原点时不激活", () => {
    const map = new Map<string, RoutePulse>();
    const changed = activatePulses(map, [{ id: "r3", ip: "9.9.9.9", lat: 10, lng: 20, ok: true }], {
      origin: null,
      catalog: new Map(),
      timing: DEFAULT_TIMING,
      arc: ARC,
      now: 0,
    });
    expect(changed).toBe(0);
    expect(map.size).toBe(0);
  });

  it("未知坐标的 IP 会写入 catalog", () => {
    const catalog = new Map<string, { lat: number; lng: number }>();
    activatePulses(new Map(), [{ id: "r4", ip: "9.9.9.9", lat: 10, lng: 20, ok: true }], {
      origin: ORIGIN,
      catalog,
      timing: DEFAULT_TIMING,
      arc: ARC,
      now: 0,
    });
    expect(catalog.get("9.9.9.9")).toMatchObject({ lat: 10, lng: 20 });
  });
});

describe("pruneDeadPulses", () => {
  it("生命周期结束后回到灰色骨架但不删除", () => {
    const map = new Map<string, RoutePulse>();
    activatePulses(map, [{ id: "r5", ip: "1.1.1.1", lat: 1, lng: 1, ok: true }], {
      origin: ORIGIN,
      catalog: new Map(),
      timing: DEFAULT_TIMING,
      arc: ARC,
      now: 0,
    });
    const life = DEFAULT_TIMING.drawMs + DEFAULT_TIMING.holdMs + DEFAULT_TIMING.fadeMs;
    expect(pruneDeadPulses(map, life - 1)).toBe(0);
    expect(pruneDeadPulses(map, life)).toBe(1);
    const pulse = [...map.values()][0]!;
    expect(pulse.active).toBe(false);
    expect(pulse.color).toBe(IDLE_ROUTE_COLOR);
    expect(map.size).toBe(1);
  });
});
