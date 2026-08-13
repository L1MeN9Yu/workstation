import { findGhostyKey, type GhostyKeySpec } from "./ghostyKeys";

export type GhostyLine =
  | { type: "kv"; key: string; value: string; raw: string; indent: string }
  | { type: "comment"; raw: string }
  | { type: "blank"; raw: string };

const KV_RE = /^(\s*)([A-Za-z0-9_-]+)\s*=\s*(.*?)\s*$/;

export function parseGhostyLines(content: string): GhostyLine[] {
  return content.split("\n").map((raw) => {
    const m = KV_RE.exec(raw);
    if (m) return { type: "kv", key: m[2], value: m[3], raw, indent: m[1] };
    if (raw.trim().startsWith("#")) return { type: "comment", raw };
    return { type: "blank", raw };
  });
}

export interface GhostyDirty {
  set: Map<string, string>;
  remove: Set<string>;
}

export type GhostyValueType = "bool" | "number" | "color" | "text" | "enum";

export function inferGhostyValueType(value: string): GhostyValueType {
  if (value === "true" || value === "false") return "bool";
  if (/^-?\d+(\.\d+)?$/.test(value)) return "number";
  if (/^#[0-9a-fA-F]{3,8}$/.test(value) || /^rgb\(/.test(value)) return "color";
  return "text";
}

export function resolveGhostyEntryType(
  key: string,
  value: string,
  keys?: readonly GhostyKeySpec[],
): GhostyValueType {
  const spec = findGhostyKey(key, keys);
  if (spec) return spec.type === "text" ? "text" : spec.type;
  return inferGhostyValueType(value);
}

export function applyGhostyChanges(lines: GhostyLine[], dirty: GhostyDirty): string {
  const set = new Map(dirty.set);
  const remove = dirty.remove;
  const out: string[] = [];
  for (const line of lines) {
    if (line.type === "kv") {
      if (remove.has(line.key)) continue;
      if (set.has(line.key)) {
        const value = set.get(line.key)!;
        out.push(`${line.indent}${line.key} = ${value}`);
        set.delete(line.key);
        continue;
      }
    }
    out.push(line.raw);
  }
  for (const [key, value] of set) {
    out.push(`${key} = ${value}`);
  }
  return out.join("\n");
}
