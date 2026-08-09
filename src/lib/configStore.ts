import { invoke } from "@tauri-apps/api/core";

export async function readConfig<T = unknown>(key: string): Promise<T | null> {
  const value = await invoke<unknown>("read_config", { key });
  return (value as T | null) ?? null;
}

export async function writeConfig(key: string, value: unknown): Promise<void> {
  await invoke("write_config", { key, value });
}
