import { NextResponse } from "next/server";
import { SESSION_COOKIE, useSecureCookie } from "@/lib/session";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: useSecureCookie(req),
  });
  return res;
}
