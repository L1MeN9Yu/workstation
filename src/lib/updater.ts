import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

export interface UpdateApi {
  check(): Promise<Update | null>;
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;
}

export function createUpdateApi(): UpdateApi {
  return { check };
}

export async function currentAppVersion(): Promise<string | null> {
  if (!isTauriRuntime()) {
    return null;
  }
  try {
    return await invoke<string>("app_version");
  } catch {
    return null;
  }
}

export type ProgressListener = (downloadedBytes: number, totalBytes: number) => void;

export function downloadWithProgress(
  update: Update,
  onProgress: ProgressListener,
): Promise<void> {
  let downloadedBytes = 0;
  let totalBytes = 0;
  return update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      totalBytes = event.data.contentLength ?? 0;
      onProgress(0, totalBytes);
    } else if (event.event === "Progress") {
      downloadedBytes += event.data.chunkLength;
      onProgress(downloadedBytes, totalBytes);
    }
  });
}
