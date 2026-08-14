import { create } from "zustand";

type Theme = "light" | "dark";

const isTauri = typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

interface ThemeState {
  theme: Theme;
  _userTouched: boolean;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
}

export function persistTheme(theme: Theme) {
  if (isTauri) {
    void import("../lib/configStore").then(({ writeConfig }) =>
      writeConfig("theme", { theme }),
    );
  } else {
    localStorage.setItem("workstation-theme", theme);
  }
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "light",
  _userTouched: false,
  toggle: () => {
    const next: Theme = get().theme === "light" ? "dark" : "light";
    persistTheme(next);
    set({ theme: next, _userTouched: true });
    applyTheme(next);
  },
  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
  },
}));

export async function initTheme(): Promise<void> {
  if (useTheme.getState()._userTouched) {
    return;
  }
  let saved: Theme | null;
  if (isTauri) {
    try {
      const { readConfig } = await import("../lib/configStore");
      const value = await readConfig<{ theme: Theme }>("theme");
      saved = value?.theme ?? null;
    } catch {
      saved = null;
    }
  } else {
    saved = localStorage.getItem("workstation-theme") as Theme | null;
  }
  useTheme.getState().setTheme(saved ?? "light");
}

export function useInitTheme() {
  if (!document.documentElement.dataset.theme) {
    void initTheme();
  }
}
