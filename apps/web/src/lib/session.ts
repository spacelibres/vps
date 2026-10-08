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
