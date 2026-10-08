import type { ComponentType } from "react";
import type { ZodType, ZodTypeDef, output as ZodOutput } from "zod";
import type { KiwiVmClient } from "../client/kiwivm-client";
import type { Logger } from "../logger";

/** 一台被管理的 VPS。 */
export interface VpsTarget {
  veid: string;
  alias: string;
}

/**
 * 运行期注入给插件的上下文。插件通过它与 API 交互，无需接触凭据或环境变量。
 */
export interface PluginContext {
  /** 绑定到「当前选中 VPS」的客户端。 */
  client: KiwiVmClient;
  /** 取任意一台 VPS 的客户端（批量操作时使用）。 */
  clientFor(veid: string): KiwiVmClient;
  /** 账号下全部 VPS。 */
  targets: readonly VpsTarget[];
  logger: Logger;
}

/** 动作的操作范围。 */
export type ActionScope = "selected" | "all";

/**
 * 插件暴露的一个服务端动作，对应一次（或多次）API 调用。
 * 由宿主注册为 `/api/plugins/<pluginId>/actions/<actionId>`。
 */
export interface PluginAction {
  id: string;
  label: string;
  description?: string;
  method: "GET" | "POST";
  /** 危险操作（UI 会二次确认）。 */
  danger?: boolean;
  /** 默认作用于当前选中的 VPS；`"all"` 表示作用于全部 VPS。 */
  scope?: ActionScope;
  /**
   * 是否需要 VPS 上下文（默认 `true`）。
   * 为 `false` 时：动作路由不要求 `veid`，`ctx.client` / `ctx.clientFor` 不可用。
   */
  needsVps?: boolean;
  /**
   * 为 `true` 时 `run` 返回一个 `Response`，路由直接透传（用于 SSE 等流式响应），
   * 不做 JSON 包装。默认 `false`。
   */
  raw?: boolean;
  /** 可选的输入校验 schema。 */
  input?: ZodType;
  /**
   * 可选的**输出**校验 schema。提供后宿主会在路由层校验动作返回值；
   * 输出类型主要由 TypeScript 返回类型约束（见 AGENTS.md §3）。
   */
  output?: ZodType;
  run(ctx: PluginContext, input: unknown): Promise<unknown>;
}

/** 传给插件视图组件的 props。 */
export interface PluginViewProps {
  targets: readonly VpsTarget[];
  currentVeid: string;
  onSelectVps(veid: string): void;
}

/** 插件自带的一个前端视图（挂载于 `/plugins/<pluginId>/<view.path>`）。 */
export interface PluginView {
  id: string;
  title: string;
  description?: string;
  path: string;
  Component: ComponentType<PluginViewProps>;
}

/** 插件契约：同时暴露服务端动作与前端视图。 */
export interface VpsPlugin {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** 简单的图标标识（emoji 或图标名），由壳决定如何渲染。 */
  readonly icon?: string;
  /** 导航排序，数字越小越靠前。 */
  readonly order?: number;
  readonly actions: readonly PluginAction[];
  readonly views: readonly PluginView[];
}

/**
 * 定义一个动作，保留 `input` 的类型推导。
 * 返回值是类型擦除后的 {@link PluginAction}，可直接放进插件。
 */
export function defineAction<
  InputSchema extends ZodType<any, ZodTypeDef, any>,
  OutputSchema extends ZodType<any, ZodTypeDef, any> = ZodType<any, ZodTypeDef, any>,
>(def: {
  id: string;
  label: string;
  description?: string;
  method: "GET" | "POST";
  danger?: boolean;
  scope?: ActionScope;
  needsVps?: boolean;
  raw?: boolean;
  /** **必填**：无参数也必须写 `z.object({})`（AGENTS.md §3）。 */
  input: InputSchema;
  /** 可选：提供后宿主会在路由层用它校验返回值。 */
  output?: OutputSchema;
  run(ctx: PluginContext, input: ZodOutput<InputSchema>): Promise<unknown>;
}): PluginAction {
  return def as unknown as PluginAction;
}

/** 定义一个视图，保留组件 props 类型检查。 */
export function defineView<Props extends PluginViewProps>(
  def: PluginView & { Component: ComponentType<Props> },
): PluginView {
  return def as unknown as PluginView;
}

/** 按 `order` 再按 `name` 排序插件，供导航使用。 */
export function sortPlugins(plugins: readonly VpsPlugin[]): VpsPlugin[] {
  return [...plugins].sort((a, b) => {
    const diff = (a.order ?? 100) - (b.order ?? 100);
    return diff !== 0 ? diff : a.name.localeCompare(b.name, "zh-Hans-CN");
  });
}
