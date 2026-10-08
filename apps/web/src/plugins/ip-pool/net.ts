import { readFileSync } from "node:fs";

/**
 * 读取本机网卡累计流量（`/proc/net/dev`，Linux）。
 * 取所有非回环接口的 rx/tx 字节数之和；非 Linux 返回 `null`。
 */
export interface NicTotals {
  rxBytes: number;
  txBytes: number;
}

export function readNicTotals(): NicTotals | null {
  let raw: string;
  try {
    raw = readFileSync("/proc/net/dev", "utf8");
  } catch {
    return null;
  }

  let rxBytes = 0;
  let txBytes = 0;
  const lines = raw.split("\n");
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const iface = line.slice(0, idx).trim();
    if (!iface || iface === "lo") continue;
    const fields = line.slice(idx + 1).trim().split(/\s+/);
    const rx = Number(fields[0]);
    const tx = Number(fields[8]);
    if (Number.isFinite(rx)) rxBytes += rx;
    if (Number.isFinite(tx)) txBytes += tx;
  }
  return { rxBytes, txBytes };
}
