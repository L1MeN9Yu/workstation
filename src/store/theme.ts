import { create } from "zustand";

export type Theme = "light" | "dark" | "system";

export function resolveTheme(
  theme: Theme,
  prefersDark: boolean,
): "light" | "dark" {
  if (theme === "system") {
    return prefersDark ? "dark" : "light";
  }
  return theme;
}

export const ACCENT_COLORS = [
  "blue",
  "green",
  "purple",
  "orange",
  "red",
  "cyan",
  "pink",
  "indigo",
] as const;
export type PresetAccent = (typeof ACCENT_COLORS)[number];
export type AccentColor = PresetAccent | `#${string}`;

export const ACCENT_VARS = [
  "--color-accent-300",
  "--color-accent-400",
  "--color-accent-500",
  "--color-accent-600",
  "--color-accent-700",
  "--color-accent-800",
] as const;

export interface ThemeSettings {
  theme: Theme;
  accent: AccentColor;
}

const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

export function getSystemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function subscribeSystemTheme(listener: (prefersDark: boolean) => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = (event: MediaQueryListEvent) => {
    listener(event.matches);
  };
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  mq.addListener(handler);
  return () => mq.removeListener(handler);
}

interface ThemeState extends ThemeSettings {
  resolvedTheme: "light" | "dark";
  _userTouched: boolean;
  toggle: () => void;
  setTheme: (t: Theme) => void;
  setAccent: (a: AccentColor) => void;
}

export function isHexColor(value: string): value is `#${string}` {
  return /^#[0-9a-f]{6}$/i.test(value);
}

export function isAccentColor(value: unknown): value is AccentColor {
  return (
    typeof value === "string" &&
    (ACCENT_COLORS.includes(value as PresetAccent) || isHexColor(value))
  );
}

export function applyTheme(theme: Theme, accent: AccentColor = "blue") {
  const resolved = resolveTheme(theme, getSystemPrefersDark());
  applyResolvedTheme(resolved, accent);
  return resolved;
}

function applyAccent(accent: AccentColor) {
  const root = document.documentElement;
  if (ACCENT_COLORS.includes(accent as PresetAccent)) {
    root.dataset.accent = accent;
    for (const variable of ACCENT_VARS) {
      root.style.removeProperty(variable);
    }
    return;
  }
  if (isHexColor(accent)) {
    delete root.dataset.accent;
    const shades: Record<(typeof ACCENT_VARS)[number], string> = {
      "--color-accent-300": `color-mix(in srgb, ${accent} 35%, white)`,
      "--color-accent-400": `color-mix(in srgb, ${accent} 55%, white)`,
      "--color-accent-500": `color-mix(in srgb, ${accent} 80%, white)`,
      "--color-accent-600": accent,
      "--color-accent-700": `color-mix(in srgb, ${accent} 70%, black)`,
      "--color-accent-800": `color-mix(in srgb, ${accent} 85%, black)`,
    };
    for (const [variable, value] of Object.entries(shades)) {
      root.style.setProperty(variable, value);
    }
  }
}

export function persistTheme(settings: ThemeSettings) {
  if (isTauri) {
    void import("../lib/configStore").then(({ writeConfig }) =>
      writeConfig("theme", { theme: settings.theme, accent: settings.accent }),
    );
  } else {
    localStorage.setItem("workstation-theme", JSON.stringify(settings));
  }
}

export function parseThemeSettings(value: unknown): ThemeSettings | null {
  if (value === "light" || value === "dark" || value === "system") {
    return { theme: value, accent: "blue" };
  }
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const theme: Theme | null =
    obj.theme === "light" || obj.theme === "dark" || obj.theme === "system"
      ? obj.theme
      : null;
  const accent: AccentColor | null = isAccentColor(obj.accent)
    ? obj.accent
    : null;
  return { theme: theme ?? "system", accent: accent ?? "blue" };
}

let unsubscribeSystemTheme: (() => void) | null = null;

function registerSystemThemeListener() {
  unsubscribeSystemTheme?.();
  unsubscribeSystemTheme = subscribeSystemTheme((prefersDark) => {
    const { theme, accent } = useTheme.getState();
    if (theme === "system") {
      const resolved = resolveTheme(theme, prefersDark);
      applyResolvedTheme(resolved, accent);
      useTheme.setState({ resolvedTheme: resolved });
    }
  });
}

function applyResolvedTheme(resolved: "light" | "dark", accent: AccentColor) {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.dataset.theme = resolved;
  applyAccent(accent);
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "system",
  resolvedTheme: "light",
  accent: "blue",
  _userTouched: false,
  toggle: () => {
    const next: Theme = get().resolvedTheme === "light" ? "dark" : "light";
    const settings: ThemeSettings = { theme: next, accent: get().accent };
    persistTheme(settings);
    const nextResolved = applyTheme(next, get().accent);
    set({ theme: next, resolvedTheme: nextResolved, _userTouched: true });
  },
  setTheme: (theme) => {
    const settings: ThemeSettings = { theme, accent: get().accent };
    persistTheme(settings);
    const resolved = applyTheme(theme, get().accent);
    set({ theme, resolvedTheme: resolved, _userTouched: true });
  },
  setAccent: (accent) => {
    const settings: ThemeSettings = { theme: get().theme, accent };
    persistTheme(settings);
    const resolved = applyTheme(get().theme, accent);
    set({ accent, resolvedTheme: resolved });
  },
}));

export async function initTheme(): Promise<void> {
  registerSystemThemeListener();
  if (useTheme.getState()._userTouched) {
    return;
  }
  let saved: ThemeSettings | null = null;
  if (isTauri) {
    try {
      const { readConfig } = await import("../lib/configStore");
      const value = await readConfig<unknown>("theme");
      saved = parseThemeSettings(value);
    } catch {
      saved = null;
    }
  } else {
    const raw = localStorage.getItem("workstation-theme");
    if (raw !== null) {
      saved = parseThemeSettings(raw);
    }
  }
  const theme: Theme = saved?.theme ?? "system";
  const accent: AccentColor = saved?.accent ?? "blue";
  const resolved = applyTheme(theme, accent);
  useTheme.setState({ theme, accent, resolvedTheme: resolved });
}

export function useInitTheme() {
  if (!document.documentElement.dataset.theme) {
    void initTheme();
  }
}
