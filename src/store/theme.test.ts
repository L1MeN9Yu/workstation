import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useTheme,
  initTheme,
  useInitTheme,
  applyTheme,
  persistTheme,
  parseThemeSettings,
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

describe("theme store", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.accent;
    for (const variable of ACCENT_VARS) {
      document.documentElement.style.removeProperty(variable);
    }
    useTheme.setState({ theme: "light", accent: "blue", _userTouched: false });
    delete window.__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  it("starts with light theme and blue accent", () => {
    expect(useTheme.getState().theme).toBe("light");
    expect(useTheme.getState().accent).toBe("blue");
  });

  it("toggles between light and dark and persists settings to localStorage", () => {
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe("dark");
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

  it("toggle keeps the current accent", () => {
    useTheme.setState({ accent: "purple" });
    useTheme.getState().toggle();
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "dark",
      accent: "purple",
    });
  });

  it("setTheme applies theme without persisting", () => {
    useTheme.getState().setTheme("dark");
    expect(useTheme.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("workstation-theme")).toBeNull();
  });

  it("setAccent applies accent and persists settings", () => {
    useTheme.getState().setAccent("green");
    expect(useTheme.getState().accent).toBe("green");
    expect(document.documentElement.dataset.accent).toBe("green");
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "light",
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
        theme: "light",
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
    persistTheme({ theme: "dark", accent: "purple" });
    expect(JSON.parse(localStorage.getItem("workstation-theme")!)).toEqual({
      theme: "dark",
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

    it("parses a JSON string with both fields", () => {
      expect(parseThemeSettings('{"theme":"dark","accent":"green"}')).toEqual({
        theme: "dark",
        accent: "green",
      });
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

    it("defaults missing theme to light", () => {
      expect(parseThemeSettings({})).toEqual({
        theme: "light",
        accent: "blue",
      });
    });

    it("defaults invalid theme to light", () => {
      expect(parseThemeSettings({ theme: "sepia" })).toEqual({
        theme: "light",
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
    expect(useTheme.getState().theme).toBe("light");
    expect(useTheme.getState().accent).toBe("blue");
  });

  it("initTheme falls back to light when nothing saved", async () => {
    await initTheme();
    expect(useTheme.getState().theme).toBe("light");
    expect(useTheme.getState().accent).toBe("blue");
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
        theme: "light",
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
      expect(reloadedTheme.getState().theme).toBe("light");
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
      expect(reloadedTheme.getState().theme).toBe("light");
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
