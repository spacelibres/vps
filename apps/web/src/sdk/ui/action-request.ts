/**
 * 构造调用某个插件动作所需的请求（纯逻辑，可单测）。
 *
 * 与宿主路由 `/api/plugins/<pluginId>/actions/<actionId>` 的约定一致：
 * - `GET`（只读）：`veid` 与输入都放进 query；
 * - `POST`（写入/变更）：JSON body `{ veid, input }`。
 */

export interface ActionRequest {
  url: string;
  init: RequestInit;
}

export interface BuildActionRequestArgs {
  pluginId: string;
  actionId: string;
  method: "GET" | "POST";
  veid: string;
  input?: unknown;
}

export function buildActionRequest(args: BuildActionRequestArgs): ActionRequest {
  const base = `/api/plugins/${args.pluginId}/actions/${args.actionId}`;

  if (args.method === "GET") {
    const params = new URLSearchParams();
    if (args.veid) params.set("veid", args.veid);
    if (args.input && typeof args.input === "object" && !Array.isArray(args.input)) {
      for (const [key, value] of Object.entries(args.input as Record<string, unknown>)) {
        if (value === undefined || value === null) continue;
        params.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
      }
    }
    const qs = params.toString();
    return { url: qs ? `${base}?${qs}` : base, init: { cache: "no-store" } };
  }

  return {
    url: base,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ veid: args.veid, input: args.input }),
    },
  };
}
