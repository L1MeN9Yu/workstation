import { create } from "zustand";
import {
  GHOSTY_KEYS,
  mergeGhostyKeys,
  type GhostyKeySpec,
  type GhostyRemoteKey,
} from "../lib/ghostyKeys";
import {
  fetchRemoteGhostyKeys,
  readRemoteCache,
  writeRemoteCache,
} from "../lib/ghostyKeysRemote";

export type GhostyKeysSource = "base" | "cache" | "remote";

interface GhostyKeysState {
  keys: GhostyKeySpec[];
  source: GhostyKeysSource;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useGhostyKeys = create<GhostyKeysState>((set) => ({
  keys: [...GHOSTY_KEYS],
  source: "base",
  init: async () => {
    const cached = readRemoteCache();
    if (cached) {
      set({ keys: mergeGhostyKeys(cached), source: "cache" });
    }
    await useGhostyKeys.getState().refresh();
  },
  refresh: async () => {
    let remote: GhostyRemoteKey[];
    try {
      remote = await fetchRemoteGhostyKeys();
    } catch {
      return;
    }
    writeRemoteCache(remote);
    set({ keys: mergeGhostyKeys(remote), source: "remote" });
  },
}));
