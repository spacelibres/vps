import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { backupViews } from "./view";

/** 只读：列出当前 VPS 的自动备份。 */
export const listAction = defineAction({
  id: "list",
  input: z.object({}),
  label: "获取备份列表",
  method: "GET",
  run: (ctx) => ctx.client.backupList(),
});

/** 把某个自动备份复制为一个快照，便于长期保留。 */
export const copyToSnapshotAction = defineAction({
  id: "copyToSnapshot",
  label: "备份转为快照",
  method: "POST",
  input: z.object({ backupToken: z.string().min(1) }),
  run: (ctx, input) => ctx.client.backupCopyToSnapshot(input.backupToken),
});

/**
 * 自动备份插件：查看系统自动备份，并转为快照。
 */
export class BackupPlugin extends BasePlugin {
  readonly id = "backup";
  readonly name = "自动备份";
  override readonly description = "查看自动备份并将其转为快照";
  override readonly icon = "🗄️";
  override readonly order = 55;
  readonly actions: readonly PluginAction[] = [listAction, copyToSnapshotAction];
  readonly views = backupViews;
}

export default BackupPlugin;
