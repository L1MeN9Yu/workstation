import { invoke } from "@tauri-apps/api/core";

export function listSystemFonts(): Promise<string[]> {
  return invoke("list_system_fonts");
}
