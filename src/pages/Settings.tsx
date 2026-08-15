import { useEffect, useState } from "react";
import { useUpdateStore } from "../store/update";
import { getGlobalProxy, saveGlobalProxy } from "../lib/proxy";
import { confirmDialog } from "../lib/confirm";
import {
  ACCENT_COLORS,
  isHexColor,
  useTheme,
  type AccentColor,
  type PresetAccent,
  type Theme,
} from "../store/theme";
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

const ACCENT_LABELS: Record<PresetAccent, string> = {
  blue: "蓝",
  green: "绿",
  purple: "紫",
  orange: "橙",
  red: "红",
  cyan: "青",
  pink: "粉",
  indigo: "靛",
};

const ACCENT_SWATCH: Record<PresetAccent, string> = {
  blue: "bg-blue-500",
  green: "bg-green-500",
  purple: "bg-purple-500",
  orange: "bg-orange-500",
  red: "bg-red-500",
  cyan: "bg-cyan-500",
  pink: "bg-pink-500",
  indigo: "bg-indigo-500",
};

const PRESET_ACCENT_HEX: Record<PresetAccent, string> = {
  blue: "#2563eb",
  green: "#16a34a",
  purple: "#9333ea",
  orange: "#f97316",
  red: "#dc2626",
  cyan: "#06b6d4",
  pink: "#ec4899",
  indigo: "#4f46e5",
};

function accentToHex(accent: AccentColor): string {
  return ACCENT_COLORS.includes(accent as PresetAccent)
    ? PRESET_ACCENT_HEX[accent as PresetAccent]
    : accent;
}

const MODE_OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
  { value: "system", label: "跟随系统" },
];

function ThemeSection() {
  const { theme, accent, setTheme, setAccent } = useTheme();
  const [hexInput, setHexInput] = useState(accentToHex(accent));
  const [hexError, setHexError] = useState<string | null>(null);

  function selectTheme(mode: Theme) {
    setTheme(mode);
  }

  function chooseAccent(value: AccentColor) {
    setAccent(value);
    setHexInput(accentToHex(value));
    setHexError(null);
  }

  function applyHexInput() {
    const raw = hexInput.trim();
    const normalized = raw.startsWith("#") ? raw : `#${raw}`;
    if (isHexColor(normalized)) {
      chooseAccent(normalized);
    } else {
      setHexError("请输入 6 位十六进制颜色，如 #ff5722");
    }
  }

  return (
    <section className="max-w-xl rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h3 className="mb-1 text-sm font-semibold">外观</h3>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        选择明暗模式与应用强调色。
      </p>
      <div className="mb-4">
        <span className="mb-2 block text-sm text-gray-600 dark:text-gray-300">
          明暗模式
        </span>
        <div className="flex gap-2">
          {MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => selectTheme(option.value)}
              className={`rounded-md px-4 py-1.5 text-sm disabled:opacity-50 ${
                theme === option.value
                  ? "bg-accent-600 text-white"
                  : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <span className="mb-2 block text-sm text-gray-600 dark:text-gray-300">
          主题色
        </span>
        <div className="flex gap-2">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color}
              onClick={() => chooseAccent(color)}
              title={ACCENT_LABELS[color]}
              aria-pressed={accent === color}
              className={`h-8 w-8 rounded-full ${ACCENT_SWATCH[color]} ${
                accent === color
                  ? "ring-2 ring-gray-900 ring-offset-2 dark:ring-white"
                  : ""
              }`}
            />
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
            自定义
            <input
              type="color"
              value={accentToHex(accent)}
              onChange={(e) => chooseAccent(e.target.value as AccentColor)}
              className="h-8 w-10 cursor-pointer rounded border border-gray-300 bg-transparent dark:border-gray-600"
            />
          </label>
          <input
            type="text"
            value={hexInput}
            onChange={(e) => {
              setHexInput(e.target.value);
              setHexError(null);
            }}
            onBlur={applyHexInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                applyHexInput();
              }
            }}
            placeholder="#ff5722"
            aria-label="自定义主题色十六进制值"
            className="w-28 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
          />
        </div>
        {hexError && (
          <div className="mt-1 text-sm text-red-500 dark:text-red-400">
            {hexError}
          </div>
        )}
      </div>
    </section>
  );
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
        <div className="mt-2 text-sm text-green-600 dark:text-green-400">
          {message}
        </div>
      )}
      {error && (
        <div className="mt-2 text-sm text-red-500 dark:text-red-400">
          {error}
        </div>
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

function UpdateSection() {
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
        <div className="mb-3 text-sm text-accent-600 dark:text-accent-400">
          发现新版本 {availableVersion}，可下载并安装。
        </div>
      )}

      {status === "downloading" && (
        <div className="mb-3">
          <div className="mb-1 text-sm text-gray-600 dark:text-gray-300">
            正在下载更新... {formatBytes(downloadedBytes)}
            {totalBytes ? ` / ${formatBytes(totalBytes)}` : ""}（{progress}%）
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              data-testid="update-progress-bar"
              className="h-full rounded-full bg-accent-600 transition-all"
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
            className="rounded-md bg-accent-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            下载并安装
          </button>
        )}
        {status === "error" && (
          <button
            onClick={handleDownload}
            disabled={busy}
            className="rounded-md bg-accent-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            重试下载
          </button>
        )}
      </div>
    </section>
  );
}

type SettingsTab = "appearance" | "update" | "proxy";

const TAB_OPTIONS: { id: SettingsTab; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "update", label: "应用更新" },
  { id: "proxy", label: "网络代理" },
];

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>("appearance");

  return (
    <ToolPage title="设置" description="应用更新与系统设置">
      <div className="mb-4 flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {TAB_OPTIONS.map((option) => (
          <button
            key={option.id}
            onClick={() => setTab(option.id)}
            className={`-mb-px rounded-t-md border border-b-0 px-4 py-1.5 text-sm ${
              tab === option.id
                ? "border-gray-200 bg-white font-medium text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {tab === "appearance" && <ThemeSection />}
      {tab === "update" && <UpdateSection />}
      {tab === "proxy" && <ProxySection />}
    </ToolPage>
  );
}
