import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Update } from "@tauri-apps/plugin-updater";
import Settings from "./Settings";
import { useUpdateStore } from "../store/update";
import { useTheme } from "../store/theme";

vi.mock("../lib/updater", () => ({
  isTauriRuntime: vi.fn(() => true),
  currentAppVersion: vi.fn(async () => "0.1.0"),
  createUpdateApi: vi.fn(() => ({
    check: vi.fn(async () => null),
  })),
  downloadWithProgress: vi.fn(async () => undefined),
}));

vi.mock("../lib/proxy", () => ({
  getGlobalProxy: vi.fn(async () => ""),
  saveGlobalProxy: vi.fn(async () => undefined),
}));

vi.mock("../lib/confirm", () => ({
  confirmDialog: vi.fn(async () => true),
}));

import { confirmDialog } from "../lib/confirm";

// node 26 provides an experimental global localStorage that conflicts with
// jsdom's; polyfill window.localStorage explicitly for tests.
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length(): number {
    return this.store.size;
  }
  clear(): void {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

Object.defineProperty(window, "localStorage", {
  value: new MemoryStorage(),
  configurable: true,
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderPage(container: HTMLElement, tab?: string): Promise<Root> {
  const root = createRoot(container);
  await act(async () => {
    root.render(<Settings />);
  });
  if (tab) {
    await clickButton(container, tab);
  }
  return root;
}

async function clickButton(
  container: HTMLElement,
  text: string,
): Promise<void> {
  const buttons = [...container.querySelectorAll("button")];
  const btn = buttons.find((b) => b.textContent === text);
  expect(btn).not.toBeUndefined();
  await act(async () => {
    btn!.click();
  });
}

function resetStore(): void {
  useUpdateStore.setState({
    status: "idle",
    currentVersion: null,
    availableVersion: null,
    downloadedBytes: 0,
    totalBytes: null,
    errorMessage: null,
    upToDate: false,
  });
}

describe("Settings update section", () => {
  let container: HTMLElement;

  beforeEach(() => {
    resetStore();
    vi.mocked(confirmDialog).mockResolvedValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it("renders the update section with check button and unknown version", async () => {
    const root = await renderPage(container, "应用更新");
    expect(container.textContent).toContain("应用更新");
    expect(container.textContent).toContain("当前版本：未知");
    const btn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "检查更新",
    );
    expect(btn).toBeDefined();
    await act(async () => {
      root.unmount();
    });
  });

  it("clicking check with no update shows up-to-date message", async () => {
    const root = await renderPage(container, "应用更新");
    await clickButton(container, "检查更新");
    expect(container.textContent).toContain("已是最新版本");
    expect(useUpdateStore.getState().currentVersion).toBe("0.1.0");
    await act(async () => {
      root.unmount();
    });
  });

  it("shows available version and download button when update exists", async () => {
    vi.mocked((await import("../lib/updater")).createUpdateApi).mockReturnValue(
      {
        check: vi.fn(async () => ({ version: "0.2.0" }) as unknown as Update),
      },
    );
    const root = await renderPage(container, "应用更新");
    await clickButton(container, "检查更新");
    expect(container.textContent).toContain("发现新版本 0.2.0");
    expect(useUpdateStore.getState().status).toBe("available");
    const downloadBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "下载并安装",
    );
    expect(downloadBtn).toBeDefined();
    await act(async () => {
      root.unmount();
    });
  });

  it("downloads and reports ready after confirmation", async () => {
    const updater = await import("../lib/updater");
    vi.mocked(updater.createUpdateApi).mockReturnValue({
      check: vi.fn(async () => ({ version: "0.2.0" }) as unknown as Update),
    });
    vi.mocked(updater.downloadWithProgress).mockImplementation(
      async (_update, listener) => {
        listener(0, 1000);
        listener(500, 1000);
        listener(1000, 1000);
      },
    );
    vi.mocked(confirmDialog).mockResolvedValue(true);
    const root = await renderPage(container, "应用更新");
    await clickButton(container, "检查更新");
    await clickButton(container, "下载并安装");
    expect(confirmDialog).toHaveBeenCalledWith(
      "下载并安装更新？安装过程中请保存好当前工作，应用将自动重启。",
    );
    expect(container.textContent).toContain(
      "更新已下载，应用即将自动重启并安装",
    );
    expect(useUpdateStore.getState().status).toBe("ready");
    expect(useUpdateStore.getState().downloadedBytes).toBe(1000);
    await act(async () => {
      root.unmount();
    });
  });

  it("does not download when the user cancels the confirmation", async () => {
    const updater = await import("../lib/updater");
    vi.mocked(updater.createUpdateApi).mockReturnValue({
      check: vi.fn(async () => ({ version: "0.2.0" }) as unknown as Update),
    });
    const downloadSpy = vi.fn();
    vi.mocked(updater.downloadWithProgress).mockImplementation(downloadSpy);
    vi.mocked(confirmDialog).mockResolvedValue(false);
    const root = await renderPage(container, "应用更新");
    await clickButton(container, "检查更新");
    await clickButton(container, "下载并安装");
    expect(downloadSpy).not.toHaveBeenCalled();
    expect(useUpdateStore.getState().status).toBe("available");
    await act(async () => {
      root.unmount();
    });
  });

  it("shows progress bar while downloading", async () => {
    const updater = await import("../lib/updater");
    vi.mocked(updater.createUpdateApi).mockReturnValue({
      check: vi.fn(async () => ({ version: "0.2.0" }) as unknown as Update),
    });
    vi.mocked(updater.downloadWithProgress).mockImplementation(
      async (_update, listener) => {
        listener(0, 1000);
        listener(500, 1000);
        await new Promise(() => {});
      },
    );
    const root = await renderPage(container, "应用更新");
    await clickButton(container, "检查更新");
    await clickButton(container, "下载并安装");
    expect(container.textContent).toContain("正在下载更新");
    expect(container.textContent).toContain("50%");
    const bar = container.querySelector('[data-testid="update-progress-bar"]');
    expect(bar).toBeDefined();
    expect((bar as HTMLElement).style.width).toBe("50%");
    await act(async () => {
      root.unmount();
    });
  });

  it("shows error message with retry button on failure", async () => {
    const updater = await import("../lib/updater");
    vi.mocked(updater.createUpdateApi).mockReturnValue({
      check: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const root = await renderPage(container, "应用更新");
    await clickButton(container, "检查更新");
    expect(container.textContent).toContain("network down");
    const retryBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "重试下载",
    );
    expect(retryBtn).toBeDefined();
    await act(async () => {
      root.unmount();
    });
  });
});

describe("Settings theme section", () => {
  let container: HTMLElement;

  beforeEach(() => {
    localStorage.clear();
    useTheme.setState({ theme: "light", accent: "blue", _userTouched: false });
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.accent;
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it("renders the appearance section with mode and accent options", async () => {
    const root = await renderPage(container);
    expect(container.textContent).toContain("外观");
    expect(container.textContent).toContain("亮色");
    expect(container.textContent).toContain("暗色");
    expect(container.querySelectorAll("[aria-pressed]").length).toBe(8);
    await act(async () => {
      root.unmount();
    });
  });

  it("switches between tabs and hides inactive content", async () => {
    const root = await renderPage(container);
    expect(container.textContent).toContain("明暗模式");
    expect(container.textContent).not.toContain("当前版本");
    await clickButton(container, "应用更新");
    expect(container.textContent).toContain("当前版本");
    expect(container.textContent).not.toContain("明暗模式");
    await clickButton(container, "网络代理");
    expect(container.textContent).toContain("代理地址");
    expect(container.textContent).not.toContain("明暗模式");
    await act(async () => {
      root.unmount();
    });
  });

  it("switches to dark mode from the appearance section", async () => {
    const root = await renderPage(container);
    await clickButton(container, "暗色");
    expect(useTheme.getState().theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "dark",
      accent: "blue",
    });
    await act(async () => {
      root.unmount();
    });
  });

  it("switches accent color from the appearance section", async () => {
    const root = await renderPage(container);
    const green = [...container.querySelectorAll("[aria-pressed]")][1];
    expect(green).toBeDefined();
    await act(async () => {
      (green as HTMLButtonElement).click();
    });
    expect(useTheme.getState().accent).toBe("green");
    expect(document.documentElement.dataset.accent).toBe("green");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "light",
      accent: "green",
    });
    await act(async () => {
      root.unmount();
    });
  });

  it("shows selected states for the current mode and accent", async () => {
    useTheme.setState({ theme: "dark", accent: "purple" });
    const root = await renderPage(container);
    const darkBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "暗色",
    );
    expect(darkBtn!.className).toContain("bg-accent-600");
    const purple = [...container.querySelectorAll("[aria-pressed]")][2];
    expect(purple.getAttribute("aria-pressed")).toBe("true");
    expect(purple.className).toContain("ring-2");
    await act(async () => {
      root.unmount();
    });
  });

  it("applies a custom hex color typed manually", async () => {
    const root = await renderPage(container);
    const input = container.querySelector(
      '[aria-label="自定义主题色十六进制值"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "ff5722");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(useTheme.getState().accent).toBe("#ff5722");
    expect(document.documentElement.dataset.accent).toBeUndefined();
    expect(
      document.documentElement.style.getPropertyValue("--color-accent-600"),
    ).toBe("#ff5722");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "light",
      accent: "#ff5722",
    });
    await act(async () => {
      root.unmount();
    });
  });

  it("applies a custom hex color on Enter", async () => {
    const root = await renderPage(container);
    const input = container.querySelector(
      '[aria-label="自定义主题色十六进制值"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "#00aabb");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(useTheme.getState().accent).toBe("#00aabb");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "light",
      accent: "#00aabb",
    });
    await act(async () => {
      root.unmount();
    });
  });

  it("shows an error for an invalid hex color", async () => {
    const root = await renderPage(container);
    const input = container.querySelector(
      '[aria-label="自定义主题色十六进制值"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "red");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(container.textContent).toContain("请输入 6 位十六进制颜色");
    expect(useTheme.getState().accent).toBe("blue");
    await act(async () => {
      root.unmount();
    });
  });

  it("applies a color picked from the picker", async () => {
    const root = await renderPage(container);
    const picker = container.querySelector(
      'input[type="color"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(picker, "#ff5722");
      picker.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(useTheme.getState().accent).toBe("#ff5722");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "light",
      accent: "#ff5722",
    });
    await act(async () => {
      root.unmount();
    });
  });
});

describe("Settings network proxy section", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it("loads and displays current global proxy", async () => {
    const proxyModule = await import("../lib/proxy");
    vi.mocked(proxyModule.getGlobalProxy).mockResolvedValue(
      "http://127.0.0.1:7890",
    );
    const root = await renderPage(container, "网络代理");
    expect(container.textContent).toContain("网络代理");
    const input = container.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("http://127.0.0.1:7890");
    await act(async () => {
      root.unmount();
    });
  });

  it("saves proxy and shows success message", async () => {
    const proxyModule = await import("../lib/proxy");
    vi.mocked(proxyModule.getGlobalProxy).mockResolvedValue("");
    const root = await renderPage(container, "网络代理");
    const input = container.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "http://192.168.1.1:8080");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clickButton(container, "保存");
    expect(proxyModule.saveGlobalProxy).toHaveBeenCalledWith(
      "http://192.168.1.1:8080",
    );
    expect(container.textContent).toContain("代理配置已保存");
    await act(async () => {
      root.unmount();
    });
  });

  it("shows error message when saving invalid proxy", async () => {
    const proxyModule = await import("../lib/proxy");
    vi.mocked(proxyModule.getGlobalProxy).mockResolvedValue("");
    vi.mocked(proxyModule.saveGlobalProxy).mockRejectedValue(
      new Error("代理地址无效"),
    );
    const root = await renderPage(container, "网络代理");
    await clickButton(container, "保存");
    expect(container.textContent).toContain("代理地址无效");
    await act(async () => {
      root.unmount();
    });
  });
});
