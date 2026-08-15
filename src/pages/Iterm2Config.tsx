import { useEffect, useState } from "react";
import {
  deleteIterm2Profile,
  listIterm2Profiles,
  writeIterm2Profile,
  type Iterm2ProfileFile,
} from "../lib/iterm2Config";
import { confirmDialog } from "../lib/confirm";
import { toast } from "../lib/toast";
import Iterm2ConfigForm from "../components/Iterm2ConfigForm";
import Alert from "../components/Alert";
import Button from "../components/Button";
import EmptyState from "../components/EmptyState";

export default function Iterm2Config() {
  const [profiles, setProfiles] = useState<Iterm2ProfileFile[] | null>(null);
  const [selected, setSelected] = useState<Iterm2ProfileFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function refresh() {
    try {
      const list = await listIterm2Profiles();
      setProfiles(list);
      setSelected((cur) => (cur ? list.find((p) => p.name === cur.name) ?? null : null));
    } catch (e) {
      setError(String(e));
    }
  }

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
      toast.success(`已创建 ${name}`);
    } catch (e) {
      setNameError(String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(name: string) {
    const ok = await confirmDialog(`确认删除 profile ${name}？此操作不可恢复。`);
    if (!ok) return;
    setDeleting(name);
    setError(null);
    try {
      await deleteIterm2Profile(name);
      const list = await listIterm2Profiles();
      setProfiles(list);
      setSelected((cur) => (cur && cur.name === name ? (list[0] ?? null) : cur));
      toast.success(`已删除 ${name}`);
    } catch (e) {
      setError(String(e));
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="w-full px-6 py-6">
      <h2 className="mb-1 text-xl font-semibold">iTerm2 配置</h2>
      <p className="mb-4 text-sm text-gray-500">
        管理 iTerm2 Dynamic Profiles，编辑保存后无需重启 iTerm2 即可生效。
      </p>

      {error && <Alert variant="error">读取失败：{error}</Alert>}

      {profiles === null ? (
        <EmptyState>加载中...</EmptyState>
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
                  <Button
                    variant="dangerText"
                    onClick={() => void handleDelete(p.name)}
                    disabled={deleting !== null}
                    title={`删除 ${p.name}`}
                  >
                    {deleting === p.name ? "..." : "删除"}
                  </Button>
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
              <Button
                variant="secondary"
                onClick={handleCreate}
                disabled={creating}
                className="w-full px-3 py-1"
              >
                {creating ? "创建中..." : "新建 profile"}
              </Button>
              {nameError && (
                <div className="text-xs text-red-500 dark:text-red-400">{nameError}</div>
              )}
            </div>
          </aside>

          <main className="min-w-0 flex-1">
            {selected ? (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-700">
                  <span className="truncate text-xs text-gray-500">{selected.path}</span>
                  <Button
                    variant="secondary"
                    onClick={() => void refresh()}
                    className="ml-3 px-2 py-1 text-xs hover:bg-gray-300 dark:hover:bg-gray-600"
                    title="从磁盘重新读取 profile 文件（同步 iTerm2 内的修改）"
                  >
                    读取
                  </Button>
                </div>
                <div className="p-4">
                  <Iterm2ConfigForm
                    key={`${selected.name}:${selected.content}`}
                    name={selected.name}
                    content={selected.content}
                    onSaved={() => {
                      void refresh();
                    }}
                  />
                </div>
              </div>
            ) : (
              <EmptyState>暂无 profile 文件，可在左侧新建</EmptyState>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
