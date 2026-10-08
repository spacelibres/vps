import { describe, expect, it } from "vitest";
import { buildActionRequest } from "./action-request";

describe("buildActionRequest", () => {
  it("GET 无输入：veid 进 query，使用 GET 语义（无 method 字段）", () => {
    const { url, init } = buildActionRequest({
      pluginId: "lifecycle",
      actionId: "status",
      method: "GET",
      veid: "2166457",
      input: {},
    });
    expect(url).toBe("/api/plugins/lifecycle/actions/status?veid=2166457");
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("GET 带输入：额外字段序列化为 query", () => {
    const { url } = buildActionRequest({
      pluginId: "shell",
      actionId: "cd",
      method: "GET",
      veid: "1",
      input: { currentDir: "/", newDir: "/tmp" },
    });
    expect(url).toBe("/api/plugins/shell/actions/cd?veid=1&currentDir=%2F&newDir=%2Ftmp");
  });

  it("GET 无 veid 时不带 veid 参数", () => {
    const { url } = buildActionRequest({
      pluginId: "ip-pool",
      actionId: "stats",
      method: "GET",
      veid: "",
    });
    expect(url).toBe("/api/plugins/ip-pool/actions/stats");
  });

  it("POST：JSON body 携带 veid 与 input", () => {
    const { url, init } = buildActionRequest({
      pluginId: "lifecycle",
      actionId: "restart",
      method: "POST",
      veid: "2166457",
      input: {},
    });
    expect(url).toBe("/api/plugins/lifecycle/actions/restart");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ veid: "2166457", input: {} });
  });

  it("GET 输入中的 undefined/null 被忽略", () => {
    const { url } = buildActionRequest({
      pluginId: "x",
      actionId: "y",
      method: "GET",
      veid: "1",
      input: { a: undefined, b: null, c: "ok" },
    });
    expect(url).toBe("/api/plugins/x/actions/y?veid=1&c=ok");
  });
});
