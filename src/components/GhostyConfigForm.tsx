import { useMemo, useState } from "react";
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
import { writeGhostyConfig } from "../lib/cmuxConfig";
import ReloadConfigButton from "./ReloadConfigButton";

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

function enumOptions(spec: GhostyKeySpec, current: string): string[] {
  const options = [...(spec.enum ?? [])];
  if (current && !options.includes(current)) options.push(current);
  return options;
}

function ValueControl({
  spec,
  type,
  value,
  className,
  onChange,
  onKeyDown,
}: {
  spec: GhostyKeySpec | undefined;
  type: GhostyValueType;
  value: string;
  className: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}) {
  if (type === "enum" && spec?.enum) {
    return (
      <select className={className} value={value} onChange={(ev) => onChange(ev.target.value)}>
        {enumOptions(spec, value).map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    );
  }
  if (type === "bool") {
    return (
      <select className={className} value={value} onChange={(ev) => onChange(ev.target.value)}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (type === "number") {
    return (
      <input
        type="number"
        className={className}
        value={value}
        min={spec?.min}
        max={spec?.max}
        onChange={(ev) => onChange(ev.target.value)}
        onKeyDown={onKeyDown}
      />
    );
  }
  if (type === "color") {
    return (
      <div className="flex flex-1 items-center gap-2">
        <input
          type="color"
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
          value={value}
          onChange={(ev) => onChange(ev.target.value)}
        />
        <input
          className={className}
          value={value}
          placeholder={spec?.placeholder}
          onChange={(ev) => onChange(ev.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    );
  }
  return (
    <input
      className={className}
      value={value}
      placeholder={spec?.placeholder}
      onChange={(ev) => onChange(ev.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

export default function GhostyConfigForm({ content }: Props) {
  const keys = useGhostyKeys((s) => s.keys);
  const [entries, setEntries] = useState<Entry[]>(() =>
    initialEntries(parseGhostyLines(content), keys),
  );
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [status, setStatus] = useState<string | null>(null);
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
    setStatus(null);
  }

  function removeEntry(index: number): void {
    setEntries((prev) => prev.filter((_, i) => i !== index));
    setStatus(null);
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
    setStatus(null);
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setStatus(null);
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
      setStatus(`已保存（修改 ${set.size} 项，删除 ${remove.size} 项）`);
    } catch (e) {
      setError(String(e));
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
      {error && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="mb-3 flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-600">
          暂无配置项，可在下方新增
        </div>
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
                <ValueControl
                  spec={spec}
                  type={e.type}
                  value={e.value}
                  className={inputClass}
                  onChange={(v) => updateEntry(i, { value: v })}
                />
                <button
                  onClick={() => removeEntry(i)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                  title="删除该配置项"
                >
                  删除
                </button>
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
          <button
            onClick={addEntry}
            disabled={!newKey}
            className="shrink-0 rounded-md bg-gray-200 px-3 py-1 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
          >
            新增
          </button>
        </div>
        <ValueControl
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
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        {status && <span className="text-sm text-green-600 dark:text-green-400">{status}</span>}
      </div>

      <div className="mt-3">
        <ReloadConfigButton />
      </div>
    </div>
  );
}
