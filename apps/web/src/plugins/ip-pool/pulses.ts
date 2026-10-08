import { ipVisual, mapDisplayArc, type ArcDisplayOptions } from "./flight";
import type { FetchRouteOrigin, RoutePulse } from "./types";

/** 未激活线路颜色（预绘骨架）。 */
export const IDLE_ROUTE_COLOR = "#64748b";
/** 失败线路颜色。 */
export const FAIL_ROUTE_COLOR = "#ef4444";
/** 未激活透明度。 */
export const IDLE_ROUTE_ALPHA = 0.28;

export interface ArcTiming {
  drawMs: number;
  holdMs: number;
  fadeMs: number;
}

export const DEFAULT_TIMING: ArcTiming = { drawMs: 1400, holdMs: 6000, fadeMs: 2000 };

export interface ArcOptions extends ArcDisplayOptions {
  leoAltitudeMinKm?: number;
  leoAltitudeMaxKm?: number;
}

/** 弹道路线键：同坐标共用一条线（无坐标时回退到 IP）。 */
export function pulseRouteKey(lat: number, lng: number, ip: string): string {
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return `ll:${lat.toFixed(4)},${lng.toFixed(4)}`;
  }
  return `ip:${ip}`;
}

function arcLatLngs(
  origin: FetchRouteOrigin,
  lat: number,
  lng: number,
  _ip: string,
  arc: ArcOptions,
): Array<{ lat: number; lng: number }> {
  const coords = mapDisplayArc(
    { lat: origin.lat, lng: origin.lng },
    { lat, lng },
    {
      bowFactor: arc.bowFactor,
      maxBowDeg: arc.maxBowDeg,
      maxAbsLat: arc.maxAbsLat,
      minSteps: arc.minSteps ?? 16,
      maxSteps: arc.maxSteps ?? 40,
    },
  );
  return coords.map(([x, y]) => ({ lat: y, lng: x }));
}

export interface SeedArgs {
  origin: FetchRouteOrigin;
  /** 池子目录（ip → 坐标）。 */
  ips: Array<{ ip: string; lat: number; lng: number }>;
  timing: ArcTiming;
  arc: ArcOptions;
}

/** 由池子目录预绘全部落点的灰色骨架（同坐标只一条）。 */
export function buildSeedPulses(args: SeedArgs): RoutePulse[] {
  const byKey = new Map<string, { lat: number; lng: number; ip: string }>();
  for (const item of args.ips) {
    if (!Number.isFinite(item.lat) || !Number.isFinite(item.lng)) continue;
    const key = pulseRouteKey(item.lat, item.lng, item.ip);
    if (!byKey.has(key)) byKey.set(key, item);
  }

  const pulses: RoutePulse[] = [];
  for (const [key, { lat, lng, ip }] of byKey) {
    const latlngs = arcLatLngs(args.origin, lat, lng, ip, args.arc);
    if (latlngs.length < 2) continue;
    pulses.push({
      id: key,
      color: IDLE_ROUTE_COLOR,
      idleColor: IDLE_ROUTE_COLOR,
      latlngs,
      bornAt: 0,
      drawMs: args.timing.drawMs,
      holdMs: args.timing.holdMs,
      fadeMs: args.timing.fadeMs,
      pinnedIp: ip,
      active: false,
    });
  }
  return pulses;
}

export interface PulseItem {
  id: string;
  ip: string;
  lat?: number;
  lng?: number;
  ok: boolean;
  city?: string;
  country?: string;
}

export interface ActivateArgs {
  origin: FetchRouteOrigin | null;
  catalog: Map<string, { lat: number; lng: number; city?: string; country?: string }>;
  timing: ArcTiming;
  arc: ArcOptions;
  now: number;
}

/**
 * 激活一批请求：换色「点亮」；同批内按落点去重并错开相位。
 * 直接修改传入的 `pulses`（Map）。
 * @returns 实际变化的条数
 */
export function activatePulses(
  pulses: Map<string, RoutePulse>,
  items: readonly PulseItem[],
  args: ActivateArgs,
): number {
  const { origin, catalog, timing, arc, now } = args;
  let changed = 0;

  const byRoute = new Map<string, { item: PulseItem; lat: number; lng: number }>();
  for (const item of items) {
    if (!item.id || !item.ip) continue;
    const known = catalog.get(item.ip);
    let lat = Number(item.lat);
    let lng = Number(item.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      if (known) {
        lat = known.lat;
        lng = known.lng;
      }
    } else if (!known) {
      catalog.set(item.ip, { lat, lng, city: item.city, country: item.country });
    }
    byRoute.set(pulseRouteKey(lat, lng, item.ip), { item, lat, lng });
  }

  for (const [key, { item, lat, lng }] of byRoute) {
    if (!origin || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const color = item.ok ? ipVisual(item.ip, arc).color : FAIL_ROUTE_COLOR;
    const staggerMs = changed * 12;
    const existing = pulses.get(key);

    if (existing) {
      existing.id = item.id;
      existing.color = color;
      existing.drawMs = timing.drawMs;
      existing.holdMs = timing.holdMs;
      existing.fadeMs = timing.fadeMs;
      existing.pinnedIp = item.ip;
      // 已点亮：只续命到 hold 段，不重头播绘线
      existing.bornAt = existing.active ? now - timing.drawMs - staggerMs : now - staggerMs;
      existing.active = true;
    } else {
      const latlngs = arcLatLngs(origin, lat, lng, item.ip, arc);
      if (latlngs.length < 2) continue;
      pulses.set(key, {
        id: item.id,
        color,
        idleColor: IDLE_ROUTE_COLOR,
        latlngs,
        bornAt: now - staggerMs,
        drawMs: timing.drawMs,
        holdMs: timing.holdMs,
        fadeMs: timing.fadeMs,
        pinnedIp: item.ip,
        active: true,
      });
    }
    changed += 1;
  }
  return changed;
}

/** 淡出结束的脉冲回到灰色骨架（不删除）。 */
export function pruneDeadPulses(pulses: Map<string, RoutePulse>, now: number): number {
  let changed = 0;
  for (const pulse of pulses.values()) {
    if (!pulse.active) continue;
    if (now - pulse.bornAt >= pulse.drawMs + pulse.holdMs + pulse.fadeMs) {
      pulse.active = false;
      pulse.color = pulse.idleColor || IDLE_ROUTE_COLOR;
      changed += 1;
    }
  }
  return changed;
}
