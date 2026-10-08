import { timingSafeEqual } from "node:crypto";

/** 是否已配置面板密码。 */
export function isPasswordConfigured(): boolean {
  return Boolean(process.env.PANEL_PASSWORD);
}

/** 恒时比较输入密码与配置密码，避免时序侧信道。 */
export function verifyPassword(input: string): boolean {
  const expected = process.env.PANEL_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
