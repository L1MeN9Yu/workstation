import { create } from "zustand";
import { listSystemFonts } from "../lib/systemFonts";

export type SystemFontsSource = "base" | "loaded";

interface SystemFontsState {
  fonts: string[];
  source: SystemFontsSource;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useSystemFonts = create<SystemFontsState>((set) => ({
  fonts: [],
  source: "base",
  init: async () => {
    if (useSystemFonts.getState().source !== "base") return;
    await useSystemFonts.getState().refresh();
  },
  refresh: async () => {
    let fonts: string[];
    try {
      fonts = await listSystemFonts();
    } catch (e) {
      console.error("load system fonts failed:", e);
      return;
    }
    set({ fonts, source: "loaded" });
  },
}));
