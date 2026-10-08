import { describe, expect, it } from "vitest";
import { pickFairHotIp } from "./hot-picker";

const c = (ip: string, assignCount: number, lastUsedAt = 0) => ({ ip, assignCount, lastUsedAt });

describe("pickFairHotIp", () => {
  it("空候选返回 undefined", () => {
    expect(pickFairHotIp([])).toBeUndefined();
  });

  it("严格公平（warmSlack=0）：优先指派次数最少者", () => {
    expect(pickFairHotIp([c("a", 3), c("b", 1), c("c", 2)])).toBe("b");
  });

  it("同次数时优先最久未用（避免闲置）", () => {
    expect(pickFairHotIp([c("a", 1, 900), c("b", 1, 100)])).toBe("b");
  });

  it("带内（warmSlack>0）优先复用最近用过的热连接", () => {
    // a 落后 1 次（在 slack 内），但最近用过 → 仍选 a（复用热连接）
    expect(pickFairHotIp([c("a", 2, 999), c("b", 3, 100)], { warmSlack: 1 })).toBe("a");
    // 落后超出 slack → 补落后
    expect(pickFairHotIp([c("a", 1, 999), c("b", 5, 100)], { warmSlack: 1 })).toBe("a");
  });

  it("完全同分时按 ip 字典序稳定", () => {
    expect(pickFairHotIp([c("z", 1), c("a", 1)])).toBe("a");
  });
});
