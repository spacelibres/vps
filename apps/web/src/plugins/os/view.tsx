"use client";

import { useCallback, useEffect, useState } from "react";
import {
  defineView,
  type AvailableOs,
  type PluginView,
  type PluginViewProps,
  type ReinstallOsResult,
  type ServiceInfo,
} from "@/sdk";
import {
  Alert,
  Button,
  Card,
  ConfirmButton,
  Field,
  Grid,
  JsonView,
  KeyValue,
  PluginPage,
  Select,
  Spinner,
  usePluginAction,
} from "@/sdk/ui";

function OsView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const available = usePluginAction<AvailableOs>("os", "available");
  const serviceInfo = usePluginAction<ServiceInfo>("os", "serviceInfo");
  const reinstall = usePluginAction<ReinstallOsResult>("os", "reinstall");
  const mountIso = usePluginAction("os", "mountIso");
  const unmountIso = usePluginAction("os", "unmountIso");

  const [os, setOs] = useState("");
  const [iso, setIso] = useState("");

  const runAvailable = available.run;
  const runServiceInfo = serviceInfo.run;

  const refresh = useCallback(() => {
    void runAvailable(currentVeid);
    void runServiceInfo(currentVeid);
  }, [runAvailable, runServiceInfo, currentVeid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (os) return;
    const first = available.data?.templates[0];
    if (first) setOs(first);
  }, [available.data, os]);

  useEffect(() => {
    if (iso) return;
    const first = serviceInfo.data?.available_isos[0];
    if (first) setIso(first);
  }, [serviceInfo.data, iso]);

  const templates = available.data?.templates ?? [];
  const isos = serviceInfo.data?.available_isos ?? [];

  const doReinstall = async () => {
    await reinstall.run(currentVeid, { os });
    refresh();
  };

  const doMount = async () => {
    await mountIso.run(currentVeid, { iso });
    refresh();
  };

  const doUnmount = async () => {
    await unmountIso.run(currentVeid);
    refresh();
  };

  const loadingList = available.running || serviceInfo.running;

  return (
    <PluginPage
      title="系统与 ISO"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
      toolbar={
        <Button variant="ghost" onClick={refresh} disabled={loadingList}>
          {loadingList ? <Spinner label="刷新中" /> : "刷新"}
        </Button>
      }
    >
      <Card title="当前系统">
        {available.error && (
          <div className="mb-3">
            <Alert tone="error">
              获取系统列表失败：{available.error.message}（错误码 {available.error.code}）
            </Alert>
          </div>
        )}
        {serviceInfo.error && (
          <div className="mb-3">
            <Alert tone="error">
              获取服务信息失败：{serviceInfo.error.message}（错误码 {serviceInfo.error.code}）
            </Alert>
          </div>
        )}
        <Grid cols={2}>
          <KeyValue label="已安装系统" value={available.data?.installed ?? "-"} />
          <KeyValue label="已挂载 ISO 1" value={serviceInfo.data?.iso1 ?? "-"} />
          <KeyValue label="已挂载 ISO 2" value={serviceInfo.data?.iso2 ?? "-"} />
          <KeyValue label="可用 ISO" value={isos.length > 0 ? isos.join("、") : "-"} />
        </Grid>
      </Card>

      <Card title="重装操作系统" description="重装会清空系统盘数据，请务必先做好备份">
        <div className="space-y-3">
          <Field label="选择系统模板">
            <Select value={os} onChange={(e) => setOs(e.target.value)}>
              {templates.length === 0 && <option value="">（暂无可用模板）</option>}
              {templates.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <ConfirmButton
            label="重装系统"
            confirmLabel={os ? `确认重装为 ${os}？` : "请先选择系统模板"}
            variant="danger"
            disabled={!os || reinstall.running}
            onConfirm={doReinstall}
          />
          {reinstall.error && (
            <Alert tone="error">
              重装失败：{reinstall.error.message}（错误码 {reinstall.error.code}）
            </Alert>
          )}
        </div>
      </Card>

      {reinstall.data && (
        <Card title="重装已提交">
          <Alert tone="warning">请立即保存新的 root 密码，页面刷新后将无法再次查看。</Alert>
          <div className="mt-3">
            <Grid cols={2}>
              <KeyValue
                label="新 root 密码"
                value={
                  <span className="font-mono text-base font-semibold text-red-600 dark:text-red-400">
                    {reinstall.data.rootPassword}
                  </span>
                }
              />
              <KeyValue label="SSH 端口" value={reinstall.data.sshPort} />
              <KeyValue label="SSH 公钥（摘要）" value={reinstall.data.sshKeysBrief} />
              <KeyValue label="通知邮箱" value={reinstall.data.notificationEmail} />
            </Grid>
          </div>
          <div className="mt-4">
            <JsonView value={reinstall.data} collapsed />
          </div>
        </Card>
      )}

      <Card title="ISO 镜像" description="挂载或卸载后需完全关机并重启才会生效">
        <div className="space-y-3">
          <Field label="选择 ISO">
            <Select value={iso} onChange={(e) => setIso(e.target.value)}>
              {isos.length === 0 && <option value="">（暂无可用 ISO）</option>}
              {isos.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={!iso || mountIso.running} onClick={doMount}>
              {mountIso.running ? <Spinner label="挂载中" /> : "挂载 ISO"}
            </Button>
            <ConfirmButton
              label="卸载 ISO"
              confirmLabel="确认卸载当前 ISO？"
              disabled={unmountIso.running}
              onConfirm={doUnmount}
            />
          </div>
          <Alert tone="info">提示：挂载 / 卸载 ISO 后需要完全关机并重启，改动才会生效。</Alert>
          {mountIso.error && (
            <Alert tone="error">
              挂载失败：{mountIso.error.message}（错误码 {mountIso.error.code}）
            </Alert>
          )}
          {unmountIso.error && (
            <Alert tone="error">
              卸载失败：{unmountIso.error.message}（错误码 {unmountIso.error.code}）
            </Alert>
          )}
        </div>
      </Card>

      {serviceInfo.data && (
        <Card title="服务信息原始数据">
          <JsonView value={serviceInfo.data} collapsed />
        </Card>
      )}
    </PluginPage>
  );
}

export const osViews: PluginView[] = [
  defineView({ id: "main", title: "系统与 ISO", path: "", Component: OsView }),
];
