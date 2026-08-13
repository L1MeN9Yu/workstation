#!/usr/bin/env node
// 一次性脚本：抓取 ghosty 官方配置参考，生成 src/lib/ghostyKeys.data.ts 骨架。
// 仅作初始化用，不进前端运行时与 CI；官方文档结构变化导致失效时可人工维护数据文件。
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REF_URL = "https://ghostty.org/docs/config/reference";
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/lib/ghostyKeys.data.ts",
);

const html = await (await fetch(REF_URL)).text();

function stripTags(raw) {
  return raw
    .replace(/<pre[\s\S]*?<\/pre>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function categorize(key) {
  if (
    key.startsWith("font-") ||
    key.startsWith("adjust-") ||
    key.startsWith("grapheme-") ||
    key.startsWith("freetype-") ||
    key === "alpha-blending"
  )
    return "字体与渲染";
  if (
    key.startsWith("theme") ||
    key.startsWith("background") ||
    key.startsWith("foreground") ||
    key.startsWith("palette") ||
    key.startsWith("selection") ||
    key.startsWith("search") ||
    key.startsWith("minimum-contrast") ||
    key.startsWith("cursor-color") ||
    key.startsWith("cursor-text") ||
    key.startsWith("bold-color") ||
    key.startsWith("faint-opacity") ||
    key.startsWith("split") ||
    key.startsWith("unfocused")
  )
    return "外观与主题";
  if (key.startsWith("cursor-")) return "光标";
  if (key.startsWith("mouse-") || key.startsWith("scroll-")) return "鼠标与滚动";
  if (key.startsWith("window-")) return "窗口";
  if (key.startsWith("macos-")) return "macOS";
  if (key.startsWith("linux-") || key.startsWith("gtk-")) return "Linux/GTK";
  if (key.startsWith("auto-update")) return "更新";
  if (key.startsWith("notify-")) return "通知";
  if (
    key.startsWith("command") ||
    key.startsWith("initial-command") ||
    key.startsWith("shell-integration") ||
    key.startsWith("term") ||
    key.startsWith("keybind") ||
    key.startsWith("clipboard")
  )
    return "行为与终端";
  return "其他";
}

const H2_RE = /<h2[^>]*><code>([^<]+)<\/code><\/h2>([\s\S]*?)(?=<h2[^>]*><code>|$)/g;

const parsed = [];
for (const m of html.matchAll(H2_RE)) {
  parsed.push({ key: m[1], body: stripTags(m[2]) });
}

const keys = [];
for (let i = 0; i < parsed.length; i++) {
  const { key, body } = parsed[i];
  let description = body;
  if (!description) {
    for (let j = i + 1; j < parsed.length; j++) {
      if (parsed[j].body) {
        description = parsed[j].body;
        break;
      }
    }
  }
  if (description.length > 300) description = `${description.slice(0, 297)}...`;
  const introduced = /available (?:since|in):\s*([\d.]+)/i.exec(description)?.[1];
  keys.push({ key, description, category: categorize(key), ...(introduced ? { introduced } : {}) });
}

const out = `// 本文件由 scripts/fetch-ghosty-keys.mjs 自动生成骨架，请人工标注 type/enum/min/max/placeholder 后保留。
// 数据源：${REF_URL}
export interface RawGhostyKey {
  key: string;
  description: string;
  category: string;
  introduced?: string;
}

export const GHOSTY_KEY_RAW: RawGhostyKey[] = ${JSON.stringify(keys, null, 2)};
`;

writeFileSync(OUT, out);
console.log(`wrote ${keys.length} keys to ${OUT}`);
