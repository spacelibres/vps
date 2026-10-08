import { describe, expect, it } from "vitest";
import { KiwiVmError } from "../errors";
import { KiwiVmClient, type KiwiVmTransport } from "./kiwivm-client";

function recordingTransport(
  response: unknown,
): { transport: KiwiVmTransport; calls: Array<{ endpoint: string; params: Record<string, unknown> }> } {
  const calls: Array<{ endpoint: string; params: Record<string, unknown> }> = [];
  const transport: KiwiVmTransport = async (endpoint, params) => {
    calls.push({ endpoint, params });
    return response;
  };
  return { transport, calls };
}

describe("KiwiVmClient", () => {
  it("把 veid 与调用参数一起交给传输层", async () => {
    const { transport, calls } = recordingTransport({ error: 0 });
    const client = new KiwiVmClient(transport, "2166457");

    await client.setPTR("1.2.3.4", "ns1.example.com");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.endpoint).toBe("setPTR");
    expect(calls[0]?.params).toEqual({
      veid: "2166457",
      ip: "1.2.3.4",
      ptr: "ns1.example.com",
    });
  });

  it("endpoint 路径与官方文档一致（含斜杠）", async () => {
    const { transport, calls } = recordingTransport({ error: 0, snapshots: [] });
    const client = new KiwiVmClient(transport, "1");

    await client.snapshotList();

    expect(calls[0]?.endpoint).toBe("snapshot/list");
  });

  it("error != 0 时抛出 KiwiVmError，并带上错误码与 endpoint", async () => {
    const transport: KiwiVmTransport = async () => ({ error: 8, message: "Invalid API key" });
    const client = new KiwiVmClient(transport, "1");

    await expect(client.getServiceInfo()).rejects.toMatchObject({
      name: "KiwiVmError",
      code: 8,
      message: "Invalid API key",
      endpoint: "getServiceInfo",
    });
    await expect(client.getServiceInfo()).rejects.toBeInstanceOf(KiwiVmError);
  });

  it("basicShellExec 的 error 是命令退出码，不应抛异常", async () => {
    const transport: KiwiVmTransport = async () => ({
      error: 127,
      message: "sh: nope: command not found",
    });
    const client = new KiwiVmClient(transport, "1");

    const result = await client.basicShellExec("nope");

    expect(result.error).toBe(127);
    expect(result.message).toContain("command not found");
  });
});
