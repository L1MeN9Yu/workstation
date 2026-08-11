import type { ComponentType } from "react";
import Base64Tool from "../pages/tools/base64";
import WallpaperTool from "../pages/tools/wallpaper";

export interface ToolMeta {
  id: string;
  label: string;
  path: string;
  description?: string;
}

export interface ToolEntry extends ToolMeta {
  component: ComponentType;
}

export const toolRegistry: ToolEntry[] = [
  {
    id: "base64",
    label: "Base64 编解码",
    path: "/tools/base64",
    description: "Base64 编码与解码",
    component: Base64Tool,
  },
  {
    id: "wallpaper",
    label: "壁纸工具",
    path: "/tools/wallpaper",
    description: "搜索壁纸并应用到 cmux 终端背景",
    component: WallpaperTool,
  },
];

export function registerTool(entry: ToolEntry): void {
  if (toolRegistry.find((t) => t.id === entry.id)) {
    return;
  }
  toolRegistry.push(entry);
}
