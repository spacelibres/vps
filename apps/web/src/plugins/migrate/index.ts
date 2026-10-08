import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { migrateViews } from "./view";

/** 只读：获取可迁移的节点、说明与流量倍率。 */
export const locationsAction = defineAction({
  id: "locations",
  input: z.object({}),
  label: "可选节点",
  description: "获取当前节点与可迁移的节点列表",
  method: "GET",
  run: (ctx) => ctx.client.migrateGetLocations(),
});

/** 危险：迁移到指定节点（IPv4 会全部更换）。 */
export const startAction = defineAction({
  id: "start",
  label: "开始迁移",
  description: "迁移到指定节点；迁移后 IPv4 地址会全部更换",
  method: "POST",
  danger: true,
  input: z.object({ location: z.union([z.string().min(1), z.number().int()]) }),
  run: (ctx, input) => ctx.client.migrateStart(input.location),
});

/** 危险：从外部服务器克隆数据（仅 OpenVZ 支持）。 */
export const cloneAction = defineAction({
  id: "clone",
  label: "从外部服务器克隆",
  description: "仅 OpenVZ (OVZ) 支持；把外部服务器的数据克隆到本 VPS",
  method: "POST",
  danger: true,
  input: z.object({
    externalServerIP: z.string(),
    externalServerSSHport: z.number().int(),
    externalServerRootPassword: z.string(),
  }),
  run: (ctx, input) =>
    ctx.client.cloneFromExternalServer(
      input.externalServerIP,
      input.externalServerSSHport,
      input.externalServerRootPassword,
    ),
});

/**
 * 迁移与克隆插件：节点迁移、从外部服务器克隆。
 */
export class MigratePlugin extends BasePlugin {
  readonly id = "migrate";
  readonly name = "迁移与克隆";
  override readonly description = "节点迁移与从外部服务器克隆";
  override readonly icon = "🚚";
  override readonly order = 80;
  readonly actions: readonly PluginAction[] = [locationsAction, startAction, cloneAction];
  readonly views = migrateViews;
}

export default MigratePlugin;
