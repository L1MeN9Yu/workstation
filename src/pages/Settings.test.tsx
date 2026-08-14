import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Update } from "@tauri-apps/plugin-updater";
import Settings from "./Settings";
import { useUpdateStore } from "../store/update";

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function renderPage(container: HTMLElement): Promise<Root> {
  const root = createRoot(container);
  await act(async () => {
    root.render(<Settings />);
  });
  return root;
}

async function clickButton(container: HTMLElement, text: string): Promise<void> {
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
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it("renders the update section with check button and unknown version", async () => {
    const root = await renderPage(container);
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
    const root = await renderPage(container);
    await clickButton(container, "检查更新");
    expect(container.textContent).toContain("已是最新版本");
    expect(useUpdateStore.getState().currentVersion).toBe("0.1.0");
    await act(async () => {
      root.unmount();
    });
  });

  it("shows available version and download button when update exists", async () => {
    vi.mocked(
      (await import("../lib/updater")).createUpdateApi,
    ).mockReturnValue({
      check: vi.fn(async () => ({ version: "0.2.0" }) as unknown as Update),
    });
    const root = await renderPage(container);
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
    const root = await renderPage(container);
    await clickButton(container, "检查更新");
    await clickButton(container, "下载并安装");
    expect(container.textContent).toContain("更新已下载，应用即将自动重启并安装");
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
    vi.mocked(window.confirm).mockReturnValue(false);    const root = await renderPage(container);
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
    const root = await renderPage(container);
    await clickButton(container, "检查更新");
    await clickButton(container, "下载并安装");
    expect(container.textContent).toContain("正在下载更新");
    expect(container.textContent).toContain("50%");
    const bar = container.querySelector(".bg-blue-600");
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
    const root = await renderPage(container);
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
    const root = await renderPage(container);
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
    const root = await renderPage(container);
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
    const root = await renderPage(container);
    await clickButton(container, "保存");
    expect(container.textContent).toContain("代理地址无效");
    await act(async () => {
      root.unmount();
    });
  });
});
