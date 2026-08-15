import { create } from "zustand";

export type Theme = "light" | "dark";

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

interface ThemeState extends ThemeSettings {
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
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
  applyAccent(accent);
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
  if (value === "light" || value === "dark") {
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
    obj.theme === "light" || obj.theme === "dark" ? obj.theme : null;
  const accent: AccentColor | null = isAccentColor(obj.accent)
    ? obj.accent
    : null;
  return { theme: theme ?? "light", accent: accent ?? "blue" };
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "light",
  accent: "blue",
  _userTouched: false,
  toggle: () => {
    const next: Theme = get().theme === "light" ? "dark" : "light";
    const settings: ThemeSettings = { theme: next, accent: get().accent };
    persistTheme(settings);
    set({ theme: next, _userTouched: true });
    applyTheme(next, get().accent);
  },
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme, get().accent);
  },
  setAccent: (accent) => {
    const settings: ThemeSettings = { theme: get().theme, accent };
    persistTheme(settings);
    set({ accent });
    applyTheme(get().theme, accent);
  },
}));

export async function initTheme(): Promise<void> {
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
  const theme: Theme = saved?.theme ?? "light";
  const accent: AccentColor = saved?.accent ?? "blue";
  useTheme.setState({ theme, accent });
  applyTheme(theme, accent);
}

export function useInitTheme() {
  if (!document.documentElement.dataset.theme) {
    void initTheme();
  }
}
