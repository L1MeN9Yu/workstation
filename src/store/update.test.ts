import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Update } from "@tauri-apps/plugin-updater";

function installUpdaterMock(overrides: Record<string, unknown> = {}) {
  vi.resetModules();
  vi.doMock("../lib/updater", () => ({
    isTauriRuntime: vi.fn(() => true),
    currentAppVersion: vi.fn(async () => "0.1.0"),
    createUpdateApi: vi.fn(() => ({
      check: vi.fn(async () => null),
    })),
    downloadWithProgress: vi.fn(async () => undefined),
    ...overrides,
  }));
}

const fakeUpdate = { version: "0.2.0" } as unknown as Update;

async function loadStore() {
  return import("./update");
}

describe("update store", () => {
  beforeEach(() => {
    delete window.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
    vi.unmock("../lib/updater");
  });

  it("initial state is idle", async () => {
    installUpdaterMock();
    const { useUpdateStore } = await loadStore();
    expect(useUpdateStore.getState().status).toBe("idle");
    expect(useUpdateStore.getState().currentVersion).toBeNull();
    expect(useUpdateStore.getState().upToDate).toBe(false);
  });

  it("check outside Tauri runtime reports error", async () => {
    installUpdaterMock({ isTauriRuntime: vi.fn(() => false) });
    const { useUpdateStore } = await loadStore();
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().errorMessage).toContain("不支持检查更新");
  });

  it("check with no update marks upToDate and stores version", async () => {
    installUpdaterMock();
    const { useUpdateStore } = await loadStore();
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().status).toBe("idle");
    expect(useUpdateStore.getState().upToDate).toBe(true);
    expect(useUpdateStore.getState().currentVersion).toBe("0.1.0");
  });

  it("check with available update transitions to available", async () => {
    installUpdaterMock({
      createUpdateApi: vi.fn(() => ({
        check: vi.fn(async () => fakeUpdate),
      })),
    });
    const { useUpdateStore } = await loadStore();
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().status).toBe("available");
    expect(useUpdateStore.getState().availableVersion).toBe("0.2.0");
    expect(useUpdateStore.getState().upToDate).toBe(false);
  });

  it("check failure transitions to error", async () => {
    installUpdaterMock({
      createUpdateApi: vi.fn(() => ({
        check: vi.fn(async () => {
          throw new Error("network down");
        }),
      })),
    });
    const { useUpdateStore } = await loadStore();
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().errorMessage).toContain("network down");
  });

  it("re-entrant check while checking is ignored", async () => {
    let resolveCheck!: (u: Update | null) => void;
    installUpdaterMock({
      createUpdateApi: vi.fn(() => ({
        check: vi.fn(
          () =>
            new Promise<Update | null>((resolve) => {
              resolveCheck = resolve;
            }),
        ),
      })),
    });
    const { useUpdateStore } = await loadStore();
    const first = useUpdateStore.getState().check();
    const second = useUpdateStore.getState().check();
    resolveCheck(null);
    await Promise.all([first, second]);
    expect(useUpdateStore.getState().status).toBe("idle");
    expect(useUpdateStore.getState().upToDate).toBe(true);
  });

  it("downloadAndInstall downloads with progress then ready", async () => {
    const onProgress = vi.fn();
    installUpdaterMock({
      createUpdateApi: vi.fn(() => ({
        check: vi.fn(async () => fakeUpdate),
      })),
      downloadWithProgress: vi.fn(async (_update, listener) => {
        listener(0, 1000);
        onProgress(0, 1000);
        listener(500, 1000);
        onProgress(500, 1000);
        listener(1000, 1000);
        onProgress(1000, 1000);
      }),
    });
    const { useUpdateStore } = await loadStore();
    await useUpdateStore.getState().check();
    expect(useUpdateStore.getState().status).toBe("available");
    await useUpdateStore.getState().downloadAndInstall();
    expect(useUpdateStore.getState().status).toBe("ready");
    expect(useUpdateStore.getState().downloadedBytes).toBe(1000);
    expect(useUpdateStore.getState().totalBytes).toBe(1000);
    expect(useUpdateStore.getState().errorMessage).toBeNull();
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("downloadAndInstall outside Tauri runtime reports error", async () => {
    installUpdaterMock({
      isTauriRuntime: vi.fn(() => false),
    });
    const { useUpdateStore } = await loadStore();
    await useUpdateStore.getState().downloadAndInstall();
    expect(useUpdateStore.getState().status).toBe("error");
  });

  it("downloadAndInstall with no update marks upToDate", async () => {
    installUpdaterMock();
    const { useUpdateStore } = await loadStore();
    await useUpdateStore.getState().downloadAndInstall();
    expect(useUpdateStore.getState().status).toBe("idle");
    expect(useUpdateStore.getState().upToDate).toBe(true);
  });

  it("downloadAndInstall failure transitions to error for retry", async () => {
    installUpdaterMock({
      createUpdateApi: vi.fn(() => ({
        check: vi.fn(async () => fakeUpdate),
      })),
      downloadWithProgress: vi.fn(async () => {
        throw new Error("download interrupted");
      }),
    });
    const { useUpdateStore } = await loadStore();
    await useUpdateStore.getState().downloadAndInstall();
    expect(useUpdateStore.getState().status).toBe("error");
    expect(useUpdateStore.getState().errorMessage).toContain("download interrupted");
  });

  it("retry after failure can succeed", async () => {
    let failed = true;
    installUpdaterMock({
      createUpdateApi: vi.fn(() => ({
        check: vi.fn(async () => fakeUpdate),
      })),
      downloadWithProgress: vi.fn(async () => {
        if (failed) {
          failed = false;
          throw new Error("download interrupted");
        }
      }),
    });
    const { useUpdateStore } = await loadStore();
    await useUpdateStore.getState().downloadAndInstall();
    expect(useUpdateStore.getState().status).toBe("error");
    await useUpdateStore.getState().downloadAndInstall();
    expect(useUpdateStore.getState().status).toBe("ready");
  });

  it("re-entrant downloadAndInstall while downloading is ignored", async () => {
    let downloadCalls = 0;
    installUpdaterMock({
      createUpdateApi: vi.fn(() => ({
        check: vi.fn(async () => fakeUpdate),
      })),
      downloadWithProgress: vi.fn(() => {
        downloadCalls += 1;
        return new Promise<void>(() => {});
      }),
    });
    const { useUpdateStore } = await loadStore();
    void useUpdateStore.getState().downloadAndInstall();
    void useUpdateStore.getState().downloadAndInstall();
    await Promise.resolve();
    await Promise.resolve();
    expect(downloadCalls).toBe(1);
    expect(useUpdateStore.getState().status).toBe("downloading");
  });

  it("initUpdateCheck runs once inside Tauri runtime", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    installUpdaterMock();
    const { useUpdateStore, initUpdateCheck } = await loadStore();
    const spy = vi.spyOn(useUpdateStore.getState(), "check");
    initUpdateCheck();
    initUpdateCheck();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("initUpdateCheck skips outside Tauri runtime", async () => {
    installUpdaterMock({ isTauriRuntime: vi.fn(() => false) });
    const { useUpdateStore, initUpdateCheck } = await loadStore();
    const spy = vi.spyOn(useUpdateStore.getState(), "check");
    initUpdateCheck();
    expect(spy).not.toHaveBeenCalled();
  });
});
