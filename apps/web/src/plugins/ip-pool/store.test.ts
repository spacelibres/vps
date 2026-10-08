import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { IpPoolStore } from "./store";

const POOL_YAML = [
  "ipv4:",
  "  - ip: 1.1.1.1",
  "    city: Dallas",
  "    region: Texas",
  "    country: US",
  "    loc: 32.7,-96.8",
  "  - ip: 1.1.1.2",
  "    city: Tulsa",
  "    region: Oklahoma",
  "    country: US",
  "    loc: 36.1,-95.9",
  "",
].join("\n");

/** 每个用例使用独立临时目录，避免互相污染。 */
function makeStore(): { store: IpPoolStore; dataDir: string; dispose: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "ip-pool-test-"));
  const poolFile = path.join(root, "pool.yaml");
  const dataDir = path.join(root, "data");
  writeFileSync(poolFile, POOL_YAML, "utf8");
  const store = new IpPoolStore({
    hostname: "kh.google.com",
    poolFile,
    dataDir,
    flushIntervalMs: 0,
    debounceMs: 0,
  });
  return {
    store,
    dataDir,
    dispose: () => {
      store.dispose();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("IpPoolStore.ingest", () => {
  it("累计每 IP 统计并合成弹道", () => {
    const { store, dispose } = makeStore();
    try {
      const result = store.ingest({
        origin: { lat: 0, lng: 0, label: "origin" },
        attempts: [
          {
            requestId: "r1",
            url: "https://kh.google.com/a",
            attempt: 1,
            ip: "1.1.1.1",
            outcome: "success",
            httpStatus: 200,
            durationMs: 100,
            bytes: 500,
            at: 1,
          },
          {
            requestId: "r1",
            url: "https://kh.google.com/a",
            attempt: 2,
            ip: "1.1.1.2",
            outcome: "http_error",
            httpStatus: 503,
            durationMs: 300,
            bytes: 0,
            at: 2,
          },
        ],
        requests: [
          {
            requestId: "r1",
            url: "https://kh.google.com/a",
            outcome: "success",
            attempts: 2,
            totalDurationMs: 400,
            finalIp: "1.1.1.1",
            finalStatus: 200,
            ipsUsed: ["1.1.1.1", "1.1.1.2"],
            bytes: 500,
            at: 2,
          },
        ],
      });

      expect(result.accepted).toMatchObject({ attempts: 2, requests: 1, flightPaths: 1 });

      const snap = store.snapshot();
      expect(snap.summary.totalAttempts).toBe(2);
      expect(snap.summary.totalSuccess).toBe(1);
      expect(snap.summary.totalFailed).toBe(1);

      const row = snap.rows.find((r) => r.ip === "1.1.1.1")!;
      expect(row.requests).toBe(1);
      expect(row.success).toBe(1);
      expect(row.avgDurationMs).toBe(100);
      expect(row.country).toBe("US");
      expect(row.city).toBe("Dallas");

      const flight = snap.recentFlightPaths[0]!;
      expect(flight.waypoints[0]!.role).toBe("origin");
      expect(flight.waypoints[flight.waypoints.length - 1]!.role).toBe("target");
      expect(flight.colorKey).toBe("1.1.1.1");
      expect(flight.legs).toHaveLength(1);
    } finally {
      dispose();
    }
  });

  it("重复事件幂等", () => {
    const { store, dispose } = makeStore();
    try {
      const payload = {
        attempts: [
          {
            requestId: "r9",
            url: "u",
            attempt: 1,
            ip: "1.1.1.1",
            outcome: "success" as const,
            durationMs: 10,
            at: 1,
          },
        ],
        requests: [
          {
            requestId: "r9",
            url: "u",
            outcome: "success" as const,
            attempts: 1,
            totalDurationMs: 10,
            ipsUsed: ["1.1.1.1"],
            at: 1,
          },
        ],
      };
      store.ingest(payload);
      const second = store.ingest(payload);
      expect(second.accepted.attempts).toBe(0);
      expect(second.accepted.requests).toBe(0);
      expect(second.accepted.duplicates).toBe(2);
      expect(store.snapshot().summary.totalAttempts).toBe(1);
    } finally {
      dispose();
    }
  });

  it("落盘后可回填", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ip-pool-test-"));
    const poolFile = path.join(root, "pool.yaml");
    const dataDir = path.join(root, "data");
    writeFileSync(poolFile, POOL_YAML, "utf8");
    try {
      const store = new IpPoolStore({
        hostname: "kh.google.com",
        poolFile,
        dataDir,
        flushIntervalMs: 0,
        debounceMs: 0,
      });
      store.ingest({
        attempts: [
          {
            requestId: "r3",
            url: "u",
            attempt: 1,
            ip: "1.1.1.2",
            outcome: "success",
            durationMs: 50,
            bytes: 100,
            at: 1,
          },
        ],
      });
      store.flush();

      const file = path.join(dataDir, "kh.google.com.yaml");
      expect(existsSync(file)).toBe(true);
      const doc = parseYaml(readFileSync(file, "utf8")) as {
        ips: Record<string, { requests: number }>;
      };
      expect(doc.ips["1.1.1.2"]!.requests).toBe(1);

      const reloaded = new IpPoolStore({
        hostname: "kh.google.com",
        poolFile,
        dataDir,
        flushIntervalMs: 0,
        debounceMs: 0,
      });
      expect(reloaded.snapshot().rows.find((r) => r.ip === "1.1.1.2")?.requests).toBe(1);

      reloaded.dispose();
      store.dispose();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("IpPoolStore.reset", () => {
  it("清空计数与最近事件、递增 resetEpoch 并落盘", () => {
    const { store, dataDir, dispose } = makeStore();
    try {
      store.ingest({
        attempts: [
          {
            requestId: "r1",
            url: "u",
            attempt: 1,
            ip: "1.1.1.1",
            outcome: "success",
            durationMs: 20,
            bytes: 30,
            at: 1,
          },
        ],
        requests: [
          {
            requestId: "r1",
            url: "u",
            outcome: "success",
            attempts: 1,
            totalDurationMs: 20,
            finalIp: "1.1.1.1",
            ipsUsed: ["1.1.1.1"],
            at: 1,
          },
        ],
      });
      expect(store.snapshot().rows).toHaveLength(1);
      const epochBefore = store.resetEpoch;

      const result = store.reset();

      expect(result.clearedIps).toBe(1);
      expect(store.resetEpoch).toBe(epochBefore + 1);
      const snap = store.snapshot();
      expect(snap.resetEpoch).toBe(epochBefore + 1);
      expect(snap.rows).toHaveLength(0);
      expect(snap.recentRequests).toHaveLength(0);
      expect(snap.recentAttempts).toHaveLength(0);
      expect(snap.recentFlightPaths).toHaveLength(0);
      expect(snap.summary.totalRequests).toBe(0);
      expect(snap.summary.totalAttempts).toBe(0);

      // 落盘后重新加载为空。
      const file = path.join(dataDir, "kh.google.com.yaml");
      expect(existsSync(file)).toBe(true);
      const doc = parseYaml(readFileSync(file, "utf8")) as { ips: Record<string, unknown> };
      expect(Object.keys(doc.ips)).toHaveLength(0);
    } finally {
      dispose();
    }
  });
});
