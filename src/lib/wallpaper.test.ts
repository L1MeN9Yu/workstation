import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  BIT_GROUPS,
  DEFAULT_SOURCE_SETTINGS,
  DEFAULT_WALLPAPER_SETTINGS,
  RATIO_OPTIONS,
  applyWallpaper,
  applyWallpaperToGhosty,
  applyWallpaperToIt,
  bitsToSelections,
  downloadWallpaper,
  generateSeed,
  loadWallpaperSettings,
  previewWallpaper,
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

vi.mock("./iterm2Config", () => ({
  listIterm2Profiles: vi.fn(),
  writeIterm2Profile: vi.fn(),
  reloadIterm2Config: vi.fn(),
  reloadStatusMessage: vi.fn((r: { status: string }) => `iterm-msg:${r.status}`),
}));

import { readGhostyConfig, writeGhostyConfig } from "./cmuxConfig";
import {
  listIterm2Profiles,
  reloadIterm2Config,
  writeIterm2Profile,
} from "./iterm2Config";

const mockedReadGhostyConfig = vi.mocked(readGhostyConfig);
const mockedWriteGhostyConfig = vi.mocked(writeGhostyConfig);
const mockedListIterm2Profiles = vi.mocked(listIterm2Profiles);
const mockedWriteIterm2Profile = vi.mocked(writeIterm2Profile);
const mockedReloadIterm2Config = vi.mocked(reloadIterm2Config);

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
      downloadDir: "",
      defaultApplyTarget: "cmux" as const,
      iterm2Profile: "",
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
          ratios: "",
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

  it("previewWallpaper invokes fetch_full_image and returns the data url", async () => {
    mockedInvoke.mockResolvedValue("data:image/jpeg;base64,AAAA");
    const item: WallpaperItem = {
      id: "wallhaven-preview",
      source: "wallhaven",
      thumb_url: "https://thumb",
      thumb_hash: "fedcba9876543210",
      full_url: "https://full",
      width: 1920,
      height: 1080,
    };
    const url = await previewWallpaper(item);
    expect(mockedInvoke).toHaveBeenCalledWith("fetch_full_image", { item });
    expect(url).toBe("data:image/jpeg;base64,AAAA");
  });

  it("previewWallpaper propagates invoke failures", async () => {
    mockedInvoke.mockRejectedValue(new Error("fetch failed"));
    const item: WallpaperItem = {
      id: "wallhaven-preview",
      source: "wallhaven",
      thumb_url: "https://thumb",
      thumb_hash: "fedcba9876543210",
      full_url: "https://full",
      width: 1920,
      height: 1080,
    };
    await expect(previewWallpaper(item)).rejects.toThrow("fetch failed");
  });

  it("loadWallpaperSettings merges stored values over defaults", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockImplementation(async (key: string) => {
      if (key === "wallpaper") {
        return {
          downloadDir: "/custom",
          defaultApplyTarget: "iterm2",
          iterm2Profile: "work.json",
        };
      }
      return null;
    });
    const settings = await loadWallpaperSettings();
    expect(readConfig).toHaveBeenCalledWith("wallpaper");
    expect(readConfig).toHaveBeenCalledWith("wallpaperSources");
    expect(settings.downloadDir).toBe("/custom");
    expect(settings.defaultApplyTarget).toBe("iterm2");
    expect(settings.iterm2Profile).toBe("work.json");
    expect(settings.sources.wallhaven).toEqual(DEFAULT_SOURCE_SETTINGS);
  });

  it("loadWallpaperSettings defaults apply target when not stored", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockResolvedValue(null);
    const settings = await loadWallpaperSettings();
    expect(settings.defaultApplyTarget).toBe("cmux");
    expect(settings.iterm2Profile).toBe("");
  });

  it("loadWallpaperSettings falls back to defaults when nothing stored", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockResolvedValue(null);
    const settings = await loadWallpaperSettings();
    expect(settings).toEqual(DEFAULT_WALLPAPER_SETTINGS);
  });

  it("loadWallpaperSettings fills only missing keys from defaults", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockResolvedValue(null);
    const settings = await loadWallpaperSettings();
    expect(settings.downloadDir).toBe(DEFAULT_WALLPAPER_SETTINGS.downloadDir);
  });

  it("loadWallpaperSettings merges per-source overrides from wallpaperSources", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockImplementation(async (key: string) => {
      if (key === "wallpaperSources") {
        return {
          sources: {
            wallhaven: {
              apiKey: "wh-key",
              purity: "110",
              seed: "custom-seed",
              ratios: "16x9,21x9",
            },
          },
        };
      }
      return null;
    });
    const settings = await loadWallpaperSettings();
    expect(settings.sources.wallhaven.apiKey).toBe("wh-key");
    expect(settings.sources.wallhaven.purity).toBe("110");
    expect(settings.sources.wallhaven.seed).toBe("custom-seed");
    expect(settings.sources.wallhaven.ratios).toBe("16x9,21x9");
    expect(settings.sources.wallhaven.categories).toBe("010");
    expect(settings.sources.danbooru.apiKey).toBe("");
    expect(settings.sources.safebooru.minHeight).toBe("");
  });

  it("loadWallpaperSettings fills default ratios for legacy sources without it", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockImplementation(async (key: string) => {
      if (key === "wallpaperSources") {
        return { sources: { wallhaven: { apiKey: "wh-key" } } };
      }
      return null;
    });
    const settings = await loadWallpaperSettings();
    expect(settings.sources.wallhaven.apiKey).toBe("wh-key");
    expect(settings.sources.wallhaven.ratios).toBe("");
  });

  it("RATIO_OPTIONS exposes common wallhaven ratios", () => {
    expect(RATIO_OPTIONS).toContain("16x9");
    expect(RATIO_OPTIONS).toContain("21x9");
    expect(RATIO_OPTIONS).toContain("9x16");
  });

  it("default ratios is an empty string", () => {
    expect(DEFAULT_SOURCE_SETTINGS.ratios).toBe("");
  });

  it("loadWallpaperSettings falls back to legacy wallpaper.sources", async () => {
    mockedInvoke.mockResolvedValue(null);
    vi.mocked(readConfig).mockImplementation(async (key: string) => {
      if (key === "wallpaper") {
        return {
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

  it("saveWallpaperProxy writes downloadDir and apply target", async () => {
    mockedInvoke.mockResolvedValue(null);
    await saveWallpaperProxy({
      downloadDir: "/d",
      defaultApplyTarget: "iterm2",
      iterm2Profile: "work.json",
    });
    expect(writeConfig).toHaveBeenCalledWith("wallpaper", {
      downloadDir: "/d",
      defaultApplyTarget: "iterm2",
      iterm2Profile: "work.json",
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
    expect(result.target).toBe("cmux");
    expect(result.reloadMessage).toBe("msg:success");
  });

  it("applyWallpaper cmux target delegates to ghosty without profile", async () => {
    mockedReadGhostyConfig.mockResolvedValue({
      kind: "ghosty",
      path: "/cfg",
      content: "",
    });
    vi.mocked(writeGhostyConfig).mockResolvedValue(undefined);
    const { reloadCmuxConfig } = await import("./cmuxConfig");
    vi.mocked(reloadCmuxConfig).mockResolvedValue({ status: "success" });

    const result = await applyWallpaper("/wall/a.jpg", "cmux");
    expect(result.target).toBe("cmux");
    expect(result.reloadMessage).toBe("msg:success");
    expect(mockedWriteGhostyConfig).toHaveBeenCalled();
    expect(mockedListIterm2Profiles).not.toHaveBeenCalled();
  });

  it("applyWallpaper iterm2 target requires a profile name", async () => {
    await expect(applyWallpaper("/wall/a.jpg", "iterm2")).rejects.toThrow(
      "需指定 Profile",
    );
    expect(mockedListIterm2Profiles).not.toHaveBeenCalled();
  });

  it("applyWallpaper iterm2 target delegates with the profile name", async () => {
    mockedListIterm2Profiles.mockResolvedValue([
      { name: "p.json", path: "/dir/p.json", content: '{"Name":"p"}' },
    ]);
    vi.mocked(writeIterm2Profile).mockResolvedValue(undefined);
    vi.mocked(reloadIterm2Config).mockResolvedValue({ status: "success" });

    const result = await applyWallpaper("/wall/it.jpg", "iterm2", "p.json");
    expect(mockedWriteIterm2Profile).toHaveBeenCalledWith(
      "p.json",
      '{"Name":"p","Background Image Location":"/wall/it.jpg"}',
    );
    expect(result.target).toBe("iterm2");
    expect(result.reloadMessage).toBe("iterm-msg:success");
  });

  it("applyWallpaper rejects unknown targets", async () => {
    await expect(
      applyWallpaper("/wall/a.jpg", "nope" as never),
    ).rejects.toThrow("未知的应用目标");
  });

  it("applyWallpaperToIt writes Background Image Location and reloads", async () => {
    mockedListIterm2Profiles.mockResolvedValue([
      {
        name: "work.json",
        path: "/dir/work.json",
        content: '{"Name":"work","Foreground Color":[0.9,0.9,0.9,1]}',
      },
    ]);
    vi.mocked(writeIterm2Profile).mockResolvedValue(undefined);
    vi.mocked(reloadIterm2Config).mockResolvedValue({ status: "success" });

    const result = await applyWallpaperToIt("/wall/it.jpg", "work.json");

    expect(mockedWriteIterm2Profile).toHaveBeenCalledWith(
      "work.json",
      JSON.stringify({
        Name: "work",
        "Foreground Color": [0.9, 0.9, 0.9, 1],
        "Background Image Location": "/wall/it.jpg",
      }),
    );
    expect(mockedReloadIterm2Config).toHaveBeenCalled();
    expect(result).toEqual({
      imagePath: "/wall/it.jpg",
      target: "iterm2",
      reloadMessage: "iterm-msg:success",
    });
  });

  it("applyWallpaperToIt adds the key when profile has none", async () => {
    mockedListIterm2Profiles.mockResolvedValue([
      { name: "empty.json", path: "/dir/empty.json", content: '{"Name":"x"}' },
    ]);
    vi.mocked(writeIterm2Profile).mockResolvedValue(undefined);
    vi.mocked(reloadIterm2Config).mockResolvedValue({
      status: "mechanismUnavailable",
    });

    const result = await applyWallpaperToIt("/wall/it.jpg", "empty.json");
    expect(mockedWriteIterm2Profile).toHaveBeenCalledWith(
      "empty.json",
      '{"Name":"x","Background Image Location":"/wall/it.jpg"}',
    );
    expect(result.reloadMessage).toBe("iterm-msg:mechanismUnavailable");
  });

  it("applyWallpaperToIt writes into Profiles[0] for exported format", async () => {
    mockedListIterm2Profiles.mockResolvedValue([
      {
        name: "exported.json",
        path: "/dir/exported.json",
        content: '{"Profiles":[{"Guid":"g1","Name":"work","Window Type":0}]}',
      },
    ]);
    vi.mocked(writeIterm2Profile).mockResolvedValue(undefined);
    vi.mocked(reloadIterm2Config).mockResolvedValue({ status: "success" });

    const result = await applyWallpaperToIt("/wall/it.jpg", "exported.json");
    expect(mockedWriteIterm2Profile).toHaveBeenCalledWith(
      "exported.json",
      JSON.stringify({
        Profiles: [
          {
            Guid: "g1",
            Name: "work",
            "Window Type": 0,
            "Background Image Location": "/wall/it.jpg",
          },
        ],
      }),
    );
    expect(result.target).toBe("iterm2");
    expect(mockedReloadIterm2Config).toHaveBeenCalled();
  });

  it("applyWallpaperToIt fails on empty Profiles list", async () => {
    mockedListIterm2Profiles.mockResolvedValue([
      { name: "nop.json", path: "/dir/nop.json", content: '{"Profiles":[]}' },
    ]);
    await expect(applyWallpaperToIt("/wall/it.jpg", "nop.json")).rejects.toThrow(
      "Profiles 列表为空",
    );
    expect(mockedWriteIterm2Profile).not.toHaveBeenCalled();
  });

  it("applyWallpaperToIt fails when Profiles[0] is not an object", async () => {
    mockedListIterm2Profiles.mockResolvedValue([
      { name: "bad.json", path: "/dir/bad.json", content: '{"Profiles":["x"]}' },
    ]);
    await expect(applyWallpaperToIt("/wall/it.jpg", "bad.json")).rejects.toThrow(
      "Profiles[0] 不是 JSON 对象",
    );
    expect(mockedWriteIterm2Profile).not.toHaveBeenCalled();
  });

  it("applyWallpaperToIt fails when profile does not exist", async () => {
    mockedListIterm2Profiles.mockResolvedValue([
      { name: "a.json", path: "/dir/a.json", content: "{}" },
    ]);
    await expect(applyWallpaperToIt("/wall/it.jpg", "ghost")).rejects.toThrow(
      "iTerm2 Profile 不存在",
    );
    expect(mockedWriteIterm2Profile).not.toHaveBeenCalled();
    expect(mockedReloadIterm2Config).not.toHaveBeenCalled();
  });

  it("applyWallpaperToIt fails on invalid JSON without writing", async () => {
    mockedListIterm2Profiles.mockResolvedValue([
      { name: "bad.json", path: "/dir/bad.json", content: "not json" },
    ]);
    await expect(applyWallpaperToIt("/wall/it.jpg", "bad.json")).rejects.toThrow(
      "JSON 解析失败",
    );
    expect(mockedWriteIterm2Profile).not.toHaveBeenCalled();
    expect(mockedReloadIterm2Config).not.toHaveBeenCalled();
  });

  it("applyWallpaperToIt fails when profile content is not an object", async () => {
    mockedListIterm2Profiles.mockResolvedValue([
      { name: "arr.json", path: "/dir/arr.json", content: "[1,2]" },
    ]);
    await expect(applyWallpaperToIt("/wall/it.jpg", "arr.json")).rejects.toThrow(
      "不是 JSON 对象",
    );
    expect(mockedWriteIterm2Profile).not.toHaveBeenCalled();
  });

  it("applyWallpaperToIt propagates write and reload failures", async () => {
    mockedListIterm2Profiles.mockResolvedValue([
      { name: "p.json", path: "/dir/p.json", content: "{}" },
    ]);
    vi.mocked(writeIterm2Profile).mockRejectedValue(new Error("disk full"));
    await expect(applyWallpaperToIt("/wall/it.jpg", "p.json")).rejects.toThrow(
      "disk full",
    );
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
