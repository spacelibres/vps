import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { parseLocString } from "./geo";
import type { HostPinRecord, PoolCityNode, PoolCountryNode, PoolIpNode } from "./types";

// 便于其它服务端模块从本文件统一引用。
export { parseLocString } from "./geo";
export type { GeoPoint } from "./geo";
export type {
  HostPinFamily,
  HostPinRecord,
  PoolCityNode,
  PoolCountryNode,
  PoolIpNode,
} from "./types";

interface YamlEntry {
  ip?: string;
  hostname?: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: string;
  org?: string;
  timezone?: string;
}

function toRecord(entry: YamlEntry, family: HostPinRecord["family"]): HostPinRecord | null {
  if (!entry?.ip) return null;
  return {
    ip: entry.ip,
    family,
    hostname: entry.hostname,
    city: entry.city,
    region: entry.region,
    country: entry.country,
    loc: entry.loc,
    org: entry.org,
    timezone: entry.timezone,
  };
}

/** 解析 kh.google.com.yaml（`ipv4` / `ipv6` 两段）。 */
export function parseKhGoogleYaml(text: string): {
  ipv4: HostPinRecord[];
  ipv6: HostPinRecord[];
  all: HostPinRecord[];
} {
  const doc = parseYaml(text) as { ipv4?: YamlEntry[]; ipv6?: YamlEntry[] } | null;
  const ipv4 = (doc?.ipv4 ?? [])
    .map((e) => toRecord(e, "ipv4"))
    .filter((r): r is HostPinRecord => r !== null);
  const ipv6 = (doc?.ipv6 ?? [])
    .map((e) => toRecord(e, "ipv6"))
    .filter((r): r is HostPinRecord => r !== null);
  return { ipv4, ipv6, all: [...ipv4, ...ipv6] };
}

/** 从文件加载全部 IP 记录。 */
export function loadPoolRecords(yamlPath: string): HostPinRecord[] {
  return parseKhGoogleYaml(readFileSync(yamlPath, "utf8")).all;
}

/**
 * 池子聚合：先按 IP 去重，再组织成 `country → city → ip`。
 * 国家/城市均按数量降序，IP 按字符串升序。
 */
export function aggregatePool(records: readonly HostPinRecord[]): PoolCountryNode[] {
  const byIp = new Map<string, HostPinRecord>();
  for (const record of records) {
    if (!byIp.has(record.ip)) byIp.set(record.ip, record);
  }

  const countries = new Map<string, Map<string, PoolIpNode[]>>();
  for (const record of byIp.values()) {
    const country = record.country || "未知";
    const city = record.city || "未知";
    const node: PoolIpNode = {
      ip: record.ip,
      family: record.family,
      hostname: record.hostname,
      org: record.org,
      timezone: record.timezone,
      loc: record.loc,
      point: parseLocString(record.loc),
    };
    let cities = countries.get(country);
    if (!cities) {
      cities = new Map();
      countries.set(country, cities);
    }
    const ips = cities.get(city);
    if (ips) ips.push(node);
    else cities.set(city, [node]);
  }

  const result: PoolCountryNode[] = [];
  for (const [country, cities] of countries) {
    const cityNodes: PoolCityNode[] = [];
    for (const [city, ips] of cities) {
      ips.sort((a, b) => a.ip.localeCompare(b.ip));
      cityNodes.push({
        city,
        region: byIp.get(ips[0]!.ip)?.region,
        total: ips.length,
        ips,
      });
    }
    cityNodes.sort((a, b) => b.total - a.total || a.city.localeCompare(b.city));
    result.push({
      country,
      total: cityNodes.reduce((sum, c) => sum + c.total, 0),
      cities: cityNodes,
    });
  }
  result.sort((a, b) => b.total - a.total || a.country.localeCompare(b.country));
  return result;
}
