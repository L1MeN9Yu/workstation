import { create } from "zustand";
import {
  createUpdateApi,
  currentAppVersion,
  downloadWithProgress,
  isTauriRuntime,
} from "../lib/updater";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdateState {
  status: UpdateStatus;
  currentVersion: string | null;
  availableVersion: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  errorMessage: string | null;
  upToDate: boolean;
  check: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: "idle",
  currentVersion: null,
  availableVersion: null,
  downloadedBytes: 0,
  totalBytes: null,
  errorMessage: null,
  upToDate: false,

  check: async () => {
    const { status } = get();
    if (status === "checking" || status === "downloading") {
      return;
    }
    if (!isTauriRuntime()) {
      set({ status: "error", errorMessage: "当前环境不支持检查更新" });
      return;
    }
    set({
      status: "checking",
      errorMessage: null,
      upToDate: false,
      availableVersion: null,
    });
    try {
      const [version, update] = await Promise.all([
        currentAppVersion(),
        createUpdateApi().check(),
      ]);
      if (!update) {
        set({ status: "idle", upToDate: true, currentVersion: version });
        return;
      }
      set({
        status: "available",
        currentVersion: version,
        availableVersion: update.version,
      });
    } catch (e) {
      set({ status: "error", errorMessage: String(e) });
    }
  },

  downloadAndInstall: async () => {
    const { status } = get();
    if (status === "checking" || status === "downloading") {
      return;
    }
    if (!isTauriRuntime()) {
      set({ status: "error", errorMessage: "当前环境不支持检查更新" });
      return;
    }
    set({
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: null,
      errorMessage: null,
    });
    try {
      const update = await createUpdateApi().check();
      if (!update) {
        set({ status: "idle", upToDate: true });
        return;
      }
      await downloadWithProgress(update, (downloadedBytes, totalBytes) => {
        set({ downloadedBytes, totalBytes });
      });
      set({ status: "ready" });
    } catch (e) {
      set({ status: "error", errorMessage: String(e) });
    }
  },
}));

let updateCheckStarted = false;

export function initUpdateCheck(): void {
  if (updateCheckStarted || !isTauriRuntime()) {
    return;
  }
  updateCheckStarted = true;
  void useUpdateStore.getState().check();
}
