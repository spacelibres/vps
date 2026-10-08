import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { snapshotViews } from "./view";

/** 只读：列出当前 VPS 的全部快照。 */
export const listAction = defineAction({
  id: "list",
  input: z.object({}),
  label: "获取快照列表",
  method: "GET",
  run: (ctx) => ctx.client.snapshotList(),
});

/** 创建快照，描述可选。 */
export const createAction = defineAction({
  id: "create",
  label: "创建快照",
  method: "POST",
  input: z.object({ description: z.string().optional() }),
  run: (ctx, input) => ctx.client.snapshotCreate(input.description),
});

export const deleteAction = defineAction({
  id: "delete",
  label: "删除快照",
  method: "POST",
  danger: true,
  input: z.object({ snapshot: z.string().min(1) }),
  run: (ctx, input) => ctx.client.snapshotDelete(input.snapshot),
});

/** 恢复快照会覆盖当前 VPS 的全部数据。 */
export const restoreAction = defineAction({
  id: "restore",
  label: "恢复快照",
  description: "用该快照覆盖当前 VPS 的全部数据",
  method: "POST",
  danger: true,
  input: z.object({ snapshot: z.string().min(1) }),
  run: (ctx, input) => ctx.client.snapshotRestore(input.snapshot),
});

/** 切换快照的常驻状态（常驻不会被自动清除）。 */
export const toggleStickyAction = defineAction({
  id: "toggleSticky",
  label: "切换常驻",
  method: "POST",
  input: z.object({
    snapshot: z.string().min(1),
    sticky: z.union([z.literal(0), z.literal(1)]),
  }),
  run: (ctx, input) => ctx.client.snapshotToggleSticky(input.snapshot, input.sticky),
});

/** 导出快照，返回可用于在其他 VPS 上导入的令牌。 */
export const exportAction = defineAction({
  id: "export",
  label: "导出快照",
  method: "POST",
  input: z.object({ snapshot: z.string().min(1) }),
  run: (ctx, input) => ctx.client.snapshotExport(input.snapshot),
});

/** 从另一台 VPS 导入快照。 */
export const importAction = defineAction({
  id: "import",
  label: "导入快照",
  description: "用另一台 VPS 导出的令牌导入快照",
  method: "POST",
  danger: true,
  input: z.object({ sourceVeid: z.string().min(1), sourceToken: z.string().min(1) }),
  run: (ctx, input) => ctx.client.snapshotImport(input.sourceVeid, input.sourceToken),
});

/**
 * 快照插件：创建 / 删除 / 恢复 / 常驻 / 导出 / 导入。
 */
export class SnapshotPlugin extends BasePlugin {
  readonly id = "snapshot";
  readonly name = "快照";
  override readonly description = "创建、恢复、导出和导入 VPS 快照";
  override readonly icon = "📸";
  override readonly order = 50;
  readonly actions: readonly PluginAction[] = [
    listAction,
    createAction,
    deleteAction,
    restoreAction,
    toggleStickyAction,
    exportAction,
    importAction,
  ];
  readonly views = snapshotViews;
}

export default SnapshotPlugin;
