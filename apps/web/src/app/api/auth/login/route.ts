import { NextResponse } from "next/server";
import { z } from "zod";
import { isPasswordConfigured, verifyPassword } from "@/lib/password";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  isSessionConfigured,
} from "@/lib/session";

const BodySchema = z.object({ password: z.string().min(1) });

export async function POST(req: Request) {
  if (!isPasswordConfigured() || !isSessionConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: 500, message: "服务端未配置 PANEL_PASSWORD / SESSION_SECRET" },
      },
      { status: 500 },
    );
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !verifyPassword(parsed.data.password)) {
    return NextResponse.json(
      { ok: false, error: { code: 401, message: "密码错误" } },
      { status: 401 },
    );
  }

  const token = await createSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
