import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WallpaperTool from "./wallpaper";
import {
  applyWallpaper,
  clearWallpaperCache,
  downloadWallpaper,
  getWallpaperCacheStats,
  hasWallpaperFullCache,
  listLocalWallpapers,
  loadWallpaperSettings,
  previewWallpaper,
  saveWallpaperProxy,
  saveWallpaperSources,
  searchWallpapers,
  type WallpaperItem,
} from "../../lib/wallpaper";
import { listIterm2Profiles } from "../../lib/iterm2Config";
import { toast } from "../../lib/toast";

const { readyCallbackRef } = vi.hoisted(() => ({
  readyCallbackRef: { current: () => {} },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, cb: () => void) => {
    readyCallbackRef.current = cb;
    return Promise.resolve(() => {});
  }),
}));

vi.mock("../../lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("../../lib/iterm2Config", () => ({
  listIterm2Profiles: vi.fn(),
}));

vi.mock("../../lib/wallpaper", () => ({
  RATIO_OPTIONS: ["16x9", "16x10", "21x9", "32x9", "48x27", "9x16", "10x16", "9x21"],
  BIT_GROUPS: {
    categories: [
      { key: "General", label: "综合" },
      { key: "Anime", label: "动漫" },
      { key: "People", label: "人物" },
    ],
    purity: [
      { key: "SFW", label: "SFW" },
      { key: "Sketchy", label: "Sketchy" },
      { key: "NSFW", label: "NSFW" },
    ],
  },
  bitsToSelections: (value: string, groups: { key: string }[]) =>
    groups
      .map((g, i) => (value[i] === "1" ? g.key : ""))
      .filter((k) => k !== ""),
  selectionsToBits: (selected: string[], groups: { key: string }[]) =>
    groups.map((g) => (selected.includes(g.key) ? "1" : "0")).join(""),
  generateSeed: vi.fn(() => "mockedseed1234"),
  applyWallpaper: vi.fn(),
  downloadWallpaper: vi.fn(),
  listLocalWallpapers: vi.fn(),
  fetchWallpaperThumb: vi.fn().mockResolvedValue("data:image/jpeg;base64,thumb"),
  readLocalWallpaperFile: vi.fn(),
  deleteLocalWallpapers: vi.fn(),
  formatFileSize: (bytes: number) => `${bytes}B`,
  formatModifiedTime: (ms: number) => `t${ms}`,
  loadWallpaperSettings: vi.fn(),
  previewWallpaper: vi.fn(),
  hasWallpaperFullCache: vi.fn().mockResolvedValue(false),
  getWallpaperCacheStats: vi.fn().mockResolvedValue({
    totalBytes: 1000,
    thumbBytes: 300,
    fullBytes: 700,
    limitBytes: 50 * 1024 * 1024 * 1024,
  }),
  clearWallpaperCache: vi.fn().mockResolvedValue(undefined),
  saveWallpaperProxy: vi.fn().mockResolvedValue(undefined),
  saveWallpaperSources: vi.fn().mockResolvedValue(undefined),
  searchWallpapers: vi.fn(),
  thumbUrl: (hash: string) => `thumb://${hash}`,
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

const PREVIEW_ITEM: WallpaperItem = {
  id: "wallhaven-preview",
  source: "wallhaven",
  thumb_url: "https://thumb.example/a.jpg",
  thumb_hash: "aaaaaaaaaaaaaaaa",
  full_url: "https://full.example/a.jpg",
  width: 1920,
  height: 1080,
};

const PREVIEW_ITEM_2: WallpaperItem = {
  id: "wallhaven-second",
  source: "wallhaven",
  thumb_url: "https://thumb.example/b.jpg",
  thumb_hash: "bbbbbbbbbbbbbbbb",
  full_url: "https://full.example/b.jpg",
  width: 2560,
  height: 1440,
};

describe("WallpaperTool", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listIterm2Profiles).mockResolvedValue([
      { name: "work.json", path: "/dir/work.json", content: "{}" },
      { name: "home.json", path: "/dir/home.json", content: "{}" },
    ]);
    vi.mocked(loadWallpaperSettings).mockResolvedValue({
      downloadDir: "",
      defaultApplyTarget: "cmux",
      iterm2Profile: "",
  cacheLimitBytes: 50 * 1024 * 1024 * 1024,
      sources: {
        wallhaven: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "",
        },
        danbooru: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "",
        },
        safebooru: {
          apiKey: "",
          login: "",
          categories: "",
          purity: "",
          minWidth: "1920",
          minHeight: "",
          rating: "",
          seed: "",
          ratios: "",
        },
      },
    });
    vi.mocked(searchWallpapers).mockResolvedValue([]);
    vi.mocked(hasWallpaperFullCache).mockResolvedValue(false);
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
        thumb_hash: "aaaaaaaaaaaaaaaa",
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
    expect(searchWallpapers).toHaveBeenCalledWith(
      {
        source: "wallhaven",
        keywords: "anime",
        random: false,
        page: 1,
      },
      expect.objectContaining({
        sources: expect.objectContaining({
          wallhaven: expect.objectContaining({ purity: "100" }),
        }),
      }),
    );
    expect(container.textContent).toContain("1920×1080");
    const card = container.querySelector(".overflow-hidden.rounded-lg")!;
    const actionBar = Array.from(card.querySelectorAll("div")).find(
      (d) =>
        d.className.includes("flex-wrap") &&
        d.textContent?.includes("下载并应用"),
    )!;
    expect(actionBar.className).toContain("flex-wrap");
    expect(actionBar.className).toContain("gap-y-1");
  });

  it("renders thumb via protocol url", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        thumb_hash: "0123456789abcdef",
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
    expect(img?.getAttribute("src")).toBe("thumb://0123456789abcdef");
  });

  it("shows skeleton placeholder until thumb image loads", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        thumb_hash: "0123456789abcdef",
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
    const img = container.querySelector("img")!;
    expect(container.querySelector('div[role="status"]')).not.toBeNull();
    expect(img.className).toContain("opacity-0");
    act(() => {
      img.dispatchEvent(new Event("load"));
    });
    expect(container.querySelector('div[role="status"]')).toBeNull();
    expect(img.className).toContain("opacity-100");
  });

  it("refreshes thumbs when thumb-ready event fires", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        thumb_hash: "0123456789abcdef",
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
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "thumb://0123456789abcdef",
    );
    act(() => {
      readyCallbackRef.current();
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "thumb://0123456789abcdef?r=0&v=1",
    );
  });

  it("shows failure placeholder after retries exhausted and supports manual retry", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(searchWallpapers).mockResolvedValue([
        {
          id: "wallhaven-xyz",
          source: "wallhaven",
          thumb_url: "https://thumb.example/x.jpg",
          thumb_hash: "fedcba9876543210",
          full_url: "https://full.example/x.jpg",
          width: 2560,
          height: 1440,
        },
      ]);
      await flush();
      const searchBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "搜索",
      )!;
      await act(async () => {
        searchBtn.click();
      });
      let img = container.querySelector("img")!;
      for (let i = 1; i <= 6; i += 1) {
        act(() => {
          img.dispatchEvent(new Event("error"));
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
        img = container.querySelector("img")!;
        expect(img.getAttribute("src")).toContain(`?r=${i}`);
      }
      act(() => {
        img.dispatchEvent(new Event("error"));
      });
      expect(container.textContent).toContain("加载失败，点击重试");

      const retryBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "加载失败，点击重试",
      )!;
      act(() => {
        retryBtn.click();
      });
      const img2 = container.querySelector("img");
      expect(img2).not.toBeNull();
      expect(img2?.getAttribute("src")).toContain("thumb://fedcba9876543210");
      act(() => {
        img2?.dispatchEvent(new Event("load"));
      });
      expect(container.textContent).not.toContain("加载失败，点击重试");
    } finally {
      vi.useRealTimers();
    }
  });

  it("random button passes empty keywords with random true", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([]);
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const randomBtn = buttons.find((b) => b.textContent === "随机")!;
    await act(async () => {
      randomBtn.click();
    });
    expect(searchWallpapers).toHaveBeenCalledWith(
      {
        source: "wallhaven",
        keywords: "",
        random: true,
        page: 1,
      },
      expect.anything(),
    );
  });

  it("shows a network error with proxy guidance when search fails to connect", async () => {
    vi.mocked(searchWallpapers).mockRejectedValue(
      new Error("wallhaven request failed: error sending request"),
    );
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    expect(container.textContent).toContain("连接失败");
    expect(container.textContent).toContain("检查网络或代理设置");
    expect(container.textContent).toContain("error sending request");
  });

  it("shows a generic error without proxy guidance for HTTP failures", async () => {
    vi.mocked(searchWallpapers).mockRejectedValue(
      new Error("wallhaven request failed with HTTP 429"),
    );
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    expect(container.textContent).toContain("请求过于频繁");
    expect(container.textContent).not.toContain("检查网络或代理设置");
  });

  it("shows empty-result message when nothing found", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([]);
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    expect(toast.info).toHaveBeenCalledWith(
      "没有找到匹配的壁纸，试试更换关键词或图源",
    );
    expect(container.textContent).not.toContain("没有找到匹配的壁纸");
  });

  it("loads more results appending page 2 items", async () => {
    vi.mocked(searchWallpapers).mockResolvedValueOnce([
      {
        id: "wallhaven-a",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        thumb_hash: "bbbbbbbbbbbbbbbb",
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
        thumb_hash: "cccccccccccccccc",
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
    expect(searchWallpapers).toHaveBeenLastCalledWith(
      {
        source: "wallhaven",
        keywords: "",
        random: false,
        page: 1,
      },
      expect.anything(),
    );
    expect(container.textContent).toContain("加载更多");

    const moreBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "加载更多",
    )!;
    await act(async () => {
      moreBtn.click();
    });
    expect(searchWallpapers).toHaveBeenLastCalledWith(
      {
        source: "wallhaven",
        keywords: "",
        random: false,
        page: 2,
      },
      expect.anything(),
    );
    const imgs = container.querySelectorAll("img");
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute("src")).toContain("thumb://bbbbbbbbbbbbbbbb");
  });

  it("downloads and applies wallpaper on button click", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        thumb_hash: "dddddddddddddddd",
        full_url: "https://full.example/a.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    vi.mocked(downloadWallpaper).mockResolvedValue("/wall/abc.jpg");
    vi.mocked(applyWallpaper).mockResolvedValue({
      imagePath: "/wall/abc.jpg",
      target: "cmux",
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
    expect(applyWallpaper).toHaveBeenCalledWith("/wall/abc.jpg", "cmux", "");
    expect(toast.success).toHaveBeenCalledWith(
      "已下载并应用到 cmux：/wall/abc.jpg。配置已重新加载，cmux 已生效",
    );
    expect(container.textContent).not.toContain("已下载并应用到 cmux");
  });

  /** 单次应用目标下拉 */
  function findTargetSelect(): HTMLSelectElement {
    return container.querySelector(
      'select[aria-label="应用目标"]',
    ) as HTMLSelectElement;
  }

  /** 通过原生 setter 修改受控 select 并派发 change */
  async function selectOption(
    select: HTMLSelectElement,
    value: string,
  ): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )!.set!;
      setter.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("switching target for one apply does not change the persisted default", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        thumb_hash: "dddddddddddddddd",
        full_url: "https://full.example/a.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    vi.mocked(downloadWallpaper).mockResolvedValue("/wall/abc.jpg");
    vi.mocked(applyWallpaper).mockResolvedValue({
      imagePath: "/wall/abc.jpg",
      target: "iterm2",
      reloadMessage: "iTerm2 已重新加载配置",
    });
    vi.mocked(loadWallpaperSettings).mockResolvedValue({
      downloadDir: "",
      defaultApplyTarget: "cmux",
      iterm2Profile: "work.json",
  cacheLimitBytes: 50 * 1024 * 1024 * 1024,
      sources: {
        wallhaven: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "",
        },
        danbooru: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "",
        },
        safebooru: {
          apiKey: "",
          login: "",
          categories: "",
          purity: "",
          minWidth: "1920",
          minHeight: "",
          rating: "",
          seed: "",
          ratios: "",
        },
      },
    });
    act(() => {
      root.unmount();
    });
    root = setup(container);
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    await selectOption(findTargetSelect(), "iterm2");
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    const applyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "下载并应用",
    )!;
    await act(async () => {
      applyBtn.click();
    });
    expect(applyWallpaper).toHaveBeenCalledWith(
      "/wall/abc.jpg",
      "iterm2",
      "work.json",
    );
    const settingsBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    const targetLabel = Array.from(
      container.querySelectorAll("label"),
    ).find((l) => l.textContent?.includes("默认应用目标"))!;
    expect(
      (targetLabel.querySelector("select") as HTMLSelectElement).value,
    ).toBe("cmux");
  });

  it("applies to iterm2 when the stored default target is iterm2", async () => {
    vi.mocked(loadWallpaperSettings).mockResolvedValue({
      downloadDir: "",
      defaultApplyTarget: "iterm2",
      iterm2Profile: "work.json",
  cacheLimitBytes: 50 * 1024 * 1024 * 1024,
      sources: {
        wallhaven: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "",
        },
        danbooru: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "",
        },
        safebooru: {
          apiKey: "",
          login: "",
          categories: "",
          purity: "",
          minWidth: "1920",
          minHeight: "",
          rating: "",
          seed: "",
          ratios: "",
        },
      },
    });
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        thumb_hash: "dddddddddddddddd",
        full_url: "https://full.example/a.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    vi.mocked(downloadWallpaper).mockResolvedValue("/wall/it.jpg");
    vi.mocked(applyWallpaper).mockResolvedValue({
      imagePath: "/wall/it.jpg",
      target: "iterm2",
      reloadMessage: "iTerm2 已重新加载配置",
    });
    act(() => {
      root.unmount();
    });
    root = setup(container);
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    expect(findTargetSelect().value).toBe("iterm2");
    const applyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "下载并应用",
    )!;
    await act(async () => {
      applyBtn.click();
    });
    expect(applyWallpaper).toHaveBeenCalledWith(
      "/wall/it.jpg",
      "iterm2",
      "work.json",
    );
    expect(toast.success).toHaveBeenCalledWith(
      "已下载并应用到 iTerm2：/wall/it.jpg。iTerm2 已重新加载配置",
    );
  });

  it("prompts to pick an iterm2 profile when none is configured", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        thumb_hash: "dddddddddddddddd",
        full_url: "https://full.example/a.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const searchBtn = buttons.find((b) => b.textContent === "搜索")!;
    await act(async () => {
      searchBtn.click();
    });
    await selectOption(findTargetSelect(), "iterm2");
    const applyBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "下载并应用",
    )!;
    await act(async () => {
      applyBtn.click();
    });
    expect(downloadWallpaper).not.toHaveBeenCalled();
    expect(applyWallpaper).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "未选择 iTerm2 目标 Profile，请在上方设置中选择后再应用",
    );
    expect(container.textContent).toContain("统一设置");
    expect(container.textContent).toContain("请选择 Profile");
  });

  it("shows failure message when applyWallpaper errors", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        thumb_hash: "dddddddddddddddd",
        full_url: "https://full.example/a.jpg",
        width: 1920,
        height: 1080,
      },
    ]);
    vi.mocked(downloadWallpaper).mockResolvedValue("/wall/x.jpg");
    vi.mocked(applyWallpaper).mockRejectedValue(new Error("reload boom"));
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
    expect(toast.error).toHaveBeenCalledWith("应用失败：Error: reload boom");
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("shows failure message when apply errors", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "danbooru-1",
        source: "danbooru",
        thumb_url: "https://t/a.jpg",
        thumb_hash: "eeeeeeeeeeeeeeee",
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
    expect(toast.error).toHaveBeenCalledWith("应用失败：Error: disk full");
  });

  it("saves global settings via settings panel", async () => {
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const settingsBtn = buttons.find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    expect(container.textContent).toContain("统一设置");
    expect(container.textContent).not.toContain("代理地址");
    expect(container.textContent).toContain("下载目录");
    expect(container.textContent).not.toContain("Danbooru 参数");
    expect(container.textContent).not.toContain("打开日志目录");
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "保存设置",
    )!;
    await act(async () => {
      saveBtn.click();
    });
    expect(saveWallpaperProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        downloadDir: "",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("设置已保存");
    expect(container.textContent).not.toContain("设置已保存");
  });

  it("settings panel renders apply target and iterm2 profile selects with loaded profiles", async () => {
    await flush();
    const settingsBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    const labels = Array.from(container.querySelectorAll("label"));
    const targetLabel = labels.find((l) =>
      l.textContent?.includes("默认应用目标"),
    )!;
    expect(
      (targetLabel.querySelector("select") as HTMLSelectElement).value,
    ).toBe("cmux");
    const profileLabel = labels.find((l) =>
      l.textContent?.includes("iTerm2 目标 Profile"),
    )!;
    const options = Array.from(profileLabel.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toEqual(["", "work.json", "home.json"]);
  });

  it("saves changed apply target and profile via settings panel", async () => {
    await flush();
    const settingsBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    const labels = Array.from(container.querySelectorAll("label"));
    const targetLabel = labels.find((l) =>
      l.textContent?.includes("默认应用目标"),
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )!.set!;
      setter.call(targetLabel.querySelector("select"), "iterm2");
      targetLabel
        .querySelector("select")!
        .dispatchEvent(new Event("change", { bubbles: true }));
    });
    const profileLabel = labels.find((l) =>
      l.textContent?.includes("iTerm2 目标 Profile"),
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )!.set!;
      setter.call(profileLabel.querySelector("select"), "home.json");
      profileLabel
        .querySelector("select")!
        .dispatchEvent(new Event("change", { bubbles: true }));
    });
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "保存设置",
    )!;
    await act(async () => {
      saveBtn.click();
    });
    expect(saveWallpaperProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultApplyTarget: "iterm2",
        iterm2Profile: "home.json",
      }),
    );
  });

  it("settings panel shows cache stats and saves adjusted cache limit", async () => {
    await flush();
    const settingsBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    await flush();
    expect(container.textContent).toContain("壁纸缓存");
    // beforeEach 默认 mock：total=1000, thumb=300, full=700, limit=50GB
    expect(container.textContent).toContain("已用 1000B / 上限 53687091200B");
    expect(container.textContent).toContain("缩略图 300B");
    expect(container.textContent).toContain("原图 700B");
    const label = Array.from(container.querySelectorAll("label")).find((l) =>
      l.textContent?.includes("缓存容量上限"),
    )!;
    const input = label.querySelector("input")! as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "80");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "保存设置",
    )!;
    await act(async () => {
      saveBtn.click();
    });
    expect(saveWallpaperProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheLimitBytes: 80 * 1024 * 1024 * 1024,
      }),
    );
  });

  it("clear cache requires confirmation and clears on confirm", async () => {
    await flush();
    const settingsBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    await flush();
    const clearBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "清空缓存",
    )!;
    await act(async () => {
      clearBtn.click();
    });
    expect(container.textContent).toContain("不影响已下载壁纸");
    expect(clearWallpaperCache).not.toHaveBeenCalled();
    const confirmBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "确认清空",
    )!;
    await act(async () => {
      confirmBtn.click();
    });
    await flush();
    expect(clearWallpaperCache).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("缓存已清空");
    expect(getWallpaperCacheStats).toHaveBeenCalled();
  });

  it("clear cache can be cancelled without clearing", async () => {
    await flush();
    const settingsBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent === "设置")!;
    await act(async () => {
      settingsBtn.click();
    });
    const clearBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "清空缓存",
    )!;
    await act(async () => {
      clearBtn.click();
    });
    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "取消",
    )!;
    await act(async () => {
      cancelBtn.click();
    });
    expect(clearWallpaperCache).not.toHaveBeenCalled();
  });

  it("exposes the selected source settings outside the settings panel", async () => {
    await flush();
    expect(container.textContent).toContain("wallhaven 参数");
    expect(container.textContent).toContain("API Key");
    expect(container.textContent).toContain("purity");
    expect(container.textContent).toContain("categories");
    expect(container.textContent).toContain("ratios");
    expect(container.textContent).not.toContain("最小宽度");
    expect(container.textContent).not.toContain("最小高度");
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

  it("edits source params and auto-saves them debounced", async () => {
    vi.useFakeTimers();
    try {
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
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(saveWallpaperSources).toHaveBeenCalledWith(
        expect.objectContaining({
          wallhaven: expect.objectContaining({ apiKey: "wh-secret" }),
        }),
      );
      expect(toast.success).toHaveBeenCalledWith("参数已自动保存");
      expect(container.textContent).not.toContain("参数已自动保存");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders categories as checkboxes reflecting the stored bit string", async () => {
    await flush();
    const checkboxes = Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    );
    const labels = Array.from(container.querySelectorAll("label"));
    const animeLabel = labels.find((l) =>
      l.textContent?.includes("动漫"),
    )!;
    const generalLabel = labels.find((l) =>
      l.textContent?.includes("综合"),
    )!;
    expect(checkboxes).toHaveLength(14);
    expect(animeLabel.querySelector("input")!.checked).toBe(true);
    expect(generalLabel.querySelector("input")!.checked).toBe(false);
  });

  it("encodes checkbox selections back to the bit string on save", async () => {
    vi.useFakeTimers();
    try {
      await flush();
      const labels = Array.from(container.querySelectorAll("label"));
      const generalLabel = labels.find((l) =>
        l.textContent?.includes("综合"),
      )!;
      await act(async () => {
        generalLabel.querySelector("input")!.click();
      });
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(saveWallpaperSources).toHaveBeenCalledWith(
        expect.objectContaining({
          wallhaven: expect.objectContaining({ categories: "110" }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders ratios as multiselect checkboxes", async () => {
    await flush();
    expect(container.textContent).toContain("ratios");
    expect(container.textContent).toContain("16x9");
    expect(container.textContent).toContain("21x9");
    const labels = Array.from(container.querySelectorAll("label"));
    const ratioLabels = labels.filter((l) =>
      ["16x9", "21x9", "9x16"].some((r) => l.textContent?.includes(r)),
    );
    expect(ratioLabels).toHaveLength(3);
    expect(
      ratioLabels.every((l) => !l.querySelector("input")!.checked),
    ).toBe(true);
  });

  it("writes checked ratios back as comma-joined string on save", async () => {
    vi.useFakeTimers();
    try {
      await flush();
      const labels = Array.from(container.querySelectorAll("label"));
      const ratioLabels = labels.filter((l) =>
        ["16x9", "21x9"].some((r) => l.textContent === r),
      );
      expect(ratioLabels).toHaveLength(2);
      for (const l of ratioLabels) {
        await act(async () => {
          l.querySelector("input")!.click();
        });
      }
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(saveWallpaperSources).toHaveBeenCalledWith(
        expect.objectContaining({
          wallhaven: expect.objectContaining({ ratios: "16x9,21x9" }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reflects stored ratios back to checked state", async () => {
    vi.mocked(loadWallpaperSettings).mockResolvedValue({
      downloadDir: "",
      defaultApplyTarget: "cmux",
      iterm2Profile: "",
  cacheLimitBytes: 50 * 1024 * 1024 * 1024,
      sources: {
        wallhaven: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "16x9,9x16",
        },
        danbooru: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "",
        },
        safebooru: {
          apiKey: "",
          login: "",
          categories: "",
          purity: "",
          minWidth: "1920",
          minHeight: "",
          rating: "",
          seed: "",
          ratios: "",
        },
      },
    });
    act(() => {
      root.unmount();
    });
    root = setup(container);
    await flush();
    const labels = Array.from(container.querySelectorAll("label"));
    const checked = labels
      .filter((l) => l.querySelector("input")?.checked)
      .map((l) => l.textContent?.trim());
    expect(checked).toContain("16x9");
    expect(checked).toContain("9x16");
    expect(checked).not.toContain("21x9");
  });

  it("unchecking all ratios clears the stored value", async () => {
    vi.mocked(loadWallpaperSettings).mockResolvedValue({
      downloadDir: "",
      defaultApplyTarget: "cmux",
      iterm2Profile: "",
  cacheLimitBytes: 50 * 1024 * 1024 * 1024,
      sources: {
        wallhaven: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "16x9,21x9",
        },
        danbooru: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "100",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "",
        },
        safebooru: {
          apiKey: "",
          login: "",
          categories: "",
          purity: "",
          minWidth: "1920",
          minHeight: "",
          rating: "",
          seed: "",
          ratios: "",
        },
      },
    });
    vi.useFakeTimers();
    try {
      act(() => {
        root.unmount();
      });
      root = setup(container);
      await flush();
      const labels = Array.from(container.querySelectorAll("label"));
      const checkedLabels = labels.filter(
        (l) => l.querySelector("input")?.checked,
      );
      for (const l of checkedLabels) {
        await act(async () => {
          l.querySelector("input")!.click();
        });
      }
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
      expect(saveWallpaperSources).toHaveBeenCalledWith(
        expect.objectContaining({
          wallhaven: expect.objectContaining({ ratios: "" }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects unchecking the last category option with an inline hint", async () => {
    vi.mocked(loadWallpaperSettings).mockResolvedValue({
      downloadDir: "",
      defaultApplyTarget: "cmux",
      iterm2Profile: "",
  cacheLimitBytes: 50 * 1024 * 1024 * 1024,
      sources: {
        wallhaven: {
          apiKey: "",
          login: "",
          categories: "010",
          purity: "000",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "",
        },
        danbooru: {
          apiKey: "",
          login: "",
          categories: "000",
          purity: "000",
          minWidth: "1920",
          minHeight: "1080",
          rating: "safe",
          seed: "",
          ratios: "",
        },
        safebooru: {
          apiKey: "",
          login: "",
          categories: "000",
          purity: "000",
          minWidth: "1920",
          minHeight: "",
          rating: "",
          seed: "",
          ratios: "",
        },
      },
    });
    await flush();
    const labels = Array.from(container.querySelectorAll("label"));
    const animeLabel = labels.find((l) =>
      l.textContent?.includes("动漫"),
    )!;
    await act(async () => {
      animeLabel.querySelector("input")!.click();
    });
    expect(container.textContent).toContain("至少需勾选一项");
    const inputs = Array.from(
      container.querySelectorAll('input[type="checkbox"]'),
    );
    expect(
      labels.find((l) => l.textContent?.includes("动漫"))!.querySelector(
        "input",
      )!.checked,
    ).toBe(true);
    expect(inputs[1]).not.toBe(null);
  });

  it("renders rating as a select with an unlimited option", async () => {
    await flush();
    const danbooruTab = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Danbooru",
    )!;
    await act(async () => {
      danbooruTab.click();
    });
    const select = container.querySelector("select")!;
    expect(select).not.toBe(null);
    const options = Array.from(select.querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).toEqual(["safe", "questionable", "explicit", ""]);
    expect(container.textContent).toContain("不限");
  });

  it("filters negative values in number inputs", async () => {
    await flush();
    const safebooruTab = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Safebooru",
    )!;
    await act(async () => {
      safebooruTab.click();
    });
    const numberInputs = Array.from(
      container.querySelectorAll('input[type="number"]'),
    );
    expect(numberInputs.length).toBeGreaterThan(0);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(numberInputs[0], "-5");
      numberInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((numberInputs[0] as HTMLInputElement).value).toBe("1920");
  });

  it("renders a seed input with refresh button for wallhaven", async () => {
    await flush();
    const seedInput = Array.from(container.querySelectorAll("input")).find(
      (i) => i.placeholder.includes("随机搜索种子"),
    )!;
    expect(seedInput).not.toBe(undefined);
    const refreshBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent === "刷新")!;
    expect(refreshBtn).not.toBe(undefined);
    expect(container.textContent).toContain("随机搜索的种子");
  });

  it("refresh button generates a new seed and saves it automatically", async () => {
    await flush();
    const refreshBtn = Array.from(
      container.querySelectorAll("button"),
    ).find((b) => b.textContent === "刷新")!;
    await act(async () => {
      refreshBtn.click();
    });
    expect(saveWallpaperSources).toHaveBeenCalledWith(
      expect.objectContaining({
        wallhaven: expect.objectContaining({ seed: "mockedseed1234" }),
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("seed 已刷新并保存");
    expect(container.textContent).not.toContain("seed 已刷新并保存");
  });

  describe("Lightbox 预览", () => {
    /** 搜索结果卡片（外层带点击打开预览的 div） */
    function getCard(): HTMLElement {
      return container.querySelector(
        ".overflow-hidden.rounded-lg",
      ) as HTMLElement;
    }

    /** 在对话框内按标题找按钮 */
    function dialogButton(
      dialog: HTMLElement,
      title: string,
    ): HTMLButtonElement {
      return Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.title === title || b.getAttribute("aria-label") === title,
      ) as HTMLButtonElement;
    }

    /** 在对话框内按文本找按钮（如下载并应用） */
    function dialogTextButton(
      dialog: HTMLElement,
      text: string,
    ): HTMLButtonElement {
      return Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === text,
      ) as HTMLButtonElement;
    }

    /** 若对话框显示「查看原图」按钮则点击以加载原图 */
    async function viewFull(dialog: HTMLElement): Promise<void> {
      const btn = dialogTextButton(dialog, "查看原图");
      if (!btn) return;
      await act(async () => {
        btn.click();
      });
      await flush();
    }

    /** 搜索得到 PREVIEW_ITEM 并点击卡片打开预览，随后加载原图 */
    async function openLightbox(): Promise<HTMLElement> {
      vi.mocked(searchWallpapers).mockResolvedValue([PREVIEW_ITEM]);
      await flush();
      const searchBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "搜索",
      )!;
      await act(async () => {
        searchBtn.click();
      });
      await act(async () => {
        getCard().click();
      });
      await flush();
      const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
      await viewFull(dialog);
      return dialog;
    }

    /** 搜索多张结果并点击第 index 张卡片打开预览，随后加载原图 */
    async function openLightboxAt(
      results: WallpaperItem[],
      index: number,
    ): Promise<HTMLElement> {
      vi.mocked(searchWallpapers).mockResolvedValue(results);
      await flush();
      const searchBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "搜索",
      )!;
      await act(async () => {
        searchBtn.click();
      });
      await act(async () => {
        const cards = container.querySelectorAll(
          ".overflow-hidden.rounded-lg",
        );
        (cards[index] as HTMLElement).click();
      });
      await flush();
      const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
      await viewFull(dialog);
      return dialog;
    }

    /** 对话框内的位置指示文本（如 1 / 2） */
    function positionText(dialog: HTMLElement): string {
      return dialog.querySelector('[aria-label="预览位置"]')!.textContent ?? "";
    }

    it("点击缩略图卡片打开预览，加载完成后展示 data URL 图片与元信息", async () => {
      let resolvePreview!: (url: string) => void;
      vi.mocked(previewWallpaper).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePreview = resolve;
          }),
      );
      const dialog = await openLightbox();
      expect(dialog).not.toBeNull();
      expect(previewWallpaper).toHaveBeenCalledWith(
        expect.objectContaining({ id: "wallhaven-preview" }),
      );
      expect(dialog.textContent).toContain("加载中...");
      expect(dialog.textContent).toContain("1920×1080");
      expect(dialog.textContent).toContain("wallhaven");
      await act(async () => {
        resolvePreview("data:image/jpeg;base64,TEST");
      });
      await flush();
      const img = dialog.querySelector("img")!;
      expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,TEST");
      expect(img.style.transform).toContain("scale(1)");
      expect(dialog.textContent).not.toContain("加载中...");
    });

    it("点击卡片上的「下载并应用」不打开预览", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      vi.mocked(downloadWallpaper).mockResolvedValue("/wall/a.jpg");
      vi.mocked(applyWallpaper).mockResolvedValue({
        imagePath: "/wall/a.jpg",
        target: "cmux",
        reloadMessage: "ok",
      });
      vi.mocked(searchWallpapers).mockResolvedValue([PREVIEW_ITEM]);
      await flush();
      const searchBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "搜索",
      )!;
      await act(async () => {
        searchBtn.click();
      });
      const applyBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "下载并应用",
      )!;
      await act(async () => {
        applyBtn.click();
      });
      expect(downloadWallpaper).toHaveBeenCalled();
      expect(previewWallpaper).not.toHaveBeenCalled();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it("加载失败显示错误提示，点击重试后成功", async () => {
      vi.mocked(previewWallpaper)
        .mockRejectedValueOnce(new Error("proxy timeout"))
        .mockResolvedValueOnce("data:image/jpeg;base64,RETRY");
      const dialog = await openLightbox();
      expect(dialog.textContent).toContain("原图加载失败");
      expect(dialog.textContent).toContain("proxy timeout");
      const retryBtn = Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "重试",
      )!;
      await act(async () => {
        retryBtn.click();
      });
      await flush();
      const img = dialog.querySelector("img")!;
      expect(img.getAttribute("src")).toBe("data:image/jpeg;base64,RETRY");
      expect(dialog.textContent).not.toContain("原图加载失败");
    });

    it("按 Esc 关闭预览并复位状态", async () => {
      vi.mocked(previewWallpaper)
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce("data:image/jpeg;base64,OK");
      const dialog = await openLightbox();
      expect(dialog.textContent).toContain("原图加载失败");
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      const card = getCard();
      await act(async () => {
        card.click();
      });
      await flush();
      const dialog2 = container.querySelector('[role="dialog"]')! as HTMLElement;
      // 重新打开默认展示缩略图，不触发原图加载
      expect(dialog2.querySelector("img")?.getAttribute("src")).toBe(
        `thumb://${PREVIEW_ITEM.thumb_hash}`,
      );
      expect(dialog2.textContent).not.toContain("原图加载失败");
      await viewFull(dialog2);
      expect(dialog2.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,OK",
      );
    });

    it("点击遮罩关闭，点击图片不关闭", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightbox();
      const img = dialog.querySelector("img")!;
      await act(async () => {
        img.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
      await act(async () => {
        dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it("关闭按钮关闭预览", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightbox();
      await act(async () => {
        dialogButton(dialog, "关闭预览").click();
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it("工具条放大/缩小/复位按钮调整缩放与平移", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightbox();
      const img = dialog.querySelector("img")!;
      await act(async () => {
        dialogButton(dialog, "放大").click();
      });
      expect(img.style.transform).toContain("scale(1.2)");
      expect(dialog.textContent).toContain("120%");
      await act(async () => {
        dialogButton(dialog, "放大").click();
      });
      expect(img.style.transform).toContain("scale(1.44)");
      await act(async () => {
        dialogButton(dialog, "缩小").click();
      });
      expect(img.style.transform).toContain("scale(1.2)");
      await act(async () => {
        dialogButton(dialog, "复位到 100%").click();
      });
      expect(img.style.transform).toContain("translate3d(0px, 0px, 0) scale(1)");
      expect(dialog.textContent).toContain("100%");
    });

    it("滚轮以光标为锚点缩放并限制在 0.2~5", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightbox();
      const img = dialog.querySelector("img")!;
      for (let i = 0; i < 10; i += 1) {
        await act(async () => {
          dialog.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, deltaY: -100 }),
          );
        });
      }
      expect(img.style.transform).toContain("scale(5)");
      expect(dialog.textContent).toContain("500%");
      for (let i = 0; i < 20; i += 1) {
        await act(async () => {
          dialog.dispatchEvent(
            new WheelEvent("wheel", { bubbles: true, deltaY: 100 }),
          );
        });
      }
      expect(img.style.transform).toContain("scale(0.2)");
      expect(dialog.textContent).toContain("20%");
    });

    it("拖拽平移更新 offset，拖拽后的点击不关闭、再次点击关闭", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightbox();
      const img = dialog.querySelector("img")!;
      await act(async () => {
        dialog.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            clientX: 100,
            clientY: 100,
          }),
        );
        dialog.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            clientX: 200,
            clientY: 150,
          }),
        );
      });
      expect(img.style.transform).toContain("translate3d(100px, 50px, 0)");
      await act(async () => {
        dialog.dispatchEvent(
          new PointerEvent("pointerup", {
            bubbles: true,
            clientX: 200,
            clientY: 150,
          }),
        );
      });
      await act(async () => {
        dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
      await act(async () => {
        dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it("查看器内「下载并应用」成功与失败，且不关闭预览", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      vi.mocked(downloadWallpaper).mockResolvedValue("/wall/preview.jpg");
      vi.mocked(applyWallpaper).mockResolvedValue({
        imagePath: "/wall/preview.jpg",
        target: "cmux",
        reloadMessage: "已生效",
      });
      const dialog = await openLightbox();
      await act(async () => {
        dialogTextButton(dialog, "下载并应用").click();
      });
      await flush();
      expect(downloadWallpaper).toHaveBeenCalledWith(
        expect.objectContaining({ id: "wallhaven-preview" }),
      );
      expect(applyWallpaper).toHaveBeenCalledWith(
        "/wall/preview.jpg",
        "cmux",
        "",
      );
      expect(toast.success).toHaveBeenCalledWith(
        "已下载并应用到 cmux：/wall/preview.jpg。已生效",
      );
      expect(dialog.textContent).not.toContain("已下载并应用到 cmux");
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();

      vi.mocked(downloadWallpaper).mockRejectedValue(new Error("disk full"));
      await act(async () => {
        dialogTextButton(dialog, "下载并应用").click();
      });
      await flush();
      expect(toast.error).toHaveBeenCalledWith("应用失败：Error: disk full");
      expect(dialog.textContent).not.toContain("应用失败");
    });

    it("关闭后重新打开时预览状态复位", async () => {
      vi.mocked(previewWallpaper).mockRejectedValue(new Error("old error"));
      const dialog = await openLightbox();
      expect(dialog.textContent).toContain("原图加载失败");
      await act(async () => {
        dialogButton(dialog, "关闭预览").click();
      });
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,NEW");
      await act(async () => {
        getCard().click();
      });
      await flush();
      const dialog2 = container.querySelector('[role="dialog"]')! as HTMLElement;
      expect(dialog2.textContent).not.toContain("原图加载失败");
      await viewFull(dialog2);
      expect(dialog2.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,NEW",
      );
    });

    it("打开预览展示位置指示，首张时上一张禁用、下一张可用", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightboxAt([PREVIEW_ITEM, PREVIEW_ITEM_2], 0);
      expect(positionText(dialog)).toBe("1 / 2");
      expect(dialogButton(dialog, "上一张").disabled).toBe(true);
      expect(dialogButton(dialog, "下一张").disabled).toBe(false);
      expect(previewWallpaper).toHaveBeenCalledTimes(1);
    });

    it("点击下一张切换图片并更新位置，末张时下一张禁用", async () => {
      vi.mocked(previewWallpaper)
        .mockResolvedValueOnce("data:image/jpeg;base64,FIRST")
        .mockResolvedValueOnce("data:image/jpeg;base64,SECOND");
      const dialog = await openLightboxAt([PREVIEW_ITEM, PREVIEW_ITEM_2], 0);
      await act(async () => {
        dialogButton(dialog, "下一张").click();
      });
      await flush();
      expect(positionText(dialog)).toBe("2 / 2");
      expect(dialogButton(dialog, "下一张").disabled).toBe(true);
      expect(dialogButton(dialog, "上一张").disabled).toBe(false);
      // 切换后默认展示缩略图，点击查看原图后加载新图
      await viewFull(dialog);
      expect(previewWallpaper).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: "wallhaven-second" }),
      );
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,SECOND",
      );
    });

    it("方向键切换上一张/下一张", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightboxAt([PREVIEW_ITEM, PREVIEW_ITEM_2], 0);
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowRight" }),
        );
      });
      await flush();
      expect(positionText(dialog)).toBe("2 / 2");
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      });
      await flush();
      expect(positionText(dialog)).toBe("1 / 2");
      // 首张按 ← 不越界
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
      });
      await flush();
      expect(positionText(dialog)).toBe("1 / 2");
    });

    it("切换图片后缩放与偏移复位", async () => {
      vi.mocked(previewWallpaper)
        .mockResolvedValueOnce("data:image/jpeg;base64,FIRST")
        .mockResolvedValueOnce("data:image/jpeg;base64,SECOND");
      const dialog = await openLightboxAt([PREVIEW_ITEM, PREVIEW_ITEM_2], 0);
      const img = dialog.querySelector("img")!;
      await act(async () => {
        dialogButton(dialog, "放大").click();
      });
      expect(img.style.transform).toContain("scale(1.2)");
      await act(async () => {
        dialogButton(dialog, "下一张").click();
      });
      await flush();
      await viewFull(dialog);
      const img2 = dialog.querySelector("img")!;
      expect(img2.style.transform).toContain("translate3d(0px, 0px, 0) scale(1)");
      expect(dialog.textContent).toContain("100%");
    });

    it("切换后加载失败展示错误，可重试当前张", async () => {
      vi.mocked(previewWallpaper)
        .mockResolvedValueOnce("data:image/jpeg;base64,FIRST")
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce("data:image/jpeg;base64,RETRIED");
      const dialog = await openLightboxAt([PREVIEW_ITEM, PREVIEW_ITEM_2], 0);
      await act(async () => {
        dialogButton(dialog, "下一张").click();
      });
      await flush();
      // 切换后点击查看原图触发加载失败
      await viewFull(dialog);
      expect(dialog.textContent).toContain("原图加载失败");
      expect(dialog.textContent).toContain("network down");
      const retryBtn = Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "重试",
      )!;
      await act(async () => {
        retryBtn.click();
      });
      await flush();
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,RETRIED",
      );
      expect(positionText(dialog)).toBe("2 / 2");
    });

    it("预览底部应用目标下拉使用深色高对比度样式", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightboxAt([PREVIEW_ITEM], 0);
      const select = dialog.querySelector('select[aria-label="应用目标"]')!;
      expect(select.className).toContain("bg-gray-700/80");
      expect(select.className).toContain("text-white");
      const option = dialog.querySelector("option")!;
      expect(option.className).toContain("bg-gray-900");
      expect(option.className).toContain("text-white");
      const bar = select.parentElement!;
      expect(bar.className).toContain("flex-wrap");
      expect(bar.className).toContain("justify-center");
      expect(bar.className).toContain("gap-y-1");
    });

    it("打开预览默认展示缩略图，不自动下载原图", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      vi.mocked(searchWallpapers).mockResolvedValue([PREVIEW_ITEM]);
      await flush();
      const searchBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "搜索",
      )!;
      await act(async () => {
        searchBtn.click();
      });
      await act(async () => {
        getCard().click();
      });
      await flush();
      const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
      expect(previewWallpaper).not.toHaveBeenCalled();
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
        `thumb://${PREVIEW_ITEM.thumb_hash}`,
      );
      expect(dialogTextButton(dialog, "查看原图")).toBeDefined();
    });

    it("原图已缓存时打开预览直接展示原图，零网络", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,CACHED");
      vi.mocked(hasWallpaperFullCache).mockResolvedValue(true);
      const dialog = await openLightbox();
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,CACHED",
      );
      expect(dialogTextButton(dialog, "查看原图")).toBeUndefined();
    });

    it("点击查看原图加载成功并隐藏按钮", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,FULL");
      vi.mocked(searchWallpapers).mockResolvedValue([PREVIEW_ITEM]);
      await flush();
      const searchBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "搜索",
      )!;
      await act(async () => {
        searchBtn.click();
      });
      await act(async () => {
        getCard().click();
      });
      await flush();
      const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
        `thumb://${PREVIEW_ITEM.thumb_hash}`,
      );
      await act(async () => {
        dialogTextButton(dialog, "查看原图").click();
      });
      await flush();
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,FULL",
      );
      expect(dialogTextButton(dialog, "查看原图")).toBeUndefined();
    });

    it("查看原图失败自动回退缩略图并可重试", async () => {
      vi.mocked(previewWallpaper)
        .mockRejectedValueOnce(new Error("proxy timeout"))
        .mockResolvedValueOnce("data:image/jpeg;base64,RETRY");
      vi.mocked(searchWallpapers).mockResolvedValue([PREVIEW_ITEM]);
      await flush();
      const searchBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "搜索",
      )!;
      await act(async () => {
        searchBtn.click();
      });
      await act(async () => {
        getCard().click();
      });
      await flush();
      const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
      await act(async () => {
        dialogTextButton(dialog, "查看原图").click();
      });
      await flush();
      expect(dialog.textContent).toContain("原图加载失败");
      // 失败后仍展示缩略图
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
        `thumb://${PREVIEW_ITEM.thumb_hash}`,
      );
      const retryBtn = Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "重试",
      )!;
      await act(async () => {
        retryBtn.click();
      });
      await flush();
      expect(dialog.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,RETRY",
      );
    });

    it("缩略图预览下图片铺满舞台，且支持放大与复位", async () => {
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      vi.mocked(searchWallpapers).mockResolvedValue([PREVIEW_ITEM]);
      await flush();
      const searchBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "搜索",
      )!;
      await act(async () => {
        searchBtn.click();
      });
      await act(async () => {
        getCard().click();
      });
      await flush();
      const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
      // 未加载原图：展示缩略图且图片铺满舞台（object-contain 保持比例）
      expect(previewWallpaper).not.toHaveBeenCalled();
      const img = dialog.querySelector("img")!;
      expect(img.getAttribute("src")).toBe(
        `thumb://${PREVIEW_ITEM.thumb_hash}`,
      );
      expect(img.className).toContain("h-[85vh]");
      expect(img.className).toContain("object-contain");
      // 缩略图下可缩放：放大按钮生效
      await act(async () => {
        dialogButton(dialog, "放大").click();
      });
      expect(img.style.transform).toContain("scale(1.2)");
      await act(async () => {
        dialogButton(dialog, "复位到 100%").click();
      });
      expect(img.style.transform).toContain("translate3d(0px, 0px, 0) scale(1)");
    });
  });

  describe("本地壁纸库视图", () => {
    it("点击「本地壁纸库」切换视图并加载列表，再切回搜索视图", async () => {
      vi.mocked(listLocalWallpapers).mockResolvedValue([
        {
          fileName: "a.png",
          absolutePath: "/w/a.png",
          sizeBytes: 10,
          modifiedAtMs: 1000,
          thumbDataUrl: "data:image/jpeg;base64,x",
        },
      ]);
      await flush();
      const buttons = Array.from(container.querySelectorAll("button"));
      const libButton = buttons.find((b) => b.textContent === "本地壁纸库")!;
      await act(async () => {
        libButton.click();
      });
      await flush();
      expect(container.textContent).toContain("a.png");
      expect(listLocalWallpapers).toHaveBeenCalled();
      expect(container.textContent).toContain("删除选中（0）");
      // 本地壁纸库视图不显示图源 tab，避免 wallhaven 残留选中态
      const libButtons = Array.from(container.querySelectorAll("button"));
      expect(
        libButtons.find((b) => b.textContent === "wallhaven"),
      ).toBeUndefined();
      // 本地壁纸库视图不显示图源参数面板
      expect(container.textContent).not.toContain("wallhaven 参数");

      const buttons2 = Array.from(container.querySelectorAll("button"));
      const back = buttons2.find((b) => b.textContent === "在线搜索")!;
      await act(async () => {
        back.click();
      });
      await flush();
      expect(container.textContent).toContain("搜索壁纸以预览");
      const searchButtons = Array.from(container.querySelectorAll("button"));
      expect(
        searchButtons.find((b) => b.textContent === "wallhaven"),
      ).toBeDefined();
      // 切回搜索视图后参数面板恢复显示
      expect(container.textContent).toContain("wallhaven 参数");
    });
  });
});
