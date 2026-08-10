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

export function writeCmuxConfig(content: string): Promise<void> {
  return invoke("write_cmux_config", { content });
}

export function writeGhostyConfig(content: string): Promise<void> {
  return invoke("write_ghosty_config", { content });
}
