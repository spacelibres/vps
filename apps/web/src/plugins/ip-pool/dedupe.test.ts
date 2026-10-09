import { describe, expect, it } from "vitest";
import { BoundedKeySet } from "./dedupe";

describe("BoundedKeySet", () => {
  it("记录已存在的键", () => {
    const set = new BoundedKeySet(10);
    expect(set.has("a")).toBe(false);
    set.add("a");
    expect(set.has("a")).toBe(true);
    expect(set.size).toBe(1);
  });

  it("超出容量按插入序淘汰最旧键", () => {
    const set = new BoundedKeySet(3);
    set.add("a");
    set.add("b");
    set.add("c");
    set.add("d");
    expect(set.size).toBe(3);
    expect(set.has("a")).toBe(false); // 最旧被淘汰
    expect(set.has("b")).toBe(true);
    expect(set.has("c")).toBe(true);
    expect(set.has("d")).toBe(true);
  });

  it("重复加入不增长且不改变淘汰序", () => {
    const set = new BoundedKeySet(2);
    set.add("a");
    set.add("b");
    set.add("a"); // 重复：忽略
    set.add("c");
    expect(set.size).toBe(2);
    expect(set.has("a")).toBe(false); // 仍是最旧的 a 被淘汰
    expect(set.has("b")).toBe(true);
    expect(set.has("c")).toBe(true);
  });

  it("clear 清空；容量非法时回落为 1", () => {
    const set = new BoundedKeySet(0);
    set.add("a");
    set.add("b");
    expect(set.size).toBe(1);
    expect(set.has("b")).toBe(true);
    set.clear();
    expect(set.size).toBe(0);
  });
});
