"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  defineView,
  formatBytes,
  type LiveServiceInfo,
  type PluginView,
  type PluginViewProps,
  type RateLimitStatus,
} from "@/sdk";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Grid,
  JsonView,
  KeyValue,
  PluginPage,
  Spinner,
  StatusBadge,
  usePluginAction,
} from "@/sdk/ui";

type TabId = "live" | "usage" | "audit" | "ratelimit";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "live", label: "实时状态" },
  { id: "usage", label: "用量统计" },
  { id: "audit", label: "操作审计" },
  { id: "ratelimit", label: "限流状态" },
];

/** 缺失字段统一显示为「-」。 */
function dash(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function throttleLabel(value: number | undefined): ReactNode {
  if (value === undefined || value === null) return "-";
  return value ? (
    <StatusBadge tone="warning">是</StatusBadge>
  ) : (
    <StatusBadge tone="success">否</StatusBadge>
  );
}

function veStatusTone(status: string | undefined): "success" | "warning" | "error" | "neutral" {
  switch (status) {
    case "Running":
      return "success";
    case "Starting":
      return "warning";
    case "Stopped":
      return "error";
    default:
      return "neutral";
  }
}

function LivePanel({ info }: { info: LiveServiceInfo }) {
  const isKvm = info.vm_type === "kvm";
  return (
    <>
      <Card
        title="实时状态"
        actions={
          isKvm ? (
            <StatusBadge tone={veStatusTone(info.ve_status)}>{dash(info.ve_status)}</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">OpenVZ</StatusBadge>
          )
        }
      >
        <Grid cols={3}>
          {isKvm ? (
            <>
              <KeyValue label="运行状态" value={dash(info.ve_status)} />
              <KeyValue label="CPU 限流" value={throttleLabel(info.is_cpu_throttled)} />
              <KeyValue label="磁盘限流" value={throttleLabel(info.is_disk_throttled)} />
              <KeyValue label="负载（load average）" value={dash(info.load_average)} />
              <KeyValue
                label="可用内存"
                value={
                  info.mem_available_kb === undefined
                    ? "-"
                    : formatBytes(info.mem_available_kb * 1024)
                }
              />
              <KeyValue label="SSH 端口" value={dash(info.ssh_port)} />
              <KeyValue
                label="SWAP 总量"
                value={
                  info.swap_total_kb === undefined ? "-" : formatBytes(info.swap_total_kb * 1024)
                }
              />
              <KeyValue
                label="SWAP 可用"
                value={
                  info.swap_available_kb === undefined
                    ? "-"
                    : formatBytes(info.swap_available_kb * 1024)
                }
              />
            </>
          ) : (
            <>
              <KeyValue label="虚拟化" value="OpenVZ" />
              <KeyValue label="CPU 限流" value={throttleLabel(info.is_cpu_throttled)} />
              <KeyValue label="SSH 端口" value={dash(info.ssh_port)} />
            </>
          )}
        </Grid>

        {!isKvm && info.vz_status && (
          <div className="mt-4">
            <div className="mb-1 text-xs text-neutral-500">vz_status</div>
            <JsonView value={info.vz_status} collapsed />
          </div>
        )}
      </Card>

      {info.screendump_png_base64 && (
        <Card title="屏幕截图">
          <img
            src={"data:image/png;base64," + info.screendump_png_base64}
            alt="VPS 屏幕截图"
            className="max-w-full rounded-md border border-neutral-200 dark:border-neutral-800"
          />
        </Card>
      )}

      <Card title="原始数据">
        <JsonView value={info} collapsed />
      </Card>
    </>
  );
}

function InfoView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const [tab, setTab] = useState<TabId>("live");

  const live = usePluginAction<LiveServiceInfo>("info", "live");
  const usage = usePluginAction("info", "usage");
  const audit = usePluginAction("info", "audit");
  const ratelimit = usePluginAction<RateLimitStatus>("info", "ratelimit");

  const runLive = live.run;
  const runUsage = usage.run;
  const runAudit = audit.run;
  const runRatelimit = ratelimit.run;

  const runFor = useCallback(
    (id: TabId, veid: string) => {
      switch (id) {
        case "live":
          void runLive(veid);
          break;
        case "usage":
          void runUsage(veid);
          break;
        case "audit":
          void runAudit(veid);
          break;
        case "ratelimit":
          void runRatelimit(veid);
          break;
      }
    },
    [runLive, runUsage, runAudit, runRatelimit],
  );

  useEffect(() => {
    runFor(tab, currentVeid);
  }, [runFor, tab, currentVeid]);

  const running =
    (tab === "live" && live.running) ||
    (tab === "usage" && usage.running) ||
    (tab === "audit" && audit.running) ||
    (tab === "ratelimit" && ratelimit.running);

  return (
    <PluginPage
      title="监控与日志"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
      toolbar={
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <Button
              key={t.id}
              variant={tab === t.id ? "primary" : "default"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => runFor(tab, currentVeid)} disabled={running}>
            {running ? <Spinner label="刷新中" /> : "刷新"}
          </Button>
        </div>
      }
    >
      {tab === "live" && (
        <>
          {live.error && (
            <Alert tone="error">
              获取实时状态失败：{live.error.message}（错误码 {live.error.code}）
            </Alert>
          )}
          {live.data ? (
            <LivePanel info={live.data} />
          ) : (
            !live.running && <EmptyState>尚未加载实时状态，点击「刷新」开始获取。</EmptyState>
          )}
          {live.running && !live.data && <Spinner label="正在获取实时状态（最长约 15 秒）…" />}
        </>
      )}

      {tab === "usage" && (
        <>
          {usage.error && (
            <Alert tone="error">
              获取用量统计失败：{usage.error.message}（错误码 {usage.error.code}）
            </Alert>
          )}
          {usage.data !== undefined ? (
            <Card title="用量统计">
              <JsonView value={usage.data} />
            </Card>
          ) : (
            !usage.running && <EmptyState>尚未加载用量统计。</EmptyState>
          )}
          {usage.running && usage.data === undefined && <Spinner label="正在获取用量统计…" />}
        </>
      )}

      {tab === "audit" && (
        <>
          {audit.error && (
            <Alert tone="error">
              获取审计日志失败：{audit.error.message}（错误码 {audit.error.code}）
            </Alert>
          )}
          {audit.data !== undefined ? (
            <Card title="操作审计">
              <JsonView value={audit.data} />
            </Card>
          ) : (
            !audit.running && <EmptyState>尚未加载审计日志。</EmptyState>
          )}
          {audit.running && audit.data === undefined && <Spinner label="正在获取审计日志…" />}
        </>
      )}

      {tab === "ratelimit" && (
        <>
          {ratelimit.error && (
            <Alert tone="error">
              获取限流状态失败：{ratelimit.error.message}（错误码 {ratelimit.error.code}）
            </Alert>
          )}
          {ratelimit.data ? (
            <Card title="API 限流状态">
              <Grid cols={2}>
                <KeyValue
                  label="15 分钟内剩余点数"
                  value={ratelimit.data.remaining_points_15min}
                />
                <KeyValue label="24 小时内剩余点数" value={ratelimit.data.remaining_points_24h} />
              </Grid>
              <div className="mt-4">
                <JsonView value={ratelimit.data} collapsed />
              </div>
            </Card>
          ) : (
            !ratelimit.running && <EmptyState>尚未加载限流状态。</EmptyState>
          )}
          {ratelimit.running && !ratelimit.data && <Spinner label="正在获取限流状态…" />}
        </>
      )}
    </PluginPage>
  );
}

export const infoViews: PluginView[] = [
  defineView({ id: "main", title: "监控与日志", path: "", Component: InfoView }),
];
