import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WallpaperTool from "./wallpaper";
import {
  applyWallpaperToGhosty,
  downloadWallpaper,
  loadWallpaperSettings,
  saveWallpaperSettings,
  searchWallpapers,
} from "../../lib/wallpaper";

vi.mock("../../lib/wallpaper", () => ({
  applyWallpaperToGhosty: vi.fn(),
  downloadWallpaper: vi.fn(),
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
    const input = container.querySelector("input")!;
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
    });
    expect(container.textContent).toContain("1920×1080");
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

  it("saves settings via settings panel", async () => {
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const settingsBtn = buttons.find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    expect(container.textContent).toContain("代理地址");
    expect(container.textContent).toContain("wallhaven 参数");
    expect(container.textContent).not.toContain("Danbooru 参数");
    expect(container.textContent).not.toContain("Safebooru 参数");
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

  it("shows only the selected source settings in panel", async () => {
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const danbooruTab = buttons.find((b) => b.textContent === "Danbooru")!;
    await act(async () => {
      danbooruTab.click();
    });
    const settingsBtn = buttons.find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    expect(container.textContent).toContain("Danbooru 参数");
    expect(container.textContent).toContain("用户名");
    expect(container.textContent).toContain("API Key");
    expect(container.textContent).toContain("rating");
    expect(container.textContent).not.toContain("wallhaven 参数");
    expect(container.textContent).not.toContain("Safebooru 参数");
    expect(container.textContent).not.toContain("最小高度");
  });

  it("edits per-source field and saves it", async () => {
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const settingsBtn = buttons.find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    const inputs = Array.from(container.querySelectorAll("input"));
    const apiKeyInput = inputs.find((i) => i.placeholder.includes("wallhaven 设置页"))!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(apiKeyInput, "wh-secret");
      apiKeyInput.dispatchEvent(new Event("input", { bubbles: true }));
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
