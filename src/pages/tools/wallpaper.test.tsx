import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WallpaperTool from "./wallpaper";
import {
  addBlacklistedWallpapers,
  applyWallpaper,
  clearBlacklistedWallpapers,
  downloadWallpaper,
  fetchBlacklistedThumb,
  hasWallpaperFullCache,
  listBlacklistedWallpaperPage,
  listLocalWallpapers,
  loadWallpaperSettings,
  previewWallpaper,
  removeBlacklistedWallpapers,
  saveWallpaperProxy,
  saveWallpaperSources,
  searchWallpapers,
  type WallpaperItem,
} from "../../lib/wallpaper";
import { listIterm2Profiles } from "../../lib/iterm2Config";
import { toast } from "../../lib/toast";
import {
  addWallpaperHistory,
  clearWallpaperHistory,
  deleteWallpaperHistory,
  listWallpaperHistory,
} from "../../lib/wallpaperHistory";
import { confirmDialog } from "../../lib/confirm";

const { readyCallbackRef } = vi.hoisted(() => ({
  // 初始为占位，会在 mock 的 listen 中被真实回调覆盖
  readyCallbackRef: {
    current: undefined as unknown as (evt?: { payload?: unknown }) => void,
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_eventName: string, cb: (e: unknown) => void) => {
    readyCallbackRef.current = cb;
    return Promise.resolve(() => {});
  }),
}));

vi.mock("../../lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("../../lib/confirm", () => ({
  confirmDialog: vi.fn(),
}));

vi.mock("../../lib/wallpaperHistory", () => ({
  HISTORY_PAGE_SIZE: 8,
  listWallpaperHistory: vi.fn(),
  addWallpaperHistory: vi.fn(),
  deleteWallpaperHistory: vi.fn(),
  clearWallpaperHistory: vi.fn(),
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
  addBlacklistedWallpapers: vi.fn(),
  listBlacklistedWallpapers: vi.fn(),
  listBlacklistedWallpaperPage: vi.fn(),
  removeBlacklistedWallpapers: vi.fn(),
  clearBlacklistedWallpapers: vi.fn(),
  fetchBlacklistedThumb: vi
    .fn()
    .mockResolvedValue("data:image/jpeg;base64,blk"),
  formatFileSize: (bytes: number) => `${bytes}B`,
  formatModifiedTime: (ms: number) => `t${ms}`,
  loadWallpaperSettings: vi.fn(),
  previewWallpaper: vi.fn(),
  hasWallpaperFullCache: vi.fn().mockResolvedValue(false),
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
    vi.mocked(listWallpaperHistory).mockResolvedValue({
      total: 0,
      page: 1,
      pageSize: 8,
      items: [],
    });
    vi.mocked(addWallpaperHistory).mockResolvedValue(undefined);
    vi.mocked(deleteWallpaperHistory).mockResolvedValue(undefined);
    vi.mocked(clearWallpaperHistory).mockResolvedValue(undefined);
    vi.mocked(confirmDialog).mockResolvedValue(true);
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

  it("refreshes the matching thumbnail when its thumb-ready event fires", async () => {
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
      readyCallbackRef.current({ payload: "0123456789abcdef" });
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "thumb://0123456789abcdef?r=0&v=1",
    );
  });

  it("ignores empty thumb-ready payload without refreshing", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-empty",
        source: "wallhaven",
        thumb_url: "https://thumb.example/e.jpg",
        thumb_hash: "empty0000000000",
        full_url: "https://full.example/e.jpg",
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
      "thumb://empty0000000000",
    );
    act(() => {
      readyCallbackRef.current({});
    });
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("thumb://empty0000000000");
  });

  it("only refreshes the card whose hash matches thumb-ready payload", async () => {
    vi.mocked(searchWallpapers).mockResolvedValue([
      {
        id: "wallhaven-abc",
        source: "wallhaven",
        thumb_url: "https://thumb.example/a.jpg",
        thumb_hash: "aaa",
        full_url: "https://full.example/a.jpg",
        width: 1920,
        height: 1080,
      },
      {
        id: "wallhaven-def",
        source: "wallhaven",
        thumb_url: "https://thumb.example/b.jpg",
        thumb_hash: "bbb",
        full_url: "https://full.example/b.jpg",
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
    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "thumb://aaa",
      "thumb://bbb",
    ]);
    act(() => {
      readyCallbackRef.current({ payload: "aaa" });
    });
    const after = Array.from(container.querySelectorAll("img"));
    expect(after[0]?.getAttribute("src")).toBe("thumb://aaa?r=0&v=1");
    expect(after[1]?.getAttribute("src")).toBe("thumb://bbb");
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

  describe("搜索历史区块", () => {
    /** 按精确文本找按钮 */
    function findButton(text: string): HTMLButtonElement | undefined {
      return Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === text,
      );
    }

    /** 重新挂载组件：让挂载时的历史拉取使用当前设置的 mock */
    async function remount(): Promise<void> {
      act(() => {
        root.unmount();
      });
      root = setup(container);
      await flush();
    }

    /** 通过原生 setter 修改受控搜索框并派发 input */
    function setSearchInput(value: string): void {
      const input = Array.from(container.querySelectorAll("input")).find(
        (i) => i.placeholder.includes("关键词"),
      )!;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    /** 历史条目按钮（按 title 定位） */
    function historyButton(keyword: string): HTMLButtonElement | undefined {
      return Array.from(container.querySelectorAll("button")).find(
        (b) => b.title === `搜索「${keyword}」`,
      );
    }

    it("空历史时不渲染历史区块，挂载时拉取初始图源第 1 页", async () => {
      await flush();
      expect(listWallpaperHistory).toHaveBeenCalledWith("wallhaven", 1, 8);
      expect(container.textContent).not.toContain("搜索历史");
      expect(historyButton("anime")).toBeUndefined();
    });

    it("有历史时渲染历史区块与关键词，未超一页时不显示分页按钮", async () => {
      vi.mocked(listWallpaperHistory).mockResolvedValue({
        total: 2,
        page: 1,
        pageSize: 8,
        items: [
          { source: "wallhaven", keyword: "anime", updatedAt: 2 },
          { source: "wallhaven", keyword: "landscape", updatedAt: 1 },
        ],
      });
      await remount();
      expect(container.textContent).toContain("wallhaven 搜索历史");
      expect(historyButton("anime")).toBeDefined();
      expect(historyButton("landscape")).toBeDefined();
      expect(findButton("上一页")).toBeUndefined();
      expect(findButton("下一页")).toBeUndefined();
    });

    it("超过一页时显示分页按钮，翻页拉取新页并切换可用态", async () => {
      const page1Items = Array.from({ length: 8 }, (_, i) => ({
        source: "wallhaven",
        keyword: `kw${i}`,
        updatedAt: 100 - i,
      }));
      const page2Items = Array.from({ length: 2 }, (_, i) => ({
        source: "wallhaven",
        keyword: `kw2-${i}`,
        updatedAt: 50 - i,
      }));
      vi.mocked(listWallpaperHistory).mockImplementation(
        async (_source: string, page: number) => {
          if (page >= 2) {
            return { total: 10, page: 2, pageSize: 8, items: page2Items };
          }
          return { total: 10, page: 1, pageSize: 8, items: page1Items };
        },
      );
      await remount();
      let prevBtn = findButton("上一页")!;
      let nextBtn = findButton("下一页")!;
      expect(prevBtn.disabled).toBe(true);
      expect(nextBtn.disabled).toBe(false);
      await act(async () => {
        nextBtn.click();
      });
      await flush();
      expect(listWallpaperHistory).toHaveBeenLastCalledWith("wallhaven", 2, 8);
      expect(container.textContent).toContain("kw2-0");
      expect(container.textContent).not.toContain("kw0");
      prevBtn = findButton("上一页")!;
      nextBtn = findButton("下一页")!;
      expect(prevBtn.disabled).toBe(false);
      expect(nextBtn.disabled).toBe(true);
      await act(async () => {
        prevBtn.click();
      });
      await flush();
      expect(listWallpaperHistory).toHaveBeenLastCalledWith("wallhaven", 1, 8);
      expect(container.textContent).toContain("kw0");
    });

    it("点击历史条目填入搜索框并立即回搜", async () => {
      vi.mocked(listWallpaperHistory).mockResolvedValue({
        total: 1,
        page: 1,
        pageSize: 8,
        items: [{ source: "wallhaven", keyword: "anime", updatedAt: 1 }],
      });
      await remount();
      await act(async () => {
        historyButton("anime")!.click();
      });
      await flush();
      expect(searchWallpapers).toHaveBeenLastCalledWith(
        expect.objectContaining({ keywords: "anime", random: false, page: 1 }),
        expect.anything(),
      );
      const input = Array.from(container.querySelectorAll("input")).find(
        (i) => i.placeholder.includes("关键词"),
      )! as HTMLInputElement;
      expect(input.value).toBe("anime");
    });

    it("非随机搜索发起时记录历史并刷新当前页", async () => {
      await flush();
      act(() => {
        setSearchInput("anime");
      });
      await act(async () => {
        findButton("搜索")!.click();
      });
      await flush();
      expect(addWallpaperHistory).toHaveBeenCalledWith("wallhaven", "anime");
      expect(listWallpaperHistory).toHaveBeenLastCalledWith("wallhaven", 1, 8);
    });

    it("空白关键词搜索不记录历史", async () => {
      await flush();
      act(() => {
        setSearchInput("   ");
      });
      await act(async () => {
        findButton("搜索")!.click();
      });
      await flush();
      expect(addWallpaperHistory).not.toHaveBeenCalled();
      expect(searchWallpapers).toHaveBeenCalled();
    });

    it("随机搜索不记录历史", async () => {
      await flush();
      act(() => {
        setSearchInput("anime");
      });
      await act(async () => {
        findButton("随机")!.click();
      });
      await flush();
      expect(addWallpaperHistory).not.toHaveBeenCalled();
    });

    it("历史记录失败时静默，不影响搜索主流程", async () => {
      vi.mocked(addWallpaperHistory).mockRejectedValue(new Error("boom"));
      await flush();
      act(() => {
        setSearchInput("anime");
      });
      await act(async () => {
        findButton("搜索")!.click();
      });
      await flush();
      expect(searchWallpapers).toHaveBeenCalledWith(
        expect.objectContaining({ keywords: "anime" }),
        expect.anything(),
      );
    });

    it("切换图源重置历史分页并拉取新源第 1 页", async () => {
      vi.mocked(listWallpaperHistory).mockImplementation(
        async (sourceId: string, page: number) => {
          if (sourceId === "danbooru") {
            return {
              total: 1,
              page: 1,
              pageSize: 8,
              items: [{ source: "danbooru", keyword: "scenery", updatedAt: 1 }],
            };
          }
          if (page >= 2) {
            return {
              total: 10,
              page: 2,
              pageSize: 8,
              items: [{ source: "wallhaven", keyword: "kw-page2", updatedAt: 1 }],
            };
          }
          return {
            total: 10,
            page: 1,
            pageSize: 8,
            items: Array.from({ length: 8 }, (_, i) => ({
              source: "wallhaven",
              keyword: `kw${i}`,
              updatedAt: 100 - i,
            })),
          };
        },
      );
      await remount();
      await act(async () => {
        findButton("下一页")!.click();
      });
      await flush();
      expect(listWallpaperHistory).toHaveBeenLastCalledWith("wallhaven", 2, 8);
      await act(async () => {
        findButton("Danbooru")!.click();
      });
      await flush();
      expect(listWallpaperHistory).toHaveBeenLastCalledWith("danbooru", 1, 8);
      expect(container.textContent).toContain("Danbooru 搜索历史");
      expect(container.textContent).toContain("scenery");
      expect(container.textContent).not.toContain("kw-page2");
    });

    it("删除单条历史后调用后端并重新拉取当前页", async () => {
      vi.mocked(listWallpaperHistory).mockResolvedValue({
        total: 2,
        page: 1,
        pageSize: 8,
        items: [
          { source: "wallhaven", keyword: "anime", updatedAt: 2 },
          { source: "wallhaven", keyword: "landscape", updatedAt: 1 },
        ],
      });
      await remount();
      const deleteBtn = container.querySelector(
        'button[aria-label="删除 anime"]',
      ) as HTMLButtonElement;
      expect(deleteBtn).not.toBeNull();
      await act(async () => {
        deleteBtn.click();
      });
      await flush();
      expect(deleteWallpaperHistory).toHaveBeenCalledWith(
        "wallhaven",
        "anime",
      );
      expect(listWallpaperHistory).toHaveBeenLastCalledWith("wallhaven", 1, 8);
    });

    it("删除历史失败时 toast 提示", async () => {
      vi.mocked(listWallpaperHistory).mockResolvedValue({
        total: 1,
        page: 1,
        pageSize: 8,
        items: [{ source: "wallhaven", keyword: "anime", updatedAt: 1 }],
      });
      vi.mocked(deleteWallpaperHistory).mockRejectedValue(new Error("db"));
      await remount();
      await act(async () => {
        (container.querySelector('button[aria-label="删除 anime"]') as HTMLButtonElement).click();
      });
      await flush();
      expect(toast.error).toHaveBeenCalledWith(
        "删除搜索历史失败：Error: db",
      );
    });

    it("清空当前站点历史需确认，确认后清空并回到空态", async () => {
      let cleared = false;
      vi.mocked(listWallpaperHistory).mockImplementation(async () => {
        if (cleared) {
          return { total: 0, page: 1, pageSize: 8, items: [] };
        }
        return {
          total: 2,
          page: 1,
          pageSize: 8,
          items: [
            { source: "wallhaven", keyword: "anime", updatedAt: 2 },
            { source: "wallhaven", keyword: "landscape", updatedAt: 1 },
          ],
        };
      });
      vi.mocked(clearWallpaperHistory).mockImplementation(async () => {
        cleared = true;
      });
      await remount();
      expect(container.textContent).toContain("wallhaven 搜索历史");
      await act(async () => {
        findButton("清空")!.click();
      });
      await flush();
      expect(confirmDialog).toHaveBeenCalledWith(
        expect.stringContaining("wallhaven"),
      );
      expect(clearWallpaperHistory).toHaveBeenCalledWith("wallhaven");
      expect(toast.success).toHaveBeenCalledWith("搜索历史已清空");
      expect(container.textContent).not.toContain("搜索历史");
    });

    it("取消确认时不执行清空", async () => {
      vi.mocked(listWallpaperHistory).mockResolvedValue({
        total: 1,
        page: 1,
        pageSize: 8,
        items: [{ source: "wallhaven", keyword: "anime", updatedAt: 1 }],
      });
      vi.mocked(confirmDialog).mockResolvedValue(false);
      await remount();
      await act(async () => {
        findButton("清空")!.click();
      });
      await flush();
      expect(clearWallpaperHistory).not.toHaveBeenCalled();
      expect(historyButton("anime")).toBeDefined();
    });

    it("历史加载失败时 toast 提示且不阻塞搜索", async () => {
      vi.mocked(listWallpaperHistory).mockRejectedValue(
        new Error("db locked"),
      );
      await remount();
      expect(toast.error).toHaveBeenCalledWith(
        "加载搜索历史失败：Error: db locked",
      );
      await act(async () => {
        findButton("搜索")!.click();
      });
      await flush();
      expect(searchWallpapers).toHaveBeenCalled();
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

  describe("拉黑操作", () => {
    const ITEM_C: WallpaperItem = {
      id: "wallhaven-third",
      source: "wallhaven",
      thumb_url: "https://thumb.example/c.jpg",
      thumb_hash: "cccccccccccccccc",
      full_url: "https://full.example/c.jpg",
      width: 1024,
      height: 768,
    };

    function searchBtn(): HTMLButtonElement {
      return Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "搜索",
      )!;
    }

    /** 卡片右上角「更多操作」按钮（⋯） */
    function moreMenuBtn(card: HTMLElement): HTMLButtonElement {
      return Array.from(card.querySelectorAll("button")).find(
        (b) => b.getAttribute("aria-label")?.startsWith("更多操作"),
      )!;
    }

    /** 卡片已展开菜单中的指定项（拉黑 / 复制 URL） */
    function cardMenuBtn(
      card: HTMLElement,
      text: string,
    ): HTMLButtonElement | undefined {
      return Array.from(card.querySelectorAll("button")).find(
        (b) => b.textContent === text,
      );
    }

    function positionText(dialog: HTMLElement): string {
      return (
        dialog.querySelector('[aria-label="预览位置"]')!.textContent ?? ""
      );
    }

    async function searchResults(results: WallpaperItem[]): Promise<void> {
      vi.mocked(searchWallpapers).mockResolvedValue(results);
      await flush();
      await act(async () => {
        searchBtn().click();
      });
      await flush();
    }

    /** 搜索结果卡片（panel 内层容器也含有 overflow-hidden rounded-lg，故限定 cursor-pointer） */
    function cards(): NodeListOf<HTMLElement> {
      return container.querySelectorAll(
        ".overflow-hidden.rounded-lg.cursor-pointer",
      );
    }

    /** 点击多张卡片结果里的第 index 张打开预览并加载原图 */
    async function openLightboxAt(
      results: WallpaperItem[],
      index: number,
    ): Promise<HTMLElement> {
      await searchResults(results);
      await act(async () => {
        const cards = container.querySelectorAll(
          ".overflow-hidden.rounded-lg",
        );
        (cards[index] as HTMLElement).click();
      });
      await flush();
      const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
      const viewFullBtn = Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "查看原图",
      );
      if (viewFullBtn) {
        await act(async () => {
          viewFullBtn.click();
        });
        await flush();
      }
      return dialog;
    }

    it("卡片菜单拉黑：加入黑名单、移除卡片并 toast，且不打开预览", async () => {
      vi.mocked(addBlacklistedWallpapers).mockResolvedValue(1);
      await searchResults([PREVIEW_ITEM, PREVIEW_ITEM_2]);
      expect(cards().length).toBe(2);
      const firstCard = cards()[0];
      await act(async () => {
        moreMenuBtn(firstCard).click();
      });
      await flush();
      await act(async () => {
        cardMenuBtn(firstCard, "拉黑")!.click();
      });
      await flush();
      expect(addBlacklistedWallpapers).toHaveBeenCalledWith([
        { url: PREVIEW_ITEM.full_url, thumbUrl: PREVIEW_ITEM.thumb_url },
      ]);
      expect(toast.success).toHaveBeenCalledWith("已加入黑名单");
      expect(cards().length).toBe(1);
      expect(container.textContent).not.toContain("1920×1080");
      expect(container.textContent).toContain("2560×1440");
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it("卡片菜单拉黑失败：toast 错误含后端语义且列表不变", async () => {
      vi.mocked(addBlacklistedWallpapers).mockRejectedValue(
        new Error("该壁纸已被拉黑，无法下载/预览"),
      );
      await searchResults([PREVIEW_ITEM]);
      const firstCard = cards()[0];
      await act(async () => {
        moreMenuBtn(firstCard).click();
      });
      await flush();
      await act(async () => {
        cardMenuBtn(firstCard, "拉黑")!.click();
      });
      await flush();
      expect(toast.error).toHaveBeenCalledWith(
        "拉黑失败：Error: 该壁纸已被拉黑，无法下载/预览",
      );
      expect(cards().length).toBe(1);
      expect(container.textContent).toContain("1920×1080");
    });

    it("卡片菜单复制 URL：复制原图 URL 并 toast", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      try {
        await searchResults([PREVIEW_ITEM]);
        const firstCard = cards()[0];
        await act(async () => {
          moreMenuBtn(firstCard).click();
        });
        await flush();
        await act(async () => {
          cardMenuBtn(firstCard, "复制 URL")!.click();
        });
        await flush();
        expect(writeText).toHaveBeenCalledWith(PREVIEW_ITEM.full_url);
        expect(toast.success).toHaveBeenCalledWith("已复制原图 URL");
        expect(container.querySelector('[role="dialog"]')).toBeNull();
      } finally {
        delete (window.navigator as { clipboard?: unknown }).clipboard;
      }
    });

    it("卡片菜单复制 URL 失败：toast 报错", async () => {
      const writeText = vi.fn().mockRejectedValue(new Error("denied"));
      Object.defineProperty(window.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      try {
        await searchResults([PREVIEW_ITEM]);
        const firstCard = cards()[0];
        await act(async () => {
          moreMenuBtn(firstCard).click();
        });
        await flush();
        await act(async () => {
          cardMenuBtn(firstCard, "复制 URL")!.click();
        });
        await flush();
        expect(toast.error).toHaveBeenCalledWith("复制失败：Error: denied");
      } finally {
        delete (window.navigator as { clipboard?: unknown }).clipboard;
      }
    });

    it("不支持剪贴板时复制 URL 报错", async () => {
      delete (window.navigator as { clipboard?: unknown }).clipboard;
      await searchResults([PREVIEW_ITEM]);
      const firstCard = cards()[0];
      await act(async () => {
        moreMenuBtn(firstCard).click();
      });
      await flush();
      await act(async () => {
        cardMenuBtn(firstCard, "复制 URL")!.click();
      });
      await flush();
      expect(toast.error).toHaveBeenCalledWith(
        "复制失败：Error: 当前环境不支持剪贴板",
      );
    });

    it("点击其他区域或按 Esc 关闭更多菜单", async () => {
      await searchResults([PREVIEW_ITEM, PREVIEW_ITEM_2]);
      const firstCard = cards()[0];
      await act(async () => {
        moreMenuBtn(firstCard).click();
      });
      await flush();
      expect(cardMenuBtn(firstCard, "复制 URL")).toBeTruthy();
      const grid = container.querySelector(".grid.grid-cols-2") as HTMLElement;
      await act(async () => {
        grid.click();
      });
      await flush();
      expect(cardMenuBtn(firstCard, "复制 URL")).toBeUndefined();
      await act(async () => {
        moreMenuBtn(firstCard).click();
      });
      await flush();
      expect(cardMenuBtn(firstCard, "复制 URL")).toBeTruthy();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      await flush();
      expect(cardMenuBtn(firstCard, "复制 URL")).toBeUndefined();
    });

    it("预览中拉黑当前壁纸：关闭预览并从列表移除", async () => {
      vi.mocked(addBlacklistedWallpapers).mockResolvedValue(0);
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightboxAt([PREVIEW_ITEM, PREVIEW_ITEM_2], 0);
      const blacklistBtn = Array.from(dialog.querySelectorAll("button")).find(
        (b) => b.textContent === "拉黑",
      )!;
      await act(async () => {
        blacklistBtn.click();
      });
      await flush();
      expect(addBlacklistedWallpapers).toHaveBeenCalledWith([
        { url: PREVIEW_ITEM.full_url, thumbUrl: PREVIEW_ITEM.thumb_url },
      ]);
      expect(toast.success).toHaveBeenCalledWith("已加入黑名单");
      expect(container.querySelector('[role="dialog"]')).toBeNull();
      expect(cards().length).toBe(1);
      expect(container.textContent).toContain("2560×1440");
    });

    it("预览第3张时拉黑前面的卡片：预览索引自动前移并仍展示原图", async () => {
      vi.mocked(addBlacklistedWallpapers).mockResolvedValue(0);
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightboxAt(
        [PREVIEW_ITEM, PREVIEW_ITEM_2, ITEM_C],
        2,
      );
      expect(positionText(dialog)).toBe("3 / 3");
      await act(async () => {
        moreMenuBtn(cards()[0]).click();
      });
      await flush();
      await act(async () => {
        cardMenuBtn(cards()[0], "拉黑")!.click();
      });
      await flush();
      const dialog2 = container.querySelector(
        '[role="dialog"]',
      ) as HTMLElement;
      expect(positionText(dialog2)).toBe("2 / 2");
      expect(dialog2.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,X",
      );
      expect(cards().length).toBe(2);
    });

    it("预览第1张时拉黑后面的卡片：预览索引不变", async () => {
      vi.mocked(addBlacklistedWallpapers).mockResolvedValue(0);
      vi.mocked(previewWallpaper).mockResolvedValue("data:image/jpeg;base64,X");
      const dialog = await openLightboxAt([PREVIEW_ITEM, PREVIEW_ITEM_2], 0);
      await act(async () => {
        moreMenuBtn(cards()[1]).click();
      });
      await flush();
      await act(async () => {
        cardMenuBtn(cards()[1], "拉黑")!.click();
      });
      await flush();
      const dialog2 = container.querySelector(
        '[role="dialog"]',
      ) as HTMLElement;
      expect(positionText(dialog2)).toBe("1 / 1");
      expect(dialog.textContent).toContain("1920×1080");
    });
  });

  describe("右键菜单", () => {
    function searchBtn(): HTMLButtonElement {
      return Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "搜索",
      )!;
    }

    async function searchResults(results: WallpaperItem[]): Promise<void> {
      vi.mocked(searchWallpapers).mockResolvedValue(results);
      await flush();
      await act(async () => {
        searchBtn().click();
      });
      await flush();
    }

    function cards(): NodeListOf<HTMLElement> {
      return container.querySelectorAll(
        ".overflow-hidden.rounded-lg.cursor-pointer",
      );
    }

    function contextMenu(card: HTMLElement): HTMLElement | undefined {
      return Array.from(card.querySelectorAll('[role="menu"]')).find(
        (m) => m.className.includes("fixed"),
      ) as HTMLElement | undefined;
    }

    function menuItem(card: HTMLElement, text: string): HTMLButtonElement {
      return Array.from(card.querySelectorAll("[role='menuitem']")).find(
        (b) => b.textContent === text,
      ) as HTMLButtonElement;
    }

    /** 对卡片触发一次右键事件：preventDefault + clientX/clientY */
    function rightClick(
      card: HTMLElement,
      x: number,
      y: number,
    ): { defaultPrevented: boolean } {
      let defaultPrevented = false;
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      event.preventDefault = () => {
        defaultPrevented = true;
      };
      act(() => {
        card.dispatchEvent(event);
      });
      return { defaultPrevented };
    }

    it("缩略图上右键弹出固定菜单并拦截原生菜单", async () => {
      await searchResults([PREVIEW_ITEM]);
      const firstCard = cards()[0];
      const prevented = rightClick(firstCard, 300, 300);
      await flush();
      expect(prevented.defaultPrevented).toBe(true);
      expect(contextMenu(firstCard)).toBeTruthy();
    });

    it("卡片空白处右键同样弹出菜单", async () => {
      await searchResults([PREVIEW_ITEM]);
      const firstCard = cards()[0];
      rightClick(firstCard, 400, 400);
      await flush();
      expect(contextMenu(firstCard)).toBeTruthy();
    });

    it("右键菜单在光标处弹出且四合一动作一致", async () => {
      vi.mocked(applyWallpaper).mockResolvedValue({
        target: "cmux",
        imagePath: "/tmp/wall.jpg",
        reloadMessage: "reload ok",
      });
      vi.mocked(downloadWallpaper).mockResolvedValue("/tmp/wall.jpg");
      await searchResults([PREVIEW_ITEM]);
      const firstCard = cards()[0];
      rightClick(firstCard, 120, 130);
      await flush();
      const menu = contextMenu(firstCard)!;
      const style = menu.getAttribute("style") ?? "";
      expect(style).toContain("left: 120px");
      expect(style).toContain("top: 130px");
      // 「⋯」与右键菜单共享动作：预览打开查看器
      await act(async () => {
        menuItem(firstCard, "预览大图").click();
      });
      await flush();
      expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    });

    it("右键菜单在视口边缘内收敛不溢出", async () => {
      await searchResults([PREVIEW_ITEM]);
      const firstCard = cards()[0];
      rightClick(firstCard, 999999, 999999);
      await flush();
      const menu = contextMenu(firstCard)!;
      const style = menu.getAttribute("style") ?? "";
      const left = Number(style.match(/left: (-?\d+)px/)?.[1]);
      const top = Number(style.match(/top: (-?\d+)px/)?.[1]);
      expect(left).toBeLessThanOrEqual(window.innerWidth);
      expect(top).toBeLessThanOrEqual(window.innerHeight);
    });

    it("右键菜单点击下载并应用：触发 download+apply", async () => {
      vi.mocked(applyWallpaper).mockResolvedValue({
        target: "cmux",
        imagePath: "/tmp/wall.jpg",
        reloadMessage: "reload ok",
      });
      vi.mocked(downloadWallpaper).mockResolvedValue("/tmp/wall.jpg");
      await searchResults([PREVIEW_ITEM]);
      const firstCard = cards()[0];
      rightClick(firstCard, 300, 300);
      await flush();
      await act(async () => {
        menuItem(firstCard, "下载并应用").click();
      });
      await flush();
      expect(downloadWallpaper).toHaveBeenCalledWith(PREVIEW_ITEM);
      expect(applyWallpaper).toHaveBeenCalledWith("/tmp/wall.jpg", "cmux", "");
    });

    it("右键菜单点击复制 URL：复制并 toast", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window.navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      try {
        await searchResults([PREVIEW_ITEM]);
        const firstCard = cards()[0];
        rightClick(firstCard, 300, 300);
        await flush();
        await act(async () => {
          menuItem(firstCard, "复制 URL").click();
        });
        await flush();
        expect(writeText).toHaveBeenCalledWith(PREVIEW_ITEM.full_url);
        expect(toast.success).toHaveBeenCalledWith("已复制原图 URL");
      } finally {
        delete (window.navigator as { clipboard?: unknown }).clipboard;
      }
    });

    it("右键菜单点击拉黑：移除卡片并 toast，不打开预览", async () => {
      vi.mocked(addBlacklistedWallpapers).mockResolvedValue(1);
      await searchResults([PREVIEW_ITEM, PREVIEW_ITEM_2]);
      const firstCard = cards()[0];
      rightClick(firstCard, 300, 300);
      await flush();
      await act(async () => {
        menuItem(firstCard, "拉黑").click();
      });
      await flush();
      expect(addBlacklistedWallpapers).toHaveBeenCalledWith([
        { url: PREVIEW_ITEM.full_url, thumbUrl: PREVIEW_ITEM.thumb_url },
      ]);
      expect(toast.success).toHaveBeenCalledWith("已加入黑名单");
      expect(cards().length).toBe(1);
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it("菜单打开时点击卡片关闭菜单且不触发预览", async () => {
      await searchResults([PREVIEW_ITEM]);
      const firstCard = cards()[0];
      rightClick(firstCard, 300, 300);
      await flush();
      expect(contextMenu(firstCard)).toBeTruthy();
      await act(async () => {
        firstCard.click();
      });
      await flush();
      expect(contextMenu(firstCard)).toBeUndefined();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it("按 Esc 关闭右键菜单", async () => {
      await searchResults([PREVIEW_ITEM]);
      const firstCard = cards()[0];
      rightClick(firstCard, 300, 300);
      await flush();
      expect(contextMenu(firstCard)).toBeTruthy();
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      });
      await flush();
      expect(contextMenu(firstCard)).toBeUndefined();
    });

    it("页面滚动关闭右键菜单", async () => {
      await searchResults([PREVIEW_ITEM]);
      const firstCard = cards()[0];
      rightClick(firstCard, 300, 300);
      await flush();
      expect(contextMenu(firstCard)).toBeTruthy();
      await act(async () => {
        window.dispatchEvent(new Event("scroll"));
      });
      await flush();
      expect(contextMenu(firstCard)).toBeUndefined();
    });

    it("同时只保留一个菜单实例：打开另一张卡片的右键菜单关闭前一张", async () => {
      await searchResults([PREVIEW_ITEM, PREVIEW_ITEM_2]);
      const [firstCard, secondCard] = cards();
      rightClick(firstCard, 300, 300);
      await flush();
      expect(contextMenu(firstCard)).toBeTruthy();
      rightClick(secondCard, 300, 300);
      await flush();
      expect(contextMenu(firstCard)).toBeUndefined();
      expect(contextMenu(secondCard)).toBeTruthy();
    });

    it("卡片外右键不拦截（不弹菜单）", async () => {
      await searchResults([PREVIEW_ITEM]);
      const grid = container.querySelector(".grid.grid-cols-2") as HTMLElement;
      act(() => {
        grid.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
        );
      });
      await flush();
      expect(container.querySelector('[role="menu"]')).toBeNull();
    });
  });

  describe("黑名单管理", () => {
    function blacklistBtn(): HTMLButtonElement | undefined {
      return Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "黑名单",
      );
    }

    function panel(): HTMLElement | null {
      return container.querySelector('[aria-label="壁纸黑名单"]');
    }

    function panelButton(btn: HTMLElement, text: string): HTMLButtonElement {
      return Array.from(btn.querySelectorAll("button")).find(
        (b) => b.textContent === text,
      )!;
    }

    async function openPanel(): Promise<HTMLElement> {
      await act(async () => {
        blacklistBtn()!.click();
      });
      await flush();
      return panel()!;
    }

    const PAGE_A = [
      { url: "https://full.example/a.jpg", thumbUrl: "https://thumb.example/a.jpg" },
      { url: "https://full.example/legacy.jpg" },
    ];

    function mockPage(
      items: { url: string; thumbUrl?: string }[],
      total: number,
    ): void {
      vi.mocked(listBlacklistedWallpaperPage).mockResolvedValue({ items, total });
    }

    beforeEach(() => {
      mockPage(PAGE_A, 2);
    });

    it("黑名单按钮仅在搜索视图显示", async () => {
      await flush();
      expect(blacklistBtn()).toBeDefined();
      const libBtn = Array.from(container.querySelectorAll("button")).find(
        (b) => b.textContent === "本地壁纸库",
      )!;
      await act(async () => {
        libBtn.click();
      });
      await flush();
      expect(blacklistBtn()).toBeUndefined();
    });

    it("打开面板渲染条目：总数、图源标签、缩略图请求与 URL 展示", async () => {
      const p = await openPanel();
      expect(listBlacklistedWallpaperPage).toHaveBeenCalledWith(1, 20, "");
      expect(p.textContent).toContain("共 2 条");
      expect(p.textContent).toContain("https://full.example/a.jpg");
      expect(p.textContent).toContain("https://full.example/legacy.jpg");
      expect(fetchBlacklistedThumb).toHaveBeenCalledWith(
        "https://thumb.example/a.jpg",
      );
      expect(p.querySelectorAll("img").length).toBe(1);
      expect(p.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,blk",
      );
    });

    it("图源标签按域名推断（wallhaven/Danbooru/Safebooru/其他/空）", async () => {
      mockPage(
        [
          { url: "https://wallhaven.cc/w/a.jpg" },
          { url: "https://danbooru.donmai.us/posts/1" },
          { url: "https://safebooru.org/index.php?id=1" },
          { url: "https://example.com/1.jpg" },
          { url: "" },
        ],
        5,
      );
      const p = await openPanel();
      expect(p.textContent).toContain("wallhaven");
      expect(p.textContent).toContain("Danbooru");
      expect(p.textContent).toContain("Safebooru");
      expect(p.textContent).toContain("example.com");
      expect(p.textContent).toContain("未知");
    });

    it("黑名单为空时显示空态", async () => {
      mockPage([], 0);
      const p = await openPanel();
      expect(p.textContent).toContain("暂无黑名单");
      expect(panelButton(p, "清空全部")).toBeDefined();
    });

    it("打开面板失败时 toast 错误并关闭面板", async () => {
      vi.mocked(listBlacklistedWallpaperPage).mockRejectedValue(
        new Error("load fail"),
      );
      await act(async () => {
        blacklistBtn()!.click();
      });
      await flush();
      expect(toast.error).toHaveBeenCalledWith(
        "加载黑名单失败：Error: load fail",
      );
      expect(panel()).toBeNull();
    });

    it("搜索框输入按关键词过滤（回到第 1 页）", async () => {
      mockPage([], 0);
      const p = await openPanel();
      const input = p.querySelector(
        'input[aria-label="搜索黑名单"]',
      ) as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!;
      setter.call(input, "legacy");
      await act(async () => {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await flush();
      await flush();
      expect(listBlacklistedWallpaperPage).toHaveBeenLastCalledWith(1, 20, "legacy");
      expect(p.textContent).toContain("暂无黑名单");
    });

    it("翻页：下一页加载第 2 页，边界按钮禁用状态正确", async () => {
      const many = Array.from({ length: 25 }, (_, i) => ({
        url: `https://p/${i}.jpg`,
      }));
      mockPage(many.slice(0, 20), 25);
      const p = await openPanel();
      expect(p.textContent).toContain("第 1 / 2 页");
      const prevBtn = Array.from(p.querySelectorAll("button")).find(
        (b) => b.textContent === "上一页",
      )!;
      expect(prevBtn.hasAttribute("disabled")).toBe(true);
      mockPage(many.slice(20), 25);
      await act(async () => {
        panelButton(p, "下一页").click();
      });
      await flush();
      expect(listBlacklistedWallpaperPage).toHaveBeenLastCalledWith(2, 20, "");
      expect(p.textContent).toContain("第 2 / 2 页");
      expect(panelButton(p, "下一页").hasAttribute("disabled")).toBe(true);
    });

    it("缩略图就绪前显示骨架，失败显示占位", async () => {
      let resolveThumb!: (v: string) => void;
      vi.mocked(fetchBlacklistedThumb).mockImplementation(
        (url: string) =>
          url === "tA"
            ? new Promise((r) => {
                resolveThumb = r;
              })
            : Promise.reject(new Error("fetch fail")),
      );
      mockPage(
        [
          { url: "A", thumbUrl: "tA" },
          { url: "B", thumbUrl: "tB" },
        ],
        2,
      );
      const p = await openPanel();
      expect(p.querySelector('div[role="status"]')).not.toBeNull();
      expect(p.textContent).toContain("加载失败");
      await act(async () => {
        resolveThumb("data:image/jpeg;base64,OK");
      });
      await flush();
      expect(p.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/jpeg;base64,OK",
      );
    });

    it("缩略图请求在面板关闭后完成时不更新状态", async () => {
      let resolveThumb!: (v: string) => void;
      vi.mocked(fetchBlacklistedThumb).mockImplementation(
        () =>
          new Promise((r) => {
            resolveThumb = r;
          }),
      );
      mockPage([{ url: "A", thumbUrl: "tA" }], 1);
      await openPanel();
      await act(async () => {
        panelButton(panel()!, "关闭").click();
      });
      expect(panel()).toBeNull();
      await act(async () => {
        resolveThumb("data:image/jpeg;base64,LATE");
      });
      await flush();

      let rejectThumb!: (e: Error) => void;
      vi.mocked(fetchBlacklistedThumb).mockImplementation(
        () =>
          new Promise((_, rej) => {
            rejectThumb = rej;
          }),
      );
      await openPanel();
      await act(async () => {
        panelButton(panel()!, "关闭").click();
      });
      await act(async () => {
        rejectThumb(new Error("late"));
      });
      await flush();
      expect(container.querySelector('[role="dialog"]')).toBeNull();
    });

    it("移除单条黑名单：调用后端、重载当前页并 toast，已加载搜索结果不变", async () => {
      vi.mocked(removeBlacklistedWallpapers).mockResolvedValue(1);
      vi.mocked(searchWallpapers).mockResolvedValue([PREVIEW_ITEM]);
      await flush();
      await act(async () => {
        Array.from(container.querySelectorAll("button"))
          .find((b) => b.textContent === "搜索")!
          .click();
      });
      await flush();
      expect(
        container.querySelectorAll(".overflow-hidden.rounded-lg").length,
      ).toBe(1);
      const p = await openPanel();
      const firstRow = Array.from(p.querySelectorAll("li")).find((r) =>
        r.textContent?.includes("https://full.example/a.jpg"),
      )!;
      mockPage([{ url: "https://full.example/legacy.jpg" }], 1);
      await act(async () => {
        panelButton(firstRow, "移除").click();
      });
      await flush();
      expect(removeBlacklistedWallpapers).toHaveBeenCalledWith([
        "https://full.example/a.jpg",
      ]);
      expect(toast.success).toHaveBeenCalledWith("已移除，重新搜索后可见");
      expect(panel()!.textContent).not.toContain("https://full.example/a.jpg");
      expect(panel()!.textContent).toContain("https://full.example/legacy.jpg");
      expect(
        container.querySelectorAll(
          ".overflow-hidden.rounded-lg.cursor-pointer",
        ).length,
      ).toBe(1);
    });

    it("移除黑名单失败时 toast 错误", async () => {
      vi.mocked(removeBlacklistedWallpapers).mockRejectedValue(
        new Error("io"),
      );
      const p = await openPanel();
      const firstRow = Array.from(p.querySelectorAll("li")).find((r) =>
        r.textContent?.includes("https://full.example/a.jpg"),
      )!;
      await act(async () => {
        panelButton(firstRow, "移除").click();
      });
      await flush();
      expect(toast.error).toHaveBeenCalledWith("移除黑名单失败：Error: io");
    });

    it("清空黑名单需二次确认，确认后清空、显示空态并 toast", async () => {
      vi.mocked(clearBlacklistedWallpapers).mockResolvedValue(undefined);
      const p = await openPanel();
      await act(async () => {
        panelButton(p, "清空全部").click();
      });
      await flush();
      expect(confirmDialog).toHaveBeenCalledWith(
        expect.stringContaining("黑名单"),
      );
      expect(clearBlacklistedWallpapers).toHaveBeenCalled();
      expect(toast.success).toHaveBeenCalledWith("黑名单已清空");
      expect(panel()!.textContent).toContain("暂无黑名单");
    });

    it("取消清空确认时不执行", async () => {
      vi.mocked(confirmDialog).mockResolvedValue(false);
      const p = await openPanel();
      await act(async () => {
        panelButton(p, "清空全部").click();
      });
      await flush();
      expect(clearBlacklistedWallpapers).not.toHaveBeenCalled();
      expect(p.textContent).toContain("https://full.example/a.jpg");
    });

    it("清空失败时 toast 错误", async () => {
      vi.mocked(clearBlacklistedWallpapers).mockRejectedValue(
        new Error("io"),
      );
      const p = await openPanel();
      await act(async () => {
        panelButton(p, "清空全部").click();
      });
      await flush();
      expect(clearBlacklistedWallpapers).toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith("清空黑名单失败：Error: io");
    });

    it("黑名单面板可通过关闭按钮、✕ 与遮罩点击关闭", async () => {
      await openPanel();
      await act(async () => {
        panelButton(panel()!, "关闭").click();
      });
      expect(panel()).toBeNull();

      await openPanel();
      await act(async () => {
        (
          panel()!.querySelector(
            'button[aria-label="关闭黑名单"]',
          ) as HTMLButtonElement
        ).click();
      });
      expect(panel()).toBeNull();

      await openPanel();
      await act(async () => {
        panel()!.dispatchEvent(
          new MouseEvent("click", { bubbles: true }),
        );
      });
      expect(panel()).toBeNull();
    });
  });
});
