import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  HISTORY_PAGE_SIZE,
  addWallpaperHistory,
  clearWallpaperHistory,
  deleteWallpaperHistory,
  listWallpaperHistory,
} from "./wallpaperHistory";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

describe("wallpaperHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the page size constant", () => {
    expect(HISTORY_PAGE_SIZE).toBe(8);
  });

  it("listWallpaperHistory invokes with source/page/pageSize and passes the page through", async () => {
    const page = {
      total: 3,
      page: 1,
      pageSize: 8,
      items: [
        { source: "wallhaven", keyword: "anime", updatedAt: 300 },
        { source: "wallhaven", keyword: "landscape", updatedAt: 200 },
        { source: "wallhaven", keyword: "city", updatedAt: 100 },
      ],
    };
    mockedInvoke.mockResolvedValue(page);
    const result = await listWallpaperHistory("wallhaven", 1, 8);
    expect(invoke).toHaveBeenCalledWith("list_wallpaper_history", {
      source: "wallhaven",
      page: 1,
      pageSize: 8,
    });
    expect(result).toEqual(page);
  });

  it("listWallpaperHistory propagates rejections", async () => {
    mockedInvoke.mockRejectedValue(new Error("db locked"));
    await expect(
      listWallpaperHistory("wallhaven", 2, 8),
    ).rejects.toThrow("db locked");
  });

  it("addWallpaperHistory invokes with source and keyword", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await addWallpaperHistory("danbooru", "scenery");
    expect(invoke).toHaveBeenCalledWith("add_wallpaper_history", {
      source: "danbooru",
      keyword: "scenery",
    });
  });

  it("addWallpaperHistory propagates rejections", async () => {
    mockedInvoke.mockRejectedValue(new Error("write failed"));
    await expect(
      addWallpaperHistory("danbooru", "scenery"),
    ).rejects.toThrow("write failed");
  });

  it("deleteWallpaperHistory invokes with source and keyword", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await deleteWallpaperHistory("safebooru", "landscape");
    expect(invoke).toHaveBeenCalledWith("delete_wallpaper_history", {
      source: "safebooru",
      keyword: "landscape",
    });
  });

  it("deleteWallpaperHistory propagates rejections", async () => {
    mockedInvoke.mockRejectedValue(new Error("delete failed"));
    await expect(
      deleteWallpaperHistory("safebooru", "landscape"),
    ).rejects.toThrow("delete failed");
  });

  it("clearWallpaperHistory invokes with source", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    await clearWallpaperHistory("wallhaven");
    expect(invoke).toHaveBeenCalledWith("clear_wallpaper_history", {
      source: "wallhaven",
    });
  });

  it("clearWallpaperHistory propagates rejections", async () => {
    mockedInvoke.mockRejectedValue(new Error("clear failed"));
    await expect(clearWallpaperHistory("wallhaven")).rejects.toThrow(
      "clear failed",
    );
  });
});
