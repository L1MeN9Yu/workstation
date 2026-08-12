import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WallpaperTool from "./wallpaper";
import {
  applyWallpaperToGhosty,
  downloadWallpaper,
  fetchWallpaperThumb,
  loadWallpaperSettings,
  saveWallpaperSettings,
  searchWallpapers,
} from "../../lib/wallpaper";

vi.mock("../../lib/wallpaper", () => ({
  applyWallpaperToGhosty: vi.fn(),
  downloadWallpaper: vi.fn(),
  fetchWallpaperThumb: vi.fn(),
  loadWallpaperSettings: vi.fn(),
  saveWallpaperSettings: vi.fn(),
  searchWallpapers: vi.fn(),
}));

function setup(container: HTMLElement): Root {
  const root = createRoot(container);
  act(() => {
    root.render(<WallpaperTool />);
  });
  return root;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("WallpaperTool", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadWallpaperSettings).mockResolvedValue({
      proxy: "http://127.0.0.1:7890",
      downloadDir: "",
      sources: {
        wallhaven: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
        },
        danbooru: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
        },
        safebooru: {
          apiKey: "",
          login: "",
          categories: "",
          purity: "",
          minWidth: "1920",
          minHeight: "",
          rating: "",
        },
      },
    });
    vi.mocked(searchWallpapers).mockResolvedValue([]);
    vi.mocked(fetchWallpaperThumb).mockResolvedValue("data:image/jpeg;base64,AAAA");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = setup(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("renders source tabs, search input and empty placeholder", async () => {
    await flush();
    expect(container.textContent).toContain("wallhaven");
    expect(container.textContent).toContain("Danbooru");
    expect(container.textContent).toContain("Safebooru");
    expect(container.textContent).toContain("搜索壁纸以预览");
  });

  it("shows only the selected source homepage link and switches on tab change", async () => {
    await flush();
    let link = container.querySelector("a[href='https://wallhaven.cc']");
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("官网");
    expect(container.querySelector("a[href='https://danbooru.donmai.us']")).toBeNull();
    expect(container.querySelector("a[href='https://safebooru.org']")).toBeNull();

    const danbooruTab = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Danbooru",
    )!;
    act(() => {
      danbooruTab.click();
    });
    link = container.querySelector("a[href='https://danbooru.donmai.us']");
    expect(link).not.toBeNull();
    expect(container.querySelector("a[href='https://wallhaven.cc']")).toBeNull();
  });

  it("searches with keywords and renders result grid", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        full_url: "https://full.example/a.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    await flush();
    const input = Array.from(container.querySelectorAll("input")).find(
      (i) => i.placeholder === "关键词，如 anime、landscape",
    )!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "anime");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    expect(searchWallpapers).toHaveBeenCalledWith({
      source: "wallhaven",
      keywords: "anime",
      random: false,
      page: 1,
    });
    expect(container.textContent).toContain("1920×1080");
  });

  it("shows thumb via proxied fetch and renders failure fallback", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        full_url: "https://full.example/a.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    await flush();
    const searchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "搜索",
    )!;
    await act(async () => {
      searchBtn.click();
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");

    vi.mocked(fetchWallpaperThumb).mockRejectedValue(new Error("proxy down"));
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-xyz",
        source: "wallhaven",
        thumb_url: "https://thumb.example/x.jpg",
        full_url: "https://full.example/x.jpg",
        width: 2560,
        height: 1440,
      },
    ]);
    await act(async () => {
      searchBtn.click();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("加载失败");
  });

  it("random button passes empty keywords with random true", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([]);
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const randomBtn = buttons.find((b) => b.textContent === "随机")!;
    await act(async () => {
      randomBtn.click();
    });
    expect(searchWallpapers).toHaveBeenCalledWith({
      source: "wallhaven",
      keywords: "",
      random: true,
      page: 1,
    });
  });

  it("shows source error when search fails", async () => {
    vi.mocked(searchWallpapers).mockRejectedValue(new Error("timeout"));
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    expect(container.textContent).toContain("搜索失败");
    expect(container.textContent).toContain("timeout");
  });

  it("shows empty-result message when nothing found", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([]);
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    expect(container.textContent).toContain("没有找到满足条件的壁纸");
  });

  it("loads more results appending page 2 items", async () => {
    vi.mocked(searchWallpapers).mockResolvedValueOnce([
      {
        id: "wallhaven-a",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        full_url: "https://full.example/a.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    vi.mocked(searchWallpapers).mockResolvedValueOnce([
      {
        id: "wallhaven-b",
        source: "wallhaven",
        thumb_url: "https://thumb.example/b.jpg",
        full_url: "https://full.example/b.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    await flush();
    const searchBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "搜索",
    )!;
    await act(async () => {
      searchBtn.click();
    });
    expect(searchWallpapers).toHaveBeenLastCalledWith({
      source: "wallhaven",
      keywords: "",
      random: false,
      page: 1,
    });
    expect(container.textContent).toContain("加载更多");

    const moreBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "加载更多",
    )!;
    await act(async () => {
      moreBtn.click();
    });
    expect(searchWallpapers).toHaveBeenLastCalledWith({
      source: "wallhaven",
      keywords: "",
      random: false,
      page: 2,
    });
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute("src")).toBe(
      "data:image/jpeg;base64,AAAA",
    );
  });

  it("downloads and applies wallpaper on button click", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        full_url: "https://full.example/a.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    vi.mocked(downloadWallpaper).mockResolvedValue("/wall/abc.jpg");
    vi.mocked(applyWallpaperToGhosty).mockResolvedValue({
      imagePath: "/wall/abc.jpg",
      reloadMessage: "配置已重新加载，cmux 已生效",
    });
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    const applyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "下载并应用",
    )!;
    await act(async () => {
      applyBtn.click();
    });
    expect(downloadWallpaper).toHaveBeenCalledWith(
      expect.objectContaining({ id: "wallhaven-abc" }),
    );
    expect(applyWallpaperToGhosty).toHaveBeenCalledWith("/wall/abc.jpg");
    expect(container.textContent).toContain("已下载并应用");
  });

  it("shows failure message when apply errors", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "danbooru-1",
        source: "danbooru",
        thumb_url: "https://t/a.jpg",
        full_url: "https://f/a.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    vi.mocked(downloadWallpaper).mockRejectedValue(new Error("disk full"));
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    const applyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "下载并应用",
    )!;
    await act(async () => {
      applyBtn.click();
    });
    expect(container.textContent).toContain("应用失败");
    expect(container.textContent).toContain("disk full");
  });

  it("saves global settings via settings panel", async () => {
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const settingsBtn = buttons.find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    expect(container.textContent).toContain("统一设置");
    expect(container.textContent).toContain("代理地址");
    expect(container.textContent).toContain("下载目录");
    expect(container.textContent).not.toContain("Danbooru 参数");
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "保存设置",
    )!;
    await act(async () => {
      saveBtn.click();
    });
    expect(saveWallpaperSettings).toHaveBeenCalledWith({
      proxy: "http://127.0.0.1:7890",
      downloadDir: "",
      sources: {
        wallhaven: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
        },
        danbooru: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
        },
        safebooru: {
          apiKey: "",
          login: "",
          categories: "",
          purity: "",
          minWidth: "1920",
          minHeight: "",
          rating: "",
        },
      },
    });
    expect(container.textContent).toContain("设置已保存");
  });

  it("exposes the selected source settings outside the settings panel", async () => {
    await flush();
    expect(container.textContent).toContain("wallhaven 参数");
    expect(container.textContent).toContain("API Key");
    expect(container.textContent).toContain("purity");
    expect(container.textContent).toContain("categories");
    expect(container.textContent).toContain("最小宽度");
    expect(container.textContent).toContain("最小高度");
    expect(container.textContent).not.toContain("Danbooru 参数");
    expect(container.textContent).not.toContain("Safebooru 参数");

    const danbooruTab = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Danbooru",
    )!;
    await act(async () => {
      danbooruTab.click();
    });
    expect(container.textContent).toContain("Danbooru 参数");
    expect(container.textContent).toContain("用户名");
    expect(container.textContent).toContain("rating");
    expect(container.textContent).not.toContain("wallhaven 参数");
    expect(container.textContent).not.toContain("最小高度");
  });

  it("edits exposed source settings and saves them via panel", async () => {
    await flush();
    const inputs = Array.from(container.querySelectorAll("input"));
    const apiKeyInput = inputs.find((i) =>
      i.placeholder.includes("wallhaven 设置页"),
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(apiKeyInput, "wh-secret");
      apiKeyInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const buttons = Array.from(container.querySelectorAll("button"));
    const settingsBtn = buttons.find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "保存设置",
    )!;
    await act(async () => {
      saveBtn.click();
    });
    expect(saveWallpaperSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: expect.objectContaining({
          wallhaven: expect.objectContaining({ apiKey: "wh-secret" }),
        }),
      }),
    );
  });
});
