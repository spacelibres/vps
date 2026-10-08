"use client";

import type { Map as LeafletMap } from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defineView, type PluginView, type PluginViewProps } from "@/sdk";
import { Alert, Card, EmptyState, KeyValue, Spinner, StatusBadge, TextInput } from "@/sdk/ui";
import { createBingTileLayer } from "./bing";
import { ipVisual } from "./flight";
import type { PulseRouteLayer } from "./map-layer";
import { createPulseRouteLayer } from "./map-layer";
import {
  activatePulses,
  buildSeedPulses,
  DEFAULT_TIMING,
  pruneDeadPulses,
  type PulseItem,
} from "./pulses";
import type {
  FetchRequestRecord,
  FetchRouteOrigin,
  IpFetchStatRow,
  PoolCountryNode,
  PoolPayload,
  RoutePulse,
  StatsSnapshot,
  StoreSummary,
  StreamMetrics,
  StreamPulse,
  StreamSnapshot,
} from "./types";

import "leaflet/dist/leaflet.css";

const PLUGIN_ID = "ip-pool";
const MAX_TABLE_ROWS = 200;
/** 统计自动刷新间隔（毫秒）。 */
const STATS_REFRESH_MS = 5000;
/** 心跳波保留的采样数（约 90 秒）。 */
const HEARTBEAT_MAX = 90;
const ARC_OPTIONS = {
  leoAltitudeMinKm: 12,
  leoAltitudeMaxKm: 48,
  bowFactor: 0.16,
  maxBowDeg: 26,
  maxAbsLat: 56,
} as const;

type SortKey = "requests" | "success" | "failed" | "totalBytes" | "avgDurationMs" | "ip";

function formatBytes(bytes: number | undefined): string {
  if (!bytes) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTime(ms: number | undefined): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleTimeString();
}

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function outcomeTone(outcome: string): "success" | "warning" | "error" {
  if (outcome === "success") return "success";
  if (outcome === "http_error") return "warning";
  return "error";
}

/** 格式化字节速率（B/s → 人类可读）。 */
function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return "-";
  const units = ["B/s", "KB/s", "MB/s", "GB/s"];
  let value = bps;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** 请求速率心跳波：每秒一帧，绿色=成功、红色=失败，叠加最近峰值线。 */
function drawHeartbeat(
  canvas: HTMLCanvasElement | null,
  samples: readonly { ok: number; fail: number }[],
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = canvas.clientWidth || 640;
  const cssH = canvas.clientHeight || 72;
  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const peak = Math.max(1, ...samples.map((s) => s.ok + s.fail));
  const n = samples.length;
  if (n === 0) return;
  const step = cssW / HEARTBEAT_MAX;
  const baseY = cssH - 4;
  const scale = (cssH - 10) / peak;

  for (let i = 0; i < n; i += 1) {
    const sample = samples[i]!;
    const x = i * step;
    const bw = Math.max(1, step - 1);
    const okH = sample.ok * scale;
    const failH = sample.fail * scale;
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(x, baseY - okH, bw, okH);
    if (failH > 0) {
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(x, baseY - okH - failH, bw, failH);
    }
  }
}

/** 国旗（本地 flagcdn w20 PNG，位于 `public/flags/w20/{cc}.png`）。 */
function Flag({ code }: { code?: string }) {
  if (!code || code === "未知" || code.length !== 2) return null;
  return (
    <img
      src={`/flags/w20/${code.toLowerCase()}.png`}
      alt={code}
      width={18}
      loading="lazy"
      className="mr-1 inline-block h-auto align-[-2px]"
    />
  );
}

export function IpPoolView(_props: PluginViewProps) {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const focusLayerRef = useRef<import("leaflet").LayerGroup | null>(null);
  const layerRef = useRef<PulseRouteLayer | null>(null);
  const pulsesRef = useRef<Map<string, RoutePulse>>(new Map());
  const catalogRef = useRef<Map<string, { lat: number; lng: number; city?: string; country?: string }>>(
    new Map(),
  );
  const originRef = useRef<FetchRouteOrigin | null>(null);
  const hotSetRef = useRef<Set<string>>(new Set());
  const didFitRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [snapshot, setSnapshot] = useState<StatsSnapshot | null>(null);
  const [aggregate, setAggregate] = useState<PoolCountryNode[]>([]);
  const [summary, setSummary] = useState<StoreSummary | null>(null);
  const [log, setLog] = useState<FetchRequestRecord[]>([]);
  const [pulseCount, setPulseCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const [tileset, setTileset] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<StreamMetrics | null>(null);
  const [windowStat, setWindowStat] = useState<{ count: number; requests: number; bytes: number } | null>(null);
  const [focusIp, setFocusIp] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const heartbeatRef = useRef<HTMLCanvasElement | null>(null);
  const heartbeatSamplesRef = useRef<Array<{ ok: number; fail: number }>>([]);
  const tbodyRef = useRef<HTMLTableSectionElement | null>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  // 行 ↔ 地图连线
  const viewRef = useRef<HTMLDivElement | null>(null);
  const leaderRef = useRef<SVGPathElement | null>(null);
  const dotRef = useRef<SVGCircleElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const focusIpRef = useRef<string | null>(null);
  const layoutFocusRef = useRef<() => void>(() => {});
  const [query, setQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("requests");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const syncLayer = useCallback(() => {
    layerRef.current?.setPulses([...pulsesRef.current.values()]);
  }, []);

  const seedFromCatalog = useCallback(() => {
    const origin = originRef.current;
    if (!origin || catalogRef.current.size === 0) return;
    const seed = buildSeedPulses({
      origin,
      ips: [...catalogRef.current.entries()].map(([ip, v]) => ({
        ip,
        lat: v.lat,
        lng: v.lng,
      })),
      timing: DEFAULT_TIMING,
      arc: ARC_OPTIONS,
      hotIps: hotSetRef.current,
    });
    for (const pulse of seed) {
      const existing = pulsesRef.current.get(pulse.id);
      // 热状态会变（建连/掉线），已存在的骨架也要同步标记。
      if (existing) existing.hot = pulse.hot;
      else pulsesRef.current.set(pulse.id, pulse);
    }
    syncLayer();
    setPulseCount(pulsesRef.current.size);
    if (!didFitRef.current && mapRef.current) {
      const bounds = layerRef.current?.getBounds();
      if (bounds?.isValid()) {
        mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 5 });
        didFitRef.current = true;
      }
    }
  }, [syncLayer]);

  const applyPulses = useCallback(
    (items: PulseItem[]) => {
      if (items.length === 0) return;
      const changed = activatePulses(pulsesRef.current, items, {
        origin: originRef.current,
        catalog: catalogRef.current,
        timing: DEFAULT_TIMING,
        arc: ARC_OPTIONS,
        now: performance.now(),
        hotIps: hotSetRef.current,
      });
      if (changed > 0) {
        syncLayer();
        setPulseCount(pulsesRef.current.size);
      }
    },
    [syncLayer],
  );

  // ── 统计快照（自动刷新，无需手动）──────────────────────
  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/${PLUGIN_ID}/actions/stats`, { cache: "no-store" });
      const json = (await res.json()) as
        | { ok: true; data: StatsSnapshot }
        | { ok: false; error: { message: string } };
      if (!json.ok) {
        setError(json.error.message);
        return;
      }
      setSnapshot(json.data);
      setSummary(json.data.summary);
      originRef.current = json.data.origin;
      setLog(json.data.recentRequests.slice(-200).reverse());
      hotSetRef.current = new Set(json.data.hotIps ?? []);
      seedFromCatalog();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [seedFromCatalog]);

  /** 统计被重置（本端或远端触发）：清空本地脉冲/采样/日志后重种骨架。 */
  const resetLocalView = useCallback(() => {
    pulsesRef.current.clear();
    syncLayer();
    setPulseCount(0);
    heartbeatSamplesRef.current = [];
    drawHeartbeat(heartbeatRef.current, heartbeatSamplesRef.current);
    setLog([]);
    setMetrics(null);
    setWindowStat(null);
    setFocusIp(null);
    seedFromCatalog();
    void refreshStats();
  }, [refreshStats, seedFromCatalog, syncLayer]);

  /** 重置服务端统计（清空计数与最近事件）。 */
  const doResetStats = useCallback(async () => {
    if (resetting) return;
    if (!window.confirm("清空所有统计计数与请求日志？此操作不可撤销。")) return;
    setResetting(true);
    try {
      const res = await fetch(`/api/plugins/${PLUGIN_ID}/actions/resetStats`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: {} }),
      });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        setError(json.error?.message ?? "重置失败");
        return;
      }
      resetLocalView();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setResetting(false);
    }
  }, [resetLocalView, resetting]);

  // ── IP 池聚合（仅加载一次）──────────────────────────────
  const loadPool = useCallback(async () => {
    try {
      const res = await fetch(`/api/plugins/${PLUGIN_ID}/actions/pool`, { cache: "no-store" });
      const json = (await res.json()) as
        | { ok: true; data: PoolPayload }
        | { ok: false; error: { message: string } };
      if (!json.ok) return;
      setAggregate(json.data.pool.aggregate);
      const catalog = catalogRef.current;
      catalog.clear();
      for (const country of json.data.pool.aggregate) {
        for (const city of country.cities) {
          for (const ip of city.ips) {
            if (!ip.point) continue;
            catalog.set(ip.ip, {
              lat: ip.point.lat,
              lng: ip.point.lng,
              city: city.city,
              country: country.country,
            });
          }
        }
      }
      seedFromCatalog();
    } catch {
      // 池子加载失败不阻塞页面
    }
  }, [seedFromCatalog]);

  useEffect(() => {
    void loadPool();
    void refreshStats();
  }, [loadPool, refreshStats]);

  // 统计数据自动刷新。
  useEffect(() => {
    const id = setInterval(() => void refreshStats(), STATS_REFRESH_MS);
    return () => clearInterval(id);
  }, [refreshStats]);

  // ── SSE 实时流 ──────────────────────────────────────────
  useEffect(() => {
    const source = new EventSource(`/api/plugins/${PLUGIN_ID}/actions/stream`);
    source.addEventListener("open", () => setConnected(true));
    source.addEventListener("snapshot", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as StreamSnapshot;
      setSummary(data.summary);
      originRef.current = data.origin;
      setLog(data.recentRequests.slice(-200).reverse());
      setConnected(true);
      if (mapReady) {
        seedFromCatalog();
        applyPulses(
          data.recentAttempts.map((a) => ({
            id: a.requestId,
            ip: a.ip ?? "",
            ok: a.outcome === "success",
            city: a.city,
            country: a.country,
          })),
        );
      }
    });
    source.addEventListener("pulse", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as StreamPulse;
      setSummary(data.summary);
      if (data.requests.length) {
        setLog((prev) => [...[...data.requests].reverse(), ...prev].slice(0, 300));
      }
      applyPulses(
        data.attempts.map((a) => ({
          id: a.requestId,
          ip: a.ip ?? "",
          ok: a.outcome === "success",
          city: a.city,
          country: a.country,
        })),
      );
    });
    source.addEventListener("metrics", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as StreamMetrics;
      setMetrics(data);
      const samples = heartbeatSamplesRef.current;
      samples.push({ ok: data.rpsOk, fail: data.rpsFail });
      if (samples.length > HEARTBEAT_MAX) samples.splice(0, samples.length - HEARTBEAT_MAX);
      drawHeartbeat(heartbeatRef.current, samples);
    });
    source.addEventListener("reset", () => resetLocalView());
    source.addEventListener("error", () => setConnected(false));
    return () => source.close();
  }, [applyPulses, mapReady, resetLocalView, seedFromCatalog]);

  // ── 初始化地图 + 脉冲图层 + rAF 循环 ─────────────────────
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    void (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !mapElRef.current || mapRef.current) return;

      const map = L.map(mapElRef.current, {
        center: [40, 180],
        zoom: 2,
        zoomControl: true,
        worldCopyJump: true,
        preferCanvas: true,
      });

      try {
        const bing = await createBingTileLayer(L);
        bing.layer.addTo(map);
        setTileset(bing.label);
      } catch {
        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
          subdomains: "abcd",
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap &copy; CARTO",
        }).addTo(map);
        setTileset("暗色底图（Bing 回退）");
      }

      const layer = createPulseRouteLayer(L, () => [...pulsesRef.current.values()]);
      layer.addTo(map);
      layerRef.current = layer;
      leafletRef.current = L;
      focusLayerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      setMapReady(true);
      setTimeout(() => map.invalidateSize(), 0);

      const tick = (now: number) => {
        const changed = pruneDeadPulses(pulsesRef.current, now);
        if (changed > 0) layer.setPulses([...pulsesRef.current.values()]);
        layer._redraw(now);
        layoutFocusRef.current();
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // 行焦点：同步到 ref（供 rAF 定位使用）。
  useEffect(() => {
    focusIpRef.current = focusIp;
  }, [focusIp]);

  /** 每帧重算「行 → 地图」引线 + 浮动卡片位置（跟随滚动/缩放）。 */
  const layoutFocus = useCallback(() => {
    const view = viewRef.current;
    const tbody = tbodyRef.current;
    const map = mapRef.current;
    const mapEl = mapElRef.current;
    const card = cardRef.current;
    const ip = focusIpRef.current;

    const hide = () => {
      leaderRef.current?.setAttribute("d", "");
      dotRef.current?.setAttribute("r", "0");
      if (card) card.style.visibility = "hidden";
    };

    if (!view || !tbody || !map || !mapEl || !ip) {
      hide();
      return;
    }
    const entry = catalogRef.current.get(ip);
    let tr: HTMLElement | null = null;
    for (const el of tbody.querySelectorAll<HTMLElement>("tr[data-ip]")) {
      if (el.dataset.ip === ip) {
        tr = el;
        break;
      }
    }
    if (!tr || !entry) {
      hide();
      return;
    }

    const v = view.getBoundingClientRect();
    const t = tr.getBoundingClientRect();
    const m = mapEl.getBoundingClientRect();
    const pt = map.latLngToContainerPoint([entry.lat, entry.lng]);
    const x1 = t.right - v.left;
    const y1 = t.top - v.top + t.height / 2;
    const x2 = m.left - v.left + pt.x;
    const y2 = m.top - v.top + pt.y;
    // 行已滑出表格视口 → 不画
    if (y1 < 0 || y1 > v.height) {
      hide();
      return;
    }

    const mx = x1 + Math.min(56, Math.abs(x2 - x1) * 0.4);
    leaderRef.current?.setAttribute("d", `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
    dotRef.current?.setAttribute("cx", String(x2));
    dotRef.current?.setAttribute("cy", String(y2));
    dotRef.current?.setAttribute("r", "4");
    if (card) {
      card.style.visibility = "visible";
      card.style.left = `${x2}px`;
      card.style.top = `${y2}px`;
    }
  }, []);
  useEffect(() => {
    layoutFocusRef.current = layoutFocus;
  }, [layoutFocus]);

  // 行点击 → 地图聚焦：脉冲标记 + 信息卡。
  useEffect(() => {
    const L = leafletRef.current;
    const layer = focusLayerRef.current;
    const map = mapRef.current;
    if (!L || !layer || !map) return;
    layer.clearLayers();
    if (!focusIp) return;
    const entry = catalogRef.current.get(focusIp);
    if (!entry) return;
    const color = ipVisual(focusIp).color;
    L.circleMarker([entry.lat, entry.lng], {
      radius: 7,
      color,
      weight: 2,
      fillColor: color,
      fillOpacity: 0.5,
    })
      .bindTooltip(
        `<b>${focusIp}</b><br/>${[entry.country, entry.city].filter(Boolean).join(" · ")}`,
        { permanent: true, direction: "top", className: "ip-focus-tip" },
      )
      .addTo(layer);
    map.setView([entry.lat, entry.lng], Math.max(map.getZoom(), 4), { animate: true });
  }, [focusIp, mapReady]);

  // 池子/原点就绪后补种骨架
  useEffect(() => {
    if (mapReady) seedFromCatalog();
  }, [mapReady, aggregate, seedFromCatalog]);

  // 本屏窗口统计：只统计当前表格可视区域内的 IP。
  useEffect(() => {
    const root = tableWrapRef.current;
    const tbody = tbodyRef.current;
    if (!root || !tbody) {
      setWindowStat(null);
      return;
    }
    const byIp = new Map((snapshot?.rows ?? []).map((r) => [r.ip, r]));
    const visible = new Set<string>();
    const recompute = () => {
      let requests = 0;
      let bytes = 0;
      for (const ip of visible) {
        const row = byIp.get(ip);
        if (!row) continue;
        requests += row.requests;
        bytes += row.totalBytes ?? 0;
      }
      setWindowStat({ count: visible.size, requests, bytes });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const ip = (entry.target as HTMLElement).dataset.ip;
          if (!ip) continue;
          if (entry.isIntersecting) visible.add(ip);
          else visible.delete(ip);
        }
        recompute();
      },
      { root, threshold: 0 },
    );
    for (const tr of tbody.querySelectorAll<HTMLElement>("tr[data-ip]")) observer.observe(tr);
    recompute();
    return () => observer.disconnect();
  }, [snapshot, query, countryFilter, sortKey, sortDir]);

  const countryChips = useMemo(() => {
    const list = aggregate.map((c) => ({ code: c.country, total: c.total }));
    return list.slice(0, 40);
  }, [aggregate]);

  const filteredAggregate = useMemo<PoolCountryNode[]>(() => {
    const q = query.trim().toLowerCase();
    let source = aggregate;
    if (countryFilter) source = source.filter((c) => c.country === countryFilter);
    if (!q) return source;
    const result: PoolCountryNode[] = [];
    for (const country of source) {
      const countryHit = country.country.toLowerCase().includes(q);
      const cities = country.cities
        .map((city) => {
          const cityHit = city.city.toLowerCase().includes(q);
          const ips = cityHit || countryHit ? city.ips : city.ips.filter((ip) => ip.ip.includes(q));
          return { ...city, ips, total: cityHit || countryHit ? city.total : ips.length };
        })
        .filter((city) => city.ips.length > 0);
      if (cities.length > 0) {
        result.push({ country: country.country, total: cities.reduce((s, c) => s + c.total, 0), cities });
      }
    }
    return result;
  }, [aggregate, query, countryFilter]);

  const rows = useMemo<Array<IpFetchStatRow & { ip: string }>>(() => {
    const all = snapshot?.rows ?? [];
    const q = query.trim().toLowerCase();
    let filtered = countryFilter ? all.filter((r) => r.country === countryFilter) : all;
    if (q) {
      filtered = filtered.filter(
        (r) => r.ip.includes(q) || (r.city ?? "").toLowerCase().includes(q),
      );
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === "ip") return a.ip.localeCompare(b.ip) * dir;
      const av = (a[sortKey] ?? 0) as number;
      const bv = (b[sortKey] ?? 0) as number;
      return (av - bv) * dir;
    });
    return sorted.slice(0, MAX_TABLE_ROWS);
  }, [snapshot, query, countryFilter, sortKey, sortDir]);

  const successRate =
    summary && summary.totalRequests > 0
      ? Math.round((summary.totalSuccess / summary.totalRequests) * 1000) / 10
      : null;

  const focusRow = focusIp ? (snapshot?.rows ?? []).find((r) => r.ip === focusIp) : undefined;
  const focusHot = focusIp ? hotSetRef.current.has(focusIp) : false;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const th = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <th
      className={`cursor-pointer select-none px-1 py-1 text-${align} hover:text-neutral-800 dark:hover:text-neutral-200`}
      onClick={() => toggleSort(key)}
    >
      {label}
      {sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div ref={viewRef} className="relative flex h-[calc(100vh-8rem)] min-h-130 gap-4">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        <div ref={mapElRef} className="absolute inset-0 z-0" />
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-md bg-black/60 px-2.5 py-1.5 text-xs text-white backdrop-blur">
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-500"}`} />
          {connected ? "实时已连接" : "实时未连接"}
          <span className="opacity-70">航线 {pulseCount}</span>
          {metrics && <span className="opacity-70">热池 {metrics.hot}/{metrics.poolTotal}</span>}
          {metrics && metrics.rps > 0 && <span className="opacity-70">{metrics.rps} 个/秒</span>}
          {tileset && <span className="opacity-70">{tileset}</span>}
        </div>
      </div>

      <aside className="w-104 shrink-0 space-y-4 overflow-y-auto pr-1">
        <Card
          title="概览"
          actions={
            <button
              type="button"
              onClick={() => void doResetStats()}
              disabled={resetting}
              title="清空所有统计计数与请求日志（会丢失历史，不影响热连接）"
              className="rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
            >
              {resetting ? "重置中…" : "重置统计"}
            </button>
          }
        >
          {error && (
            <div className="mb-3">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
          {snapshot ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <KeyValue label="池 IP" value={snapshot.pool.total} />
                <KeyValue label="IPv4 / IPv6" value={`${snapshot.pool.ipv4} / ${snapshot.pool.ipv6}`} />
                <KeyValue label="国家 / 城市" value={`${snapshot.pool.countries} / ${snapshot.pool.cities}`} />
                <KeyValue label="总请求" value={summary?.totalRequests ?? 0} />
                <KeyValue label="成功率" value={successRate === null ? "-" : `${successRate}%`} />
                <KeyValue label="总流量" value={formatBytes(summary?.totalBytes)} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <KeyValue label="速率" value={metrics ? `${metrics.rps} 个/秒` : "-"} />
                <KeyValue label="下载" value={formatBps(metrics?.rxBps)} />
                <KeyValue label="上传" value={formatBps(metrics?.txBps)} />
              </div>
              <div className="mt-2">
                <canvas
                  ref={heartbeatRef}
                  width={640}
                  height={72}
                  className="h-18 w-full rounded bg-neutral-50 dark:bg-neutral-950"
                />
                <p className="mt-0.5 text-xs text-neutral-500">
                  心跳：绿=成功 红=失败（最近 {HEARTBEAT_MAX}s）
                  {metrics ? ` · ${metrics.rpsOk} 成功 / ${metrics.rpsFail} 失败` : ""}
                </p>
              </div>
            </>
          ) : (
            <Spinner label="正在加载池子…" />
          )}
        </Card>

        <Card
          title="IP 池"
          actions={
            <TextInput
              placeholder="搜索 国家/城市/IP"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-40"
            />
          }
        >
          <div className="mb-2 flex flex-wrap gap-1">
            {countryFilter && (
              <button
                type="button"
                onClick={() => setCountryFilter(null)}
                className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs dark:bg-neutral-700"
              >
                清除筛选 ✕
              </button>
            )}
            {countryChips.map((chip) => (
              <button
                key={chip.code}
                type="button"
                onClick={() => setCountryFilter(chip.code)}
                title={`${chip.code} · ${chip.total}`}
                className={`rounded px-1 py-0.5 text-xs ${
                  countryFilter === chip.code
                    ? "bg-blue-600 text-white"
                    : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                }`}
              >
                <Flag code={chip.code} />
                {chip.total}
              </button>
            ))}
          </div>
          {filteredAggregate.length === 0 ? (
            <EmptyState>{aggregate.length ? "没有匹配的 IP" : "加载中…"}</EmptyState>
          ) : (
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filteredAggregate.map((country) => (
                <details key={country.country} className="rounded-md border border-neutral-200 px-2 py-1 dark:border-neutral-800">
                  <summary className="cursor-pointer text-sm font-medium">
                    <Flag code={country.country} />
                    {country.country}{" "}
                    <span className="text-xs text-neutral-500">{country.total} 个 IP</span>
                  </summary>
                  <div className="mt-1 space-y-1 pl-3">
                    {country.cities.map((city) => (
                      <details key={`${country.country}/${city.city}`} className="text-sm">
                        <summary className="cursor-pointer text-neutral-700 dark:text-neutral-300">
                          {city.city} <span className="text-xs text-neutral-500">{city.total}</span>
                        </summary>
                        <ul className="mt-1 space-y-0.5 pl-3 font-mono text-xs text-neutral-500">
                          {city.ips.slice(0, 100).map((ip) => (
                            <li key={ip.ip}>{ip.ip}</li>
                          ))}
                          {city.ips.length > 100 && <li>… 还有 {city.ips.length - 100} 个</li>}
                        </ul>
                      </details>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </Card>

        <Card title="统计">
          {windowStat && windowStat.count > 0 && (
            <p className="mb-2 text-xs text-neutral-500">
              本屏 {windowStat.count} 个 IP · {windowStat.requests} 请求 · {formatBytes(windowStat.bytes)}
            </p>
          )}
          {rows.length === 0 ? (
            <EmptyState>{snapshot ? "还没有请求数据" : "加载中…"}</EmptyState>
          ) : (
            <div ref={tableWrapRef} className="max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white text-neutral-500 dark:bg-neutral-900">
                  <tr>
                    {th("ip", "IP", "left")}
                    <th className="px-1 py-1 text-left">族</th>
                    <th className="px-1 py-1 text-left">地区</th>
                    {th("requests", "请求")}
                    {th("success", "成功")}
                    {th("failed", "失败")}
                    {th("totalBytes", "字节")}
                    {th("avgDurationMs", "均耗时")}
                  </tr>
                </thead>
                <tbody ref={tbodyRef} className="font-mono">
                  {rows.map((row) => {
                    const hot = hotSetRef.current.has(row.ip);
                    return (
                      <tr
                        key={row.ip}
                        data-ip={row.ip}
                        onClick={() => setFocusIp((prev) => (prev === row.ip ? null : row.ip))}
                        className={`cursor-pointer border-t border-neutral-100 dark:border-neutral-800 ${
                          focusIp === row.ip ? "bg-blue-50 dark:bg-blue-950" : ""
                        }`}
                      >
                        <td className="px-1 py-1">
                          {hot && <span className="mr-1 text-green-500">●</span>}
                          {row.ip}
                        </td>
                        <td className="px-1 py-1 text-neutral-500">
                          {row.ip.includes(":") ? "v6" : "v4"}
                        </td>
                        <td className="px-1 py-1 text-neutral-500">
                          <Flag code={row.country} />
                          {[row.country, row.city].filter(Boolean).join(" · ") || "-"}
                        </td>
                        <td className="px-1 py-1 text-right">{row.requests}</td>
                        <td className="px-1 py-1 text-right text-green-600">{row.success}</td>
                        <td className="px-1 py-1 text-right text-red-500">{row.failed}</td>
                        <td className="px-1 py-1 text-right">{formatBytes(row.totalBytes)}</td>
                        <td className="px-1 py-1 text-right">{formatMs(row.avgDurationMs)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="日志">
          {log.length === 0 ? (
            <EmptyState>暂无数据</EmptyState>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto text-xs">
              {log.map((entry, index) => (
                <li
                  key={`${entry.requestId}-${index}`}
                  className="flex items-center justify-between gap-2 rounded border border-neutral-100 px-2 py-1 dark:border-neutral-800"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <StatusBadge tone={outcomeTone(entry.outcome)}>{entry.outcome}</StatusBadge>
                    <span className="truncate font-mono">{entry.finalIp ?? entry.requestId}</span>
                  </span>
                  <span className="shrink-0 text-neutral-500">
                    {formatMs(entry.totalDurationMs)} · {formatBytes(entry.bytes)} · {formatTime(entry.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </aside>

      {/* 行 ↔ 地图引线（每帧跟随滚动/缩放重算） */}
      <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible">
        <path ref={leaderRef} fill="none" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="5 4" opacity={0.9} />
        <circle ref={dotRef} r={0} fill="#3b82f6" opacity={0.9} />
      </svg>
      {focusIp && (
        <div
          ref={cardRef}
          className="pointer-events-none absolute z-30 w-52 -translate-x-1/2 -translate-y-[130%] rounded-lg border border-neutral-200 bg-white/95 p-2 text-xs shadow-lg dark:border-neutral-700 dark:bg-neutral-900/95"
          style={{ visibility: "hidden" }}
        >
          <div className="flex items-center gap-1 font-mono">
            {focusHot && <span className="text-green-500">●</span>}
            <span className="truncate">{focusIp}</span>
          </div>
          <div className="mt-0.5 text-neutral-500">
            <Flag code={focusRow?.country} />
            {[focusRow?.country, focusRow?.city].filter(Boolean).join(" · ") || "-"}
          </div>
          {focusRow && (
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-neutral-500">
              <span>请求 {focusRow.requests}</span>
              <span>成功 {focusRow.success}</span>
              <span>失败 {focusRow.failed}</span>
              <span>{formatBytes(focusRow.totalBytes)}</span>
              {focusHot && <span className="col-span-2 text-green-600">热连接（绿色通道）</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const ipPoolViews: PluginView[] = [
  defineView({ id: "main", title: "IP 池 · 航线", path: "", Component: IpPoolView }),
];
