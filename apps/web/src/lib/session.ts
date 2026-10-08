import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "vps_panel_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 天

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("未配置 SESSION_SECRET（至少 16 个字符）");
  }
  return new TextEncoder().encode(secret);
}

/** 是否已正确配置会话密钥。 */
export function isSessionConfigured(): boolean {
  const secret = process.env.SESSION_SECRET;
  return Boolean(secret && secret.length >= 16);
}

/** 签发一个已登录的会话 token。 */
export async function createSessionToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

/** 校验会话 token 是否有效（Edge 兼容，不依赖 node 内置模块）。 */
export async function verifySessionToken(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secretKey());
    return true;
  } catch {
    return false;
  }
}

/**
 * 会话 cookie 是否加 `Secure` 属性。
 *
 * 纯 HTTP 下若加了 `Secure`，浏览器会**直接丢弃**该 cookie，表现为「密码对但登录不上」。
 * 因此默认按请求协议自适应（HTTPS → Secure），并可用 `PANEL_COOKIE_SECURE` 强行覆盖。
 */
export function useSecureCookie(req: Request): boolean {
  const override = process.env.PANEL_COOKIE_SECURE?.trim().toLowerCase();
  if (override === "1" || override === "true" || override === "yes") return true;
  if (override === "0" || override === "false" || override === "no") return false;
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}
