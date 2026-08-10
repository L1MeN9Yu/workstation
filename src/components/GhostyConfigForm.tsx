import { useMemo, useState } from "react";
import {
  applyGhostyChanges,
  inferGhostyValueType,
  parseGhostyLines,
  type GhostyDirty,
  type GhostyLine,
  type GhostyValueType,
} from "../lib/ghostyText";
import { writeGhostyConfig } from "../lib/cmuxConfig";

interface Entry {
  key: string;
  value: string;
  type: GhostyValueType;
}

function initialEntries(lines: GhostyLine[]): Entry[] {
  return lines
    .filter((l): l is Extract<GhostyLine, { type: "kv" }> => l.type === "kv")
    .map((l) => ({ key: l.key, value: l.value, type: inferGhostyValueType(l.value) }));
}

interface Props {
  content: string;
}

export default function GhostyConfigForm({ content }: Props) {
  const [entries, setEntries] = useState<Entry[]>(() => initialEntries(parseGhostyLines(content)));
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

  function updateEntry(index: number, patch: Partial<Entry>): void {
    setEntries((prev) => {
      const next = prev.map((e, i) => (i === index ? { ...e, ...patch } : e));
      if (patch.value !== undefined) {
        next[index].type = inferGhostyValueType(patch.value as string);
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
    const key = newKey.trim();
    if (!key) return;
    if (entries.some((e) => e.key === key)) {
      setError(`键 ${key} 已存在`);
      return;
    }
    setEntries((prev) => [...prev, { key, value: newValue, type: inferGhostyValueType(newValue) }]);
    setNewKey("");
    setNewValue("");
    setStatus(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
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
          {entries.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-44 shrink-0 truncate font-mono text-sm" title={e.key}>
                {e.key}
              </span>
              <span className="text-gray-400">=</span>
              {e.type === "bool" ? (
                <select
                  className={inputClass}
                  value={e.value}
                  onChange={(ev) => updateEntry(i, { value: ev.target.value })}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : e.type === "number" ? (
                <input
                  type="number"
                  className={inputClass}
                  value={e.value}
                  onChange={(ev) => updateEntry(i, { value: ev.target.value })}
                />
              ) : e.type === "color" ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="color"
                    className="h-8 w-10 shrink-0 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
                    value={e.value}
                    onChange={(ev) => updateEntry(i, { value: ev.target.value })}
                  />
                  <input
                    className={inputClass}
                    value={e.value}
                    onChange={(ev) => updateEntry(i, { value: ev.target.value })}
                  />
                </div>
              ) : (
                <input
                  className={inputClass}
                  value={e.value}
                  onChange={(ev) => updateEntry(i, { value: ev.target.value })}
                />
              )}
              <select
                className="shrink-0 rounded-md border border-gray-200 bg-gray-50 px-1.5 py-1 text-xs dark:border-gray-700 dark:bg-gray-900"
                value={e.type}
                onChange={(ev) => updateEntry(i, { type: ev.target.value as GhostyValueType })}
                title="切换值类型（文本模式可输入任意值）"
              >
                <option value="auto">auto</option>
                <option value="text">文本</option>
              </select>
              <button
                onClick={() => removeEntry(i)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                title="删除该配置项"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600">
        <input
          className={inputClass}
          placeholder="键名，如 background-image"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder="值"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addEntry();
          }}
        />
        <button
          onClick={addEntry}
          className="shrink-0 rounded-md bg-gray-200 px-3 py-1 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-200"
        >
          新增
        </button>
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
    </div>
  );
}
