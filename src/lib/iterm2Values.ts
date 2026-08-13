import { inferGhostyValueType, type GhostyValueType } from "./ghostyText";
import { findIterm2Key, isIterm2ColorArray, type Iterm2KeySpec } from "./iterm2Keys";

export type Iterm2ValueType = GhostyValueType | "yesno";

export function inferIterm2ValueType(value: string): Iterm2ValueType {
  if (/^(yes|no)$/i.test(value.trim())) return "yesno";
  if (isIterm2ColorArray(value)) return "color";
  return inferGhostyValueType(value);
}

export function resolveIterm2EntryType(
  key: string,
  value: string,
  keys?: readonly Iterm2KeySpec[],
): Iterm2ValueType {
  const spec = findIterm2Key(key, keys);
  if (spec) return spec.type;
  return inferIterm2ValueType(value);
}

export interface Iterm2ScalarEntry {
  key: string;
  value: string;
  type: Iterm2ValueType;
}

export function toIterm2JsonValue(entry: Iterm2ScalarEntry): string | number | boolean | number[] {
  if (entry.type === "bool") return entry.value === "true";
  if (entry.type === "number") return Number(entry.value);
  if (entry.type === "color") {
    if (isIterm2ColorArray(entry.value)) {
      return entry.value
        .trim()
        .slice(1, -1)
        .split(",")
        .map((s) => Number(s.trim()));
    }
    return entry.value;
  }
  return entry.value;
}

/**
 * 将 iTerm2 颜色数组 [r,g,b] / [r,g,b,a]（分量 0-1 或 0-255）换算为 #rrggbb，
 * 供取色器显示。非法输入返回 null。
 */
export function arrayColorToHex(value: string): string | null {
  const v = value.trim();
  if (!isIterm2ColorArray(v)) return null;
  const nums = v
    .slice(1, -1)
    .split(",")
    .map((s) => Number(s.trim()));
  const scale = nums.every((n) => n <= 1) ? 255 : 1;
  const clamped = nums.slice(0, 3).map((n) => {
    const c = Math.round(n * scale);
    return Math.max(0, Math.min(255, c));
  });
  return `#${clamped.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
