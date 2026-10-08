import type {
  PluginAction,
  PluginView,
  VpsPlugin,
} from "./types";

/**
 * 所有插件的基类。
 *
 * 子类只需声明 `id` / `name` 以及 `actions` / `views` 两个字段即可：
 *
 * ```ts
 * export class LifecyclePlugin extends BasePlugin {
 *   readonly id = "lifecycle";
 *   readonly name = "生命周期";
 *   readonly icon = "power";
 *   readonly actions = [ startAction, stopAction ];
 *   readonly views = [ lifecycleView ];
 * }
 * ```
 */
export abstract class BasePlugin implements VpsPlugin {
  abstract readonly id: string;
  abstract readonly name: string;
  readonly description?: string;
  readonly icon?: string;
  readonly order?: number = 100;
  abstract readonly actions: readonly PluginAction[];
  abstract readonly views: readonly PluginView[];
}
