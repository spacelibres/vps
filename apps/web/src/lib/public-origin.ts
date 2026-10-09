/**
 * 反代场景下重建「对外 origin」的纯工具。
 *
 * Next 的 `req.nextUrl` 在反向代理后会用**服务内部地址**（`http://localhost:3000`）：
 * 直接 `req.nextUrl.clone()` 做重定向会把用户打到 `https://localhost:3000`。
 * 必须改用反代写入的 `x-forwarded-*`（或其回退 `host`）重建。
 */

/** 取转发头首个值（可能逗号分隔），去空白；空则 `undefined`。 */
export function firstForwarded(value: string | null | undefined): string | undefined {
  const first = value?.split(",")[0]?.trim();
  return first ? first : undefined;
}

/**
 * 计算对外 origin（含 scheme）。
 *
 * 输入：
 *   - headers: 请求头
 *   - fallbackOrigin: 无可用 host 时的回退（通常 `req.nextUrl.origin`）
 *
 * 输出：
 *   - string: `https://host` 形式的 origin
 */
export function publicOrigin(headers: Headers, fallbackOrigin: string): string {
  const host = firstForwarded(headers.get("x-forwarded-host")) ?? firstForwarded(headers.get("host"));
  if (!host) return fallbackOrigin;
  const proto =
    firstForwarded(headers.get("x-forwarded-proto")) ?? (fallbackOrigin.startsWith("https:") ? "https" : "http");
  return `${proto}://${host}`;
}

/**
 * 在给定 origin 上拼一个绝对 URL；origin 非法时回退到 fallbackOrigin。
 *
 * 输入：
 *   - path: 以 `/` 开头的路径
 *   - origin: 目标 origin
 *   - fallbackOrigin: origin 不可用时的回退 origin
 *
 * 输出：
 *   - URL: 绝对 URL
 */
export function absoluteUrl(path: string, origin: string, fallbackOrigin: string): URL {
  try {
    return new URL(path, origin);
  } catch {
    return new URL(path, fallbackOrigin);
  }
}
