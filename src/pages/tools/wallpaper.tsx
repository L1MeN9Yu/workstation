import { useEffect, useMemo, useState } from "react";
import { ToolPage } from "../ToolPage";
import {
  applyWallpaperToGhosty,
  downloadWallpaper,
  loadWallpaperSettings,
  saveWallpaperSettings,
  searchWallpapers,
  type SourceSettings,
  type WallpaperItem,
  type WallpaperSettings,
} from "../../lib/wallpaper";
import {
  WALLPAPER_SOURCES,
  getSourceMeta,
} from "../../lib/wallpaperSources";

interface SearchError {
  source: string;
  message: string;
}

interface SourceFieldDef {
  key: keyof SourceSettings;
  label: string;
  placeholder: string;
  hint?: string;
}

const SOURCE_FIELDS: Record<string, SourceFieldDef[]> = {
  wallhaven: [
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "wallhaven 设置页获取（可选）",
      hint: "填写后可访问更高 purity 分级内容",
    },
    { key: "purity", label: "purity", placeholder: "100" },
    { key: "categories", label: "categories", placeholder: "010" },
    { key: "minWidth", label: "最小宽度", placeholder: "1920" },
    { key: "minHeight", label: "最小高度", placeholder: "1080" },
  ],
  danbooru: [
    {
      key: "login",
      label: "用户名",
      placeholder: "danbooru 用户名（可选）",
      hint: "与 API Key 配对，提升匿名限流配额",
    },
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "账户设置页生成（可选）",
      hint: "以 HTTP Basic 认证方式随请求发送",
    },
    { key: "rating", label: "rating", placeholder: "safe" },
  ],
  safebooru: [
    { key: "minWidth", label: "最小宽度", placeholder: "1920" },
  ],
};

export default function WallpaperTool() {
  const [source, setSource] = useState("wallhaven");
  const [keywords, setKeywords] = useState("");
  const [searching, setSearching] = useState(false);
  const [items, setItems] = useState<WallpaperItem[]>([]);
  const [errors, setErrors] = useState<SearchError[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [settings, setSettings] = useState<WallpaperSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadWallpaperSettings().then((s) => {
      if (!cancelled) setSettings(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const meta = useMemo(() => getSourceMeta(source), [source]);

  async function handleSearch(random: boolean) {
    if (!settings) return;
    setSearching(true);
    setStatus(null);
    setErrors([]);
    setItems([]);
    try {
      const result = await searchWallpapers({
        source,
        keywords: random ? "" : keywords,
        random,
      });
      setItems(result);
      if (result.length === 0) {
        setStatus("没有找到满足条件的壁纸（分辨率需 ≥ 1920 宽）");
      }
    } catch (e) {
      setErrors([{ source, message: String(e) }]);
    } finally {
      setSearching(false);
    }
  }

  async function handleApply(item: WallpaperItem) {
    setApplyingId(item.id);
    setStatus(null);
    try {
      const path = await downloadWallpaper(item);
      const result = await applyWallpaperToGhosty(path);
      setStatus(`已下载并应用：${result.imagePath}。${result.reloadMessage}`);
    } catch (e) {
      setStatus(`应用失败：${String(e)}`);
    } finally {
      setApplyingId(null);
    }
  }

  async function handleSaveSettings() {
    if (!settings) return;
    try {
      await saveWallpaperSettings(settings);
      setStatus("设置已保存");
      setShowSettings(false);
    } catch (e) {
      setStatus(`保存设置失败：${String(e)}`);
    }
  }

  function updateSourceField(
    sourceId: string,
    key: keyof SourceSettings,
    value: string,
  ): void {
    if (!settings) return;
    setSettings({
      ...settings,
      sources: {
        ...settings.sources,
        [sourceId]: {
          ...settings.sources[sourceId],
          [key]: value,
        },
      },
    });
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 font-mono text-sm dark:border-gray-600 dark:bg-gray-900";

  return (
    <ToolPage
      title="壁纸工具"
      description="从 wallhaven / Danbooru / Safebooru 搜索壁纸，下载并应用到 cmux 终端背景"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-2">
          {WALLPAPER_SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSource(s.id);
                setErrors([]);
                setItems([]);
                setStatus(null);
              }}
              className={`rounded-md px-3 py-1 text-sm ${
                source === s.id
                  ? "bg-blue-600 text-white"
                  : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="rounded-md border border-gray-300 px-3 py-1 text-sm dark:border-gray-600"
        >
          设置
        </button>
      </div>

      {meta && (
        <p className="mb-3 text-xs text-gray-500">
          {meta.description}
        </p>
      )}

      {showSettings && settings && (
        <div className="mb-3 space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <label className="block text-sm">
            代理地址（留空则直连）
            <input
              value={settings.proxy}
              onChange={(e) =>
                setSettings({ ...settings, proxy: e.target.value })
              }
              placeholder="http://127.0.0.1:7890"
              className={inputClass}
            />
          </label>
          <label className="block text-sm">
            下载目录（留空使用默认 ~/.config/cmux/wallpapers）
            <input
              value={settings.downloadDir}
              onChange={(e) =>
                setSettings({ ...settings, downloadDir: e.target.value })
              }
              placeholder="~/.config/cmux/wallpapers"
              className={inputClass}
            />
          </label>
          <div className="space-y-3 border-t border-gray-200 pt-3 dark:border-gray-700">
            {(() => {
              const s = getSourceMeta(source);
              const fields = SOURCE_FIELDS[source] ?? [];
              const src = settings.sources[source];
              return (
                <div key={source}>
                  <div className="mb-1 text-sm font-medium">
                    {s?.label ?? source} 参数
                  </div>
                  {src && fields.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {fields.map((f) => (
                        <label key={f.key} className="block text-xs">
                          {f.label}
                          <input
                            value={src[f.key]}
                            onChange={(e) =>
                              updateSourceField(source, f.key, e.target.value)
                            }
                            placeholder={f.placeholder}
                            className={inputClass}
                          />
                          {f.hint && (
                            <span className="text-gray-400">{f.hint}</span>
                          )}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">
                      该图源无需额外参数
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
          <button
            onClick={() => void handleSaveSettings()}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white"
          >
            保存设置
          </button>
        </div>
      )}

      <div className="mb-3 flex gap-2">
        <input
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSearch(false);
          }}
          placeholder={meta?.placeholder ?? "输入关键词"}
          className="flex-1 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
        />
        <button
          onClick={() => void handleSearch(false)}
          disabled={searching || !settings}
          className="rounded-md bg-blue-600 px-4 py-1 text-sm text-white disabled:opacity-50"
        >
          {searching ? "搜索中..." : "搜索"}
        </button>
        {meta?.supportsRandom && (
          <button
            onClick={() => void handleSearch(true)}
            disabled={searching || !settings}
            className="rounded-md bg-gray-200 px-4 py-1 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
          >
            随机
          </button>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mb-3 space-y-2">
          {errors.map((e) => (
            <div
              key={e.source}
              className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
            >
              图源 {e.source} 搜索失败：{e.message}（wallhaven 需代理，请在设置中确认代理可用）
            </div>
          ))}
        </div>
      )}

      {status && (
        <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
          {status}
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.id}
              className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <img
                src={item.thumb_url}
                alt={item.id}
                loading="lazy"
                className="h-32 w-full object-cover"
              />
              <div className="flex items-center justify-between p-2 text-xs">
                <span className="text-gray-500">
                  {item.width}×{item.height}
                </span>
                <button
                  onClick={() => void handleApply(item)}
                  disabled={applyingId === item.id}
                  className="rounded-md bg-blue-600 px-2 py-0.5 text-white disabled:opacity-50"
                >
                  {applyingId === item.id ? "应用中..." : "下载并应用"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!searching && !status && !errors.length && items.length === 0 && (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-600">
          搜索壁纸以预览，点击「下载并应用」设置 cmux 背景
        </div>
      )}
    </ToolPage>
  );
}
