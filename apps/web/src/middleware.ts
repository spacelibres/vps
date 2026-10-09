import { NextResponse, type NextRequest } from "next/server";
import { absoluteUrl, publicOrigin } from "@/lib/public-origin";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/** 无需登录即可访问的路径。 */
const PUBLIC_PATHS = ["/login", "/api/auth/login"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** 定长比较，避免时序侧信道。 */
function tokenEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * 允许携带机器 token 的调用方直接访问 `/api/**`（env `PANEL_API_TOKEN`；未设则关闭）。
 * 仅用于机器到机器（如外部下载器调 ip-pool），不放开页面。
 */
function hasApiToken(req: NextRequest): boolean {
  const expected = process.env.PANEL_API_TOKEN;
  if (!expected) return false;
  const provided = req.headers.get("x-api-token") ?? "";
  return provided.length > 0 && tokenEquals(provided, expected);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();
  if (pathname.startsWith("/api/") && hasApiToken(req)) return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return NextResponse.next();

  // API 请求返回 401 JSON，页面请求重定向到登录页。
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, error: { code: 401, message: "未登录或会话已过期" } },
      { status: 401 },
    );
  }

  // 反代后 req.nextUrl 是内部地址（localhost:3000），必须用 x-forwarded-* 重建，
  // 否则会把用户重定向到 https://localhost:3000。
  const url = absoluteUrl("/login", publicOrigin(req.headers, req.nextUrl.origin), req.nextUrl.origin);
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|flags/).*)"],
};
