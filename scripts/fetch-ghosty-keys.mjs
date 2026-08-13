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
  if (/^(font|adjust|grapheme|freetype|alpha-blending)-/.test(key))
    return "字体与渲染";
  if (
    /^(theme|background|foreground|palette|selection|search|minimum-contrast|cursor-color|cursor-text|bold-color|faint-opacity|split|unfocused)-/.test(
      key,
    )
  )
    return "外观与主题";
  if (/^cursor-/.test(key)) return "光标";
  if (/^(mouse|scroll)-/.test(key)) return "鼠标与滚动";
  if (/^(window|gtk-window)-/.test(key)) return "窗口";
  if (/^macos-/.test(key)) return "macOS";
  if (/^(linux|gtk)-/.test(key)) return "Linux/GTK";
  if (/^auto-update/.test(key)) return "更新";
  if (/^notify-/.test(key)) return "通知";
  if (/^(command|initial-command|shell-integration|term|keybind|clipboard)/.test(key))
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
