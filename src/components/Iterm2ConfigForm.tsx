import { useMemo, useState } from "react";
import { inferGhostyValueType, type GhostyValueType } from "../lib/ghostyText";
import {
  reloadIterm2Config,
  reloadStatusMessage,
  writeIterm2Profile,
  type Iterm2ReloadResult,
} from "../lib/iterm2Config";

interface ScalarEntry {
  key: string;
  value: string;
  type: GhostyValueType;
}

interface NestedEntry {
  key: string;
  text: string;
}

interface Props {
  content: string;
  name: string;
  onSaved?: () => void;
}

function isScalar(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function toScalarString(v: string | number | boolean): string {
  return String(v);
}

function toJsonValue(entry: ScalarEntry): string | number | boolean {
  if (entry.type === "bool") return entry.value === "true";
  if (entry.type === "number") return Number(entry.value);
  return entry.value;
}

function parseContent(content: string): Record<string, unknown> {
  try {
    const obj: unknown = JSON.parse(content);
    if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export default function Iterm2ConfigForm({ content, name, onSaved }: Props) {
  const original = useMemo(() => parseContent(content), [content]);
  const [entries, setEntries] = useState<ScalarEntry[]>(() => {
    const list: ScalarEntry[] = [];
    for (const [key, value] of Object.entries(original)) {
      if (isScalar(value)) {
        const text = toScalarString(value);
        list.push({ key, value: text, type: inferGhostyValueType(text) });
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
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadResult, setReloadResult] = useState<Iterm2ReloadResult | null>(null);

  function updateEntry(index: number, patch: Partial<ScalarEntry>): void {
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
    setError(null);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const obj: Record<string, unknown> = {};
      let modified = 0;
      for (const [key, value] of Object.entries(original)) {
        if (isScalar(value)) {
          const entry = entries.find((e) => e.key === key);
          if (entry) {
            if (toScalarString(value) !== entry.value) modified += 1;
            obj[key] = toJsonValue(entry);
          }
        } else {
          obj[key] = value;
        }
      }
      for (const e of entries) {
        if (original[e.key] === undefined) {
          obj[e.key] = toJsonValue(e);
          modified += 1;
        }
      }
      let removed = 0;
      for (const [key, value] of Object.entries(original)) {
        if (isScalar(value) && !entries.some((e) => e.key === key)) removed += 1;
      }
      const text = JSON.stringify(obj, null, 2);
      await writeIterm2Profile(name, text);
      setStatus(`已保存（修改 ${modified} 项，删除 ${removed} 项）`);
      onSaved?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleReload() {
    setReloading(true);
    setReloadResult(null);
    try {
      const r = await reloadIterm2Config();
      setReloadResult(r);
    } catch (e) {
      setReloadResult({ status: "failed", message: String(e) });
    } finally {
      setReloading(false);
    }
  }

  const inputClass =
    "w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-sm dark:border-gray-700 dark:bg-gray-900";

  const empty = entries.length === 0 && nested.length === 0;

  return (
    <div>
      {error && (
        <div className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {empty ? (
        <div className="mb-3 flex h-32 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-600">
          暂无配置项，可在下方新增
        </div>
      ) : (
        <div className="mb-3 space-y-2">
          {entries.map((e, i) => (
            <div key={e.key} className="flex items-center gap-2">
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
              <button
                onClick={() => removeEntry(i)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                title="删除该配置项"
              >
                删除
              </button>
            </div>
          ))}
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

      <div className="mb-4 flex items-center gap-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600">
        <input
          className={inputClass}
          placeholder="键名，如 Name"
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

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={handleReload}
          disabled={reloading}
          className="rounded-md bg-gray-200 px-4 py-1.5 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
        >
          {reloading ? "重载中..." : "重新加载配置"}
        </button>
        {reloadResult && (
          <span
            className={`text-sm ${
              reloadResult.status === "success"
                ? "text-green-600 dark:text-green-400"
                : "text-amber-600 dark:text-amber-400"
            }`}
          >
            {reloadStatusMessage(reloadResult)}
          </span>
        )}
      </div>
    </div>
  );
}
