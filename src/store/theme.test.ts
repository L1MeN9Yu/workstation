import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useTheme,
  initTheme,
  useInitTheme,
  applyTheme,
  persistTheme,
  parseThemeSettings,
  resolveTheme,
  getSystemPrefersDark,
  subscribeSystemTheme,
  ACCENT_COLORS,
  ACCENT_VARS,
  isHexColor,
  isAccentColor,
  type AccentColor,
} from "./theme";

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

let prefersDark = false;
let setPrefersDark: (matches: boolean) => void;

function installMatchMediaMock() {
  const changeListeners = new Set<EventListener>();
  const legacyListeners = new Set<(e: MediaQueryListEvent) => void>();
  window.matchMedia = vi.fn((query: string) => ({
    matches: prefersDark,
    media: query,
    onchange: null,
    addEventListener: (
      eventType: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      if (eventType === "change") {
        changeListeners.add(listener as EventListener);
      }
    },
    removeEventListener: (
      _eventType: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      changeListeners.delete(listener as EventListener);
    },
    addListener: (listener: (e: MediaQueryListEvent) => void) => {
      legacyListeners.add(listener);
    },
    removeListener: (listener: (e: MediaQueryListEvent) => void) => {
      legacyListeners.delete(listener);
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  setPrefersDark = (matches: boolean) => {
    prefersDark = matches;
    changeListeners.forEach((listener) =>
      listener({ matches } as unknown as Event),
    );
    legacyListeners.forEach((listener) =>
      listener({ matches } as MediaQueryListEvent),
    );
  };
}

describe("theme store", () => {
  beforeEach(() => {
    prefersDark = false;
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.accent;
    for (const variable of ACCENT_VARS) {
      document.documentElement.style.removeProperty(variable);
    }
    useTheme.setState({
      theme: "system",
      resolvedTheme: "light",
      accent: "blue",
      _userTouched: false,
    });
    delete window.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
    installMatchMediaMock();
  });

  it("starts with system theme and blue accent", () => {
    expect(useTheme.getState().theme).toBe("system");
    expect(useTheme.getState().resolvedTheme).toBe("light");
    expect(useTheme.getState().accent).toBe("blue");
  });

  describe("resolveTheme", () => {
    it("resolves explicit themes directly", () => {
      expect(resolveTheme("light", true)).toBe("light");
      expect(resolveTheme("light", false)).toBe("light");
      expect(resolveTheme("dark", true)).toBe("dark");
      expect(resolveTheme("dark", false)).toBe("dark");
    });

    it("resolves system theme from the prefersDark flag", () => {
      expect(resolveTheme("system", true)).toBe("dark");
      expect(resolveTheme("system", false)).toBe("light");
    });
  });

  describe("getSystemPrefersDark", () => {
    it("reads the system dark preference from matchMedia", () => {
      expect(getSystemPrefersDark()).toBe(false);
      setPrefersDark(true);
      expect(getSystemPrefersDark()).toBe(true);
    });

    it("returns false when matchMedia is unavailable", () => {
      delete (window as { matchMedia?: unknown }).matchMedia;
      expect(getSystemPrefersDark()).toBe(false);
    });
  });

  describe("subscribeSystemTheme", () => {
    it("notifies the listener on preference changes until unsubscribed", () => {
      const listener = vi.fn();
      const unsubscribe = subscribeSystemTheme(listener);
      setPrefersDark(true);
      expect(listener).toHaveBeenLastCalledWith(true);
      setPrefersDark(false);
      expect(listener).toHaveBeenLastCalledWith(false);
      unsubscribe();
      setPrefersDark(true);
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it("falls back to legacy addListener when addEventListener is missing", () => {
      const legacyListeners: Array<(e: MediaQueryListEvent) => void> = [];
      window.matchMedia = vi.fn(() => ({
        matches: prefersDark,
        media: "(prefers-color-scheme: dark)",
        onchange: null,
        addListener: (listener: (e: MediaQueryListEvent) => void) => {
          legacyListeners.push(listener);
        },
        removeListener: vi.fn(),
        dispatchEvent: () => false,
      })) as unknown as typeof window.matchMedia;
      const listener = vi.fn();
      const unsubscribe = subscribeSystemTheme(listener);
      legacyListeners.forEach((l) =>
        l({ matches: true } as MediaQueryListEvent),
      );
      expect(listener).toHaveBeenLastCalledWith(true);
      unsubscribe();
    });

    it("is a no-op when matchMedia is unavailable", () => {
      delete (window as { matchMedia?: unknown }).matchMedia;
      const unsubscribe = subscribeSystemTheme(() => {});
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  it("toggles between light and dark and persists settings to localStorage", () => {
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("dark");
    expect(useTheme.getState().resolvedTheme).toBe("dark");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "dark",
      accent: "blue",
    });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");

    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("light");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "light",
      accent: "blue",
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggle inverts the resolved theme when in system mode", () => {
    useTheme.setState({ theme: "system", resolvedTheme: "dark" });
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("light");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "light",
      accent: "blue",
    });
  });

  it("toggle keeps the current accent", () => {
    useTheme.setState({ accent: "purple" });
    useTheme.getState().toggle();
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "dark",
      accent: "purple",
    });
  });

  it("setTheme applies and persists the chosen theme", () => {
    useTheme.getState().setTheme("dark");
    expect(useTheme.getState().theme).toBe("dark");
    expect(useTheme.getState().resolvedTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "dark",
      accent: "blue",
    });
  });

  it("setTheme('system') resolves against the system preference", () => {
    setPrefersDark(true);
    useTheme.getState().setTheme("system");
    expect(useTheme.getState().theme).toBe("system");
    expect(useTheme.getState().resolvedTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "system",
      accent: "blue",
    });
  });

  it("setAccent applies accent and persists settings", () => {
    useTheme.getState().setAccent("green");
    expect(useTheme.getState().accent).toBe("green");
    expect(document.documentElement.dataset.accent).toBe("green");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "system",
      accent: "green",
    });
  });

  it("setAccent persists the current theme", () => {
    useTheme.setState({ theme: "dark" });
    useTheme.getState().setAccent("orange");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "dark",
      accent: "orange",
    });
  });

  it("supports the full accent palette", () => {
    expect(ACCENT_COLORS).toEqual([
      "blue",
      "green",
      "purple",
      "orange",
      "red",
      "cyan",
      "pink",
      "indigo",
    ]);
    for (const color of ACCENT_COLORS) {
      useTheme.getState().setAccent(color);
      expect(useTheme.getState().accent).toBe(color);
      expect(document.documentElement.dataset.accent).toBe(color);
    }
  });

  it("applyTheme toggles the dark class and dataset attributes", () => {
    applyTheme("dark", "green");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("green");

    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.accent).toBe("blue");
  });

  it("applyTheme('system') follows the system preference", () => {
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    setPrefersDark(true);
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  describe("custom hex accent", () => {
    it("isHexColor accepts 6-digit hex with or without uppercase", () => {
      expect(isHexColor("#ff5722")).toBe(true);
      expect(isHexColor("#FF5722")).toBe(true);
      expect(isHexColor("#f57")).toBe(false);
      expect(isHexColor("ff5722")).toBe(false);
      expect(isHexColor("#ff572")).toBe(false);
      expect(isHexColor("#gggggg")).toBe(false);
    });

    it("isAccentColor accepts presets and hex, rejects others", () => {
      expect(isAccentColor("green")).toBe(true);
      expect(isAccentColor("#ff5722")).toBe(true);
      expect(isAccentColor(42)).toBe(false);
      expect(isAccentColor("brown")).toBe(false);
    });

    it("applyTheme with a hex accent injects shade variables", () => {
      applyTheme("dark", "#ff5722");
      expect(document.documentElement.dataset.theme).toBe("dark");
      expect(document.documentElement.dataset.accent).toBeUndefined();
      const rootStyle = document.documentElement.style;
      expect(rootStyle.getPropertyValue("--color-accent-300")).toBe(
        "color-mix(in srgb, #ff5722 35%, white)",
      );
      expect(rootStyle.getPropertyValue("--color-accent-600")).toBe("#ff5722");
      expect(rootStyle.getPropertyValue("--color-accent-800")).toBe(
        "color-mix(in srgb, #ff5722 85%, black)",
      );
    });

    it("applyTheme with an invalid accent leaves styles untouched", () => {
      applyTheme("dark", "nope" as AccentColor);
      expect(document.documentElement.dataset.accent).toBeUndefined();
      expect(
        document.documentElement.style.getPropertyValue("--color-accent-600"),
      ).toBe("");
    });

    it("applyTheme back to a preset clears injected variables", () => {
      applyTheme("light", "#ff5722");
      expect(
        document.documentElement.style.getPropertyValue("--color-accent-600"),
      ).toBe("#ff5722");
      applyTheme("light", "green");
      expect(document.documentElement.dataset.accent).toBe("green");
      for (const variable of ACCENT_VARS) {
        expect(document.documentElement.style.getPropertyValue(variable)).toBe(
          "",
        );
      }
    });

    it("setAccent persists and applies a custom hex color", () => {
      useTheme.getState().setAccent("#ff5722");
      expect(useTheme.getState().accent).toBe("#ff5722");
      expect(document.documentElement.dataset.accent).toBeUndefined();
      expect(
        document.documentElement.style.getPropertyValue("--color-accent-600"),
      ).toBe("#ff5722");
      expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
        theme: "system",
        accent: "#ff5722",
      });
    });

    it("initTheme restores a saved custom hex color", async () => {
      localStorage.setItem(
        "workstation-theme",
        JSON.stringify({ theme: "dark", accent: "#00aabb" }),
      );
      await initTheme();
      expect(useTheme.getState().theme).toBe("dark");
      expect(useTheme.getState().accent).toBe("#00aabb");
      expect(document.documentElement.dataset.accent).toBeUndefined();
      expect(
        document.documentElement.style.getPropertyValue("--color-accent-600"),
      ).toBe("#00aabb");
    });
  });

  it("persistTheme writes settings to localStorage in web environment", () => {
    persistTheme({ theme: "system", accent: "purple" });
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "system",
      accent: "purple",
    });
  });

  describe("parseThemeSettings", () => {
    it("parses a legacy plain string value", () => {
      expect(parseThemeSettings("dark")).toEqual({
        theme: "dark",
        accent: "blue",
      });
    });

    it("parses a plain system string", () => {
      expect(parseThemeSettings("system")).toEqual({
        theme: "system",
        accent: "blue",
      });
    });

    it("parses a JSON string with both fields", () => {
      expect(parseThemeSettings('{"theme":"system","accent":"green"}')).toEqual(
        {
          theme: "system",
          accent: "green",
        },
      );
    });

    it("returns null for invalid JSON string", () => {
      expect(parseThemeSettings("{not-json")).toBeNull();
    });

    it("returns null for a JSON string that parses to a non-object", () => {
      expect(parseThemeSettings("42")).toBeNull();
    });

    it("returns null for null", () => {
      expect(parseThemeSettings(null)).toBeNull();
    });

    it("returns null for a non-object value", () => {
      expect(parseThemeSettings(42)).toBeNull();
    });

    it("defaults missing theme to system", () => {
      expect(parseThemeSettings({})).toEqual({
        theme: "system",
        accent: "blue",
      });
    });

    it("defaults invalid theme to system", () => {
      expect(parseThemeSettings({ theme: "sepia" })).toEqual({
        theme: "system",
        accent: "blue",
      });
    });

    it("defaults missing accent to blue", () => {
      expect(parseThemeSettings({ theme: "dark" })).toEqual({
        theme: "dark",
        accent: "blue",
      });
    });

    it("defaults invalid accent to blue", () => {
      expect(parseThemeSettings({ theme: "dark", accent: "brown" })).toEqual({
        theme: "dark",
        accent: "blue",
      });
    });

    it("accepts a custom hex accent", () => {
      expect(parseThemeSettings({ theme: "dark", accent: "#ff5722" })).toEqual({
        theme: "dark",
        accent: "#ff5722",
      });
    });
  });

  it("initTheme loads saved settings from localStorage", async () => {
    localStorage.setItem(
      "workstation-theme",
      JSON.stringify({ theme: "dark", accent: "green" }),
    );
    await initTheme();
    expect(useTheme.getState().theme).toBe("dark");
    expect(useTheme.getState().accent).toBe("green");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("green");
  });

  it("initTheme reads legacy plain string from localStorage", async () => {
    localStorage.setItem("workstation-theme", "dark");
    await initTheme();
    expect(useTheme.getState().theme).toBe("dark");
    expect(useTheme.getState().accent).toBe("blue");
  });

  it("initTheme falls back to defaults when localStorage holds invalid JSON", async () => {
    localStorage.setItem("workstation-theme", "{broken");
    await initTheme();
    expect(useTheme.getState().theme).toBe("system");
    expect(useTheme.getState().accent).toBe("blue");
  });

  it("initTheme falls back to system when nothing saved", async () => {
    await initTheme();
    expect(useTheme.getState().theme).toBe("system");
    expect(useTheme.getState().accent).toBe("blue");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("initTheme with system theme follows the current system preference", async () => {
    setPrefersDark(true);
    await initTheme();
    expect(useTheme.getState().theme).toBe("system");
    expect(useTheme.getState().resolvedTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("system preference changes update the resolved theme in system mode", async () => {
    await initTheme();
    expect(useTheme.getState().resolvedTheme).toBe("light");
    setPrefersDark(true);
    expect(useTheme.getState().theme).toBe("system");
    expect(useTheme.getState().resolvedTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    setPrefersDark(false);
    expect(useTheme.getState().resolvedTheme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("system preference changes are ignored outside system mode", async () => {
    localStorage.setItem(
      "workstation-theme",
      JSON.stringify({ theme: "dark", accent: "blue" }),
    );
    await initTheme();
    setPrefersDark(false);
    expect(useTheme.getState().theme).toBe("dark");
    expect(useTheme.getState().resolvedTheme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("useInitTheme skips init when theme already applied", () => {
    useTheme.getState().setTheme("dark");
    useInitTheme();
    expect(useTheme.getState().theme).toBe("dark");
  });

  it("useInitTheme runs init when no theme applied", async () => {
    useInitTheme();
    await Promise.resolve();
    expect(useTheme.getState().theme).toBe("system");
  });

  describe("inside Tauri runtime", () => {
    it("persists and reads theme settings through configStore", async () => {
      vi.resetModules();
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {},
        configurable: true,
      });
      const writeConfigMock = vi.fn(async () => undefined);
      vi.doMock("../lib/configStore", () => ({
        readConfig: vi.fn(async () => ({ theme: "dark", accent: "purple" })),
        writeConfig: writeConfigMock,
      }));
      const { initTheme, useTheme: reloadedTheme } = await import("./theme");
      expect(window.__TAURI_INTERNALS__).toBeDefined();

      await initTheme();
      expect(reloadedTheme.getState().theme).toBe("dark");
      expect(reloadedTheme.getState().accent).toBe("purple");
      expect(window.localStorage.getItem("workstation-theme")).toBeNull();

      reloadedTheme.getState().toggle();
      expect(reloadedTheme.getState().theme).toBe("light");
      await new Promise((r) => setTimeout(r, 0));
      expect(writeConfigMock).toHaveBeenCalledWith("theme", {
        theme: "light",
        accent: "purple",
      });
    });

    it("reads legacy config without accent and falls back to blue", async () => {
      vi.resetModules();
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {},
        configurable: true,
      });
      vi.doMock("../lib/configStore", () => ({
        readConfig: vi.fn(async () => ({ theme: "dark" })),
        writeConfig: vi.fn(async () => undefined),
      }));
      const { initTheme, useTheme: reloadedTheme } = await import("./theme");

      await initTheme();
      expect(reloadedTheme.getState().theme).toBe("dark");
      expect(reloadedTheme.getState().accent).toBe("blue");
    });

    it("setAccent writes through configStore in Tauri", async () => {
      vi.resetModules();
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {},
        configurable: true,
      });
      const writeConfigMock = vi.fn(async () => undefined);
      vi.doMock("../lib/configStore", () => ({
        readConfig: vi.fn(async () => null),
        writeConfig: writeConfigMock,
      }));
      const { useTheme: reloadedTheme } = await import("./theme");

      reloadedTheme.getState().setAccent("orange");
      await new Promise((r) => setTimeout(r, 0));
      expect(writeConfigMock).toHaveBeenCalledWith("theme", {
        theme: "system",
        accent: "orange",
      });
    });

    it("falls back to defaults when configStore read fails", async () => {
      vi.resetModules();
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
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
      expect(reloadedTheme.getState().theme).toBe("system");
      expect(reloadedTheme.getState().accent).toBe("blue");
    });

    it("falls back to defaults when stored config is a non-object value", async () => {
      vi.resetModules();
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {},
        configurable: true,
      });
      vi.doMock("../lib/configStore", () => ({
        readConfig: vi.fn(async () => 42),
        writeConfig: vi.fn(async () => undefined),
      }));
      const { initTheme, useTheme: reloadedTheme } = await import("./theme");

      await initTheme();
      expect(reloadedTheme.getState().theme).toBe("system");
      expect(reloadedTheme.getState().accent).toBe("blue");
    });

    it("initTheme does not override a toggle made before init completes", async () => {
      vi.resetModules();
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {},
        configurable: true,
      });
      vi.doMock("../lib/configStore", () => ({
        readConfig: vi.fn(async () => ({ theme: "dark" })),
        writeConfig: vi.fn(async () => undefined),
      }));
      const { initTheme, useTheme: reloadedTheme } = await import("./theme");

      reloadedTheme.getState().toggle();
      expect(reloadedTheme.getState().theme).toBe("dark");

      await initTheme();
      expect(reloadedTheme.getState().theme).toBe("dark");
    });
  });
});
