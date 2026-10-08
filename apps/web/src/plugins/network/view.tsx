"use client";

import { useCallback, useEffect, useState } from "react";
import {
  defineView,
  type Ipv6AddResult,
  type PluginView,
  type PluginViewProps,
  type PrivateIpAssignResult,
  type PrivateIpListResult,
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
  StatusBadge,
  TextInput,
  usePluginAction,
} from "@/sdk/ui";

function NetworkView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const { run: fetchInfo, data: info, error, running } = usePluginAction<ServiceInfo>(
    "network",
    "serviceInfo",
  );
  const setHostname = usePluginAction("network", "setHostname");
  const setPtr = usePluginAction("network", "setPtr");
  const ipv6Add = usePluginAction<Ipv6AddResult>("network", "ipv6Add");
  const ipv6Delete = usePluginAction("network", "ipv6Delete");
  const privateIpAvailable = usePluginAction<PrivateIpListResult>("network", "privateIpAvailable");
  const privateIpAssign = usePluginAction<PrivateIpAssignResult>("network", "privateIpAssign");
  const privateIpDelete = usePluginAction("network", "privateIpDelete");

  const [hostname, setHostnameInput] = useState("");
  const [ptrIp, setPtrIp] = useState("");
  const [ptrValue, setPtrValue] = useState("");
  const [ipv6ToDelete, setIpv6ToDelete] = useState("");
  const [privateIpInput, setPrivateIpInput] = useState("");
  const [assignedSubnet, setAssignedSubnet] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetchInfo(currentVeid);
  }, [fetchInfo, currentVeid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 服务信息返回后，预填主机名与 PTR 的默认 IP。
  useEffect(() => {
    if (!info) return;
    setHostnameInput((cur) => (cur === "" ? info.hostname : cur));
    setPtrIp((cur) => (cur === "" ? info.ip_addresses[0] ?? "" : cur));
  }, [info]);

  const ipAddresses = info?.ip_addresses ?? [];
  const privateIpAddresses = info?.private_ip_addresses ?? [];
  const availableIps = privateIpAvailable.data?.available_ips ?? [];

  const handleSetHostname = async () => {
    await setHostname.run(currentVeid, { newHostname: hostname.trim() });
    refresh();
  };

  const handleSetPtr = async () => {
    await setPtr.run(currentVeid, { ip: ptrIp, ptr: ptrValue.trim() });
    refresh();
  };

  const handleIpv6Add = async () => {
    const res = await ipv6Add.run(currentVeid);
    if (res) setAssignedSubnet(res.assigned_subnet);
    refresh();
  };

  const handlePrivateIpAssign = async (ip?: string) => {
    await privateIpAssign.run(currentVeid, ip ? { ip } : {});
    void privateIpAvailable.run(currentVeid);
    refresh();
  };

  return (
    <PluginPage
      title="网络"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
      toolbar={
        <Button variant="ghost" onClick={refresh} disabled={running}>
          {running ? <Spinner label="刷新中" /> : "刷新"}
        </Button>
      }
    >
      {error && <Alert tone="error">获取服务信息失败：{error.message}（错误码 {error.code}）</Alert>}
      {running && !info && <Spinner label="正在获取服务信息…" />}

      <Card title="主机名">
        {setHostname.error && (
          <div className="mb-3">
            <Alert tone="error">
              设置主机名失败：{setHostname.error.message}（错误码 {setHostname.error.code}）
            </Alert>
          </div>
        )}
        <Grid cols={2}>
          <KeyValue label="当前主机名" value={info?.hostname ?? "-"} />
          <Field label="新主机名">
            <TextInput
              value={hostname}
              onChange={(e) => setHostnameInput(e.target.value)}
              placeholder="例如：my-vps.example.com"
            />
          </Field>
        </Grid>
        <div className="mt-3">
          <Button
            variant="primary"
            disabled={setHostname.running || !hostname.trim()}
            onClick={() => void handleSetHostname()}
          >
            {setHostname.running ? <Spinner label="保存中" /> : "保存主机名"}
          </Button>
        </div>
      </Card>

      <Card title="PTR 记录" description="为公网 IP 设置反向解析（rDNS）">
        {setPtr.error && (
          <div className="mb-3">
            <Alert tone="error">
              设置 PTR 失败：{setPtr.error.message}（错误码 {setPtr.error.code}）
            </Alert>
          </div>
        )}
        <Grid cols={2}>
          <Field label="IP 地址">
            <Select value={ptrIp} onChange={(e) => setPtrIp(e.target.value)}>
              {ipAddresses.map((ip) => (
                <option key={ip} value={ip}>
                  {ip}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="PTR 目标">
            <TextInput
              value={ptrValue}
              onChange={(e) => setPtrValue(e.target.value)}
              placeholder="例如：host.example.com"
            />
          </Field>
        </Grid>
        <div className="mt-3">
          <Button
            variant="primary"
            disabled={setPtr.running || !ptrIp || !ptrValue.trim()}
            onClick={() => void handleSetPtr()}
          >
            {setPtr.running ? <Spinner label="提交中" /> : "设置 PTR"}
          </Button>
        </div>
        {info && Object.keys(info.ptr).length > 0 && (
          <div className="mt-4">
            <Grid cols={2}>
              {Object.entries(info.ptr).map(([ip, target]) => (
                <KeyValue key={ip} label={ip} value={target || "-"} />
              ))}
            </Grid>
          </div>
        )}
      </Card>

      <Card
        title="IPv6"
        actions={
          <StatusBadge tone={info?.location_ipv6_ready ? "success" : "warning"}>
            {info?.location_ipv6_ready ? "节点支持 IPv6" : "节点暂不支持 IPv6"}
          </StatusBadge>
        }
      >
        {(ipv6Add.error ?? ipv6Delete.error) && (
          <div className="mb-3">
            <Alert tone="error">
              IPv6 操作失败：{(ipv6Add.error ?? ipv6Delete.error)?.message}（错误码{" "}
              {(ipv6Add.error ?? ipv6Delete.error)?.code}）
            </Alert>
          </div>
        )}
        <Grid cols={2}>
          <KeyValue label="可申请 IPv6 数量上限" value={info?.plan_max_ipv6s ?? "-"} />
        </Grid>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Button variant="primary" disabled={ipv6Add.running} onClick={() => void handleIpv6Add()}>
            {ipv6Add.running ? <Spinner label="申请中" /> : "申请 IPv6 子网"}
          </Button>
        </div>
        {assignedSubnet && (
          <div className="mt-3">
            <Alert tone="success">
              已分配子网：<code className="font-mono">{assignedSubnet}</code>
            </Alert>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Field label="要删除的 IPv6 子网">
              <TextInput
                value={ipv6ToDelete}
                onChange={(e) => setIpv6ToDelete(e.target.value)}
                placeholder="例如：2001:db8::/64"
              />
            </Field>
          </div>
          <ConfirmButton
            label="删除子网"
            confirmLabel="确认删除？"
            disabled={ipv6Delete.running || !ipv6ToDelete.trim()}
            onConfirm={() => {
              void ipv6Delete.run(currentVeid, { ip: ipv6ToDelete.trim() });
              setIpv6ToDelete("");
              refresh();
            }}
          />
        </div>
      </Card>

      <Card
        title="私有 IP"
        actions={
          info && (
            <StatusBadge
              tone={
                info.plan_private_network_available && info.location_private_network_available
                  ? "success"
                  : "warning"
              }
            >
              {info.plan_private_network_available && info.location_private_network_available
                ? "可用"
                : "不可用"}
            </StatusBadge>
          )
        }
      >
        {(privateIpAvailable.error ?? privateIpAssign.error ?? privateIpDelete.error) && (
          <div className="mb-3">
            <Alert tone="error">
              私有 IP 操作失败：
              {(privateIpAvailable.error ?? privateIpAssign.error ?? privateIpDelete.error)?.message}
              （错误码{" "}
              {(privateIpAvailable.error ?? privateIpAssign.error ?? privateIpDelete.error)?.code}）
            </Alert>
          </div>
        )}
        <Grid cols={2}>
          <KeyValue
            label="当前私有 IP"
            value={privateIpAddresses.length > 0 ? privateIpAddresses.join("、") : "无"}
          />
          <KeyValue
            label="可用私有 IP"
            value={availableIps.length > 0 ? availableIps.join("、") : "未获取"}
          />
        </Grid>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={privateIpAvailable.running}
            onClick={() => void privateIpAvailable.run(currentVeid)}
          >
            {privateIpAvailable.running ? <Spinner label="获取中" /> : "获取可用私有 IP"}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Field label="指定要分配的私有 IP（留空则自动分配）">
              <TextInput
                value={privateIpInput}
                onChange={(e) => setPrivateIpInput(e.target.value)}
                placeholder="例如：10.0.0.2"
              />
            </Field>
          </div>
          <Button
            variant="primary"
            disabled={privateIpAssign.running}
            onClick={() => {
              const ip = privateIpInput.trim();
              void handlePrivateIpAssign(ip || undefined);
              setPrivateIpInput("");
            }}
          >
            {privateIpAssign.running ? <Spinner label="分配中" /> : "分配私有 IP"}
          </Button>
        </div>
        {privateIpAssign.data && (
          <div className="mt-3">
            <Alert tone="success">
              已分配：
              {privateIpAssign.data.assigned_ips.length > 0
                ? privateIpAssign.data.assigned_ips.join("、")
                : "-"}
            </Alert>
          </div>
        )}
        {privateIpAddresses.length > 0 && (
          <div className="mt-4 space-y-2">
            {privateIpAddresses.map((ip) => (
              <div
                key={ip}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2 dark:border-neutral-800"
              >
                <span className="font-mono text-sm">{ip}</span>
                <ConfirmButton
                  label="删除"
                  confirmLabel="确认删除？"
                  disabled={privateIpDelete.running}
                  onConfirm={() => {
                    void privateIpDelete.run(currentVeid, { ip });
                    refresh();
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="网络信息">
        {info ? (
          <Grid cols={3}>
            <KeyValue label="主机名" value={info.hostname} />
            <KeyValue label="公网 IP" value={ipAddresses.join("、") || "-"} />
            <KeyValue label="私有 IP" value={privateIpAddresses.join("、") || "-"} />
            <KeyValue label="IPv6 就绪" value={info.location_ipv6_ready ? "是" : "否"} />
            <KeyValue label="反解 API" value={info.rdns_api_available ? "可用" : "不可用"} />
            <KeyValue label="私有网络" value={info.plan_private_network_available ? "支持" : "不支持"} />
          </Grid>
        ) : (
          <span className="text-sm text-neutral-500">暂无数据</span>
        )}
      </Card>

      {info && (
        <Card title="原始数据">
          <JsonView value={info} collapsed />
        </Card>
      )}
    </PluginPage>
  );
}

export const networkViews: PluginView[] = [
  defineView({ id: "main", title: "网络", path: "", Component: NetworkView }),
];
