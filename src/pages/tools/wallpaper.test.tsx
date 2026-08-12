import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import WallpaperTool from "./wallpaper";
import {
  applyWallpaperToGhosty,
  downloadWallpaper,
  loadWallpaperSettings,
  saveWallpaperProxy,
  saveWallpaperSources,
  searchWallpapers,
} from "../../lib/wallpaper";

const { readyCallbackRef } = vi.hoisted(() => ({
  readyCallbackRef: { current: () => {} },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, cb: () => void) => {
    readyCallbackRef.current = cb;
    return Promise.resolve(() => {});
  }),
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
  applyWallpaperToGhosty: vi.fn(),
  downloadWallpaper: vi.fn(),
  loadWallpaperSettings: vi.fn(),
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
    expect(saveWallpaperProxy).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy: "http://127.0.0.1:7890",
        downloadDir: "",
      }),
    );
    expect(container.textContent).toContain("设置已保存");
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
      expect(container.textContent).toContain("参数已自动保存");
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
      proxy: "",
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
      proxy: "",
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
      proxy: "",
      downloadDir: "",
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
    expect(container.textContent).toContain("seed 已刷新并保存");
  });
});
