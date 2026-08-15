import { useEffect, useMemo, useState } from "react";
import { findIterm2Key, validateIterm2Value } from "../lib/iterm2Keys";
import { useIterm2Keys } from "../store/iterm2Keys";
import {
  arrayColorToHex,
  resolveIterm2EntryType,
  toIterm2JsonValue,
  type Iterm2ValueType,
} from "../lib/iterm2Values";
import {
  reloadIterm2Config,
  reloadStatusMessage,
  writeIterm2Profile,
} from "../lib/iterm2Config";
import { toast } from "../lib/toast";
import ConfigValueControl from "./ConfigValueControl";
import Alert from "./Alert";
import Button from "./Button";
import EmptyState from "./EmptyState";

interface Entry {
  key: string;
  value: string;
  type: Iterm2ValueType;
}

interface NestedEntry {
  key: string;
  text: string;
}

interface Props {
  content: string;
  name: string;
  onSaved?: (message: string) => void;
}

type ScalarJson = string | number | boolean | number[];

function isScalar(v: unknown): v is ScalarJson {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return true;
  return (
    Array.isArray(v) &&
    v.length >= 2 &&
    v.length <= 4 &&
    v.every((x) => typeof x === "number")
  );
}

function toScalarString(v: ScalarJson): string {
  if (Array.isArray(v)) return JSON.stringify(v);
  return String(v);
}

interface ParsedProfile {
  /** profiles: 标准 { "Profiles": [...] } 结构；flat: 顶层直接是 profile 对象；empty: 无可编辑内容 */
  kind: "profiles" | "flat" | "empty";
  profile: Record<string, unknown>;
  rest?: unknown[];
}

function isProfilesObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 解析 profile 文件内容。iTerm2 Dynamic Profiles 的标准结构是
 * `{ "Profiles": [ { ...属性 }, ... ] }`，取第一个 profile 作为编辑对象，
 * 其余 profile 在写回时原样保留。
 */
function parseContent(content: string): ParsedProfile {
  try {
    const obj: unknown = JSON.parse(content);
    if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
      const rec = obj as Record<string, unknown>;
      if (Array.isArray(rec.Profiles) && rec.Profiles.length > 0) {
        const first = rec.Profiles[0];
        if (isProfilesObject(first)) {
          return {
            kind: "profiles",
            profile: first,
            rest: rec.Profiles.slice(1),
          };
        }
      }
      return { kind: "flat", profile: rec };
    }
    return { kind: "empty", profile: {} };
  } catch {
    return { kind: "empty", profile: {} };
  }
}

export default function Iterm2ConfigForm({ content, name, onSaved }: Props) {
  const keys = useIterm2Keys((s) => s.keys);

  useEffect(() => {
    void useIterm2Keys.getState().init();
  }, []);

  const parsed = useMemo(() => parseContent(content), [content]);
  const original = parsed.profile;
  const [entries, setEntries] = useState<Entry[]>(() => {
    const list: Entry[] = [];
    for (const [key, value] of Object.entries(original)) {
      if (isScalar(value)) {
        const text = toScalarString(value);
        list.push({ key, value: text, type: resolveIterm2EntryType(key, text, keys) });
      }
    }
    return list;
  });
  const nested = useMemo(() => {
    const list: NestedEntry[] = [];
    for (const [key, value] of Object.entries(original)) {
      if (!isScalar(value)) list.push({ key, text: JSON.stringify(value) ?? "" });
    }
    return list;
  }, [original]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);

  const categories = useMemo(() => {
    const order: string[] = [];
    for (const k of keys) {
      if (!order.includes(k.category)) order.push(k.category);
    }
    return order;
  }, [keys]);

  function updateEntry(index: number, patch: Partial<Entry>): void {
    setEntries((prev) => {
      const next = prev.map((e, i) => (i === index ? { ...e, ...patch } : e));
      if (patch.value !== undefined) {
        next[index].type = resolveIterm2EntryType(next[index].key, patch.value as string, keys);
      }
      return next;
    });
  }

  function removeEntry(index: number): void {
    setEntries((prev) => prev.filter((_, i) => i !== index));
  }

  function addEntry(): void {
    const key = newKey;
    if (!key) return;
    if (entries.some((e) => e.key === key)) {
      setError(`键 ${key} 已存在`);
      return;
    }
    const spec = findIterm2Key(key, keys);
    const validation = spec ? validateIterm2Value(spec, newValue) : null;
    if (validation) {
      setError(`键 ${key} 的值无效：${validation}`);
      return;
    }
    setEntries((prev) => [
      ...prev,
      { key, value: newValue, type: resolveIterm2EntryType(key, newValue, keys) },
    ]);
    setNewKey("");
    setNewValue("");
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      for (const e of entries) {
        const orig = original[e.key];
        if (orig !== undefined && toScalarString(orig as ScalarJson) === e.value) continue;
        const spec = findIterm2Key(e.key, keys);
        const validation = spec ? validateIterm2Value(spec, e.value) : null;
        if (validation) {
          setError(`键 ${e.key} 的值无效：${validation}`);
          return;
        }
      }
      const obj: Record<string, unknown> = {};
      let modified = 0;
      for (const [key, value] of Object.entries(original)) {
        if (isScalar(value)) {
          const entry = entries.find((e) => e.key === key);
          if (entry) {
            if (toScalarString(value) !== entry.value) {
              modified += 1;
              obj[key] = toIterm2JsonValue(entry);
            } else {
              obj[key] = value;
            }
          }
        } else {
          obj[key] = value;
        }
      }
      for (const e of entries) {
        if (original[e.key] === undefined) {
          obj[e.key] = toIterm2JsonValue(e);
          modified += 1;
        }
      }
      let removed = 0;
      for (const [key, value] of Object.entries(original)) {
        if (isScalar(value) && !entries.some((e) => e.key === key)) removed += 1;
      }
      const text =
        parsed.kind === "profiles"
          ? JSON.stringify(
              { Profiles: [obj, ...(parsed.rest ?? [])] },
              null,
              2,
            )
          : JSON.stringify(obj, null, 2);
      await writeIterm2Profile(name, text);
      const message = `已保存（修改 ${modified} 项，删除 ${removed} 项）`;
      toast.success(message);
      onSaved?.(message);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    setReloading(true);
    try {
      const r = await reloadIterm2Config();
      if (r.status === "success") {
        toast.success(reloadStatusMessage(r));
      } else {
        toast.error(reloadStatusMessage(r));
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setReloading(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-sm dark:border-gray-700 dark:bg-gray-900";

  const empty = entries.length === 0 && nested.length === 0;
  const newSpec = findIterm2Key(newKey, keys);
  const newType = newSpec ? newSpec.type : "text";

  return (
    <div>
      {error && <Alert variant="error">{error}</Alert>}

      {parsed.kind === "profiles" && (parsed.rest?.length ?? 0) > 0 && (
        <Alert variant="warning">
          该文件包含 {(parsed.rest?.length ?? 0) + 1} 个 profile，当前仅编辑第一个，其余原样保留。
        </Alert>
      )}

      {empty ? (
        <EmptyState className="mb-3 flex h-32">暂无配置项，可在下方新增</EmptyState>
      ) : (
        <div className="mb-3 space-y-2">
          {entries.map((e, i) => {
            const spec = findIterm2Key(e.key, keys);
            const title = spec ? spec.zh : e.key;
            return (
              <div key={e.key} className="flex items-center gap-2">
                <span className="w-44 shrink-0 truncate font-mono text-sm" title={title}>
                  {e.key}
                </span>
                <span className="text-gray-400">=</span>
                <ConfigValueControl
                  spec={spec}
                  type={e.type}
                  value={e.value}
                  className={inputClass}
                  onChange={(v) => updateEntry(i, { value: v })}
                  colorValueToHex={arrayColorToHex}
                />
                <Button
                  variant="dangerText"
                  onClick={() => removeEntry(i)}
                  title="删除该配置项"
                >
                  删除
                </Button>
              </div>
            );
          })}
          {nested.map((n) => (
            <div key={n.key} className="flex items-center gap-2">
              <span className="w-44 shrink-0 truncate font-mono text-sm" title={n.key}>
                {n.key}
              </span>
              <span className="text-gray-400">=</span>
              <input className={inputClass} value={n.text} readOnly />
              <span className="shrink-0 text-xs text-gray-400">只读</span>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 space-y-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600">
        <div className="flex items-center gap-2">
          <select
            className={inputClass}
            value={newKey}
            onChange={(e) => {
              setNewKey(e.target.value);
              setError(null);
            }}
            title="从官方支持的 key 中选择"
          >
            <option value="" disabled>
              选择配置项...
            </option>
            {categories.map((cat) => (
              <optgroup key={cat} label={cat}>
                {keys.filter((k) => k.category === cat).map((k) => (
                  <option key={k.key} value={k.key} title={k.zh}>
                    {k.key} — {k.zh}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Button variant="secondary" onClick={addEntry} disabled={!newKey}>
            新增
          </Button>
        </div>
        <ConfigValueControl
          spec={newSpec}
          type={newType}
          value={newValue}
          className={inputClass}
          onChange={setNewValue}
          onKeyDown={(e) => {
            if (e.key === "Enter") addEntry();
          }}
        />
        {newSpec && (
          <p className="text-xs text-gray-500 dark:text-gray-400">{newSpec.zh}</p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button variant="secondary" onClick={handleReload} disabled={reloading}>
          {reloading ? "重载中..." : "重新加载配置"}
        </Button>
      </div>
    </div>
  );
}
