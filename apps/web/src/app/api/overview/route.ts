import { NextResponse } from "next/server";
import { KiwiVmError } from "@/sdk";
import { getTargets } from "@/lib/config";
import { getClient } from "@/lib/kiwivm";

export const dynamic = "force-dynamic";

/** 汇总全部 VPS 的服务信息，供总览页使用。 */
export async function GET() {
  const targets = getTargets();

  const data = await Promise.all(
    targets.map(async (target) => {
      try {
        const info = await getClient(target.veid).getServiceInfo();
        return { veid: target.veid, alias: target.alias, ok: true as const, info };
      } catch (err) {
        const message = KiwiVmError.isKiwiVmError(err)
          ? `${err.message}（错误码 ${err.code}）`
          : err instanceof Error
            ? err.message
            : String(err);
        return { veid: target.veid, alias: target.alias, ok: false as const, error: message };
      }
    }),
  );

  return NextResponse.json({ ok: true, data });
}
