import { NextResponse } from "next/server";
import { z } from "zod";
import { isKnownVeid } from "@/lib/config";
import { buildPluginContext, buildVpslessPluginContext } from "@/lib/kiwivm";
import { registry } from "@/plugins/server";
import { KiwiVmError } from "@/sdk";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ pluginId: string; actionId: string }>;
}

function issuesToMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

async function handle(req: Request, params: RouteParams["params"], method: "GET" | "POST") {
  const { pluginId, actionId } = await params;

  const resolved = registry.resolveAction(pluginId, actionId);
  if (!resolved) {
    return NextResponse.json(
      { ok: false, error: { code: 404, message: `未找到动作：${pluginId}/${actionId}` } },
      { status: 404 },
    );
  }
  const { action } = resolved;

  if (action.method !== method) {
    return NextResponse.json(
      { ok: false, error: { code: 405, message: `该动作只接受 ${action.method}` } },
      { status: 405 },
    );
  }

  const url = new URL(req.url);
  let rawInput: unknown;
  let veid = "";

  if (method === "GET") {
    rawInput = Object.fromEntries(url.searchParams.entries());
    veid = url.searchParams.get("veid") ?? "";
  } else {
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({ veid: z.string().optional(), input: z.unknown().optional() })
      .safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: { code: 400, message: "请求体格式不正确" } },
        { status: 400 },
      );
    }
    rawInput = parsed.data.input;
    veid = parsed.data.veid ?? "";
  }

  const needsVps = action.needsVps !== false;
  if (needsVps && (!veid || !isKnownVeid(veid))) {
    return NextResponse.json(
      { ok: false, error: { code: 404, message: `未配置的 VPS：${veid || "(空)"}` } },
      { status: 404 },
    );
  }

  let input = rawInput;
  if (action.input) {
    const validated = action.input.safeParse(rawInput);
    if (!validated.success) {
      return NextResponse.json(
        { ok: false, error: { code: 400, message: `参数校验失败：${issuesToMessage(validated.error)}` } },
        { status: 400 },
      );
    }
    input = validated.data;
  }

  const ctx = needsVps ? buildPluginContext(veid) : buildVpslessPluginContext();

  try {
    const data = await action.run(ctx, input);
    // raw 动作返回 Response（如 SSE），直接透传。
    if (action.raw) return data as Response;

    // 声明了 output 就做运行时校验（契约严格执行）。
    if (action.output) {
      const validated = action.output.safeParse(data);
      if (!validated.success) {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: -1,
              message: `动作 ${pluginId}/${actionId} 的返回值不符合 output 契约：${issuesToMessage(validated.error)}`,
            },
          },
          { status: 500 },
        );
      }
      return NextResponse.json({ ok: true, data: validated.data ?? null });
    }

    return NextResponse.json({ ok: true, data: data ?? null });
  } catch (err) {
    if (KiwiVmError.isKiwiVmError(err)) {
      return NextResponse.json({ ok: false, error: { code: err.code, message: err.message } });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: { code: -1, message } }, { status: 500 });
  }
}

export async function GET(req: Request, { params }: RouteParams) {
  return handle(req, params, "GET");
}

export async function POST(req: Request, { params }: RouteParams) {
  return handle(req, params, "POST");
}
