import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  DEFAULT_CACHE_LIMIT_BYTES,
  MAX_CACHE_LIMIT_BYTES,
  MIN_CACHE_LIMIT_BYTES,
  getCacheSettings,
  normalizeCacheLimit,
  saveCacheSettings,
} from "./cacheSettings";
import { readConfig, writeConfig } from "./configStore";
import { invoke } from "@tauri-apps/api/core";

vi.mock("./configStore", () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedRead = vi.mocked(readConfig);
const mockedWrite = vi.mocked(writeConfig);
const mockedInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeCacheLimit", () => {
  it("defaults when value missing or not a number", () => {
    expect(normalizeCacheLimit(undefined)).toBe(DEFAULT_CACHE_LIMIT_BYTES);
    expect(normalizeCacheLimit(Number.NaN)).toBe(DEFAULT_CACHE_LIMIT_BYTES);
    expect(normalizeCacheLimit(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_CACHE_LIMIT_BYTES,
    );
  });

  it("clamps to range", () => {
    expect(normalizeCacheLimit(1)).toBe(MIN_CACHE_LIMIT_BYTES);
    expect(normalizeCacheLimit(999 * 1024 * 1024 * 1024)).toBe(
      MAX_CACHE_LIMIT_BYTES,
    );
  });

  it("rounds to integer bytes", () => {
    expect(normalizeCacheLimit(5 * 1024 * 1024 * 1024 + 0.4)).toBe(
      5 * 1024 * 1024 * 1024,
    );
    expect(normalizeCacheLimit(5 * 1024 * 1024 * 1024 + 0.6)).toBe(
      5 * 1024 * 1024 * 1024 + 1,
    );
  });
});

describe("getCacheSettings", () => {
  it("returns default when config read fails", async () => {
    mockedRead.mockRejectedValueOnce(new Error("invoke failed"));
    expect(await getCacheSettings()).toBe(DEFAULT_CACHE_LIMIT_BYTES);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("returns configured app-level value directly", async () => {
    mockedRead.mockResolvedValueOnce({ cacheLimitBytes: 10 * 1024 * 1024 * 1024 });
    expect(await getCacheSettings()).toBe(10 * 1024 * 1024 * 1024);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("clamps out-of-range app-level value", async () => {
    mockedRead.mockResolvedValueOnce({ cacheLimitBytes: 1 });
    expect(await getCacheSettings()).toBe(MIN_CACHE_LIMIT_BYTES);
  });

  it("migrates legacy wallpaper cache limit and clears wallpaper field", async () => {
    mockedRead
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        cacheLimitBytes: 80 * 1024 * 1024 * 1024,
        downloadDir: "/tmp",
      });
    expect(await getCacheSettings()).toBe(80 * 1024 * 1024 * 1024);
    expect(mockedWrite).toHaveBeenCalledWith("appCache", {
      cacheLimitBytes: 80 * 1024 * 1024 * 1024,
    });
    expect(mockedWrite).toHaveBeenCalledWith("wallpaper", { downloadDir: "/tmp" });
  });

  it("does not migrate when wallpaper has no cache limit", async () => {
    mockedRead
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ downloadDir: "/tmp" });
    expect(await getCacheSettings()).toBe(DEFAULT_CACHE_LIMIT_BYTES);
    expect(mockedWrite).not.toHaveBeenCalled();
  });

  it("falls back to default when wallpaper read fails", async () => {
    mockedRead
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("read failed"));
    expect(await getCacheSettings()).toBe(DEFAULT_CACHE_LIMIT_BYTES);
    expect(mockedWrite).not.toHaveBeenCalled();
  });
});

describe("saveCacheSettings", () => {
  it("writes normalized value", async () => {
    await saveCacheSettings(30 * 1024 * 1024 * 1024);
    expect(mockedWrite).toHaveBeenCalledWith("appCache", {
      cacheLimitBytes: 30 * 1024 * 1024 * 1024,
    });
  });

  it("writes clamped value for out-of-range input", async () => {
    await saveCacheSettings(999 * 1024 * 1024 * 1024);
    expect(mockedWrite).toHaveBeenCalledWith("appCache", {
      cacheLimitBytes: MAX_CACHE_LIMIT_BYTES,
    });
    await saveCacheSettings(1);
    expect(mockedWrite).toHaveBeenCalledWith("appCache", {
      cacheLimitBytes: MIN_CACHE_LIMIT_BYTES,
    });
  });

  it("propagates write errors", async () => {
    mockedWrite.mockRejectedValueOnce(new Error("write failed"));
    await expect(saveCacheSettings(10 * 1024 * 1024 * 1024)).rejects.toThrow(
      "write failed",
    );
  });
});

describe("getCacheStats / clearCache", () => {
  it("getCacheStats invokes wallpaper cache stats command", async () => {
    const stats = {
      totalBytes: 100,
      thumbBytes: 40,
      fullBytes: 60,
      limitBytes: DEFAULT_CACHE_LIMIT_BYTES,
    };
    mockedInvoke.mockResolvedValueOnce(stats);
    const result = await import("./cacheSettings").then((m) => m.getCacheStats());
    expect(result).toEqual(stats);
    expect(mockedInvoke).toHaveBeenCalledWith("get_wallpaper_cache_stats");
  });

  it("clearCache invokes clear wallpaper cache command", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await import("./cacheSettings").then((m) => m.clearCache());
    expect(mockedInvoke).toHaveBeenCalledWith("clear_wallpaper_cache");
  });
});
