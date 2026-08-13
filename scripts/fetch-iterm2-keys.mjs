#!/usr/bin/env node
// 一次性脚本：抓取 iTerm2 源码 sources/ProfileModel.m 的 KEY_* 常量赋值，
// 生成 src/lib/iterm2Keys.data.ts 骨架（key + 空 type + category 粗分）。
// 仅作初始化用，不进前端运行时与 CI；官方源码结构变化导致失效时可人工维护数据文件。
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://raw.githubusercontent.com/gnachman/iTerm2/master/sources/ProfileModel.m";
const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/lib/iterm2Keys.data.ts",
);

const src = await (await fetch(SOURCE_URL)).text();

const KEY_RE = /KEY_(\w+)\s*=\s*@"([^"]+)"/g;
const keys = [];
for (const m of src.matchAll(KEY_RE)) {
  keys.push({ key: m[2], description: "", category: categorize(m[2]), type: "" });
}

// 按 JSON 字段名去重（同名字段名可能出现多次赋值）
const seen = new Set();
const unique = keys.filter((k) => {
  if (seen.has(k.key)) return false;
  seen.add(k.key);
  return true;
});

function categorize(key) {
  if (/Font|Spacing|Anti Alias|Anti-Alias|Italic|Bold|Powerline|Contrast|Strokes|Ligatures|Width/i.test(key)) {
    return "字体与渲染";
  }
  if (/Color|Background Image|Transparency|Blur|Palette|Theme|Appearance/i.test(key)) {
    return "外观与主题";
  }
  if (/Cursor/i.test(key)) return "光标";
  if (/Scroll|Mouse|Wheel|Selection|Bell|Sound/i.test(key)) {
    return "行为与终端";
  }
  if (/Command|Shortcut|Name|Guid|Profile|Tags|Rewritable|Icon|Title/i.test(key)) {
    return "基本信息";
  }
  if (/Keyboard|Trigger|Map|Key|Hotkey/i.test(key)) return "键盘与按键";
  if (/Encoding|Character|Locale|Language/i.test(key)) return "字符与编码";
  if (/Session|Job|Process|Terminal Columns|Rows|Idle|Close/i.test(key)) {
    return "会话与终端";
  }
  return "其他";
}

const out = `// 本文件由 scripts/fetch-iterm2-keys.mjs 自动生成骨架，请人工标注 type/enum/min/max/zh 后保留。
// 数据源：${SOURCE_URL}（ProfileModel.m 的 KEY_* 常量）
export interface RawIterm2Key {
  key: string;
  type: string;
  description: string;
  category: string;
}

export const ITERM2_KEY_RAW: RawIterm2Key[] = ${JSON.stringify(unique, null, 2)};
`;

writeFileSync(OUT, out);
console.log(`wrote ${unique.length} keys to ${OUT}`);
