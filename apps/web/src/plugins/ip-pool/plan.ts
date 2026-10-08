/**
 * 派发调度（纯逻辑，便于单测与复用）。
 */

/**
 * 计算派发所需的 worker 数（有界并发）。
 *
 * 派发不是「worker 越多越快」：实测单机吞吐在 ~200-400 并发时见顶，再往上反而下降
 * （过度订阅只会拉长每个请求、吃掉内存）。因此用 `cap` 限住同时在飞的请求数，
 * 同时让每个 worker 轮询整张热 IP 表 —— **所有热 IP 都参与，但在飞数有界**。
 *
 * - `cap <= 0`：不设上限（`min(count, hotCount)`，即老行为）。
 * - 结果恒 ≥ 1（有请求且热 IP 非空时），且 ≤ `min(count, hotCount)`。
 */
export function dispatchWorkerCount(count: number, hotCount: number, cap: number): number {
  if (count <= 0 || hotCount <= 0) return 0;
  const maxUseful = Math.min(count, hotCount);
  const requested = cap > 0 ? cap : maxUseful;
  return Math.max(1, Math.min(requested, maxUseful));
}

/** 第 `index` 个请求分配给哪张热 IP（轮询整表，保证每张都参与）。 */
export function hotIpFor(index: number, hotCount: number): number {
  if (hotCount <= 0) return 0;
  return ((index % hotCount) + hotCount) % hotCount;
}
