import { GHOSTY_KEY_RAW, type RawGhostyKeyType } from "./ghostyKeys.data";

export type GhostyKeyType = RawGhostyKeyType;

export interface GhostyKeySpec {
  key: string;
  type: GhostyKeyType;
  enum?: readonly string[];
  min?: number;
  max?: number;
  placeholder?: string;
  description: string;
  category: string;
  introduced?: string;
}

export interface GhostyRemoteKey {
  key: string;
  description: string;
  category: string;
  introduced?: string;
}

export const GHOSTY_KEYS: readonly GhostyKeySpec[] = GHOSTY_KEY_RAW;

const byKey = new Map(GHOSTY_KEYS.map((k) => [k.key, k]));

export function findGhostyKey(
  key: string,
  keys: readonly GhostyKeySpec[] = GHOSTY_KEYS,
): GhostyKeySpec | undefined {
  if (keys === GHOSTY_KEYS) return byKey.get(key);
  return keys.find((k) => k.key === key);
}

export function filterGhostyKeys(
  query: string,
  keys: readonly GhostyKeySpec[] = GHOSTY_KEYS,
): GhostyKeySpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...keys];
  return keys.filter(
    (k) =>
      k.key.toLowerCase().includes(q) || k.description.toLowerCase().includes(q),
  );
}

/**
 * 将远程抓取的 ghosty key 骨架与本地人工标注清单合并：
 * - 远程 key 已在本地：保留本地标注（type/enum/min/max/placeholder）
 * - 远程新增 key：以 text 类型 + 远程描述补入
 * - 本地独有 key（远程已移除）：保留
 * 输出按 key 名排序。
 */
export function mergeGhostyKeys(
  remote: readonly GhostyRemoteKey[],
  base: readonly GhostyKeySpec[] = GHOSTY_KEYS,
): GhostyKeySpec[] {
  const byBaseKey = new Map(base.map((k) => [k.key, k]));
  const merged = new Map<string, GhostyKeySpec>();
  for (const r of remote) {
    const existing = byBaseKey.get(r.key);
    merged.set(
      r.key,
      existing ?? {
        key: r.key,
        type: "text",
        description: r.description,
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

export function validateGhostyValue(
  spec: GhostyKeySpec,
  value: string,
): string | null {
  if (spec.type === "enum") {
    if (!spec.enum?.includes(value)) {
      return `值必须是以下之一：${spec.enum?.join("、") ?? ""}`;
    }
    return null;
  }
  if (spec.type === "bool") {
    return value === "true" || value === "false" ? null : "值必须是 true 或 false";
  }
  if (spec.type === "number") {
    if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return "值必须是数字";
    const n = Number(value);
    if (spec.min !== undefined && n < spec.min) return `值不能小于 ${spec.min}`;
    if (spec.max !== undefined && n > spec.max) return `值不能大于 ${spec.max}`;
    return null;
  }
  return null;
}
