import { describe, expect, it } from "vitest";
import { mapPool } from "./concurrency";

describe("mapPool", () => {
  it("结果顺序与输入一致", async () => {
    const out = await mapPool([1, 2, 3, 4, 5], 2, (n) => Promise.resolve(n * 10));
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it("并发不超过上限", async () => {
    let active = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active -= 1;
      return 0;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("空输入返回空数组且不调用 fn", async () => {
    let called = 0;
    const out = await mapPool([], 4, async () => {
      called += 1;
      return 0;
    });
    expect(out).toEqual([]);
    expect(called).toBe(0);
  });

  it("并发上限被输入规模收敛（limit ≤ size）", async () => {
    let peak = 0;
    let active = 0;
    await mapPool([1, 2], 64, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active -= 1;
      return 0;
    });
    expect(peak).toBe(2);
  });

  it("concurrency <= 0 表示全速（一次性全部铺开）", async () => {
    let peak = 0;
    let active = 0;
    const items = Array.from({ length: 12 }, (_, i) => i);
    await mapPool(items, 0, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return 0;
    });
    expect(peak).toBe(12);
  });

  it("单项失败会向上抛出", async () => {
    await expect(
      mapPool([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
