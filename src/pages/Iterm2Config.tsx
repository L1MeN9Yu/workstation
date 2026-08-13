import { useEffect, useState } from "react";
import {
  deleteIterm2Profile,
  listIterm2Profiles,
  writeIterm2Profile,
  type Iterm2ProfileFile,
} from "../lib/iterm2Config";
import Iterm2ConfigForm from "../components/Iterm2ConfigForm";

export default function Iterm2Config() {
  const [profiles, setProfiles] = useState<Iterm2ProfileFile[] | null>(null);
  const [selected, setSelected] = useState<Iterm2ProfileFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const list = await listIterm2Profiles();
        if (cancelled) return;
        setProfiles(list);
        if (list.length > 0) setSelected(list[0]);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refresh() {
    try {
      const list = await listIterm2Profiles();
      setProfiles(list);
      setSelected((cur) => (cur ? list.find((p) => p.name === cur.name) ?? null : null));
    } catch (e) {
      setError(String(e));
    }
  }
  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setNameError("请输入文件名");
      return;
    }
    if (!name.endsWith(".json")) {
      setNameError("文件名必须以 .json 结尾");
      return;
    }
    const baseName = name.replace(/\.json$/, "");
    const profileName = `Profile ${baseName}`;
    const guid = crypto.randomUUID();
    const content = JSON.stringify(
      { Profiles: [{ Name: profileName, Guid: guid }] },
      null,
      2,
    );
    setCreating(true);
    setNameError(null);
    try {
      await writeIterm2Profile(name, content);
      const list = await listIterm2Profiles();
      setProfiles(list);
      setSelected(list.find((p) => p.name === name) ?? null);
      setNewName("");
    } catch (e) {
      setNameError(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(name: string) {
    if (confirming !== name) {
      setConfirming(name);
      return;
    }
    setConfirming(null);
    setDeleting(name);
    setError(null);
    try {
      await deleteIterm2Profile(name);
      const list = await listIterm2Profiles();
      setProfiles(list);
      setSelected((cur) => (cur && cur.name === name ? (list[0] ?? null) : cur));
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-6">
      <h2 className="mb-1 text-xl font-semibold">iTerm2 配置</h2>
      <p className="mb-4 text-sm text-gray-500">
        管理 iTerm2 Dynamic Profiles，编辑保存后无需重启 iTerm2 即可生效。
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          读取失败：{error}
        </div>
      )}

      {profiles === null ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-600">
          加载中...
        </div>
      ) : (
        <div className="flex gap-4">
          <aside className="w-60 shrink-0">
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">
              Profiles
            </div>
            <div className="space-y-1">
              {profiles.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-1 rounded-md"
                  style={{
                    backgroundColor:
                      selected?.name === p.name
                        ? "rgb(37 99 235)"
                        : undefined,
                  }}
                >
                  <button
                    onClick={() => {
                      setConfirming(null);
                      setSelected(p);
                    }}
                    className={`block min-w-0 flex-1 truncate rounded-md px-3 py-2 text-left text-sm ${
                      selected?.name === p.name
                        ? "font-medium text-white"
                        : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {p.name}
                  </button>
                  <button
                    onClick={() => void handleDelete(p.name)}
                    disabled={deleting !== null}
                    title={
                      confirming === p.name
                        ? `再次点击确认删除 ${p.name}`
                        : `删除 ${p.name}`
                    }
                    className={`mr-1 shrink-0 rounded-md px-1.5 py-1 text-xs ${
                      confirming === p.name
                        ? "bg-red-600 font-medium text-white hover:bg-red-700"
                        : "text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                    } disabled:opacity-50`}
                  >
                    {deleting === p.name ? "..." : confirming === p.name ? "确认？" : "删除"}
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-600">
              <input
                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
                placeholder="my-profile.json"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                }}
              />
              <button
                onClick={handleCreate}
                disabled={creating}
                className="w-full rounded-md bg-gray-200 px-3 py-1 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
              >
                {creating ? "创建中..." : "新建 profile"}
              </button>
              {nameError && (
                <div className="text-xs text-red-500 dark:text-red-400">{nameError}</div>
              )}
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            {selected ? (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="border-b border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-700">
                  {selected.path}
                </div>
                <div className="p-4">
                  <Iterm2ConfigForm
                    key={selected.name}
                    name={selected.name}
                    content={selected.content}
                    onSaved={refresh}
                  />
                </div>
              </div>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-600">
                暂无 profile 文件，可在左侧新建
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
