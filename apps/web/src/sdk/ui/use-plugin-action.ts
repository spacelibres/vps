"use client";

import { useCallback, useState } from "react";
import { buildActionRequest } from "./action-request";
import { useActionMeta } from "./plugin-actions";

export interface ActionError {
  code: number;
  message: string;
}

export interface ActionState<T> {
  running: boolean;
  data?: T;
  error?: ActionError;
}

/**
 * 调用某个插件动作的 React hook。
 *
 * 请求方法取自插件动作元数据（由宿主页经 {@link PluginActionsProvider} 注入）：
 * - `GET` 动作 → `GET ...?veid=...&<input>`；
 * - `POST` 动作 → `POST` JSON `{ veid, input }`。
 *
 * 未拿到元数据时回退为 `POST`。
 */
export function usePluginAction<T = unknown>(pluginId: string, actionId: string) {
  const [state, setState] = useState<ActionState<T>>({ running: false });
  const meta = useActionMeta(actionId);
  const method = meta?.method ?? "POST";

  const run = useCallback(
    async (veid: string, input?: unknown): Promise<T | undefined> => {
      setState({ running: true });
      try {
        const { url, init } = buildActionRequest({ pluginId, actionId, method, veid, input });
        const res = await fetch(url, init);
        const json = (await res.json()) as
          | { ok: true; data: T }
          | { ok: false; error: ActionError };
        if (!json.ok) {
          setState({ running: false, error: json.error });
          return undefined;
        }
        setState({ running: false, data: json.data });
        return json.data;
      } catch (err) {
        setState({
          running: false,
          error: { code: -1, message: err instanceof Error ? err.message : String(err) },
        });
        return undefined;
      }
    },
    [pluginId, actionId, method],
  );

  const reset = useCallback(() => setState({ running: false }), []);

  return { ...state, run, reset };
}
