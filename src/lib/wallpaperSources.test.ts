import { describe, expect, it } from "vitest";
import {
  WALLPAPER_SOURCES,
  getSourceMeta,
  isKnownSource,
} from "./wallpaperSources";

describe("wallpaperSources", () => {
  it("exposes the three configured sources", () => {
    expect(WALLPAPER_SOURCES.map((s) => s.id)).toEqual([
      "wallhaven",
      "danbooru",
      "safebooru",
    ]);
  });

  it("marks random support per source", () => {
    const wallhaven = getSourceMeta("wallhaven");
    expect(wallhaven?.supportsRandom).toBe(true);
    const safebooru = getSourceMeta("safebooru");
    expect(safebooru?.supportsRandom).toBe(false);
  });

  it("exposes the official homepage per source", () => {
    expect(WALLPAPER_SOURCES.map((s) => s.homepage)).toEqual([
      "https://wallhaven.cc",
      "https://danbooru.donmai.us",
      "https://safebooru.org",
    ]);
  });

  it("getSourceMeta returns undefined for unknown source", () => {
    expect(getSourceMeta("nope")).toBeUndefined();
  });

  it("isKnownSource validates registered ids", () => {
    expect(isKnownSource("danbooru")).toBe(true);
    expect(isKnownSource("unsplash")).toBe(false);
  });
});
