import { describe, expect, it } from "vitest";
import { buildUpstreamUrl, EARTH_RT_BASE } from "./rocktree";

describe("buildUpstreamUrl", () => {
  it("planetoid → {base}/PlanetoidMetadata", () => {
    expect(buildUpstreamUrl({ kind: "planetoid" })).toBe(`${EARTH_RT_BASE}/PlanetoidMetadata`);
    expect(buildUpstreamUrl({ kind: "planetoid", base: "https://x/rt/earth" })).toBe(
      "https://x/rt/earth/PlanetoidMetadata",
    );
  });

  it("bulk → {base}/BulkMetadata/pb=!1m2!1s{path}!2u{epoch}", () => {
    expect(buildUpstreamUrl({ kind: "bulk", path: "1015", epoch: 42 })).toBe(
      `${EARTH_RT_BASE}/BulkMetadata/pb=!1m2!1s1015!2u42`,
    );
  });

  it("raw → 原样 url", () => {
    expect(buildUpstreamUrl({ kind: "raw", url: "https://a/b" })).toBe("https://a/b");
  });

  it("缺参数抛错", () => {
    expect(() => buildUpstreamUrl({ kind: "bulk", epoch: 1 })).toThrow("path");
    expect(() => buildUpstreamUrl({ kind: "bulk", path: "1" })).toThrow("epoch");
    expect(() => buildUpstreamUrl({ kind: "raw" })).toThrow("url");
  });
});
