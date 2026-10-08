/**
 * 热池 IP 公平选路（移植自 `GeoClaw/src/fetch/HotIpPicker.ts`）。
 * 纯逻辑，无副作用，便于单测。
 */

export interface HotIpCandidate {
  ip: string;
  lastUsedAt: number;
  assignCount: number;
}

export interface PickFairHotIpOptions {
  /**
   * 允许领先的 `assignCount` 差。
   * `0`：同次数优先最久未用（严格公平）。
   * `>0`：在 `[min, min+slack]` 带内优先**最近用过**（更多复用热连接），落后的仍会被补上。
   */
  warmSlack?: number;
}

/**
 * 按 `assignCount` 均摊选出一条热 IP；带内优先复用最近连接的。
 * @returns 选中的 IP；无候选时 `undefined`
 */
export function pickFairHotIp(
  candidates: readonly HotIpCandidate[],
  options?: PickFairHotIpOptions,
): string | undefined {
  if (candidates.length === 0) return undefined;

  const warmSlack = Math.max(0, Math.floor(options?.warmSlack ?? 0));
  if (warmSlack <= 0) {
    const sorted = [...candidates].sort((a, b) => {
      if (a.assignCount !== b.assignCount) return a.assignCount - b.assignCount;
      if (a.lastUsedAt !== b.lastUsedAt) return a.lastUsedAt - b.lastUsedAt;
      return a.ip.localeCompare(b.ip);
    });
    return sorted[0]?.ip;
  }

  let minCount = candidates[0]!.assignCount;
  for (const c of candidates) if (c.assignCount < minCount) minCount = c.assignCount;
  const band = candidates.filter((c) => c.assignCount <= minCount + warmSlack);
  const pool = band.length > 0 ? band : candidates;
  const sorted = [...pool].sort((a, b) => {
    if (a.assignCount !== b.assignCount) return a.assignCount - b.assignCount;
    if (a.lastUsedAt !== b.lastUsedAt) return b.lastUsedAt - a.lastUsedAt;
    return a.ip.localeCompare(b.ip);
  });
  return sorted[0]?.ip;
}
