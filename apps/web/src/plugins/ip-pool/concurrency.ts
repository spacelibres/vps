/**
 * 有界并发映射：以 `concurrency` 为上限并发执行 `fn`，结果按输入顺序返回。
 * `concurrency <= 0` 表示**不限并发（全速）**。
 * 纯逻辑模块（无 `node:*`、无 DOM），便于单测与复用。
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const size = items.length;
  const results = new Array<R>(size);
  if (size === 0) return results;
  const requested = Math.floor(concurrency);
  const limit = requested <= 0 ? size : Math.min(requested, size);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    for (;;) {
      const index = next++;
      if (index >= size) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}
