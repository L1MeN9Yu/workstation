import { create } from "zustand";
import {
  ITERM2_KEYS,
  mergeIterm2Keys,
  type Iterm2KeySpec,
  type Iterm2RemoteKey,
} from "../lib/iterm2Keys";
import {
  fetchRemoteIterm2Keys,
  readRemoteCache,
  writeRemoteCache,
} from "../lib/iterm2KeysRemote";

export type Iterm2KeysSource = "base" | "cache" | "remote";

interface Iterm2KeysState {
  keys: Iterm2KeySpec[];
  source: Iterm2KeysSource;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const useIterm2Keys = create<Iterm2KeysState>((set) => ({
  keys: [...ITERM2_KEYS],
  source: "base",
  init: async () => {
    const cached = readRemoteCache();
    if (cached) {
      set({ keys: mergeIterm2Keys(cached), source: "cache" });
    }
    await useIterm2Keys.getState().refresh();
  },
  refresh: async () => {
    let remote: Iterm2RemoteKey[];
    try {
      remote = await fetchRemoteIterm2Keys();
    } catch {
      return;
    }
    writeRemoteCache(remote);
    set({ keys: mergeIterm2Keys(remote), source: "remote" });
  },
}));
