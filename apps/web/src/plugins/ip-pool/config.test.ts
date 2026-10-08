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
