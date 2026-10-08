import type { PluginAction, PluginView, VpsPlugin } from "./types";

/** `pluginId` + `actionId` 的定位结果。 */
export interface ResolvedAction {
  plugin: VpsPlugin;
  action: PluginAction;
}

export interface ResolvedView {
  plugin: VpsPlugin;
  view: PluginView;
}

/**
 * 插件注册表。
 *
 * 宿主在启动时把插件类实例注册进来，之后由 UI 与 API 路由按 id 查找。
 * 将来要支持「目录自动扫描 / 运行时加载」，只需替换本类的实例化来源。
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, VpsPlugin>();

  register(plugin: VpsPlugin): this {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`插件 id 重复：${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
    return this;
  }

  registerAll(plugins: readonly VpsPlugin[]): this {
    for (const plugin of plugins) this.register(plugin);
    return this;
  }

  get(pluginId: string): VpsPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  list(): VpsPlugin[] {
    return [...this.plugins.values()];
  }

  resolveAction(pluginId: string, actionId: string): ResolvedAction | undefined {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return undefined;
    const action = plugin.actions.find((a) => a.id === actionId);
    return action ? { plugin, action } : undefined;
  }

  resolveView(pluginId: string, viewId: string): ResolvedView | undefined {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return undefined;
    const view = plugin.views.find((v) => v.id === viewId);
    return view ? { plugin, view } : undefined;
  }
}
