import { describe, expect, it } from "vitest";
import { absoluteUrl, firstForwarded, publicOrigin } from "./public-origin";

const LOCAL = "http://localhost:3000";

describe("firstForwarded", () => {
  it("取首个值并去空白", () => {
    expect(firstForwarded("https, http")).toBe("https");
    expect(firstForwarded("  panel.example.com  ")).toBe("panel.example.com");
  });

  it("空值 → undefined", () => {
    expect(firstForwarded("")).toBeUndefined();
    expect(firstForwarded("   ")).toBeUndefined();
    expect(firstForwarded(null)).toBeUndefined();
    expect(firstForwarded(undefined)).toBeUndefined();
  });
});

describe("publicOrigin", () => {
  it("优先 x-forwarded-host + x-forwarded-proto（反代场景）", () => {
    const headers = new Headers({
      "x-forwarded-host": "tile1.spacexway.com",
      "x-forwarded-proto": "https",
    });
    expect(publicOrigin(headers, LOCAL)).toBe("https://tile1.spacexway.com");
  });

  it("无 x-forwarded-host 时回退到 host", () => {
    const headers = new Headers({ host: "panel.example.com", "x-forwarded-proto": "https" });
    expect(publicOrigin(headers, LOCAL)).toBe("https://panel.example.com");
  });

  it("无转发协议时按回退 origin 推断 scheme", () => {
    const headers = new Headers({ host: "panel.example.com" });
    expect(publicOrigin(headers, "https://internal")).toBe("https://panel.example.com");
    expect(publicOrigin(headers, LOCAL)).toBe("http://panel.example.com");
  });

  	it("无任何 host → 返回回退 origin", () => {
    expect(publicOrigin(new Headers(), LOCAL)).toBe(LOCAL);
  });

  it("逗号分隔的转发头只取首个", () => {
    const headers = new Headers({
      "x-forwarded-host": "tile1.spacexway.com, internal",
      "x-forwarded-proto": "https, http",
    });
    expect(publicOrigin(headers, LOCAL)).toBe("https://tile1.spacexway.com");
  });
});

describe("absoluteUrl", () => {
  it("正常拼接", () => {
    expect(absoluteUrl("/login", "https://tile1.spacexway.com", LOCAL).href).toBe(
      "https://tile1.spacexway.com/login",
    );
  });

  it("origin 非法时回退", () => {
    expect(absoluteUrl("/login", "http://bad host", LOCAL).href).toBe("http://localhost:3000/login");
  });
});
