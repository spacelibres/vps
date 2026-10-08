"use client";

import { createContext, useContext, type ReactNode } from "react";

/** 动作的客户端可见元数据（不含服务端 `run`）。 */
export interface ActionMeta {
  id: string;
  method: "GET" | "POST";
}

const PluginActionsContext = createContext<readonly ActionMeta[]>([]);

/**
 * 由插件宿主页提供「当前插件的动作元数据」，
 * 让 {@link usePluginAction} 能在客户端知道该用 GET 还是 POST。
 */
export function PluginActionsProvider({
  actions,
  children,
}: {
  actions: readonly ActionMeta[];
  children: ReactNode;
}) {
  return (
    <PluginActionsContext.Provider value={actions}>{children}</PluginActionsContext.Provider>
  );
}

/** 取某个动作的元数据；未知返回 `undefined`。 */
export function useActionMeta(actionId: string): ActionMeta | undefined {
  const actions = useContext(PluginActionsContext);
  return actions.find((action) => action.id === actionId);
}

/** 取当前插件的全部动作元数据。 */
export function usePluginActions(): readonly ActionMeta[] {
  return useContext(PluginActionsContext);
}
