import { describe, expect, it } from "vitest";
import { planDispatch } from "./plan";

describe("planDispatch", () => {
  it("均分且总数守恒（每个工人相差 ≤ 1）", () => {
    expect(planDispatch(10, 3)).toEqual([4, 3, 3]);
    expect(planDispatch(9, 3)).toEqual([3, 3, 3]);
    for (const [count, workers] of [
      [10000, 3458],
      [3458, 3458],
      [1, 5],
      [5, 5],
    ] as const) {
      const plan = planDispatch(count, workers);
      expect(plan).toHaveLength(workers);
      expect(plan.reduce((s, n) => s + n, 0)).toBe(count);
      expect(Math.max(...plan) - Math.min(...plan)).toBeLessThanOrEqual(1);
    }
  });

  it("工人多于请求时，前 count 个各 1，其余 0", () => {
    expect(planDispatch(2, 5)).toEqual([1, 1, 0, 0, 0]);
  });

  it("无工人返回空数组；count<=0 返回全 0", () => {
    expect(planDispatch(100, 0)).toEqual([]);
    expect(planDispatch(0, 3)).toEqual([0, 0, 0]);
  });
});
