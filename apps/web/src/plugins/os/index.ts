import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { osViews } from "./view";

/** 只读：获取已安装系统与可用重装模板。 */
export const availableAction = defineAction({
  id: "available",
  input: z.object({}),
  label: "可用系统列表",
  method: "GET",
  run: (ctx) => ctx.client.getAvailableOS(),
});

/** 只读：获取服务信息（用于展示当前已挂载的 ISO 等）。 */
export const serviceInfoAction = defineAction({
  id: "serviceInfo",
  input: z.object({}),
  label: "服务信息",
  method: "GET",
  run: (ctx) => ctx.client.getServiceInfo(),
});

/** 重装操作系统，会清空系统盘数据。 */
export const reinstallAction = defineAction({
  id: "reinstall",
  label: "重装系统",
  description: "重装会清空系统盘数据，请先做好备份",
  method: "POST",
  danger: true,
  input: z.object({ os: z.string().min(1) }),
  run: (ctx, input) => ctx.client.reinstallOS(input.os),
});

/** 挂载 ISO 镜像，需完全关机并重启后生效。 */
export const mountIsoAction = defineAction({
  id: "mountIso",
  label: "挂载 ISO",
  description: "挂载后需完全关机并重启才会生效",
  method: "POST",
  input: z.object({ iso: z.string().min(1) }),
  run: (ctx, input) => ctx.client.mountIso(input.iso),
});

/** 卸载 ISO 镜像，需完全关机并重启后生效。 */
export const unmountIsoAction = defineAction({
  id: "unmountIso",
  input: z.object({}),
  label: "卸载 ISO",
  description: "卸载后需完全关机并重启才会生效",
  method: "POST",
  run: (ctx) => ctx.client.unmountIso(),
});

/**
 * 系统与 ISO 插件：查看可用系统、重装系统、挂载 / 卸载 ISO。
 */
export class OsPlugin extends BasePlugin {
  readonly id = "os";
  readonly name = "系统与 ISO";
  override readonly description = "重装操作系统、挂载与卸载 ISO 镜像";
  override readonly icon = "💿";
  override readonly order = 30;
  readonly actions: readonly PluginAction[] = [
    availableAction,
    serviceInfoAction,
    reinstallAction,
    mountIsoAction,
    unmountIsoAction,
  ];
  readonly views = osViews;
}

export default OsPlugin;
