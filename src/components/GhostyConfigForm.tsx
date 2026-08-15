import { useEffect, useMemo, useState } from "react";
import {
  applyGhostyChanges,
  parseGhostyLines,
  resolveGhostyEntryType,
  type GhostyDirty,
  type GhostyLine,
  type GhostyValueType,
} from "../lib/ghostyText";
import {
  findGhostyKey,
  validateGhostyValue,
  type GhostyKeySpec,
} from "../lib/ghostyKeys";
import { useGhostyKeys } from "../store/ghostyKeys";
import { useSystemFonts } from "../store/systemFonts";
import { writeGhostyConfig } from "../lib/cmuxConfig";
import { toast } from "../lib/toast";
import ReloadConfigButton from "./ReloadConfigButton";
import ConfigValueControl from "./ConfigValueControl";
import Alert from "./Alert";
import Button from "./Button";
import EmptyState from "./EmptyState";

interface Entry {
  key: string;
  value: string;
  type: GhostyValueType;
}

function initialEntries(lines: GhostyLine[], keys: readonly GhostyKeySpec[]): Entry[] {
  return lines
    .filter((l): l is Extract<GhostyLine, { type: "kv" }> => l.type === "kv")
    .map((l) => ({
      key: l.key,
      value: l.value,
      type: resolveGhostyEntryType(l.key, l.value, keys),
    }));
}

interface Props {
  content: string;
}

export default function GhostyConfigForm({ content }: Props) {
  const keys = useGhostyKeys((s) => s.keys);
  const fonts = useSystemFonts((s) => s.fonts);

  useEffect(() => {
    void useSystemFonts.getState().init();
  }, []);

  const [entries, setEntries] = useState<Entry[]>(() =>
    initialEntries(parseGhostyLines(content), keys),
  );
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const original = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of parseGhostyLines(content)) {
      if (l.type === "kv") map.set(l.key, l.value);
    }
    return map;
  }, [content]);

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
        next[index].type = resolveGhostyEntryType(next[index].key, patch.value as string, keys);
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
    const spec = findGhostyKey(key, keys);
    const validation = spec ? validateGhostyValue(spec, newValue) : null;
    if (validation) {
      setError(`键 ${key} 的值无效：${validation}`);
      return;
    }
    setEntries((prev) => [
      ...prev,
      { key, value: newValue, type: resolveGhostyEntryType(key, newValue, keys) },
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
        if (original.has(e.key)) continue;
        const spec = findGhostyKey(e.key, keys);
        const validation = spec ? validateGhostyValue(spec, e.value) : null;
        if (validation) {
          setError(`键 ${e.key} 的值无效：${validation}`);
          return;
        }
      }
      const set = new Map<string, string>();
      const remove = new Set<string>();
      for (const e of entries) {
        const orig = original.get(e.key);
        if (orig === undefined || orig !== e.value) set.set(e.key, e.value);
      }
      for (const key of original.keys()) {
        if (!entries.some((e) => e.key === key)) remove.add(key);
      }
      const dirty: GhostyDirty = { set, remove };
      const lines = parseGhostyLines(content);
      const text = applyGhostyChanges(lines, dirty);
      await writeGhostyConfig(text);
      toast.success(`已保存（修改 ${set.size} 项，删除 ${remove.size} 项）`);
    } catch (e) {
      toast.error(`保存失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-sm dark:border-gray-700 dark:bg-gray-900";

  const newSpec = findGhostyKey(newKey, keys);
  const newType = newSpec ? newSpec.type : "text";

  return (
    <div>
      <datalist id="system-fonts">
        {fonts.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      {error && <Alert variant="error">{error}</Alert>}

      {entries.length === 0 ? (
        <EmptyState className="mb-3 flex h-32">暂无配置项，可在下方新增</EmptyState>
      ) : (
        <div className="mb-3 space-y-2">
          {entries.map((e, i) => {
            const spec = findGhostyKey(e.key, keys);
            const title = spec ? spec.zh : e.key;
            return (
              <div key={i} className="flex items-center gap-2">
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
                />
                <Button variant="dangerText" onClick={() => removeEntry(i)} title="删除该配置项">
                  删除
                </Button>
              </div>
            );
          })}
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
            title="从支持的 key 中选择"
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

      <div className="mt-3">
        <ReloadConfigButton />
      </div>
    </div>
  );
}
