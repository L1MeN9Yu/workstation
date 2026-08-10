import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTheme, initTheme, useInitTheme } from "./theme";

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

describe("theme store", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
    useTheme.setState({ theme: "light" });
    delete window.__TAURI__;
    vi.restoreAllMocks();
  });

  it("starts with light theme", () => {
    expect(useTheme.getState().theme).toBe("light");
  });

  it("toggles between light and dark and persists to localStorage", () => {
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("dark");
    expect(localStorage.getItem("workstation-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");

    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("light");
    expect(localStorage.getItem("workstation-theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("setTheme applies theme without persisting", () => {
    useTheme.getState().setTheme("dark");
    expect(useTheme.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("workstation-theme")).toBeNull();
  });

  it("initTheme loads saved theme from localStorage", async () => {
    localStorage.setItem("workstation-theme", "dark");
    await initTheme();
    expect(useTheme.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("initTheme falls back to light when nothing saved", async () => {
    await initTheme();
    expect(useTheme.getState().theme).toBe("light");
  });

  it("useInitTheme skips init when theme already applied", () => {
    useTheme.getState().setTheme("dark");
    useInitTheme();
    expect(useTheme.getState().theme).toBe("dark");
  });

  it("useInitTheme runs init when no theme applied", async () => {
    useInitTheme();
    await Promise.resolve();
    expect(useTheme.getState().theme).toBe("light");
  });

  describe("inside Tauri runtime", () => {
    it("persists and reads theme through configStore", async () => {
      vi.resetModules();
      Object.defineProperty(window, "__TAURI__", {
        value: {},
        configurable: true,
      });
      const writeConfigMock = vi.fn(async () => undefined);
      vi.doMock("../lib/configStore", () => ({
        readConfig: vi.fn(async () => ({ theme: "dark" })),
        writeConfig: writeConfigMock,
      }));
      const { initTheme, useTheme: reloadedTheme } = await import("./theme");
      expect(window.__TAURI__).toBeDefined();

      await initTheme();
      expect(reloadedTheme.getState().theme).toBe("dark");
      expect(window.localStorage.getItem("workstation-theme")).toBeNull();

      reloadedTheme.getState().toggle();
      expect(reloadedTheme.getState().theme).toBe("light");
      await new Promise((r) => setTimeout(r, 0));
      expect(writeConfigMock).toHaveBeenCalledWith("theme", { theme: "light" });
    });

    it("falls back to light when configStore read fails", async () => {
      vi.resetModules();
      Object.defineProperty(window, "__TAURI__", {
        value: {},
        configurable: true,
      });
      vi.doMock("../lib/configStore", () => ({
        readConfig: vi.fn(async () => {
          throw new Error("read failed");
        }),
        writeConfig: vi.fn(async () => undefined),
      }));
      const { initTheme, useTheme: reloadedTheme } = await import("./theme");

      await initTheme();
      expect(reloadedTheme.getState().theme).toBe("light");
    });

    it("falls back to light when stored config has no theme", async () => {
      vi.resetModules();
      Object.defineProperty(window, "__TAURI__", {
        value: {},
        configurable: true,
      });
      vi.doMock("../lib/configStore", () => ({
        readConfig: vi.fn(async () => ({})),
        writeConfig: vi.fn(async () => undefined),
      }));
      const { initTheme, useTheme: reloadedTheme } = await import("./theme");

      await initTheme();
      expect(reloadedTheme.getState().theme).toBe("light");
    });
  });
});
