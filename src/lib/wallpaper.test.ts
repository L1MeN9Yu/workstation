import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  BIT_GROUPS,
  DEFAULT_SOURCE_SETTINGS,
  DEFAULT_WALLPAPER_SETTINGS,
  applyWallpaperToGhosty,
  bitsToSelections,
  downloadWallpaper,
  generateSeed,
  loadWallpaperSettings,
  saveWallpaperProxy,
  saveWallpaperSources,
  searchWallpapers,
  selectionsToBits,
  thumbUrl,
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
    expect(mockedInvoke).toHaveBeenCalledWith("search_wallpapers", {
      query,
      settings: undefined,
    });
  });

  it("searchWallpapers passes settings for live UI search", () => {
    mockedInvoke.mockResolvedValue([]);
    const query = { source: "wallhaven", keywords: "", random: true };
    const settings = {
      proxy: "http://127.0.0.1:7890",
      downloadDir: "",
      sources: {
        wallhaven: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "010",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
        },
      },
    };
    void searchWallpapers(query, settings);
    expect(mockedInvoke).toHaveBeenCalledWith("search_wallpapers", {
      query,
      settings,
    });
  });

  it("downloadWallpaper invokes with the item payload", () => {
    mockedInvoke.mockResolvedValue("/tmp/wallpaper.jpg");
    const item: WallpaperItem = {
      id: "wallhaven-abc",
      source: "wallhaven",
      thumb_url: "https://thumb",
      thumb_hash: "0123456789abcdef",
      full_url: "https://full",
      width: 1920,
      height: 1080,
    };
    void downloadWallpaper(item);
    expect(mockedInvoke).toHaveBeenCalledWith("download_wallpaper", { item });
  });

  it("thumbUrl builds the thumb protocol url", () => {
    expect(thumbUrl("0123456789abcdef")).toBe("thumb://0123456789abcdef");
  });

  it("loadWallpaperSettings merges stored values over defaults", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockImplementation(async (key: string) => {
      if (key === "wallpaper") {
        return { proxy: "http://127.0.0.1:8888", downloadDir: "/custom" };
      }
      return null;
    });
    const settings = await loadWallpaperSettings();
    expect(readConfig).toHaveBeenCalledWith("wallpaper");
    expect(readConfig).toHaveBeenCalledWith("wallpaperSources");
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
    vi.mocked(readConfig).mockImplementation(async (key: string) => {
      if (key === "wallpaper") return { proxy: "" };
      return null;
    });
    const settings = await loadWallpaperSettings();
    expect(settings.proxy).toBe("");
    expect(settings.downloadDir).toBe(DEFAULT_WALLPAPER_SETTINGS.downloadDir);
  });

  it("loadWallpaperSettings merges per-source overrides from wallpaperSources", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockImplementation(async (key: string) => {
      if (key === "wallpaperSources") {
        return {
          sources: {
            wallhaven: { apiKey: "wh-key", purity: "110", seed: "custom-seed" },
          },
        };
      }
      return null;
    });
    const settings = await loadWallpaperSettings();
    expect(settings.sources.wallhaven.apiKey).toBe("wh-key");
    expect(settings.sources.wallhaven.purity).toBe("110");
    expect(settings.sources.wallhaven.seed).toBe("custom-seed");
    expect(settings.sources.wallhaven.categories).toBe("010");
    expect(settings.sources.danbooru.apiKey).toBe("");
    expect(settings.sources.safebooru.minHeight).toBe("");
  });

  it("loadWallpaperSettings falls back to legacy wallpaper.sources", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockImplementation(async (key: string) => {
      if (key === "wallpaper") {
        return {
          proxy: "",
          sources: {
            wallhaven: { categories: "111" },
          },
        };
      }
      return null;
    });
    const settings = await loadWallpaperSettings();
    expect(settings.sources.wallhaven.categories).toBe("111");
  });

  it("saveWallpaperProxy writes only proxy and downloadDir", async () => {
    mockedInvoke.mockResolvedValue(null);
    await saveWallpaperProxy({ proxy: "http://p", downloadDir: "/d" });
    expect(writeConfig).toHaveBeenCalledWith("wallpaper", {
      proxy: "http://p",
      downloadDir: "/d",
    });
  });

  it("saveWallpaperSources writes sources to wallpaperSources key", async () => {
    mockedInvoke.mockResolvedValue(null);
    await saveWallpaperSources(DEFAULT_WALLPAPER_SETTINGS.sources);
    expect(writeConfig).toHaveBeenCalledWith("wallpaperSources", {
      sources: DEFAULT_WALLPAPER_SETTINGS.sources,
    });
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

  describe("位标记编解码", () => {
    const groups = BIT_GROUPS.categories;

    it("bitsToSelections decodes by position order", () => {
      expect(bitsToSelections("010", groups)).toEqual(["Anime"]);
      expect(bitsToSelections("001", groups)).toEqual(["People"]);
      expect(bitsToSelections("101", groups)).toEqual(["General", "People"]);
    });

    it("bitsToSelections treats non-1 characters as unchecked", () => {
      expect(bitsToSelections("12x", groups)).toEqual(["General"]);
      expect(bitsToSelections("abc", groups)).toEqual([]);
    });

    it("bitsToSelections returns empty set for empty string", () => {
      expect(bitsToSelections("", groups)).toEqual([]);
    });

    it("bitsToSelections ignores characters beyond group length", () => {
      expect(bitsToSelections("1111", groups)).toEqual([
        "General",
        "Anime",
        "People",
      ]);
    });

    it("selectionsToBits encodes selection set in position order", () => {
      expect(selectionsToBits(["General", "Anime"], groups)).toBe("110");
      expect(selectionsToBits(["People"], groups)).toBe("001");
    });

    it("selectionsToBits outputs 000 when nothing selected", () => {
      expect(selectionsToBits([], groups)).toBe("000");
    });

    it("selectionsToBits ignores unknown keys", () => {
      expect(selectionsToBits(["Foo"], groups)).toBe("000");
    });

    it("purity groups use 3 positions", () => {
      expect(selectionsToBits(["SFW", "NSFW"], BIT_GROUPS.purity)).toBe("101");
      expect(bitsToSelections("100", BIT_GROUPS.purity)).toEqual(["SFW"]);
    });
  });

  describe("generateSeed", () => {
    it("returns alphanumeric lowercase string of given length", () => {
      const seed = generateSeed();
      expect(seed).toMatch(/^[a-z0-9]{12}$/);
      const short = generateSeed(4);
      expect(short).toMatch(/^[a-z0-9]{4}$/);
    });

    it("returns different values across calls", () => {
      expect(generateSeed()).not.toBe(generateSeed());
    });
  });
});
