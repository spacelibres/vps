"use client";

import { useCallback, useEffect } from "react";
import {
  defineView,
  formatBytes,
  formatDataWithMultiplier,
  formatRelativeToNow,
  formatUnixTime,
  percent,
  type PluginView,
  type PluginViewProps,
  type ServiceInfo,
} from "@/sdk";
import {
  Alert,
  Button,
  Card,
  ConfirmButton,
  Grid,
  JsonView,
  KeyValue,
  PluginPage,
  Spinner,
  StatusBadge,
  usePluginAction,
} from "@/sdk/ui";

function UsageBar({ percentValue }: { percentValue: number }) {
  const tone =
    percentValue >= 90 ? "bg-red-500" : percentValue >= 70 ? "bg-amber-500" : "bg-blue-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
      <div className={`h-full ${tone}`} style={{ width: `${percentValue}%` }} />
    </div>
  );
}

function LifecycleView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const { run: fetchInfo, data: info, error, running } = usePluginAction<ServiceInfo>(
    "lifecycle",
    "status",
  );
  const start = usePluginAction("lifecycle", "start");
  const stop = usePluginAction("lifecycle", "stop");
  const restart = usePluginAction("lifecycle", "restart");
  const kill = usePluginAction("lifecycle", "kill");

  const refresh = useCallback(() => {
    void fetchInfo(currentVeid);
  }, [fetchInfo, currentVeid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const busy = start.running || stop.running || restart.running || kill.running;
  const actionError = start.error ?? stop.error ?? restart.error ?? kill.error;

  const runThenRefresh = async (run: (veid: string) => Promise<unknown>) => {
    await run(currentVeid);
    refresh();
  };

  const dataUsed = info ? info.data_counter * info.monthly_data_multiplier : 0;
  const dataTotal = info ? info.plan_monthly_data * info.monthly_data_multiplier : 0;
  const dataPercent = percent(dataUsed, dataTotal);

  return (
    <PluginPage
      title="生命周期"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
      toolbar={
        <Button variant="ghost" onClick={refresh} disabled={running}>
          {running ? <Spinner label="刷新中" /> : "刷新"}
        </Button>
      }
    >
      <Card title="电源操作">
        {actionError && (
          <div className="mb-3">
            <Alert tone="error">操作失败：{actionError.message}（错误码 {actionError.code}）</Alert>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={busy} onClick={() => runThenRefresh(start.run)}>
            开机
          </Button>
          <Button disabled={busy} onClick={() => runThenRefresh(stop.run)}>
            关机
          </Button>
          <ConfirmButton
            label="重启"
            confirmLabel="确认重启？"
            variant="primary"
            disabled={busy}
            onConfirm={() => runThenRefresh(restart.run)}
          />
          <ConfirmButton
            label="强制停止"
            confirmLabel="确认强制停止？未保存数据会丢失"
            disabled={busy}
            onConfirm={() => runThenRefresh(kill.run)}
          />
        </div>
      </Card>

      {error && <Alert tone="error">获取信息失败：{error.message}（错误码 {error.code}）</Alert>}

      {info && (
        <>
          <Card
            title="服务信息"
            actions={
              <div className="flex gap-2">
                {info.suspended && <StatusBadge tone="error">已挂起</StatusBadge>}
                {info.policy_violation && <StatusBadge tone="warning">有违规待处理</StatusBadge>}
                {!info.suspended && !info.policy_violation && (
                  <StatusBadge tone="success">正常</StatusBadge>
                )}
              </div>
            }
          >
            <Grid cols={3}>
              <KeyValue label="主机名" value={info.hostname} />
              <KeyValue label="节点" value={`${info.node_alias}（${info.node_location}）`} />
              <KeyValue label="虚拟化" value={info.vm_type.toUpperCase()} />
              <KeyValue label="套餐" value={info.plan} />
              <KeyValue label="操作系统" value={info.os} />
              <KeyValue label="账号邮箱" value={info.email} />
              <KeyValue label="内存" value={formatBytes(info.plan_ram)} />
              <KeyValue label="SWAP" value={formatBytes(info.plan_swap)} />
              <KeyValue label="磁盘" value={formatBytes(info.plan_disk)} />
              <KeyValue label="主 IP" value={info.ip_addresses.join("、") || "-"} />
              <KeyValue label="IPv6 就绪" value={info.location_ipv6_ready ? "是" : "否"} />
              <KeyValue label="本月流量重置" value={formatUnixTime(info.data_next_reset)} />
            </Grid>
          </Card>

          <Card title="本月流量">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between text-sm">
                <span>
                  已用 {formatDataWithMultiplier(info.data_counter, info.monthly_data_multiplier)} /{" "}
                  {formatDataWithMultiplier(info.plan_monthly_data, info.monthly_data_multiplier)}
                </span>
                <span className="text-neutral-500">
                  {dataPercent}% · {formatRelativeToNow(info.data_next_reset)}重置
                </span>
              </div>
              <UsageBar percentValue={dataPercent} />
            </div>
          </Card>

          <Card title="原始数据">
            <JsonView value={info} collapsed />
          </Card>
        </>
      )}

      {running && !info && <Spinner label="正在获取服务信息…" />}
    </PluginPage>
  );
}

export const lifecycleViews: PluginView[] = [
  defineView({ id: "main", title: "生命周期", path: "", Component: LifecycleView }),
];
