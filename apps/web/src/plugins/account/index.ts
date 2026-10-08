import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { accountViews } from "./view";

/** 只读：获取当前 VPS 的 SSH 公钥。 */
export const getSshKeysAction = defineAction({
  id: "getSshKeys",
  input: z.object({}),
  label: "获取 SSH 公钥",
  method: "GET",
  run: (ctx) => ctx.client.getSshKeys(),
});

/** 更新 SSH 公钥（每行一个）。 */
export const updateSshKeysAction = defineAction({
  id: "updateSshKeys",
  label: "更新 SSH 公钥",
  method: "POST",
  input: z.object({ sshKeys: z.string() }),
  run: (ctx, input) => ctx.client.updateSshKeys(input.sshKeys),
});

/** 重置 root 密码，旧密码将立即失效。 */
export const resetRootPasswordAction = defineAction({
  id: "resetRootPassword",
  input: z.object({}),
  label: "重置 root 密码",
  description: "生成新的 root 密码，旧密码将立即失效",
  method: "POST",
  danger: true,
  run: (ctx) => ctx.client.resetRootPassword(),
});

/**
 * 账号与 SSH 插件：管理 SSH 公钥与 root 密码。
 */
export class AccountPlugin extends BasePlugin {
  readonly id = "account";
  readonly name = "账号与 SSH";
  override readonly description = "管理 SSH 公钥与 root 密码";
  override readonly icon = "🔑";
  override readonly order = 40;
  readonly actions: readonly PluginAction[] = [
    getSshKeysAction,
    updateSshKeysAction,
    resetRootPasswordAction,
  ];
  readonly views = accountViews;
}

export default AccountPlugin;
