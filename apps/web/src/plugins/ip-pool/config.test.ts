import { afterEach, describe, expect, it } from "vitest";
import { fetchConfig } from "./config";

describe("fetchConfig.autoWarm", () => {
  const prev = process.env.IP_POOL_AUTO_WARM;
  afterEach(() => {
    if (prev === undefined) delete process.env.IP_POOL_AUTO_WARM;
    else process.env.IP_POOL_AUTO_WARM = prev;
  });

  it("默认开启整池预热", () => {
    delete process.env.IP_POOL_AUTO_WARM;
    expect(fetchConfig().autoWarm).toBe(true);
  });

  it("IP_POOL_AUTO_WARM=0 时关闭", () => {
    process.env.IP_POOL_AUTO_WARM = "0";
    expect(fetchConfig().autoWarm).toBe(false);
  });
});

describe("fetchConfig 派发默认值", () => {
  it("默认并发 1024 / 超时 4000ms，可用环境变量覆盖", () => {
    delete process.env.IP_POOL_DISPATCH_CONCURRENCY;
    delete process.env.IP_POOL_DISPATCH_TIMEOUT_MS;
    expect(fetchConfig().dispatchConcurrency).toBe(1024);
    expect(fetchConfig().dispatchTimeoutMs).toBe(4000);

    process.env.IP_POOL_DISPATCH_CONCURRENCY = "1500";
    process.env.IP_POOL_DISPATCH_TIMEOUT_MS = "3000";
    expect(fetchConfig().dispatchConcurrency).toBe(1500);
    expect(fetchConfig().dispatchTimeoutMs).toBe(3000);

    delete process.env.IP_POOL_DISPATCH_CONCURRENCY;
    delete process.env.IP_POOL_DISPATCH_TIMEOUT_MS;
  });
});
