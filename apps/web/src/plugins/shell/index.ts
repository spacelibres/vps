import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { shellViews } from "./view";

/** 在基础 Shell 会话中切换当前目录。 */
export const cdAction = defineAction({
  id: "cd",
  label: "切换目录",
  description: "切换基础 Shell 会话的当前目录，返回新的 pwd",
  method: "POST",
  input: z.object({ currentDir: z.string(), newDir: z.string() }),
  run: (ctx, input) => ctx.client.basicShellCd(input.currentDir, input.newDir),
});

/** 执行单条命令；返回的 `error` 是命令退出码，不是调用失败。 */
export const execAction = defineAction({
  id: "exec",
  label: "执行命令",
  description: "执行单条 Shell 命令；返回的 error 字段是命令退出码",
  method: "POST",
  input: z.object({ command: z.string().min(1) }),
  run: (ctx, input) => ctx.client.basicShellExec(input.command),
});

/** 异步执行一段脚本，返回日志文件名。 */
export const scriptAction = defineAction({
  id: "script",
  label: "运行脚本",
  description: "异步执行一段脚本，返回日志文件名",
  method: "POST",
  input: z.object({ script: z.string().min(1) }),
  run: (ctx, input) => ctx.client.shellScriptExec(input.script),
});

/**
 * 命令行插件：基础 Shell 命令与脚本执行。
 */
export class ShellPlugin extends BasePlugin {
  readonly id = "shell";
  readonly name = "命令行";
  override readonly description = "基础 Shell 命令、脚本执行";
  override readonly icon = "⌨️";
  override readonly order = 90;
  readonly actions: readonly PluginAction[] = [cdAction, execAction, scriptAction];
  readonly views = shellViews;
}

export default ShellPlugin;
