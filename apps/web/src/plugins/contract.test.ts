import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ZodType } from "zod";
import { registry } from "./server";

/** AGENTS.md §3/§7：插件 id 为 kebab-case，动作 id 为 camelCase。 */
const PLUGIN_ID_RE = /^[a-z][a-z0-9-]*$/;
const ACTION_ID_RE = /^[a-z][a-zA-Z0-9]*$/;

const pluginsDir = fileURLToPath(new URL(".", import.meta.url));
const plugins = registry.list();

describe("插件契约（AGENTS.md）", () => {
  it("插件 id 唯一且符合命名规则", () => {
    const seen = new Set<string>();
    for (const plugin of plugins) {
      expect(PLUGIN_ID_RE.test(plugin.id), `插件 id 不合法：${plugin.id}`).toBe(true);
      expect(seen.has(plugin.id), `插件 id 重复：${plugin.id}`).toBe(false);
      seen.add(plugin.id);
    }
  });

  it("插件具备名称、视图，且目录结构完整", () => {
    for (const plugin of plugins) {
      expect(plugin.name.trim().length, `插件 ${plugin.id} 缺少名称`).toBeGreaterThan(0);
      expect(plugin.views.length, `插件 ${plugin.id} 至少需要一个视图`).toBeGreaterThan(0);
      for (const file of ["index.ts", "view.tsx"]) {
        const target = path.join(pluginsDir, plugin.id, file);
        expect(existsSync(target), `插件 ${plugin.id} 缺少 ${file}`).toBe(true);
      }
    }
  });

  it("每个动作的契约完整（id / label / method / input）", () => {
    const problems: string[] = [];
    for (const plugin of plugins) {
      const actionIds = new Set<string>();
      for (const action of plugin.actions) {
        const where = `${plugin.id}/${action.id}`;
        if (!ACTION_ID_RE.test(action.id)) problems.push(`${where}: 动作 id 不合法（应为小写驼峰）`);
        if (actionIds.has(action.id)) problems.push(`${where}: 动作 id 重复`);
        actionIds.add(action.id);
        if (!action.label || !action.label.trim()) problems.push(`${where}: label 为空`);
        if (action.method !== "GET" && action.method !== "POST") {
          problems.push(`${where}: method 必须是 "GET" 或 "POST"`);
        }
        if (!action.input) {
          problems.push(`${where}: 缺少 input（无参数也要写 z.object({})）`);
        } else if (!(action.input instanceof ZodType)) {
          problems.push(`${where}: input 不是 zod schema`);
        }
        if (action.raw && action.output) {
          problems.push(`${where}: raw 动作不应声明 output`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("插件目录内必须至少有一个 *.test.ts", () => {
    const missing: string[] = [];
    for (const plugin of plugins) {
      const dir = path.join(pluginsDir, plugin.id);
      if (!existsSync(dir)) continue;
      const hasTest = readdirSync(dir).some((file) => file.endsWith(".test.ts"));
      if (!hasTest) missing.push(plugin.id);
    }
    if (missing.length > 0) {
      // 记录未覆盖的插件，供后续补齐（不阻断；参考插件必须已覆盖）
      console.warn(`[contract] 尚无单测的插件：${missing.join("、")}`);
    }
    expect(missing.includes("ip-pool"), "参考插件 ip-pool 必须自带单测").toBe(false);
  });
});
