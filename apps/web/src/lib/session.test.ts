import { afterEach, describe, expect, it } from "vitest";
import { useSecureCookie } from "./session";

const ORIGINAL = process.env.PANEL_COOKIE_SECURE;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.PANEL_COOKIE_SECURE;
  else process.env.PANEL_COOKIE_SECURE = ORIGINAL;
});

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("useSecureCookie", () => {
  it("纯 HTTP 且无转发头 → 不加 Secure", () => {
    delete process.env.PANEL_COOKIE_SECURE;
    expect(useSecureCookie(req("http://172.93.47.57:3000/api/auth/login"))).toBe(false);
  });

  it("HTTPS 请求 → 加 Secure", () => {
    delete process.env.PANEL_COOKIE_SECURE;
    expect(useSecureCookie(req("https://panel.example.com/api/auth/login"))).toBe(true);
  });

  it("经反代时按 x-forwarded-proto 判定", () => {
    delete process.env.PANEL_COOKIE_SECURE;
    expect(
      useSecureCookie(req("http://localhost:3000/x", { "x-forwarded-proto": "https" })),
    ).toBe(true);
    expect(
      useSecureCookie(req("http://localhost:3000/x", { "x-forwarded-proto": "http" })),
    ).toBe(false);
    expect(
      useSecureCookie(req("http://localhost:3000/x", { "x-forwarded-proto": "https, http" })),
    ).toBe(true);
  });

  it("PANEL_COOKIE_SECURE 可强制覆盖", () => {
    process.env.PANEL_COOKIE_SECURE = "1";
    expect(useSecureCookie(req("http://localhost:3000/x"))).toBe(true);
    process.env.PANEL_COOKIE_SECURE = "false";
    expect(useSecureCookie(req("https://panel.example.com/x"))).toBe(false);
  });
});
