import { z } from "zod";
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { infoViews } from "./view";

/** 只读：获取实时服务状态（KVM/OVZ 专有字段随虚拟化类型变化）。 */
export const liveAction = defineAction({
  id: "live",
  input: z.object({}),
  label: "实时状态",
  description: "官方文档说明该调用最长可能需要 15 秒",
  method: "GET",
  run: (ctx) => ctx.client.getLiveServiceInfo(),
});

/** 只读：获取原始用量统计。 */
export const usageAction = defineAction({
  id: "usage",
  input: z.object({}),
  label: "用量统计",
  method: "GET",
  run: (ctx) => ctx.client.getRawUsageStats(),
});

/** 只读：获取操作审计日志。 */
export const auditAction = defineAction({
  id: "audit",
  input: z.object({}),
  label: "操作审计",
  method: "GET",
  run: (ctx) => ctx.client.getAuditLog(),
});

/** 只读：获取 API 限流状态。 */
export const ratelimitAction = defineAction({
  id: "ratelimit",
  input: z.object({}),
  label: "限流状态",
  method: "GET",
  run: (ctx) => ctx.client.getRateLimitStatus(),
});

/**
 * 监控与日志插件：实时状态、用量统计、操作审计、API 限流。
 */
export class InfoPlugin extends BasePlugin {
  readonly id = "info";
  readonly name = "监控与日志";
  override readonly description = "实时状态、用量统计、操作审计与 API 限流";
  override readonly icon = "📊";
  override readonly order = 20;
  readonly actions: readonly PluginAction[] = [
    liveAction,
    usageAction,
    auditAction,
    ratelimitAction,
  ];
  readonly views = infoViews;
}

export default InfoPlugin;
