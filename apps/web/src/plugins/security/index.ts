import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { securityViews } from "./view";

/** 只读：获取当前 VPS 的挂起记录与违规分。 */
export const suspensionsAction = defineAction({
  id: "suspensions",
  input: z.object({}),
  label: "挂起详情",
  description: "获取挂起记录、违规分与证据",
  method: "GET",
  run: (ctx) => ctx.client.getSuspensionDetails(),
});

/** 危险：解封一条软挂起记录（硬挂起需联系客服）。 */
export const unsuspendAction = defineAction({
  id: "unsuspend",
  label: "解封",
  description: "对软挂起记录执行自助解封",
  method: "POST",
  danger: true,
  input: z.object({ recordId: z.number().int() }),
  run: (ctx, input) => ctx.client.unsuspend(input.recordId),
});

/** 只读：获取当前 VPS 的违规（待处理）记录。 */
export const violationsAction = defineAction({
  id: "violations",
  input: z.object({}),
  label: "违规记录",
  description: "获取违规记录及若不处理将被暂停的时间",
  method: "GET",
  run: (ctx) => ctx.client.getPolicyViolations(),
});

/** 将一条违规记录标记为已处理。 */
export const resolveAction = defineAction({
  id: "resolve",
  label: "处理违规",
  description: "把某条违规记录标记为已处理",
  method: "POST",
  input: z.object({ recordId: z.number().int() }),
  run: (ctx, input) => ctx.client.resolvePolicyViolation(input.recordId),
});

/**
 * 挂起与违规插件：查看挂起/违规记录，自助解封与处理。
 */
export class SecurityPlugin extends BasePlugin {
  readonly id = "security";
  readonly name = "挂起与违规";
  override readonly description = "挂起记录、违规分与解封 / 处理";
  override readonly icon = "⚠️";
  override readonly order = 70;
  readonly actions: readonly PluginAction[] = [
    suspensionsAction,
    unsuspendAction,
    violationsAction,
    resolveAction,
  ];
  readonly views = securityViews;
}

export default SecurityPlugin;
