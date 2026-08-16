import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";

const invokeMock = vi.fn();
const pluginCheckMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: (...args: unknown[]) => pluginCheckMock(...args),
}));

import {
  isTauriRuntime,
  currentAppVersion,
  createUpdateApi,
  downloadWithProgress,
  relaunch,
} from "./updater";

describe("updater lib", () => {
  beforeEach(() => {
    delete window.__TAURI_INTERNALS__;
    invokeMock.mockReset();
    pluginCheckMock.mockReset();
    vi.restoreAllMocks();
  });

  it("isTauriRuntime detects the Tauri runtime", () => {
    expect(isTauriRuntime()).toBe(false);
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    expect(isTauriRuntime()).toBe(true);
  });

  it("currentAppVersion returns null outside Tauri runtime", async () => {
    expect(await currentAppVersion()).toBeNull();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("currentAppVersion invokes app_version inside Tauri runtime", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    invokeMock.mockResolvedValue("1.2.3");
    expect(await currentAppVersion()).toBe("1.2.3");
    expect(invokeMock).toHaveBeenCalledWith("app_version");
  });

  it("currentAppVersion falls back to null when invoke fails", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    invokeMock.mockRejectedValue(new Error("not available"));
    expect(await currentAppVersion()).toBeNull();
  });

  it("relaunch rejects outside Tauri runtime without invoking", async () => {
    await expect(relaunch()).rejects.toThrow("不支持重启应用");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("relaunch invokes relaunch_app inside Tauri runtime", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    invokeMock.mockResolvedValue(undefined);
    await expect(relaunch()).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith("relaunch_app");
  });

  it("relaunch propagates invoke failure", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    invokeMock.mockRejectedValue(new Error("relaunch failed"));
    await expect(relaunch()).rejects.toThrow("relaunch failed");
    expect(invokeMock).toHaveBeenCalledWith("relaunch_app");
  });

  it("createUpdateApi exposes the plugin check function", () => {
    const api = createUpdateApi();
    expect(typeof api.check).toBe("function");
  });

  it("createUpdateApi without proxy calls check without options", async () => {
    pluginCheckMock.mockResolvedValue(null);
    await createUpdateApi().check();
    expect(pluginCheckMock).toHaveBeenCalledWith();
  });

  it("createUpdateApi with proxy passes proxy option to check", async () => {
    pluginCheckMock.mockResolvedValue(null);
    await createUpdateApi("http://127.0.0.1:7890").check();
    expect(pluginCheckMock).toHaveBeenCalledWith({ proxy: "http://127.0.0.1:7890" });
  });

  it("downloadWithProgress reports total from Started and accumulates chunks", async () => {
    const listener = vi.fn();
    const update = {
      downloadAndInstall: vi.fn(async (onEvent: (e: unknown) => void) => {
        onEvent({ event: "Started", data: { contentLength: 1000 } });
        onEvent({ event: "Progress", data: { chunkLength: 400 } });
        onEvent({ event: "Progress", data: { chunkLength: 600 } });
        onEvent({ event: "Finished" });
      }),
    } as unknown as Update;
    await downloadWithProgress(update, listener);
    expect(listener).toHaveBeenNthCalledWith(1, 0, 1000);
    expect(listener).toHaveBeenNthCalledWith(2, 400, 1000);
    expect(listener).toHaveBeenNthCalledWith(3, 1000, 1000);
  });

  it("downloadWithProgress handles missing contentLength", async () => {
    const listener = vi.fn();
    const update = {
      downloadAndInstall: vi.fn(async (onEvent: (e: unknown) => void) => {
        onEvent({ event: "Started", data: {} });
        onEvent({ event: "Progress", data: { chunkLength: 100 } });
      }),
    } as unknown as Update;
    await downloadWithProgress(update, listener);
    expect(listener).toHaveBeenNthCalledWith(1, 0, 0);
    expect(listener).toHaveBeenNthCalledWith(2, 100, 0);
  });
});
