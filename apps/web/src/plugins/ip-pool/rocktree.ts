/**
 * Rocktree 上游 URL 构造（纯逻辑，客户端安全，可单测）。
 *
 * 调用方（外部下载器）只发**结构化参数**（`path` / `epoch`），不必发那条长 URL；
 * URL 在服务端拼回去。`pb=!1m2!1s<path>!2u<epoch>` 里其实就两个字段：
 * `1s` = path(string)、`2u` = epoch(uint)。
 */

/** Earth rocktree 基址。 */
export const EARTH_RT_BASE = "https://kh.google.com/rt/earth";

export type UpstreamKind = "bulk" | "planetoid" | "raw";

export interface UpstreamRequest {
  kind: UpstreamKind;
  /** 基址；缺省 `EARTH_RT_BASE`。 */
  base?: string;
  /** `kind="bulk"` 必填：BulkMetadata 的路径。 */
  path?: string;
  /** `kind="bulk"` 必填：纪元。 */
  epoch?: number;
  /** `kind="raw"` 必填：完整 URL。 */
  url?: string;
}

/** 由结构化参数拼出上游 URL。参数不合法时抛错。 */
export function buildUpstreamUrl(req: UpstreamRequest): string {
  const base = req.base?.trim() ? req.base.trim() : EARTH_RT_BASE;
  switch (req.kind) {
    case "planetoid":
      return `${base}/PlanetoidMetadata`;
    case "bulk": {
      if (!req.path) throw new Error("bulk 请求缺少 path");
      if (req.epoch === undefined) throw new Error("bulk 请求缺少 epoch");
      return `${base}/BulkMetadata/pb=!1m2!1s${req.path}!2u${req.epoch}`;
    }
    case "raw":
      if (!req.url) throw new Error("raw 请求缺少 url");
      return req.url;
  }
}
