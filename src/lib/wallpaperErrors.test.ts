import { describe, expect, it } from "vitest";
import {
  classifySearchError,
  describeSearchError,
} from "./wallpaperErrors";

describe("classifySearchError", () => {
  it("classifies parse failures", () => {
    expect(classifySearchError("wallhaven response parse failed: EOF")).toBe(
      "parse",
    );
  });

  it("classifies HTTP 429 as rate limited", () => {
    expect(classifySearchError("wallhaven request failed with HTTP 429")).toBe(
      "http429",
    );
  });

  it("classifies other 4xx as rejected", () => {
    expect(classifySearchError("danbooru request failed with HTTP 403")).toBe(
      "http4xx",
    );
  });

  it("classifies 5xx as server error", () => {
    expect(classifySearchError("safebooru request failed with HTTP 503")).toBe(
      "http5xx",
    );
  });

  it("classifies transport failures as network", () => {
    expect(
      classifySearchError(
        "wallhaven request failed: error sending request for url (...)",
      ),
    ).toBe("network");
  });

  it("treats a non-4xx/5xx HTTP status as a network-class failure", () => {
    expect(classifySearchError("wallhaven request failed with HTTP 302")).toBe(
      "network",
    );
  });

  it("classifies anything else as unknown", () => {
    expect(classifySearchError("boom")).toBe("unknown");
  });
});

describe("describeSearchError", () => {
  it("gives network guidance for transport failures", () => {
    const text = describeSearchError(
      "wallhaven",
      "wallhaven request failed: connection refused",
    );
    expect(text).toContain("检查网络或代理设置");
    expect(text).toContain("connection refused");
  });

  it("advises retry for HTTP 429", () => {
    const text = describeSearchError("wallhaven", "wallhaven request failed with HTTP 429");
    expect(text).toContain("请求过于频繁");
    expect(text).not.toContain("连接失败");
  });

  it("suggests auth for other 4xx", () => {
    const text = describeSearchError("danbooru", "danbooru request failed with HTTP 403");
    expect(text).toContain("请求被拒绝");
    expect(text).toContain("API Key");
  });

  it("advises retry for 5xx", () => {
    const text = describeSearchError("safebooru", "safebooru request failed with HTTP 500");
    expect(text).toContain("服务端错误");
  });

  it("explains parse failures", () => {
    const text = describeSearchError("wallhaven", "wallhaven response parse failed: EOF");
    expect(text).toContain("解析失败");
  });

  it("falls back to a generic message for unknown errors", () => {
    const text = describeSearchError("wallhaven", "boom");
    expect(text).toBe("图源 wallhaven 搜索失败：boom");
  });
});
