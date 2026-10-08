"use client";

import { useCallback, useState } from "react";

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
 * 它会 POST 到 `/api/plugins/<pluginId>/actions/<actionId>`，
 * 由宿主在服务端构造 `PluginContext` 并执行插件的 `run`。
 */
export function usePluginAction<T = unknown>(pluginId: string, actionId: string) {
  const [state, setState] = useState<ActionState<T>>({ running: false });

  const run = useCallback(
    async (veid: string, input?: unknown): Promise<T | undefined> => {
      setState({ running: true });
      try {
        const res = await fetch(`/api/plugins/${pluginId}/actions/${actionId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ veid, input }),
        });
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
    [pluginId, actionId],
  );

  const reset = useCallback(() => setState({ running: false }), []);

  return { ...state, run, reset };
}
