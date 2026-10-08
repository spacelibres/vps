import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { lifecycleViews } from "./view";

/** 只读：获取当前 VPS 的服务信息。 */
export const statusAction = defineAction({
  id: "status",
  input: z.object({}),
  label: "获取服务信息",
  method: "GET",
  run: (ctx) => ctx.client.getServiceInfo(),
});

export const startAction = defineAction({
  id: "start",
  input: z.object({}),
  label: "开机",
  method: "POST",
  run: (ctx) => ctx.client.start(),
});

export const stopAction = defineAction({
  id: "stop",
  input: z.object({}),
  label: "关机",
  method: "POST",
  run: (ctx) => ctx.client.stop(),
});

export const restartAction = defineAction({
  id: "restart",
  input: z.object({}),
  label: "重启",
  method: "POST",
  danger: true,
  run: (ctx) => ctx.client.restart(),
});

export const killAction = defineAction({
  id: "kill",
  input: z.object({}),
  label: "强制停止",
  description: "强制停止卡死的 VPS，未保存的数据会丢失",
  method: "POST",
  danger: true,
  run: (ctx) => ctx.client.kill(),
});

/**
 * 生命周期插件：开机 / 关机 / 重启 / 强制停止。
 */
export class LifecyclePlugin extends BasePlugin {
  readonly id = "lifecycle";
  readonly name = "生命周期";
  override readonly description = "开机、关机、重启、强制停止";
  override readonly icon = "⏻";
  override readonly order = 10;
  readonly actions: readonly PluginAction[] = [
    statusAction,
    startAction,
    stopAction,
    restartAction,
    killAction,
  ];
  readonly views = lifecycleViews;
}

export default LifecyclePlugin;
