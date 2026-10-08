import { describe, expect, it } from "vitest";
import { aggregatePool, parseKhGoogleYaml } from "./pool";

const YAML = `
ipv4:
  - ip: 1.1.1.1
    hostname: a.1e100.net
    city: Dallas
    region: Texas
    country: US
    loc: 32.7,-96.8
    org: AS15169 Google LLC
    timezone: America/Chicago
  - ip: 1.1.1.2
    city: Dallas
    region: Texas
    country: US
    loc: 32.7,-96.8
  - ip: 1.1.1.2
    city: Dallas
    region: Texas
    country: US
    loc: 32.7,-96.8
ipv6:
  - ip: 2001:db8::1
    city: Tulsa
    region: Oklahoma
    country: US
    loc: 36.1,-95.9
`;

describe("parseKhGoogleYaml", () => {
  it("解析 ipv4 / ipv6 两段", () => {
    const parsed = parseKhGoogleYaml(YAML);
    expect(parsed.ipv4).toHaveLength(3);
    expect(parsed.ipv6).toHaveLength(1);
    expect(parsed.all).toHaveLength(4);
    expect(parsed.ipv6[0]!.family).toBe("ipv6");
  });
});

describe("aggregatePool", () => {
  const aggregate = aggregatePool(parseKhGoogleYaml(YAML).all);

  it("按 IP 去重（重复的 1.1.1.2 只算一次）", () => {
    const us = aggregate.find((a) => a.country === "US")!;
    const dallas = us.cities.find((c) => c.city === "Dallas")!;
    expect(dallas.total).toBe(2);
    expect(dallas.ips.map((i) => i.ip)).toEqual(["1.1.1.1", "1.1.1.2"]);
  });

  it("组织为 country → city", () => {
    expect(aggregate).toHaveLength(1);
    expect(aggregate[0]!.country).toBe("US");
    expect(aggregate[0]!.cities.map((c) => c.city).sort()).toEqual(["Dallas", "Tulsa"]);
    expect(aggregate[0]!.total).toBe(3);
  });

  it("把 loc 解析成坐标", () => {
    const dallas = aggregate[0]!.cities.find((c) => c.city === "Dallas")!;
    expect(dallas.ips[0]!.point).toEqual({ lat: 32.7, lng: -96.8 });
    expect(dallas.region).toBe("Texas");
  });
});
