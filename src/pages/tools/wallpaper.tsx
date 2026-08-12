import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import { ToolPage } from "../ToolPage";
import {
  BIT_GROUPS,
  RATIO_OPTIONS,
  applyWallpaperToGhosty,
  bitsToSelections,
  downloadWallpaper,
  generateSeed,
  loadWallpaperSettings,
  saveWallpaperProxy,
  saveWallpaperSources,
  searchWallpapers,
  selectionsToBits,
  thumbUrl,
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

const MAX_THUMB_ATTEMPTS = 6;
const THUMB_RETRY_MS = 1000;
const SOURCE_SAVE_DEBOUNCE_MS = 500;

const thumbReadyListeners = new Set<() => void>();
let thumbReadyVersion = 0;

function subscribeThumbReady(listener: () => void): () => void {
  thumbReadyListeners.add(listener);
  return () => {
    thumbReadyListeners.delete(listener);
  };
}

function getThumbReadyVersion(): number {
  return thumbReadyVersion;
}

void listen("thumb-ready", () => {
  thumbReadyVersion += 1;
  for (const listener of thumbReadyListeners) listener();
}).catch(() => {
  // 非 Tauri 环境（测试）下静默忽略
});

interface ProxiedThumbProps {
  hash: string;
  alt: string;
  className: string;
}

interface ThumbImageProps {
  src: string;
  alt: string;
  onFailed: () => void;
}

function ThumbImage({ src, alt, onFailed }: ThumbImageProps) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && (
        <div
          className="absolute inset-0 animate-pulse bg-gradient-to-br from-gray-200 via-gray-100 to-gray-200 dark:from-gray-700 dark:via-gray-800 dark:to-gray-700"
          role="status"
          aria-label="加载中"
        />
      )}
      <img
        src={src}
        alt={alt}
        className={`relative h-full w-full object-cover transition-opacity duration-200 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        onLoad={() => setLoaded(true)}
        onError={onFailed}
      />
    </>
  );
}

function ProxiedThumb({ hash, alt, className }: ProxiedThumbProps) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryTimer = useRef<number | null>(null);
  const readyVersion = useSyncExternalStore(
    subscribeThumbReady,
    getThumbReadyVersion,
    getThumbReadyVersion,
  );

  useEffect(() => {
    return () => {
      if (retryTimer.current !== null) {
        window.clearTimeout(retryTimer.current);
      }
    };
  }, []);

  if (failed) {
    return (
      <button
        onClick={() => {
          setFailed(false);
          setAttempt((a) => a + 1);
        }}
        className={`flex w-full cursor-pointer items-center justify-center bg-gray-100 text-xs text-gray-400 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 ${className}`}
        type="button"
      >
        加载失败，点击重试
      </button>
    );
  }
  const bust =
    attempt > 0 || readyVersion > 0
      ? `?r=${attempt}&v=${readyVersion}`
      : "";
  return (
    <div className={`relative overflow-hidden ${className}`}>
      <ThumbImage
        key={bust}
        src={thumbUrl(hash) + bust}
        alt={alt}
        onFailed={() => {
          if (attempt >= MAX_THUMB_ATTEMPTS) {
            setFailed(true);
            return;
          }
          retryTimer.current = window.setTimeout(() => {
            retryTimer.current = null;
            setAttempt((a) => a + 1);
          }, THUMB_RETRY_MS);
        }}
      />
    </div>
  );
}

type FieldType = "text" | "checkbox" | "select" | "number" | "seed" | "multiselect";

interface SourceFieldDef {
  key: keyof SourceSettings;
  label: string;
  placeholder?: string;
  hint?: string;
  type?: FieldType;
  options?: string[];
  groups?: string[];
}

const SOURCE_FIELDS: Record<string, SourceFieldDef[]> = {
  wallhaven: [
    {
      key: "apiKey",
      label: "API Key",
      placeholder: "wallhaven 设置页获取（可选）",
      hint: "填写后可访问更高 purity 分级内容",
    },
    {
      key: "purity",
      label: "purity",
      type: "checkbox",
      groups: ["SFW", "Sketchy", "NSFW"],
      hint: "至少勾选一项",
    },
    {
      key: "categories",
      label: "categories",
      type: "checkbox",
      groups: ["General", "Anime", "People"],
      hint: "至少勾选一项",
    },
    {
      key: "seed",
      label: "seed",
      type: "seed",
      hint: "随机搜索的种子，点击刷新可换一批结果",
    },
    {
      key: "ratios",
      label: "ratios",
      type: "multiselect",
      options: RATIO_OPTIONS,
      hint: "宽高比筛选，可多选",
    },
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
    {
      key: "rating",
      label: "rating",
      type: "select",
      options: ["safe", "questionable", "explicit", ""],
      hint: "不限则留空",
    },
  ],
  safebooru: [{ key: "minWidth", label: "最小宽度", type: "number", placeholder: "1920" }],
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
  const [checkboxBlocked, setCheckboxBlocked] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const pageRef = useRef(1);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  function scheduleSourceSave(
    sources: WallpaperSettings["sources"],
  ): void {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveWallpaperSources(sources)
        .then(() => setStatus("参数已自动保存"))
        .catch((e) => setStatus(`自动保存失败：${String(e)}`));
    }, SOURCE_SAVE_DEBOUNCE_MS);
  }

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

  async function runSearch(random: boolean, page: number): Promise<void> {
    if (!settings) return;
    setSearching(true);
    setStatus(null);
    setErrors([]);
    try {
      const result = await searchWallpapers(
        {
          source,
          keywords: random ? "" : keywords,
          random,
          page,
        },
        settings,
      );
      setItems((prev) => (page > 1 ? [...prev, ...result] : result));
      setHasMore(result.length > 0);
      if (result.length === 0 && page === 1) {
        setStatus("没有找到满足条件的壁纸（分辨率需 ≥ 1920 宽）");
      }
    } catch (e) {
      if (page === 1) {
        setErrors([{ source, message: String(e) }]);
      } else {
        setStatus(`加载更多失败：${String(e)}`);
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleSearch(random: boolean) {
    pageRef.current = 1;
    setItems([]);
    await runSearch(random, 1);
  }

  async function handleLoadMore() {
    const next = pageRef.current + 1;
    pageRef.current = next;
    await runSearch(false, next);
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

  async function handleRefreshSeed() {
    if (!settings) return;
    const updated = {
      ...settings,
      sources: {
        ...settings.sources,
        wallhaven: {
          ...settings.sources.wallhaven,
          seed: generateSeed(),
        },
      },
    };
    setSettings(updated);
    setStatus(null);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      await saveWallpaperSources(updated.sources);
      setStatus("seed 已刷新并保存");
    } catch (e) {
      setStatus(`保存 seed 失败：${String(e)}`);
    }
  }

  async function handleSaveSettings() {
    if (!settings) return;
    try {
      await saveWallpaperProxy(settings);
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
    const nextSources = {
      ...settings.sources,
      [sourceId]: {
        ...settings.sources[sourceId],
        [key]: value,
      },
    };
    setSettings({ ...settings, sources: nextSources });
    scheduleSourceSave(nextSources);
  }

  function handleCheckboxChange(
    sourceId: string,
    key: keyof SourceSettings,
    option: string,
    checked: boolean,
  ): void {
    if (!settings) return;
    const groups = BIT_GROUPS[key] ?? [];
    const current = bitsToSelections(
      settings.sources[sourceId]?.[key] ?? "",
      groups,
    );
    const next = checked
      ? [...current, option]
      : current.filter((k) => k !== option);
    if (next.length === 0) {
      setCheckboxBlocked(key as string);
      return;
    }
    setCheckboxBlocked(null);
    updateSourceField(sourceId, key, selectionsToBits(next, groups));
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
                setHasMore(false);
                pageRef.current = 1;
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
          className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white"
        >
          设置
        </button>
      </div>

      {meta && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs text-gray-500">{meta.description}</p>
          <a
            href={meta.homepage}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-blue-600 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            {meta.label} 官网
          </a>
        </div>
      )}

      {showSettings && settings && (
        <div className="mb-3 space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="text-sm font-medium">统一设置</div>
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
          <button
            onClick={() => void handleSaveSettings()}
            className="rounded-md bg-blue-600 px-3 py-1 text-sm text-white"
          >
            保存设置
          </button>
        </div>
      )}

      {settings && meta && (
        <div className="mb-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-2 text-sm font-medium">{meta.label} 参数</div>
          {(() => {
            const fields = SOURCE_FIELDS[source] ?? [];
            const src = settings.sources[source];
            if (!src || fields.length === 0) {
              return (
                <p className="text-xs text-gray-400">该图源无需额外参数</p>
              );
            }
            return (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {fields.map((f) => {
                  if (f.type === "checkbox") {
                    const groups = BIT_GROUPS[f.key] ?? [];
                    const selected = bitsToSelections(
                      src[f.key] ?? "",
                      groups,
                    );
                    return (
                      <div
                        key={f.key}
                        className="col-span-2 sm:col-span-3"
                      >
                        <span className="block text-xs">{f.label}</span>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 dark:border-gray-600 dark:bg-gray-900">
                          {groups.map((g) => (
                            <label
                              key={g.key}
                              className="flex cursor-pointer items-center gap-1 text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={selected.includes(g.key)}
                                onChange={(e) =>
                                  handleCheckboxChange(
                                    source,
                                    f.key,
                                    g.key,
                                    e.target.checked,
                                  )
                                }
                                className="h-3.5 w-3.5"
                              />
                              {g.label}
                            </label>
                          ))}
                          {checkboxBlocked === f.key && (
                            <span className="text-xs text-red-500">
                              至少需勾选一项
                            </span>
                          )}
                        </div>
                        {f.hint && (
                          <span className="text-xs text-gray-400">{f.hint}</span>
                        )}
                      </div>
                    );
                  }
                  if (f.type === "multiselect") {
                    const options = f.options ?? [];
                    const selected = (src[f.key] ?? "")
                      .split(",")
                      .map((v) => v.trim())
                      .filter((v) => v !== "");
                    return (
                      <div
                        key={f.key}
                        className="col-span-2 sm:col-span-3"
                      >
                        <span className="block text-xs">{f.label}</span>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 dark:border-gray-600 dark:bg-gray-900">
                          {options.map((opt) => (
                            <label
                              key={opt}
                              className="flex cursor-pointer items-center gap-1 text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={selected.includes(opt)}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? [...selected, opt]
                                    : selected.filter((v) => v !== opt);
                                  updateSourceField(source, f.key, next.join(","));
                                }}
                                className="h-3.5 w-3.5"
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                        {f.hint && (
                          <span className="text-xs text-gray-400">{f.hint}</span>
                        )}
                      </div>
                    );
                  }
                  return (
                    <label key={f.key} className="block text-xs">
                      {f.label}
                      {f.type === "select" ? (
                        <select
                          value={src[f.key]}
                          onChange={(e) =>
                            updateSourceField(source, f.key, e.target.value)
                          }
                          className={inputClass}
                        >
                          {(f.options ?? []).map((opt) => (
                            <option key={opt || "__empty__"} value={opt}>
                              {opt === "" ? "不限" : opt}
                            </option>
                          ))}
                        </select>
                      ) : f.type === "number" ? (
                        <input
                          type="number"
                          min={0}
                          value={src[f.key]}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "" || Number(v) >= 0) {
                              updateSourceField(source, f.key, v);
                            }
                          }}
                          placeholder={f.placeholder}
                          className={inputClass}
                        />
                      ) : f.type === "seed" ? (
                        <div className="mt-1 flex gap-1">
                          <input
                            value={src[f.key]}
                            onChange={(e) =>
                              updateSourceField(source, f.key, e.target.value)
                            }
                            placeholder="随机搜索种子（可选）"
                            className={inputClass}
                          />
                          <button
                            onClick={() => void handleRefreshSeed()}
                            title="生成新 seed 并自动保存"
                            className="shrink-0 rounded-md bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                            type="button"
                          >
                            刷新
                          </button>
                        </div>
                      ) : (
                        <input
                          value={src[f.key]}
                          onChange={(e) =>
                            updateSourceField(source, f.key, e.target.value)
                          }
                          placeholder={f.placeholder}
                          className={inputClass}
                        />
                      )}
                      {f.hint && (
                        <span className="text-xs text-gray-400">{f.hint}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            );
          })()}
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
              <ProxiedThumb
                hash={item.thumb_hash}
                alt={item.id}
                className="h-32 w-full"
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

      {items.length > 0 && hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => void handleLoadMore()}
            disabled={searching}
            className="rounded-md bg-gray-200 px-6 py-2 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
          >
            {searching ? "加载中..." : "加载更多"}
          </button>
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
