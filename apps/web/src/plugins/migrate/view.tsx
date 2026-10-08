"use client";

import { useCallback, useEffect, useState } from "react";
import {
  defineView,
  type MigrateLocationsResult,
  type MigrateStartResult,
  type PluginView,
  type PluginViewProps,
} from "@/sdk";
import {
  Alert,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Field,
  Grid,
  KeyValue,
  PluginPage,
  Spinner,
  StatusBadge,
  TextInput,
  usePluginAction,
} from "@/sdk/ui";

const thClass = "px-3 py-2 text-left text-xs font-medium text-neutral-500";
const tdClass = "px-3 py-2 align-top text-sm";
const rowClass = "border-b border-neutral-100 last:border-0 dark:border-neutral-800";

function MigrateView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const locations = usePluginAction<MigrateLocationsResult>("migrate", "locations");
  const start = usePluginAction<MigrateStartResult>("migrate", "start");
  const clone = usePluginAction("migrate", "clone");

  const [externalServerIP, setExternalServerIP] = useState("");
  const [externalServerSSHport, setExternalServerSSHport] = useState("22");
  const [externalServerRootPassword, setExternalServerRootPassword] = useState("");

  const refresh = useCallback(() => {
    void locations.run(currentVeid);
  }, [locations.run, currentVeid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const port = Number.parseInt(externalServerSSHport, 10);
  const cloneReady =
    externalServerIP.trim() !== "" &&
    Number.isInteger(port) &&
    port > 0 &&
    externalServerRootPassword !== "";

  const handleMigrate = async (location: string) => {
    await start.run(currentVeid, { location });
    refresh();
  };

  const handleClone = async () => {
    if (!cloneReady) return;
    await clone.run(currentVeid, {
      externalServerIP: externalServerIP.trim(),
      externalServerSSHport: port,
      externalServerRootPassword,
    });
  };

  const data = locations.data;
  const currentDescription = data ? data.descriptions[data.currentLocation] : undefined;

  return (
    <PluginPage
      title="迁移与克隆"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
      toolbar={
        <Button variant="ghost" onClick={refresh} disabled={locations.running}>
          {locations.running ? <Spinner label="刷新中" /> : "刷新"}
        </Button>
      }
    >
      {locations.error && (
        <Alert tone="error">
          获取节点列表失败：{locations.error.message}（错误码 {locations.error.code}）
        </Alert>
      )}
      {start.error && (
        <Alert tone="error">迁移失败：{start.error.message}（错误码 {start.error.code}）</Alert>
      )}
      {clone.error && (
        <Alert tone="error">克隆失败：{clone.error.message}（错误码 {clone.error.code}）</Alert>
      )}

      {start.data && (
        <Alert tone="success">
          迁移已提交，通知邮箱 {start.data.notificationEmail}。新 IP：
          {(start.data.newIps ?? []).join("、") || "-"}
        </Alert>
      )}

      {data && (
        <>
          <Card title="当前节点">
            <Grid cols={2}>
              <KeyValue label="节点 ID" value={data.currentLocation} />
              <KeyValue label="说明" value={currentDescription ?? "-"} />
            </Grid>
          </Card>

          <Card title="可迁移节点" description="迁移后 IPv4 地址会全部更换">
            {data.locations.length === 0 ? (
              <EmptyState>没有可迁移的节点。</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thClass}>节点 ID</th>
                      <th className={thClass}>说明</th>
                      <th className={thClass}>流量倍率</th>
                      <th className={thClass}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.locations.map((location) => {
                      const description = data.descriptions[location] ?? `节点 ${location}`;
                      const multiplier = data.dataTransferMultipliers[location] ?? 1;
                      const isCurrent = location === data.currentLocation;
                      return (
                        <tr key={location} className={rowClass}>
                          <td className={tdClass}>{location}</td>
                          <td className={tdClass}>{description}</td>
                          <td className={tdClass}>×{multiplier}</td>
                          <td className={tdClass}>
                            {isCurrent ? (
                              <StatusBadge tone="success">当前节点</StatusBadge>
                            ) : (
                              <ConfirmButton
                                label="迁移到此节点"
                                confirmLabel="确认迁移？IPv4 会全部更换"
                                disabled={start.running}
                                onConfirm={() => void handleMigrate(location)}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {!data && locations.running && <Spinner label="正在获取节点列表…" />}

      <Card title="从外部服务器克隆" description="仅 OpenVZ (OVZ) 支持">
        <div className="mb-4">
          <Alert tone="info">该功能仅适用于 OpenVZ (OVZ) 虚拟化，KVM 机型不支持。</Alert>
        </div>
        <Grid cols={3}>
          <Field label="外部服务器 IP">
            <TextInput
              value={externalServerIP}
              onChange={(e) => setExternalServerIP(e.target.value)}
              placeholder="1.2.3.4"
            />
          </Field>
          <Field label="SSH 端口">
            <TextInput
              type="number"
              value={externalServerSSHport}
              onChange={(e) => setExternalServerSSHport(e.target.value)}
            />
          </Field>
          <Field label="Root 密码">
            <TextInput
              type="password"
              value={externalServerRootPassword}
              onChange={(e) => setExternalServerRootPassword(e.target.value)}
            />
          </Field>
        </Grid>
        <div className="mt-4">
          <ConfirmButton
            label="开始克隆"
            confirmLabel="确认从外部服务器克隆？"
            disabled={!cloneReady || clone.running}
            onConfirm={() => void handleClone()}
          />
        </div>
      </Card>
    </PluginPage>
  );
}

export const migrateViews: PluginView[] = [
  defineView({ id: "main", title: "迁移与克隆", path: "", Component: MigrateView }),
];
