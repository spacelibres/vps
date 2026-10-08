"use client";

import type { Map as LeafletMap } from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defineView, type PluginView, type PluginViewProps } from "@/sdk";
import { Alert, Card, EmptyState, KeyValue, Spinner, StatusBadge, TextInput } from "@/sdk/ui";
import { createBingTileLayer } from "./bing";
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
  FetchBatchStatus,
  FetchRequestRecord,
  FetchRouteOrigin,
  IpFetchStatRow,
  PoolCountryNode,
  PoolPayload,
  RoutePulse,
  StatsSnapshot,
  StoreSummary,
  StreamPulse,
  StreamSnapshot,
} from "./types";

import "leaflet/dist/leaflet.css";

const PLUGIN_ID = "ip-pool";
const MAX_TABLE_ROWS = 200;
/** 统计自动刷新间隔（毫秒）。 */
const STATS_REFRESH_MS = 5000;
/** 批量作业进度轮询间隔（毫秒）。 */
const BATCH_POLL_MS = 3000;
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
  const layerRef = useRef<PulseRouteLayer | null>(null);
  const pulsesRef = useRef<Map<string, RoutePulse>>(new Map());
  const catalogRef = useRef<Map<string, { lat: number; lng: number; city?: string; country?: string }>>(
    new Map(),
  );
  const originRef = useRef<FetchRouteOrigin | null>(null);
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
  const [batch, setBatch] = useState<FetchBatchStatus | null>(null);
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
    });
    for (const pulse of seed) {
      if (!pulsesRef.current.has(pulse.id)) pulsesRef.current.set(pulse.id, pulse);
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
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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

  // 批量作业进度自动轮询（展示外部触发的全池抓取）。
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/plugins/${PLUGIN_ID}/actions/batchStatus`, { cache: "no-store" });
        const json = (await res.json()) as { ok: boolean; data?: FetchBatchStatus };
        if (stopped || !json.ok || !json.data) return;
        setBatch(json.data);
      } catch {
        // 忽略；下一轮重试
      }
    };
    void tick();
    const id = setInterval(tick, BATCH_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, []);

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
    source.addEventListener("error", () => setConnected(false));
    return () => source.close();
  }, [applyPulses, mapReady, seedFromCatalog]);

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
      mapRef.current = map;
      setMapReady(true);
      setTimeout(() => map.invalidateSize(), 0);

      const tick = (now: number) => {
        const changed = pruneDeadPulses(pulsesRef.current, now);
        if (changed > 0) layer.setPulses([...pulsesRef.current.values()]);
        layer._redraw(now);
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

  // 池子/原点就绪后补种骨架
  useEffect(() => {
    if (mapReady) seedFromCatalog();
  }, [mapReady, aggregate, seedFromCatalog]);

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
    <div className="flex h-[calc(100vh-8rem)] min-h-130 gap-4">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        <div ref={mapElRef} className="absolute inset-0 z-0" />
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-md bg-black/60 px-2.5 py-1.5 text-xs text-white backdrop-blur">
          <span className={`inline-block h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-red-500"}`} />
          {connected ? "实时已连接" : "实时未连接"}
          <span className="opacity-70">航线 {pulseCount}</span>
          {tileset && <span className="opacity-70">{tileset}</span>}
        </div>
      </div>

      <aside className="w-104 shrink-0 space-y-4 overflow-y-auto pr-1">
        <Card title="概览">
          {batch && batch.total > 0 && (
            <div className="mb-3 rounded-md border border-neutral-200 px-2 py-1.5 text-xs dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <StatusBadge tone={batch.running ? "warning" : "success"}>
                  {batch.running ? "全池抓取中" : "全池抓取完成"}
                </StatusBadge>
                <span>
                  {batch.done} / {batch.total}
                </span>
                {typeof batch.ratePerSec === "number" && batch.ratePerSec > 0 && (
                  <span className="text-neutral-500">{batch.ratePerSec} 个/秒</span>
                )}
                <span className="ml-auto text-neutral-500">
                  成功 {batch.success} · HTTP {batch.httpError} · 传输 {batch.transportError}
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${Math.round((batch.done / batch.total) * 100)}%` }}
                />
              </div>
              {(batch.pool || batch.hotReused !== undefined) && (
                <div className="mt-1 flex items-center gap-3 text-neutral-500">
                  <span>热复用 {batch.hotReused ?? 0}</span>
                  <span>新建 {batch.coldOpened ?? 0}</span>
                  {batch.pool && (
                    <span className="ml-auto">
                      热池 {batch.pool.hot}/{batch.pool.total}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {error && (
            <div className="mb-3">
              <Alert tone="error">{error}</Alert>
            </div>
          )}
          {snapshot ? (
            <div className="grid grid-cols-3 gap-3">
              <KeyValue label="池 IP" value={snapshot.pool.total} />
              <KeyValue label="IPv4 / IPv6" value={`${snapshot.pool.ipv4} / ${snapshot.pool.ipv6}`} />
              <KeyValue label="国家 / 城市" value={`${snapshot.pool.countries} / ${snapshot.pool.cities}`} />
              <KeyValue label="总请求" value={summary?.totalRequests ?? 0} />
              <KeyValue label="成功率" value={successRate === null ? "-" : `${successRate}%`} />
              <KeyValue label="总流量" value={formatBytes(summary?.totalBytes)} />
            </div>
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
          {rows.length === 0 ? (
            <EmptyState>{snapshot ? "还没有请求数据" : "加载中…"}</EmptyState>
          ) : (
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white text-neutral-500 dark:bg-neutral-900">
                  <tr>
                    {th("ip", "IP", "left")}
                    <th className="px-1 py-1 text-left">地区</th>
                    {th("requests", "请求")}
                    {th("success", "成功")}
                    {th("failed", "失败")}
                    {th("totalBytes", "字节")}
                    {th("avgDurationMs", "均耗时")}
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {rows.map((row) => (
                    <tr key={row.ip} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="px-1 py-1">{row.ip}</td>
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
                  ))}
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
    </div>
  );
}

export const ipPoolViews: PluginView[] = [
  defineView({ id: "main", title: "IP 池 · 航线", path: "", Component: IpPoolView }),
];
