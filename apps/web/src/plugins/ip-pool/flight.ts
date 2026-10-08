import { parseLocString, type GeoPoint } from "./geo";
import type {
  FetchFlightPath,
  FetchRequestRecord,
  FetchRouteOrigin,
  FlightLeg,
  FlightWaypoint,
} from "./types";

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;
const GOLDEN_ANGLE_DEG = 137.508;

/** FNV-1a 32 位哈希。 */
export function hashId(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * 由 IP（或任意键）生成**稳定且互不相同**的颜色。
 * 借鉴 GeoClaw `viz/flight-map/arc.js` 的 `visualFromIp`：黄金角散列 + 三档亮度。
 */
/**
 * 与 `arc.js` 的 `visualFromIp` 对齐：稳定颜色 + 显示用轨道高度（km）。
 */
export function ipVisual(
  ip: string,
  options: { leoAltitudeMinKm?: number; leoAltitudeMaxKm?: number } = {},
): { color: string; leoAltitudeKm: number } {
  const h = hashId(ip);
  const hue = (h * GOLDEN_ANGLE_DEG) % 360;
  const band = h % 3;
  const sat = band === 0 ? 78 : band === 1 ? 88 : 70;
  const light = band === 0 ? 42 : band === 1 ? 55 : 68;
  const color = `hsl(${hue.toFixed(1)} ${sat}% ${light}%)`;
  const minKm = options.leoAltitudeMinKm ?? 12;
  const maxKm = Math.max(minKm, options.leoAltitudeMaxKm ?? 48);
  const span = maxKm - minKm;
  const leoAltitudeKm =
    span <= 0 ? minKm : minKm + (hashId(`${ip}:leo`) % (Math.floor(span) + 1));
  return { color, leoAltitudeKm };
}

export function ipColor(key: string): string {
  return ipVisual(key).color;
}

export interface ArcDisplayOptions {
  earthRadiusKm?: number;
  altitudeKm?: number;
  orbitDisplayExaggeration?: number;
  steps?: number;
  minSteps?: number;
  maxSteps?: number;
}

/**
 * 生成地图上的弹道弧线点序列（大圆 + 拱高）。
 * 借鉴 GeoClaw `arc.js` 的 `mapDisplayArc`。
 * @returns `[lng, lat][]`
 */
export function mapDisplayArc(
  from: GeoPoint,
  to: GeoPoint,
  options: ArcDisplayOptions = {},
): [number, number][] {
  const R = options.earthRadiusKm ?? 6371;
  const altitudeKm = options.altitudeKm ?? 30;
  const exag = options.orbitDisplayExaggeration ?? 2.5;
  const theta = angularDistanceRad(from, to);
  const bowPeak = leoOrbitalBowDeg(theta, altitudeKm, R) * exag;
  const minSteps = options.minSteps ?? 16;
  const maxSteps = options.maxSteps ?? 48;
  const steps =
    options.steps ??
    Math.max(minSteps, Math.min(maxSteps, Math.ceil(Math.max(theta * RAD2DEG, 1) / 2.5)));

  const ground = greatCircleArc(from, to, steps);
  const unwrapped: Array<[number, number]> = [];
  let prevLng: number | null = null;
  for (const [lng, lat] of ground) {
    const ulng: number = prevLng === null ? lng : unwrapLng(prevLng, lng);
    unwrapped.push([ulng, lat]);
    prevLng = ulng;
  }
  if (unwrapped.length < 2) return unwrapped;

  const start = unwrapped[0]!;
  const end = unwrapped[unwrapped.length - 1]!;
  const chordDx = end[0] - start[0];
  const chordDy = end[1] - start[1];
  const chordLen = Math.hypot(chordDx, chordDy) || 1;
  let nx = -chordDy / chordLen;
  let ny = chordDx / chordLen;
  const mid = unwrapped[Math.floor(unwrapped.length / 2)]!;
  const chordMidLng = (start[0] + end[0]) / 2;
  const chordMidLat = (start[1] + end[1]) / 2;
  if (nx * (mid[0] - chordMidLng) + ny * (mid[1] - chordMidLat) < 0) {
    nx = -nx;
    ny = -ny;
  }

  const n = unwrapped.length;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const elev = bowPeak * (4 * t * (1 - t));
    const [lng, lat] = unwrapped[i]!;
    points.push([lng + nx * elev, lat + ny * elev]);
  }
  return points;
}

function unwrapLng(lng1: number, lng2: number): number {
  let dLon = lng2 - lng1;
  if (dLon > 180) dLon -= 360;
  else if (dLon < -180) dLon += 360;
  return lng1 + dLon;
}

function angularDistanceRad(a: GeoPoint, b: GeoPoint): number {
  const phi1 = a.lat * DEG2RAD;
  const phi2 = b.lat * DEG2RAD;
  let dLambda = (b.lng - a.lng) * DEG2RAD;
  if (dLambda > Math.PI) dLambda -= 2 * Math.PI;
  if (dLambda < -Math.PI) dLambda += 2 * Math.PI;
  const cosDelta = clamp(
    Math.sin(phi1) * Math.sin(phi2) + Math.cos(phi1) * Math.cos(phi2) * Math.cos(dLambda),
    -1,
    1,
  );
  return Math.acos(cosDelta);
}

function leoOrbitalBowDeg(thetaRad: number, altitudeKm: number, earthRadiusKm = 6371): number {
  const half = thetaRad / 2;
  if (half < 1e-9) return 0;
  const h = Math.max(0, altitudeKm);
  const R = Math.max(1, earthRadiusKm);
  const deltaSagitta = h * (1 - Math.cos(half));
  const halfChord = R * Math.sin(half);
  return Math.atan2(deltaSagitta, Math.max(halfChord, 1e-6)) * RAD2DEG;
}

function greatCircleArc(from: GeoPoint, to: GeoPoint, steps: number): Array<[number, number]> {
  const start = latLngToUnit(from.lat, from.lng);
  const end = latLngToUnit(to.lat, to.lng);
  const dot = clamp(start[0] * end[0] + start[1] * end[1] + start[2] * end[2], -1, 1);
  const omega = Math.acos(dot);
  if (omega < 1e-10) return [unitToLngLat(start)];
  const sinOmega = Math.sin(omega);
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = Math.sin((1 - t) * omega) / sinOmega;
    const b = Math.sin(t * omega) / sinOmega;
    points.push(
      unitToLngLat([
        a * start[0] + b * end[0],
        a * start[1] + b * end[1],
        a * start[2] + b * end[2],
      ]),
    );
  }
  return points;
}

function latLngToUnit(lat: number, lng: number): [number, number, number] {
  const phi = lat * DEG2RAD;
  const lambda = lng * DEG2RAD;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lambda), cosPhi * Math.sin(lambda), Math.sin(phi)];
}

function unitToLngLat(v: [number, number, number]): [number, number] {
  const [x, y, z] = v;
  return [Math.atan2(y, x) * RAD2DEG, Math.atan2(z, Math.hypot(x, y)) * RAD2DEG];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** 目标节点的地理信息（来自池子文件或事件）。 */
export interface TargetGeo {
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
}

export interface BuildFlightPathArgs {
  request: Pick<
    FetchRequestRecord,
    "requestId" | "url" | "finalIp" | "finalStatus" | "totalDurationMs" | "bytes"
  >;
  targetHostname: string;
  origin: FetchRouteOrigin | null;
  targetGeo?: TargetGeo | null;
  proxy?: FetchRouteOrigin | null;
  dnsMode?: "hostpin" | "system";
  viaHot?: boolean;
  http2?: boolean;
}

/**
 * 由一次请求记录合成弹道航路。
 * 起点/终点缺少坐标时返回 `null`（无法绘制）。
 */
export function buildFlightPath(args: BuildFlightPathArgs): FetchFlightPath | null {
  const origin = args.origin;
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return null;

  const targetPoint = parseLocString(args.targetGeo?.loc);
  if (!targetPoint) return null;

  const waypoints: FlightWaypoint[] = [
    {
      role: "origin",
      lat: origin.lat,
      lng: origin.lng,
      label: origin.label || origin.city || "源点",
      city: origin.city,
      region: origin.region,
      country: origin.country,
    },
  ];

  if (args.proxy && Number.isFinite(args.proxy.lat) && Number.isFinite(args.proxy.lng)) {
    waypoints.push({
      role: "proxy",
      lat: args.proxy.lat,
      lng: args.proxy.lng,
      label: args.proxy.label || args.proxy.city || "代理",
      city: args.proxy.city,
      country: args.proxy.country,
    });
  }

  waypoints.push({
    role: "target",
    lat: targetPoint.lat,
    lng: targetPoint.lng,
    label: args.request.finalIp || args.targetHostname,
    city: args.targetGeo?.city,
    region: args.targetGeo?.region,
    country: args.targetGeo?.country,
    ip: args.request.finalIp,
    hostname: args.targetHostname,
  });

  const legCount = waypoints.length - 1;
  const perLeg = legCount > 0 ? Math.max(0, args.request.totalDurationMs) / legCount : 0;
  const legs: FlightLeg[] = [];
  for (let i = 0; i < legCount; i++) {
    legs.push({ fromIndex: i, toIndex: i + 1, durationMs: Math.round(perLeg) });
  }

  return {
    requestId: args.request.requestId,
    url: args.request.url,
    targetHostname: args.targetHostname,
    dnsMode: args.dnsMode ?? "hostpin",
    pinnedIp: args.request.finalIp,
    waypoints,
    legs,
    totalDurationMs: args.request.totalDurationMs,
    bodyBytes: args.request.bytes,
    httpStatus: args.request.finalStatus,
    viaHot: args.viaHot,
    http2: args.http2,
    colorKey: args.request.finalIp || args.request.requestId,
  };
}
