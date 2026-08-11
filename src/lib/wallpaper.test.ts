import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_SOURCE_SETTINGS,
  DEFAULT_WALLPAPER_SETTINGS,
  applyWallpaperToGhosty,
  downloadWallpaper,
  loadWallpaperSettings,
  saveWallpaperSettings,
  searchWallpapers,
  type WallpaperItem,
} from "./wallpaper";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

vi.mock("./configStore", () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}));

import { readConfig, writeConfig } from "./configStore";

vi.mock("./ghostyText", () => ({
  parseGhostyLines: vi.fn((content: string) => [{ type: "comment", raw: content }]),
  applyGhostyChanges: vi.fn(
    (_lines: unknown, dirty: { set: Map<string, string> }) => {
      const [key, value] = [...dirty.set.entries()][0];
      return `${key} = ${value}`;
    },
  ),
}));

vi.mock("./cmuxConfig", () => ({
  readGhostyConfig: vi.fn(),
  writeGhostyConfig: vi.fn(),
  reloadCmuxConfig: vi.fn(),
  reloadStatusMessage: vi.fn((r: { status: string }) => `msg:${r.status}`),
}));

import { readGhostyConfig, writeGhostyConfig } from "./cmuxConfig";

const mockedReadGhostyConfig = vi.mocked(readGhostyConfig);
const mockedWriteGhostyConfig = vi.mocked(writeGhostyConfig);

describe("wallpaper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searchWallpapers invokes with the query payload", () => {
    mockedInvoke.mockResolvedValue([]);
    const query = { source: "wallhaven", keywords: "anime", random: true };
    void searchWallpapers(query);
    expect(mockedInvoke).toHaveBeenCalledWith("search_wallpapers", { query });
  });

  it("downloadWallpaper invokes with the item payload", () => {
    mockedInvoke.mockResolvedValue("/tmp/wallpaper.jpg");
    const item: WallpaperItem = {
      id: "wallhaven-abc",
      source: "wallhaven",
      thumb_url: "https://thumb",
      full_url: "https://full",
      width: 1920,
      height: 1080,
    };
    void downloadWallpaper(item);
    expect(mockedInvoke).toHaveBeenCalledWith("download_wallpaper", { item });
  });

  it("loadWallpaperSettings merges stored values over defaults", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockResolvedValue({
      proxy: "http://127.0.0.1:8888",
      downloadDir: "/custom",
    });
    const settings = await loadWallpaperSettings();
    expect(readConfig).toHaveBeenCalledWith("wallpaper");
    expect(settings.proxy).toBe("http://127.0.0.1:8888");
    expect(settings.downloadDir).toBe("/custom");
    expect(settings.sources.wallhaven).toEqual(DEFAULT_SOURCE_SETTINGS);
  });

  it("loadWallpaperSettings falls back to defaults when nothing stored", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockResolvedValue(null);
    const settings = await loadWallpaperSettings();
    expect(settings).toEqual(DEFAULT_WALLPAPER_SETTINGS);
  });

  it("loadWallpaperSettings fills only missing keys from defaults", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockResolvedValue({ proxy: "" });
    const settings = await loadWallpaperSettings();
    expect(settings.proxy).toBe("");
    expect(settings.downloadDir).toBe(DEFAULT_WALLPAPER_SETTINGS.downloadDir);
  });

  it("loadWallpaperSettings merges per-source overrides", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockResolvedValue({
      sources: {
        wallhaven: { apiKey: "wh-key", purity: "110" },
      },
    });
    const settings = await loadWallpaperSettings();
    expect(settings.sources.wallhaven.apiKey).toBe("wh-key");
    expect(settings.sources.wallhaven.purity).toBe("110");
    expect(settings.sources.wallhaven.categories).toBe("010");
    expect(settings.sources.danbooru.apiKey).toBe("");
    expect(settings.sources.safebooru.minHeight).toBe("");
  });

  it("saveWallpaperSettings writes the full settings object", async () => {
    mockedInvoke.mockResolvedValue(null);
    const settings = {
      proxy: "http://p",
      downloadDir: "/d",
      sources: DEFAULT_WALLPAPER_SETTINGS.sources,
    };
    await saveWallpaperSettings(settings);
    expect(writeConfig).toHaveBeenCalledWith("wallpaper", settings);
  });

  it("applyWallpaperToGhosty writes background-image and reloads", async () => {
    mockedReadGhostyConfig.mockResolvedValue({
      kind: "ghosty",
      path: "/cfg",
      content: "background-opacity = 0.75\n",
    });
    vi.mocked(writeGhostyConfig).mockResolvedValue(undefined);
    const { reloadCmuxConfig } = await import("./cmuxConfig");
    vi.mocked(reloadCmuxConfig).mockResolvedValue({ status: "success" });

    const result = await applyWallpaperToGhosty("/wall/abc.jpg");

    expect(mockedWriteGhostyConfig).toHaveBeenCalledWith(
      "background-image = /wall/abc.jpg",
    );
    expect(result.imagePath).toBe("/wall/abc.jpg");
    expect(result.reloadMessage).toBe("msg:success");
  });
});
