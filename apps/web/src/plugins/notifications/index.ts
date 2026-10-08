import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { notificationsViews } from "./view";

/** 只读：获取账号的通知偏好。 */
export const getAction = defineAction({
  id: "get",
  input: z.object({}),
  label: "获取通知偏好",
  description: "获取邮件通知开关与通知邮箱",
  method: "GET",
  run: (ctx) => ctx.client.getNotificationPreferences(),
});

/** 保存通知偏好（界面只提交发生变更的项）。 */
export const setAction = defineAction({
  id: "set",
  label: "保存通知偏好",
  description: "提交通知开关的变更，返回友好说明",
  method: "POST",
  input: z.object({ preferences: z.record(z.string(), z.number().int()) }),
  run: (ctx, input) => ctx.client.setNotificationPreferences(input.preferences),
});

/**
 * 通知偏好插件：以开/关复选框管理邮件通知。
 */
export class NotificationsPlugin extends BasePlugin {
  readonly id = "notifications";
  readonly name = "通知偏好";
  override readonly description = "管理账号的邮件通知开关";
  override readonly icon = "🔔";
  override readonly order = 95;
  readonly actions: readonly PluginAction[] = [getAction, setAction];
  readonly views = notificationsViews;
}

export default NotificationsPlugin;
