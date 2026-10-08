/**
 * 派发调度（纯逻辑，便于单测与复用）。
 */

/**
 * 把 `count` 个请求尽量均匀分给 `workers` 个热 IP（每个工人处理数相差 ≤ 1）。
 * `workers <= 0` 返回空数组；`count <= 0` 返回全 0。
 */
export function planDispatch(count: number, workers: number): number[] {
  if (workers <= 0) return [];
  if (count <= 0) return new Array<number>(workers).fill(0);
  const base = Math.floor(count / workers);
  const extra = count % workers;
  return Array.from({ length: workers }, (_, i) => base + (i < extra ? 1 : 0));
}
