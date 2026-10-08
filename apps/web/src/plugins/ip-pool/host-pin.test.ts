import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HostPinPool } from "./host-pin";

const root = mkdtempSync(path.join(tmpdir(), "host-pin-test-"));
const poolFile = path.join(root, "pool.yaml");
writeFileSync(
  poolFile,
  [
    "ipv4:",
    "  - ip: 1.1.1.1",
    "    city: A",
    "    country: US",
    "  - ip: 1.1.1.2",
    "    city: B",
    "    country: US",
    "ipv6:",
    "  - ip: 2001:db8::1",
    "    city: C",
    "    country: US",
    "",
  ].join("\n"),
  "utf8",
);

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("HostPinPool", () => {
  it("轮询返回池内 IP 且回到开头", () => {
    const pool = new HostPinPool({ hostname: "kh.google.com", poolFile });
    expect(pool.size()).toBe(3);
    const ips = [
      pool.nextRecord().ip,
      pool.nextRecord().ip,
      pool.nextRecord().ip,
      pool.nextRecord().ip,
    ];
    expect(new Set(ips).size).toBe(3);
    expect(ips[0]).toBe(ips[3]);
  });

  it("family 过滤只取对应地址族", () => {
    const pool = new HostPinPool({ hostname: "kh.google.com", poolFile, family: "ipv4" });
    expect(pool.size()).toBe(2);
    expect(pool.nextRecord().family).toBe("ipv4");
  });

  it("resolveForUrl 生成 dns.hosts 钉 IP", () => {
    const pool = new HostPinPool({ hostname: "kh.google.com", poolFile });
    const pin = pool.resolveForUrl("https://kh.google.com/rt/earth/PlanetoidMetadata");
    expect(pin.hostname).toBe("kh.google.com");
    expect(pin.dns.hosts["kh.google.com"]).toEqual([pin.pinnedIp]);
    expect(pin.record.ip).toBe(pin.pinnedIp);
  });
});
