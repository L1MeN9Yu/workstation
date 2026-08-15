import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { WallpaperLibrary } from "./WallpaperLibrary";
import {
  applyWallpaper,
  deleteLocalWallpapers,
  fetchWallpaperThumb,
  listLocalWallpapers,
  readLocalWallpaperFile,
} from "../../lib/wallpaper";
import type { LocalWallpaperInfo } from "../../lib/wallpaper";

vi.mock("../../lib/wallpaper", () => ({
  applyWallpaper: vi.fn(),
  deleteLocalWallpapers: vi.fn(),
  fetchWallpaperThumb: vi.fn(),
  formatFileSize: (bytes: number) => `${bytes}B`,
  formatModifiedTime: (ms: number) => `t${ms}`,
  listLocalWallpapers: vi.fn(),
  readLocalWallpaperFile: vi.fn(),
}));

vi.mock("../../components/WallpaperTargetSelect", () => ({
  WallpaperTargetSelect: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (t: string) => void;
  }) => (
    <select
      aria-label="应用目标"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="cmux">cmux</option>
      <option value="iterm2">iTerm2</option>
    </select>
  ),
}));

vi.mock("../../lib/confirm", () => ({
  confirmDialog: vi.fn(),
}));

import { confirmDialog } from "../../lib/confirm";

const ITEM_A: LocalWallpaperInfo = {
  fileName: "a.png",
  absolutePath: "/w/a.png",
  sizeBytes: 1024,
  modifiedAtMs: 1000,
  thumbDataUrl: "data:image/jpeg;base64,aaa",
};

const ITEM_B: LocalWallpaperInfo = {
  fileName: "b.jpg",
  absolutePath: "/w/b.jpg",
  sizeBytes: 2048,
  modifiedAtMs: 2000,
  thumbDataUrl: "",
};

function setup(container: HTMLElement, props?: Partial<React.ComponentProps<typeof WallpaperLibrary>>) {
  const root = createRoot(container);
  act(() => {
    root.render(
      <WallpaperLibrary
        applyTarget="cmux"
        onApplyTargetChange={vi.fn()}
        iterm2Profile=""
        onRequireProfile={vi.fn()}
        {...props}
      />,
    );
  });
  return root;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("WallpaperLibrary", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.clearAllMocks();
    vi.mocked(confirmDialog).mockResolvedValue(true);
    vi.mocked(fetchWallpaperThumb).mockResolvedValue("data:image/jpeg;base64,thumb");
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container.remove();
  });

  it("shows skeleton grid while loading then lists wallpaper cards", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A, ITEM_B]);
    root = setup(container);
    expect(container.querySelector('[aria-label="加载中"]')).not.toBeNull();
    await flush();
    expect(container.querySelector('[aria-label="加载中"]')).toBeNull();
    expect(container.textContent).toContain("a.png");
    expect(container.textContent).toContain("b.jpg");
    expect(container.textContent).toContain("刷新");
  });

  it("shows empty state when directory has no wallpapers", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([]);
    root = setup(container);
    await flush();
    expect(container.textContent).toContain("本地壁纸目录为空");
  });

  it("shows error when loading fails", async () => {
    vi.mocked(listLocalWallpapers).mockRejectedValue(new Error("boom"));
    root = setup(container);
    await flush();
    expect(container.textContent).toContain("加载本地壁纸失败：Error: boom");
  });

  it("renders skeleton thumbnail before thumb resolves then the image", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A]);
    let resolveThumb!: (v: string) => void;
    vi.mocked(fetchWallpaperThumb).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveThumb = resolve;
        }),
    );
    root = setup(container);
    await flush();
    expect(
      container.querySelector('[aria-label="加载缩略图 a.png"]'),
    ).not.toBeNull();
    await act(async () => {
      resolveThumb("data:image/jpeg;base64,thumb");
    });
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain("data:image/jpeg;base64,thumb");
  });

  it("keeps skeleton when thumbnail fails without crashing", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_B]);
    vi.mocked(fetchWallpaperThumb).mockRejectedValue(new Error("decode fail"));
    root = setup(container);
    await flush();
    expect(
      container.querySelector('[aria-label="加载缩略图 b.jpg"]'),
    ).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("fetches thumbnails for every listed wallpaper in parallel", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A, ITEM_B]);
    root = setup(container);
    await flush();
    expect(fetchWallpaperThumb).toHaveBeenCalledWith("/w/a.png");
    expect(fetchWallpaperThumb).toHaveBeenCalledWith("/w/b.jpg");
    expect(fetchWallpaperThumb).toHaveBeenCalledTimes(2);
  });

  it("refresh reloads the list", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A]);
    root = setup(container);
    await flush();
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A, ITEM_B]);
    const buttons = Array.from(container.querySelectorAll("button"));
    const refresh = buttons.find((b) => b.textContent === "刷新")!;
    act(() => {
      refresh.click();
    });
    expect(container.textContent).toContain("刷新中...");
    await flush();
    expect(container.textContent).toContain("b.jpg");
  });

  it("delete selected requires confirm and reloads after success", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A, ITEM_B]);
    vi.mocked(deleteLocalWallpapers).mockResolvedValue({
      deleted: ["/w/a.png"],
      errors: [],
    });
    root = setup(container);
    await flush();
    const checkbox = container.querySelector('input[aria-label="选择 a.png"]') as HTMLInputElement;
    act(() => {
      checkbox.click();
    });
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const del = buttons.find((b) => b.textContent?.includes("删除选中"))!;
    act(() => {
      del.click();
    });
    expect(confirmDialog).toHaveBeenCalledWith(
      "确认删除 1 张壁纸？此操作不可恢复。",
    );
    await flush();
    expect(deleteLocalWallpapers).toHaveBeenCalledWith(["/w/a.png"]);
    expect(container.textContent).toContain("已删除 1 张壁纸");
    expect(vi.mocked(listLocalWallpapers)).toHaveBeenCalledTimes(2);
  });

  it("cancelling delete keeps files untouched", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A]);
    vi.mocked(confirmDialog).mockResolvedValue(false);
    root = setup(container);
    await flush();
    const checkbox = container.querySelector('input[aria-label="选择 a.png"]') as HTMLInputElement;
    act(() => {
      checkbox.click();
    });
    await flush();
    const buttons = Array.from(container.querySelectorAll("button"));
    const del = buttons.find((b) => b.textContent?.includes("删除选中"))!;
    act(() => {
      del.click();
    });
    await flush();
    expect(deleteLocalWallpapers).not.toHaveBeenCalled();
    expect(vi.mocked(listLocalWallpapers)).toHaveBeenCalledTimes(1);
  });

  it("shows partial failure notice after delete", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A, ITEM_B]);
    vi.mocked(deleteLocalWallpapers).mockResolvedValue({
      deleted: ["/w/a.png"],
      errors: ["/w/b.jpg: EACCES"],
    });
    root = setup(container);
    await flush();
    const checkbox = container.querySelector('input[aria-label="选择 a.png"]') as HTMLInputElement;
    act(() => {
      checkbox.click();
    });
    await flush();
    const del = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("删除选中"),
    )!;
    act(() => {
      del.click();
    });
    await flush();
    expect(container.textContent).toContain("失败 1 张");
  });

  it("shows delete error when invoke rejects", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A]);
    vi.mocked(deleteLocalWallpapers).mockRejectedValue(new Error("io error"));
    root = setup(container);
    await flush();
    const checkbox = container.querySelector('input[aria-label="选择 a.png"]') as HTMLInputElement;
    act(() => {
      checkbox.click();
    });
    await flush();
    const del = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("删除选中"),
    )!;
    act(() => {
      del.click();
    });
    await flush();
    expect(container.textContent).toContain("删除失败：Error: io error");
  });

  it("select all toggles every wallpaper", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A, ITEM_B]);
    root = setup(container);
    await flush();
    const labels = Array.from(container.querySelectorAll("label"));
    const all = labels.find((l) => l.textContent === "全选")!;
    const input = all.querySelector('input[type="checkbox"]') as HTMLInputElement;
    act(() => {
      input.click();
    });
    const del = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("删除选中"),
    )!;
    expect(del.textContent).toContain("2");
    act(() => {
      del.click();
    });
    await flush();
    expect(deleteLocalWallpapers).toHaveBeenCalledWith(["/w/a.png", "/w/b.jpg"]);
  });

  it("apply calls applyWallpaper with cmux target and shows result", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A]);
    vi.mocked(applyWallpaper).mockResolvedValue({
      imagePath: "/w/a.png",
      reloadMessage: "已重载",
      target: "cmux",
    });
    root = setup(container, { applyTarget: "cmux" });
    await flush();
    const applyBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent === "应用",
    )!;
    act(() => {
      applyBtn.click();
    });
    expect(container.textContent).toContain("应用中...");
    await flush();
    expect(applyWallpaper).toHaveBeenCalledWith("/w/a.png", "cmux", "");
    expect(container.textContent).toContain("已应用到 cmux");
  });

  it("apply fails without iterm2 profile and notifies to open settings", async () => {
    const onRequireProfile = vi.fn();
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A]);
    root = setup(container, {
      applyTarget: "iterm2",
      iterm2Profile: "",
      onRequireProfile,
    });
    await flush();
    const applyBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent === "应用",
    )!;
    act(() => {
      applyBtn.click();
    });
    expect(onRequireProfile).toHaveBeenCalled();
    expect(applyWallpaper).not.toHaveBeenCalled();
  });

  it("apply shows error notice when it fails", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A]);
    vi.mocked(applyWallpaper).mockRejectedValue(new Error("ghosty missing"));
    root = setup(container);
    await flush();
    const applyBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent === "应用",
    )!;
    act(() => {
      applyBtn.click();
    });
    await flush();
    expect(container.textContent).toContain("应用失败：Error: ghosty missing");
  });

  it("opens preview dialog with data url and closes on ✕", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A]);
    vi.mocked(readLocalWallpaperFile).mockResolvedValue("data:image/png;base64,big");
    root = setup(container);
    await flush();
    const thumb = container.querySelector("button[title='点击预览大图']") as HTMLButtonElement;
    act(() => {
      thumb.click();
    });
    expect(container.textContent).toContain("加载中...");
    await flush();
    const dialog = container.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("a.png");
    const img = dialog.querySelector("img") as HTMLImageElement;
    expect(img.src).toBe("data:image/png;base64,big");
    const close = dialog.querySelector('button[aria-label="关闭预览"]') as HTMLButtonElement;
    act(() => {
      close.click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("preview shows error and closes on mask click", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A]);
    vi.mocked(readLocalWallpaperFile).mockRejectedValue(new Error("missing"));
    root = setup(container);
    await flush();
    const thumb = container.querySelector("button[title='点击预览大图']") as HTMLButtonElement;
    act(() => {
      thumb.click();
    });
    await flush();
    expect(container.textContent).toContain("预览加载失败：Error: missing");
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement;
    act(() => {
      dialog.click();
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("preview closes on Escape key", async () => {
    vi.mocked(listLocalWallpapers).mockResolvedValue([ITEM_A]);
    vi.mocked(readLocalWallpaperFile).mockResolvedValue("data:image/png;base64,big");
    root = setup(container);
    await flush();
    const thumb = container.querySelector("button[title='点击预览大图']") as HTMLButtonElement;
    act(() => {
      thumb.click();
    });
    await flush();
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
