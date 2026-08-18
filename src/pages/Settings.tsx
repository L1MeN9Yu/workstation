import { useEffect, useState } from "react";
import { useUpdateStore } from "../store/update";
import { getGlobalProxy, saveGlobalProxy } from "../lib/proxy";
import { confirmDialog } from "../lib/confirm";
import { toast } from "../lib/toast";
import Button from "../components/Button";
import {
  readCmuxSetting,
  writeCmuxSetting,
  detectCmux,
  type DetectCmuxResult,
} from "../lib/cmuxSetting";
import {
  ACCENT_COLORS,
  isHexColor,
  useTheme,
  type AccentColor,
  type PresetAccent,
  type Theme,
} from "../store/theme";
import { ToolPage } from "./ToolPage";
import OpenLogDirButton from "../components/OpenLogDirButton";
import { currentLogFile } from "../lib/logging";
import {
  getCacheSettings,
  getCacheStats,
  saveCacheSettings,
  clearCache,
  type CacheStats,
} from "../lib/cacheSettings";
import { formatFileSize } from "../lib/wallpaper";

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
    try {
      await saveGlobalProxy(proxy);
      toast.success("代理配置已保存");
    } catch (e) {
      toast.error(String(e));
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
          }}
          placeholder="http://127.0.0.1:7890"
          className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>
      <div className="mt-3">
        <Button variant="secondary" onClick={handleSave} disabled={saving || proxy === null}>
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>
    </section>
  );
}

function CacheSection() {
  const [limitGb, setLimitGb] = useState<number | null>(null);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);

  async function refreshStats(): Promise<void> {
    try {
      setStats(await getCacheStats());
    } catch {
      // 非 Tauri 环境（测试）或读取失败时占用展示保持空态
    }
  }

  useEffect(() => {
    let cancelled = false;
    void getCacheSettings().then((bytes) => {
      if (!cancelled) {
        setLimitGb(Math.round(bytes / (1024 * 1024 * 1024)));
      }
    });
    void getCacheStats().then((stats) => {
      if (!cancelled) {
        setStats(stats);
      }
    }).catch(() => {
      // 非 Tauri 环境（测试）或读取失败时占用展示保持空态
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(): Promise<void> {
    if (limitGb === null || !Number.isFinite(limitGb)) return;
    setSaving(true);
    try {
      await saveCacheSettings(limitGb * 1024 * 1024 * 1024);
      toast.success("缓存容量已保存");
      await refreshStats();
    } catch (e) {
      toast.error(`保存缓存容量失败：${String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleClear(): Promise<void> {
    setClearing(true);
    try {
      await clearCache();
      toast.success("缓存已清空");
      setConfirmingClear(false);
      await refreshStats();
    } catch (e) {
      toast.error(`清空缓存失败：${String(e)}`);
    } finally {
      setClearing(false);
    }
  }

  return (
    <section className="max-w-xl rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h3 className="mb-1 text-sm font-semibold">应用缓存</h3>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        壁纸缩略图与原图等缓存共用的容量上限与占用情况；清空仅删除缓存文件，不影响本地壁纸库与配置。
      </p>
      <label className="block text-sm">
        缓存容量上限（GB，范围 1–200，默认 50）
        <input
          type="number"
          min={1}
          max={200}
          value={limitGb ?? ""}
          onChange={(e) => {
            const gb = Number(e.target.value);
            setLimitGb(Number.isFinite(gb) ? Math.round(gb) : null);
          }}
          placeholder="50"
          className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>
      {stats && (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          已用 {formatFileSize(stats.totalBytes)} / 上限{" "}
          {formatFileSize(stats.limitBytes)}
          <span className="mx-1">·</span>
          缩略图 {formatFileSize(stats.thumbBytes)}
          <span className="mx-1">·</span>
          原图 {formatFileSize(stats.fullBytes)}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={() => void handleSave()}
          disabled={saving || limitGb === null}
          className="px-3 py-1"
        >
          {saving ? "保存中..." : "保存"}
        </Button>
        {confirmingClear ? (
          <>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              确认清空缓存？
            </span>
            <Button
              variant="secondary"
              onClick={() => void handleClear()}
              disabled={clearing}
              className="px-3 py-1"
            >
              {clearing ? "清空中..." : "确认清空"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setConfirmingClear(false)}
              disabled={clearing}
              className="px-3 py-1"
            >
              取消
            </Button>
          </>
        ) : (
          <Button
            variant="secondary"
            onClick={() => setConfirmingClear(true)}
            className="px-3 py-1"
          >
            清空缓存
          </Button>
        )}
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

  useEffect(() => {
    if (status === "error") {
      toast.error(errorMessage ?? "检查更新失败");
    }
  }, [status, errorMessage]);

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
          {errorMessage && (
            <div
              data-testid="update-relaunch-error"
              className="mt-1 text-red-500 dark:text-red-400"
            >
              {errorMessage}
            </div>
          )}
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
        <Button
          variant="secondary"
          onClick={handleCheck}
          disabled={busy}
          className="px-3 py-1"
        >
          {status === "checking" ? "检查中..." : "检查更新"}
        </Button>
        {status === "available" && (
          <Button variant="primary" onClick={handleDownload} disabled={busy} className="px-3 py-1">
            下载并安装
          </Button>
        )}
        {status === "error" && (
          <Button variant="primary" onClick={handleDownload} disabled={busy} className="px-3 py-1">
            重试下载
          </Button>
        )}
      </div>
    </section>
  );
}

function CmuxSection() {
  const [binPath, setBinPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [result, setResult] = useState<DetectCmuxResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readCmuxSetting().then((value) => {
      if (!cancelled) setBinPath(value ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave() {
    if (binPath === null) return;
    setSaving(true);
    try {
      await writeCmuxSetting(binPath.trim());
      toast.success("cmux 路径已保存");
      setResult(null);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDetect() {
    setDetecting(true);
    setResult(null);
    try {
      setResult(await detectCmux());
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDetecting(false);
    }
  }

  return (
    <section className="max-w-xl rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h3 className="mb-1 text-sm font-semibold">cmux 命令路径</h3>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        GUI 应用的环境 PATH 不含用户 shell 目录，找不到 cmux 时在此填写绝对路径；
        留空表示自动查找（PATH 与常见安装位置）。
      </p>
      <label className="block text-sm">
        可执行文件路径
        <input
          value={binPath ?? ""}
          onChange={(e) => {
            setBinPath(e.target.value);
            setResult(null);
          }}
          placeholder="留空自动查找，如 /opt/homebrew/bin/cmux"
          className="mt-1 w-full rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-mono text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>
      <div className="mt-3 flex items-center gap-2">
        <Button
          variant="secondary"
          onClick={handleSave}
          disabled={saving || binPath === null}
          className="px-3 py-1"
        >
          {saving ? "保存中..." : "保存"}
        </Button>
        <Button
          variant="secondary"
          onClick={handleDetect}
          disabled={detecting}
          className="px-3 py-1"
        >
          {detecting ? "检测中..." : "检测"}
        </Button>
      </div>
      {result && (
        <div className="mt-3 text-sm">
          {result.available ? (
            <div className="text-green-600 dark:text-green-400">
              cmux 可用：{result.resolvedPath}
              {result.version ? `（${result.version}）` : ""}
            </div>
          ) : (
            <div className="text-red-500 dark:text-red-400">
              cmux 不可用：{result.error ?? "未找到 cmux 命令"}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type SettingsTab = "appearance" | "update" | "proxy" | "cache" | "cmux" | "logging";

const TAB_OPTIONS: { id: SettingsTab; label: string }[] = [
  { id: "appearance", label: "外观" },
  { id: "update", label: "应用更新" },
  { id: "proxy", label: "网络代理" },
  { id: "cache", label: "应用缓存" },
  { id: "cmux", label: "cmux" },
  { id: "logging", label: "日志" },
];

function LogSection() {
  const [logFile, setLogFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void currentLogFile()
      .then((path) => {
        if (!cancelled) {
          setLogFile(path);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="max-w-xl rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <h3 className="mb-1 text-sm font-semibold">应用日志</h3>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        后端与前端运行日志已写入本地日志目录，可在日志目录中查看。
      </p>
      <div className="mb-3 text-sm">
        {error ? (
          <p className="text-xs text-red-500 dark:text-red-400">
            无法获取日志路径：{error}
          </p>
        ) : logFile === null ? (
          <p className="text-xs text-gray-400">正在获取日志路径...</p>
        ) : (
          <>
            <span className="mb-1 block text-xs text-gray-500 dark:text-gray-400">
              当前进程写入日志文件
            </span>
            <code className="break-all rounded-md bg-gray-100 px-2 py-1 font-mono text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200">
              {logFile}
            </code>
          </>
        )}
      </div>
      <OpenLogDirButton />
    </section>
  );
}

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
      {tab === "cache" && <CacheSection />}
      {tab === "cmux" && <CmuxSection />}
      {tab === "logging" && <LogSection />}
    </ToolPage>
  );
}
