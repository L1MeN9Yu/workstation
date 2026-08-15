import { useEffect, useState } from "react";
import { useUpdateStore } from "../store/update";
import { getGlobalProxy, saveGlobalProxy } from "../lib/proxy";
import { confirmDialog } from "../lib/confirm";
import { ToolPage } from "./ToolPage";

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) {
    return "";
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ProxySection() {
  const [proxy, setProxy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getGlobalProxy().then((value) => {
      if (!cancelled) setProxy(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    if (proxy === null) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await saveGlobalProxy(proxy);
      setMessage("代理配置已保存");
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="max-w-xl rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h3 className="mb-1 text-sm font-semibold">网络代理</h3>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        配置后应用更新检查与壁纸下载均走该代理（优先于系统代理）；留空表示直连。
      </p>
      <label className="block text-sm">
        代理地址
        <input
          value={proxy ?? ""}
          onChange={(e) => {
            setProxy(e.target.value);
            setMessage(null);
            setError(null);
          }}
          placeholder="http://127.0.0.1:7890"
          className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>
      {message && (
        <div className="mt-2 text-sm text-green-600 dark:text-green-400">{message}</div>
      )}
      {error && (
        <div className="mt-2 text-sm text-red-500 dark:text-red-400">{error}</div>
      )}
      <div className="mt-3">
        <button
          onClick={handleSave}
          disabled={saving || proxy === null}
          className="rounded-md bg-gray-200 px-4 py-1.5 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>
    </section>
  );
}

export default function Settings() {
  const {
    status,
    currentVersion,
    availableVersion,
    downloadedBytes,
    totalBytes,
    errorMessage,
    upToDate,
    check,
    downloadAndInstall,
  } = useUpdateStore();

  const busy = status === "checking" || status === "downloading";

  async function handleCheck() {
    await check();
  }

  async function handleDownload() {
    const ok = await confirmDialog(
      "下载并安装更新？安装过程中请保存好当前工作，应用将自动重启。",
    );
    if (!ok) {
      return;
    }
    await downloadAndInstall();
  }

  const progress =
    status === "downloading" && totalBytes && totalBytes > 0
      ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
      : 0;

  return (
    <ToolPage title="设置" description="应用更新与系统设置">
      <section className="max-w-xl rounded-lg border border-gray-200 p-4 dark:border-gray-700">
        <h3 className="mb-1 text-sm font-semibold">应用更新</h3>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          当前版本：{currentVersion ?? "未知"}
          {availableVersion ? ` · 可用版本：${availableVersion}` : ""}
        </p>

        {status === "checking" && (
          <div className="mb-3 text-sm text-gray-500">正在检查更新...</div>
        )}

        {status === "available" && (
          <div className="mb-3 text-sm text-blue-600 dark:text-blue-400">
            发现新版本 {availableVersion}，可下载并安装。
          </div>
        )}

        {status === "downloading" && (
          <div className="mb-3">
            <div className="mb-1 text-sm text-gray-600 dark:text-gray-300">
              正在下载更新... {formatBytes(downloadedBytes)}
              {totalBytes ? ` / ${formatBytes(totalBytes)}` : ""}（
              {progress}%）
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-blue-600 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {status === "ready" && (
          <div className="mb-3 text-sm text-green-600 dark:text-green-400">
            更新已下载，应用即将自动重启并安装。
          </div>
        )}

        {status === "idle" && upToDate && (
          <div className="mb-3 text-sm text-green-600 dark:text-green-400">
            已是最新版本。
          </div>
        )}

        {status === "error" && (
          <div className="mb-3 text-sm text-red-500 dark:text-red-400">
            {errorMessage ?? "检查更新失败"}
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleCheck}
            disabled={busy}
            className="rounded-md bg-gray-200 px-4 py-1.5 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
          >
            {status === "checking" ? "检查中..." : "检查更新"}
          </button>
          {status === "available" && (
            <button
              onClick={handleDownload}
              disabled={busy}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              下载并安装
            </button>
          )}
          {status === "error" && (
            <button
              onClick={handleDownload}
              disabled={busy}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              重试下载
            </button>
          )}
        </div>
      </section>
      <div className="mt-4">
        <ProxySection />
      </div>
    </ToolPage>
  );
}
