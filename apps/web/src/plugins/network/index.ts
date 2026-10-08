import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { networkViews } from "./view";

/** 只读：获取当前 VPS 的网络信息（主机名、IP、PTR 等）。 */
export const serviceInfoAction = defineAction({
  id: "serviceInfo",
  input: z.object({}),
  label: "获取服务信息",
  method: "GET",
  run: (ctx) => ctx.client.getServiceInfo(),
});

export const setHostnameAction = defineAction({
  id: "setHostname",
  label: "设置主机名",
  method: "POST",
  input: z.object({ newHostname: z.string().min(1) }),
  run: (ctx, input) => ctx.client.setHostname(input.newHostname),
});

export const setPtrAction = defineAction({
  id: "setPtr",
  label: "设置 PTR 记录",
  method: "POST",
  input: z.object({ ip: z.string().min(1), ptr: z.string() }),
  run: (ctx, input) => ctx.client.setPTR(input.ip, input.ptr),
});

/** 申请一个 /64 的 IPv6 子网。 */
export const ipv6AddAction = defineAction({
  id: "ipv6Add",
  input: z.object({}),
  label: "申请 IPv6 子网",
  method: "POST",
  run: (ctx) => ctx.client.ipv6Add(),
});

export const ipv6DeleteAction = defineAction({
  id: "ipv6Delete",
  label: "删除 IPv6 子网",
  method: "POST",
  danger: true,
  input: z.object({ ip: z.string().min(1) }),
  run: (ctx, input) => ctx.client.ipv6Delete(input.ip),
});

/** 只读：列出可分配的私有 IP。 */
export const privateIpAvailableAction = defineAction({
  id: "privateIpAvailable",
  input: z.object({}),
  label: "获取可用私有 IP",
  method: "GET",
  run: (ctx) => ctx.client.privateIpGetAvailableIps(),
});

/** 分配私有 IP，未指定时由系统自动选取。 */
export const privateIpAssignAction = defineAction({
  id: "privateIpAssign",
  label: "分配私有 IP",
  method: "POST",
  input: z.object({ ip: z.string().optional() }),
  run: (ctx, input) => ctx.client.privateIpAssign(input.ip),
});

export const privateIpDeleteAction = defineAction({
  id: "privateIpDelete",
  label: "删除私有 IP",
  method: "POST",
  danger: true,
  input: z.object({ ip: z.string().min(1) }),
  run: (ctx, input) => ctx.client.privateIpDelete(input.ip),
});

/**
 * 网络插件：主机名、PTR 记录、IPv6 子网与私有 IP 管理。
 */
export class NetworkPlugin extends BasePlugin {
  readonly id = "network";
  readonly name = "网络";
  override readonly description = "主机名、PTR、IPv6 与私有 IP 管理";
  override readonly icon = "🌐";
  override readonly order = 60;
  readonly actions: readonly PluginAction[] = [
    serviceInfoAction,
    setHostnameAction,
    setPtrAction,
    ipv6AddAction,
    ipv6DeleteAction,
    privateIpAvailableAction,
    privateIpAssignAction,
    privateIpDeleteAction,
  ];
  readonly views = networkViews;
}

export default NetworkPlugin;
