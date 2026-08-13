import { ITERM2_KEY_RAW, type RawIterm2KeyType } from "./iterm2Keys.data";

export type Iterm2KeyType = RawIterm2KeyType;

export interface Iterm2KeySpec {
  key: string;
  type: Iterm2KeyType;
  enum?: readonly string[];
  min?: number;
  max?: number;
  placeholder?: string;
  description: string;
  zh: string;
  category: string;
  introduced?: string;
}

export interface Iterm2RemoteKey {
  key: string;
  description: string;
  category: string;
  introduced?: string;
}

export const ITERM2_KEYS: readonly Iterm2KeySpec[] = ITERM2_KEY_RAW;

const byKey = new Map(ITERM2_KEYS.map((k) => [k.key, k]));

export function findIterm2Key(
  key: string,
  keys: readonly Iterm2KeySpec[] = ITERM2_KEYS,
): Iterm2KeySpec | undefined {
  if (keys === ITERM2_KEYS) return byKey.get(key);
  return keys.find((k) => k.key === key);
}

export function filterIterm2Keys(
  query: string,
  keys: readonly Iterm2KeySpec[] = ITERM2_KEYS,
): Iterm2KeySpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...keys];
  return keys.filter(
    (k) =>
      k.key.toLowerCase().includes(q) ||
      k.description.toLowerCase().includes(q) ||
      k.zh.toLowerCase().includes(q),
  );
}

/**
 * 将远程抓取的 iTerm2 key 骨架与本地人工标注清单合并：
 * - 远程 key 已在本地：保留本地标注（type/enum/min/max/placeholder/zh）
 * - 远程新增 key：以 text 类型 + 远程描述补入
 * - 本地独有 key（远程已移除）：保留
 * 输出按 key 名排序。
 */
export function mergeIterm2Keys(
  remote: readonly Iterm2RemoteKey[],
  base: readonly Iterm2KeySpec[] = ITERM2_KEYS,
): Iterm2KeySpec[] {
  const byBaseKey = new Map(base.map((k) => [k.key, k]));
  const merged = new Map<string, Iterm2KeySpec>();
  for (const r of remote) {
    const existing = byBaseKey.get(r.key);
    merged.set(
      r.key,
      existing ?? {
        key: r.key,
        type: "text",
        description: r.description,
        // 远程新增 key 无人工中文描述，先用英文描述兜底
        zh: r.description,
        category: r.category,
        introduced: r.introduced,
      },
    );
  }
  for (const k of base) {
    if (!merged.has(k.key)) merged.set(k.key, k);
  }
  return [...merged.values()].sort((a, b) => a.key.localeCompare(b.key));
}

const ARRAY_COLOR_RE = /^\[\s*(?:-?\d+(?:\.\d+)?\s*,\s*){2,3}-?\d+(?:\.\d+)?\s*\]$/;

export function isIterm2ColorArray(value: string): boolean {
  return ARRAY_COLOR_RE.test(value.trim());
}

export function validateIterm2Value(spec: Iterm2KeySpec, value: string): string | null {
  if (spec.type === "enum") {
    if (!spec.enum?.includes(value)) {
      return `值必须是以下之一：${spec.enum?.join("、") ?? ""}`;
    }
    return null;
  }
  if (spec.type === "bool") {
    return value === "true" || value === "false" ? null : "值必须是 true 或 false";
  }
  if (spec.type === "yesno") {
    return /^(yes|no)$/i.test(value.trim()) ? null : "值必须是 Yes 或 No";
  }
  if (spec.type === "number") {
    if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return "值必须是数字";
    const n = Number(value);
    if (spec.min !== undefined && n < spec.min) return `值不能小于 ${spec.min}`;
    if (spec.max !== undefined && n > spec.max) return `值不能大于 ${spec.max}`;
    return null;
  }
  if (spec.type === "color") {
    const v = value.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(v)) return null;
    if (!ARRAY_COLOR_RE.test(v)) return "颜色必须是 #hex 或 [r,g,b] / [r,g,b,a] 数组";
    const nums = v.slice(1, -1).split(",").map((s) => Number(s.trim()));
    if (nums.some((n) => n < 0 || n > 255)) return "颜色分量必须在 0-255 范围内";
    return null;
  }
  return null;
}
