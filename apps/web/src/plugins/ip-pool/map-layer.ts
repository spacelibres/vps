import type { LatLngBounds, Layer, Map as LeafletMap } from "leaflet";
import type { RoutePulse } from "./types";

type Leaflet = typeof import("leaflet");

const IDLE_ROUTE_ALPHA = 0.28;

/** 地图上的脉冲航线图层（canvas 自绘，支持世界副本）。 */
export interface PulseRouteLayer extends Layer {
  setPulses(list: RoutePulse[]): void;
  getBounds(): LatLngBounds;
  _redraw(now: number): void;
}

interface LatLngLike {
  lat: number;
  lng: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 两点距离（米），等价于 Leaflet 的 `LatLng.distanceTo`。 */
function distance(a: LatLngLike, b: LatLngLike): number {
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function pathLength(pts: readonly LatLngLike[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += distance(pts[i - 1]!, pts[i]!);
  return total;
}

/** 取路径前 `t`（0..1）比例的子路径。 */
function samplePathPrefix(pts: readonly LatLngLike[], t: number): LatLngLike[] {
  const first = pts[0];
  if (!first) return [];
  if (t <= 0) return [first];
  if (t >= 1) return [...pts];
  const total = pathLength(pts);
  if (total <= 0) return [first];
  const target = total * t;
  const out: LatLngLike[] = [first];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = distance(a, b);
    if (acc + seg >= target) {
      const local = seg > 0 ? (target - acc) / seg : 0;
      out.push({ lat: a.lat + (b.lat - a.lat) * local, lng: a.lng + (b.lng - a.lng) * local });
      break;
    }
    out.push(b);
    acc += seg;
  }
  return out;
}

/** 当前视口需要绘制的世界副本经度偏移。 */
function visibleWorldLngOffsets(map: LeafletMap): number[] {
  const bounds = map.getBounds();
  const west = bounds.getWest();
  const east = bounds.getEast();
  const pad = 360;
  let kMin = Math.floor((west - pad) / 360);
  let kMax = Math.ceil((east + pad) / 360);
  if (kMax - kMin > 4) {
    const mid = Math.round((kMin + kMax) / 2);
    kMin = mid - 2;
    kMax = mid + 2;
  }
  const offsets: number[] = [];
  for (let k = kMin; k <= kMax; k++) offsets.push(k * 360);
  if (offsets.length === 0) offsets.push(0);
  return offsets;
}

/** 连续描线；像素突变（跨副本缝）时断开，避免拉出横穿整屏的错线。 */
function strokeLatLngPath(
  ctx: CanvasRenderingContext2D,
  map: LeafletMap,
  pts: readonly LatLngLike[],
  lngOffset: number,
): void {
  const first = pts[0];
  if (!first || pts.length < 2) return;
  const maxJump = Math.max(map.getSize().x, map.getSize().y) * 0.85;
  ctx.beginPath();
  let prev = map.latLngToContainerPoint([first.lat, first.lng + lngOffset]);
  ctx.moveTo(prev.x, prev.y);
  for (let i = 1; i < pts.length; i++) {
    const point = pts[i]!;
    const p = map.latLngToContainerPoint([point.lat, point.lng + lngOffset]);
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > maxJump) {
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    } else {
      ctx.lineTo(p.x, p.y);
    }
    prev = p;
  }
  ctx.stroke();
}

/**
 * 创建脉冲航线图层（移植自 GeoClaw flight-map 的 `createPulseRouteLayer`）。
 * @param getPulses 始终返回当前全量脉冲（避免缩放过程中本地列表不同步）
 */
export function createPulseRouteLayer(
  L: Leaflet,
  getPulses: () => RoutePulse[],
): PulseRouteLayer {
  const PulseLayer = (
    L.Layer as unknown as {
      extend: (props: Record<string, unknown>) => new () => PulseRouteLayer;
    }
  ).extend({
    initialize(this: any) {
      this._pulses = [];
      this._canvas = null;
      this._ctx = null;
      this._onView = null;
      this._onZoomStart = null;
      this._onZoomEnd = null;
      this._raf = 0;
      this._zoomLock = false;
    },

    onAdd(this: any, mapInst: LeafletMap) {
      this._map = mapInst;
      if (!this._canvas) {
        const canvas = L.DomUtil.create("canvas", "flight-pulse-routes") as HTMLCanvasElement;
        canvas.style.position = "absolute";
        canvas.style.left = "0";
        canvas.style.top = "0";
        canvas.style.pointerEvents = "none";
        this._canvas = canvas;
        this._ctx = canvas.getContext("2d");
      }
      mapInst.getPanes().overlayPane.appendChild(this._canvas);
      this._onZoomStart = () => {
        this._zoomLock = true;
      };
      this._onZoomEnd = () => {
        this._zoomLock = false;
        this._scheduleRedraw();
      };
      this._onView = () => {
        if (!this._zoomLock) this._scheduleRedraw();
      };
      mapInst.on("zoomstart", this._onZoomStart);
      mapInst.on("zoomend", this._onZoomEnd);
      mapInst.on("move moveend resize viewreset", this._onView);
      this._redraw(performance.now());
    },

    onRemove(this: any, mapInst: LeafletMap) {
      if (this._onZoomStart) mapInst.off("zoomstart", this._onZoomStart);
      if (this._onZoomEnd) mapInst.off("zoomend", this._onZoomEnd);
      if (this._onView) mapInst.off("move moveend resize viewreset", this._onView);
      this._onZoomStart = null;
      this._onZoomEnd = null;
      this._onView = null;
      if (this._canvas?.parentNode) this._canvas.parentNode.removeChild(this._canvas);
      this._map = null;
      this._zoomLock = false;
    },

    setPulses(this: any, list: RoutePulse[]) {
      this._pulses = list;
      this._scheduleRedraw();
    },

    getBounds(this: any) {
      const bounds = L.latLngBounds([]);
      for (const pulse of getPulses()) {
        for (const ll of pulse.latlngs) bounds.extend([ll.lat, ll.lng]);
      }
      return bounds;
    },

    _scheduleRedraw(this: any) {
      if (this._zoomLock || this._raf) return;
      this._raf = requestAnimationFrame((now: number) => {
        this._raf = 0;
        this._redraw(now);
      });
    },

    _redraw(this: any, now: number) {
      const mapInst: LeafletMap | null = this._map;
      const canvas: HTMLCanvasElement | null = this._canvas;
      const ctx: CanvasRenderingContext2D | null = this._ctx;
      if (!mapInst || !canvas || !ctx) return;
      if (this._zoomLock) return;

      const live = getPulses();
      const size = mapInst.getSize();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(size.x * dpr));
      const h = Math.max(1, Math.floor(size.y * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        canvas.style.width = `${size.x}px`;
        canvas.style.height = `${size.y}px`;
      }

      canvas.style.transform = "";
      canvas.style.webkitTransform = "";
      const topLeft = mapInst.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.x, size.y);
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.setLineDash([7, 9]);

      const lngOffsets = visibleWorldLngOffsets(mapInst);

      for (const pulse of live) {
        if (pulse.latlngs.length < 2) continue;

        // 未激活：灰色虚线常驻全长（与 flight-map 一致）
        if (!pulse.active) {
          ctx.globalAlpha = IDLE_ROUTE_ALPHA;
          ctx.strokeStyle = pulse.idleColor;
          ctx.lineDashOffset = 0;
          for (const off of lngOffsets) {
            strokeLatLngPath(ctx, mapInst, pulse.latlngs, off);
            const head = pulse.latlngs[pulse.latlngs.length - 1]!;
            const hp = mapInst.latLngToContainerPoint([head.lat, head.lng + off]);
            ctx.setLineDash([]);
            ctx.fillStyle = pulse.idleColor;
            ctx.beginPath();
            ctx.arc(hp.x, hp.y, 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.setLineDash([7, 9]);
          }
          continue;
        }

        const age = now - pulse.bornAt;
        const life = pulse.drawMs + pulse.holdMs + pulse.fadeMs;
        if (age >= life) continue;

        let drawT = 1;
        let opacity = 0.9;
        if (age < pulse.drawMs) {
          drawT = age / pulse.drawMs;
          opacity = 0.55 + 0.4 * drawT;
        } else if (age < pulse.drawMs + pulse.holdMs) {
          drawT = 1;
          opacity = 0.95;
        } else {
          const fadeAge = age - pulse.drawMs - pulse.holdMs;
          drawT = 1;
          opacity = Math.max(0, 1 - fadeAge / pulse.fadeMs) * 0.9;
        }

        const pts = samplePathPrefix(pulse.latlngs, drawT);
        if (pts.length < 2) continue;

        // 激活：本 IP 自己的颜色 + **流动虚线**（与 flight-map 完全一致）
        ctx.globalAlpha = opacity;
        ctx.strokeStyle = pulse.color;
        ctx.lineDashOffset = -(age / 28);
        for (const off of lngOffsets) {
          strokeLatLngPath(ctx, mapInst, pts, off);
          const head = pts[pts.length - 1]!;
          const hp = mapInst.latLngToContainerPoint([head.lat, head.lng + off]);
          ctx.setLineDash([]);
          ctx.fillStyle = pulse.color;
          ctx.beginPath();
          ctx.arc(hp.x, hp.y, 2.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.setLineDash([7, 9]);
        }
      }

      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    },
  });
  return new PulseLayer();
}
