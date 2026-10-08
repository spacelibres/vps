"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useVps } from "@/components/vps-context";
import { sortedPlugins } from "@/plugins";
import {
  formatBytes,
  formatRelativeToNow,
  percent,
  type ServiceInfo,
} from "@/sdk";
import { Alert, Button, Card, Grid, KeyValue, Spinner, StatusBadge } from "@/sdk/ui";

interface OverviewEntry {
  veid: string;
  alias: string;
  ok: boolean;
  info?: ServiceInfo;
  error?: string;
}

/** 本月流量使用率达到该百分比时，在总览卡片上告警。 */
const TRAFFIC_WARN_PERCENT = 95;

export default function OverviewPage() {
  const [entries, setEntries] = useState<OverviewEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const router = useRouter();
  const { setCurrentVeid } = useVps();
  const defaultPluginPath = `/plugins/${sortedPlugins[0]?.id ?? "lifecycle"}`;

  /** 点卡片 = 选中这台 VPS，并进入它的默认插件页（veid 带入 URL，便于刷新/分享）。 */
  const openServer = useCallback(
    (veid: string) => {
      setCurrentVeid(veid);
      router.push(`${defaultPluginPath}?veid=${encodeURIComponent(veid)}`);
    },
    [router, defaultPluginPath, setCurrentVeid],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/overview");
      const json = (await res.json()) as {
        ok: boolean;
        data?: OverviewEntry[];
        error?: { message?: string };
      };
      if (!json.ok) {
        setError(json.error?.message ?? "加载失败");
        return;
      }
      setEntries(json.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">总览</h1>
          <p className="text-sm text-neutral-500">{entries?.length ?? 0} 台 VPS</p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading}>
          {loading ? <Spinner label="刷新中" /> : "刷新全部"}
        </Button>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {(entries ?? []).map((entry) => (
          <OverviewCard
            key={entry.veid}
            entry={entry}
            onOpen={() => openServer(entry.veid)}
          />
        ))}
      </div>

      {!entries && loading && <Spinner label="正在拉取全部 VPS 信息…" />}
    </div>
  );
}

function OverviewCard({ entry, onOpen }: { entry: OverviewEntry; onOpen: () => void }) {
  const info = entry.info;
  const dataPercent = info
    ? percent(
        info.data_counter * info.monthly_data_multiplier,
        info.plan_monthly_data * info.monthly_data_multiplier,
      )
    : 0;

  const abnormal = !entry.ok || Boolean(info?.suspended) || Boolean(info?.policy_violation);
  const trafficWarning = dataPercent >= TRAFFIC_WARN_PERCENT;

  const status = info ? (
    info.suspended ? (
      <StatusBadge tone="error">已挂起</StatusBadge>
    ) : info.policy_violation ? (
      <StatusBadge tone="warning">违规待处理</StatusBadge>
    ) : trafficWarning ? (
      <StatusBadge tone="warning">流量告警</StatusBadge>
    ) : (
      <StatusBadge tone="success">正常</StatusBadge>
    )
  ) : null;

  // 异常 => 红框常亮；流量告警 => 琥珀色常亮；正常 => 仅在 hover 时高亮。
  const ringClass = abnormal
    ? "ring-2 ring-red-500"
    : trafficWarning
      ? "ring-2 ring-amber-400"
      : "hover:ring-2 hover:ring-blue-500/40";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`进入 ${entry.alias}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`cursor-pointer rounded-xl transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${ringClass}`}
    >
      <Card
        title={entry.alias}
        description={`VEID ${entry.veid}`}
        actions={status}
      >
        {!entry.ok && <Alert tone="error">{entry.error}</Alert>}
        {info && trafficWarning && (
          <div className="mb-3">
            <Alert tone="warning">
              本月流量已用 {dataPercent}%，接近上限（{formatRelativeToNow(info.data_next_reset)}重置）。
            </Alert>
          </div>
        )}
        {info && (
          <Grid cols={2}>
            <KeyValue label="位置" value={info.node_location} />
            <KeyValue label="套餐" value={info.plan} />
            <KeyValue label="系统" value={info.os} />
            <KeyValue label="内存" value={formatBytes(info.plan_ram)} />
            <KeyValue label="磁盘" value={formatBytes(info.plan_disk)} />
            <KeyValue
              label="流量"
              value={`${dataPercent}%（${formatRelativeToNow(info.data_next_reset)}重置）`}
            />
          </Grid>
        )}
      </Card>
    </div>
  );
}
