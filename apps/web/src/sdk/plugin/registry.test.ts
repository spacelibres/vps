import { z } from "zod";
import { describe, expect, it } from "vitest";
import { BasePlugin } from "./base-plugin";
import { PluginRegistry } from "./registry";
import { defineAction, sortPlugins } from "./types";

class FakePlugin extends BasePlugin {
  readonly id: string;
  readonly name: string;
  override readonly order: number;
  readonly actions = [
    defineAction({
      id: "ping",
      input: z.object({}),
      label: "Ping",
      method: "GET",
      run: async () => "pong",
    }),
  ];
  readonly views = [];

  constructor(id: string, name: string, order: number) {
    super();
    this.id = id;
    this.name = name;
    this.order = order;
  }
}

describe("PluginRegistry", () => {
  it("注册后可按 id 取出", () => {
    const registry = new PluginRegistry().register(new FakePlugin("a", "A", 1));
    expect(registry.get("a")?.name).toBe("A");
    expect(registry.list()).toHaveLength(1);
  });

  it("重复 id 会抛错", () => {
    const registry = new PluginRegistry().register(new FakePlugin("a", "A", 1));
    expect(() => registry.register(new FakePlugin("a", "A2", 2))).toThrow(/重复/);
  });

  it("resolveAction 能找到动作，找不到时返回 undefined", () => {
    const registry = new PluginRegistry().register(new FakePlugin("a", "A", 1));
    expect(registry.resolveAction("a", "ping")?.action.label).toBe("Ping");
    expect(registry.resolveAction("a", "nope")).toBeUndefined();
    expect(registry.resolveAction("nope", "ping")).toBeUndefined();
  });

  it("resolveView 在插件没有该视图时返回 undefined", () => {
    const registry = new PluginRegistry().register(new FakePlugin("a", "A", 1));
    expect(registry.resolveView("a", "main")).toBeUndefined();
  });
});

describe("sortPlugins", () => {
  it("按 order 升序排列", () => {
    const sorted = sortPlugins([
      new FakePlugin("c", "C", 30),
      new FakePlugin("a", "A", 10),
      new FakePlugin("b", "B", 20),
    ]);
    expect(sorted.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
});
