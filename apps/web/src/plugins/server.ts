import { PluginRegistry } from "@/sdk";
import { plugins } from "./index";
import { ipPoolActions } from "./ip-pool";

/**
 * 服务端插件注册表（**只在 API 路由中使用**）。
 *
 * 与 `./index.ts` 的区别：这里会为需要服务端依赖的插件补齐 `actions`。
 */
export const registry = new PluginRegistry().registerAll(
  plugins.map((plugin) =>
    plugin.id === "ip-pool" ? { ...plugin, actions: ipPoolActions } : plugin,
  ),
);
