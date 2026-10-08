import { parseLocString, type GeoPoint } from "./geo";
import type {
  FetchFlightPath,
  FetchRequestRecord,
  FetchRouteOrigin,
  FlightLeg,
  FlightWaypoint,
} from "./types";

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
  /** 拱高相对弦长的系数。 */
  bowFactor?: number;
  /** 拱高上限（度）。 */
  maxBowDeg?: number;
  /** 纬度软上限（度）：压缩拱高以保证最凸点纬度不超过该值，避免越过极圈。 */
  maxAbsLat?: number;
  /** 等分步数；缺省按弦长自适应。 */
  steps?: number;
  minSteps?: number;
  maxSteps?: number;
}

const DEFAULT_BOW_FACTOR = 0.16;
const DEFAULT_MAX_BOW_DEG = 26;
const DEFAULT_MAX_ABS_LAT = 56;

/**
 * 生成地图上的弹道弧：**等距圆柱（经纬度平面）下的二次拱形**。
 *
 * 不做大圆：沿**最短经度差**线性插值，再沿弦的垂线叠加一个有限拱高，并受 `maxAbsLat`
 * 软约束。这样弧线不会被 Mercator 的高纬拉伸推到极圈之外，视觉上更接近航班轨迹的优美弧线。
 * 端点精确落在起止点上。
 * @returns `[lng, lat][]`
 */
export function mapDisplayArc(
  from: GeoPoint,
  to: GeoPoint,
  options: ArcDisplayOptions = {},
): [number, number][] {
  const fromLng = from.lng;
  const toLng = unwrapLng(fromLng, to.lng);
  const dx = toLng - fromLng;
  const dy = to.lat - from.lat;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-6) return [[fromLng, from.lat]];

  const minSteps = options.minSteps ?? 16;
  const maxSteps = options.maxSteps ?? 48;
  const steps =
    options.steps ??
    Math.max(minSteps, Math.min(maxSteps, Math.ceil(Math.max(chord, 1) / 2.5)));

  // 弦的单位垂线（+90°），再取向所半球（北半球向北拱、南半球向南拱），形成连贯的彩虹弧。
  let nx = -dy / chord;
  let ny = dx / chord;
  const midLat = (from.lat + to.lat) / 2;
  const poleSign = midLat >= 0 ? 1 : -1;
  if (ny * poleSign < 0) {
    nx = -nx;
    ny = -ny;
  }

  const bowFactor = options.bowFactor ?? DEFAULT_BOW_FACTOR;
  const maxBowDeg = options.maxBowDeg ?? DEFAULT_MAX_BOW_DEG;
  const maxAbsLat = options.maxAbsLat ?? DEFAULT_MAX_ABS_LAT;

  let bow = Math.min(maxBowDeg, chord * bowFactor);
  // 纬度软上限：二分压缩拱高，保证拱起极值点不越过 ±maxAbsLat（端点本身不受限）。
  let lo = 0;
  let hi = bow;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const extreme = arcBulgeExtreme(from.lat, dy, ny, mid);
    const ok = ny >= 0 ? extreme <= maxAbsLat : extreme >= -maxAbsLat;
    if (ok) lo = mid;
    else hi = mid;
  }
  bow = lo;

  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const elev = bow * (4 * t * (1 - t));
    points.push([fromLng + dx * t + nx * elev, from.lat + dy * t + ny * elev]);
  }
  return points;
}

/** 把 `lng2` 解开到与 `lng1` 最接近的经度（最短跨纬差，±180 内）。 */
function unwrapLng(lng1: number, lng2: number): number {
  let dLon = lng2 - lng1;
  if (dLon > 180) dLon -= 360;
  else if (dLon < -180) dLon += 360;
  return lng1 + dLon;
}

/**
 * 拱起方向上的纬度极值（`ny>=0` 取最大、`ny<0` 取最小）。
 * `lat(t) = lat0 + dy·t + 4·A·t(1-t)`，`A = ny·bow`；极值点可能在端点或内部临界点。
 */
function arcBulgeExtreme(lat0: number, dy: number, ny: number, bow: number): number {
  const A = ny * bow;
  const latAt = (t: number): number => lat0 + dy * t + 4 * A * t * (1 - t);
  const candidates = [latAt(0), latAt(1)];
  if (Math.abs(A) > 1e-9) {
    const t = (dy + 4 * A) / (8 * A);
    if (t > 0 && t < 1) candidates.push(latAt(t));
  }
  return ny >= 0 ? Math.max(...candidates) : Math.min(...candidates);
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
