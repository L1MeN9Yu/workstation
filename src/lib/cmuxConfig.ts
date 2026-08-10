import { invoke } from "@tauri-apps/api/core";

export interface CmuxConfigFile {
  kind: "cmux" | "ghosty";
  path: string;
  content: string;
}

export function readCmuxConfig(): Promise<CmuxConfigFile> {
  return invoke("read_cmux_config");
}

export function readGhostyConfig(): Promise<CmuxConfigFile> {
  return invoke("read_ghosty_config");
}
