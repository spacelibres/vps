import type { VpsPlugin } from "@/sdk";
import { ipPoolViews } from "./view";

/**
 * 面向**客户端**的插件描述符：只含元数据与视图，**不含服务端动作**，
 * 因此可以被 UI 安全地静态引入（不会把 `node:fs` 等带进浏览器包）。
 */
export const IP_POOL_META = {
  id: "ip-pool",
  name: "IP 池 · 航线",
  description: "Google 前端 IP 池管理与请求统计（弹道航线可视化）",
  icon: "🛰️",
  order: 200,
} as const;

export const ipPoolDescriptor: VpsPlugin = {
  ...IP_POOL_META,
  actions: [],
  views: ipPoolViews,
};
