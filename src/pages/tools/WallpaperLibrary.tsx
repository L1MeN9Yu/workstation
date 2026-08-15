import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyWallpaper,
  deleteLocalWallpapers,
  fetchWallpaperThumb,
  formatFileSize,
  formatModifiedTime,
  listLocalWallpapers,
  readLocalWallpaperFile,
  type ApplyWallpaperTarget,
  type LocalWallpaperInfo,
} from "../../lib/wallpaper";
import { WallpaperTargetSelect } from "../../components/WallpaperTargetSelect";

interface WallpaperLibraryProps {
  applyTarget: ApplyWallpaperTarget;
  onApplyTargetChange: (target: ApplyWallpaperTarget) => void;
  /** iTerm2 目标 Profile 名称（应用目标为 iterm2 时使用） */
  iterm2Profile: string;
  /** 未选择 iTerm2 Profile 时通知上层打开设置 */
  onRequireProfile: () => void;
}

const IMAGE_PLACEHOLDER =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiPjxyZWN0IHdpZHRoPSIxNjAiIGhlaWdodD0iOTAiIGZpbGw9IiNlNWU3ZWIiLz48dGV4dCB4PSI4MCIgeT0iNTAiIGZvbnQtc2l6ZT0iMTIiIGZpbGw9IiM5Y2EzYWYiIHRleHQtYW5jaG9yPSJtaWRkbGUiPjphZGE8L3RleHQ+PC9zdmc+";

/** 单张壁纸的缩略图：独立并行拉取，就绪前显示骨架脉冲块，失败显示占位图 */
function ThumbImage({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const reqId = reqRef.current + 1;
    reqRef.current = reqId;
    let cancelled = false;
    void fetchWallpaperThumb(path)
      .then((data) => {
        if (!cancelled && reqRef.current === reqId) setUrl(data);
      })
      .catch(() => {
        // 缩略图失败不阻塞卡片，保留骨架占位
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!url) {
    return (
      <div
        role="status"
        aria-label={`加载缩略图 ${alt}`}
        className="h-32 w-full animate-pulse bg-gray-200 dark:bg-gray-700"
      />
    );
  }
  return (
    <img
      src={url || IMAGE_PLACEHOLDER}
      alt={alt}
      className="h-32 w-full object-cover"
    />
  );
}

/** 列表加载中的骨架网格 */
function SkeletonGrid() {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
      aria-label="加载中"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
        >
          <div className="h-32 w-full animate-pulse bg-gray-200 dark:bg-gray-700" />
          <div className="space-y-2 p-2">
            <div className="h-3 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 本地壁纸库视图：预览、删除、刷新、应用为 cmux/iTerm2 背景 */
export function WallpaperLibrary({
  applyTarget,
  onApplyTargetChange,
  iterm2Profile,
  onRequireProfile,
}: WallpaperLibraryProps) {
  const [items, setItems] = useState<LocalWallpaperInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [applyingPath, setApplyingPath] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewReqRef = useRef(0);
  const loadReqRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const reqId = loadReqRef.current + 1;
    loadReqRef.current = reqId;
    setError(null);
    try {
      const result = await listLocalWallpapers();
      if (loadReqRef.current !== reqId) return;
      setItems(result);
      setSelected(new Set());
    } catch (e) {
      if (loadReqRef.current !== reqId) return;
      setError(String(e));
    } finally {
      if (loadReqRef.current === reqId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listLocalWallpapers()
      .then((result) => {
        if (cancelled) return;
        setItems(result);
        setSelected(new Set());
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** 手动刷新：重新置为加载态并拉取列表 */
  function handleRefresh(): void {
    setLoading(true);
    void load();
  }

  function toggleSelected(path: string, checked: boolean): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }

  async function handleDelete(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    if (!window.confirm(`确认删除 ${paths.length} 张壁纸？此操作不可恢复。`)) {
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await deleteLocalWallpapers(paths);
      if (result.errors.length > 0) {
        setNotice(
          `删除完成：成功 ${result.deleted.length} 张，失败 ${result.errors.length} 张（${result.errors[0]}）`,
        );
      } else {
        setNotice(`已删除 ${result.deleted.length} 张壁纸`);
      }
      await load();
    } catch (e) {
      setNotice(`删除失败：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleApply(path: string): Promise<void> {
    if (applyTarget === "iterm2" && !iterm2Profile) {
      onRequireProfile();
      return;
    }
    setApplyingPath(path);
    setNotice(null);
    try {
      const result = await applyWallpaper(path, applyTarget, iterm2Profile);
      setNotice(
        `已应用到 ${result.target === "iterm2" ? "iTerm2" : "cmux"}：${result.imagePath}。${result.reloadMessage}`,
      );
    } catch (e) {
      setNotice(`应用失败：${String(e)}`);
    } finally {
      setApplyingPath(null);
    }
  }

  async function openPreview(path: string): Promise<void> {
    const reqId = previewReqRef.current + 1;
    previewReqRef.current = reqId;
    setPreviewPath(path);
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const url = await readLocalWallpaperFile(path);
      if (previewReqRef.current !== reqId) return;
      setPreviewUrl(url);
    } catch (e) {
      if (previewReqRef.current !== reqId) return;
      setPreviewError(String(e));
    } finally {
      if (previewReqRef.current === reqId) {
        setPreviewLoading(false);
      }
    }
  }

  function closePreview(): void {
    previewReqRef.current += 1;
    setPreviewPath(null);
    setPreviewUrl(null);
    setPreviewError(null);
    setPreviewLoading(false);
  }

  useEffect(() => {
    if (!previewPath) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewPath]);

  const selectedPaths = [...selected];
  const allSelected =
    items.length > 0 && selected.size === items.length;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={loading || busy}
            className="rounded-md bg-gray-200 px-3 py-1 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200"
          >
            {loading ? "刷新中..." : "刷新"}
          </button>
          <button
            onClick={() => void handleDelete(selectedPaths)}
            disabled={selectedPaths.length === 0 || busy}
            className="rounded-md bg-red-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            删除选中（{selectedPaths.length}）
          </button>
          <label className="flex cursor-pointer items-center gap-1 text-xs text-gray-600 dark:text-gray-300">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={items.length === 0}
              onChange={(e) => {
                setSelected(
                  e.target.checked
                    ? new Set(items.map((i) => i.absolutePath))
                    : new Set(),
                );
              }}
              className="h-3.5 w-3.5"
            />
            全选
          </label>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>应用目标</span>
          <WallpaperTargetSelect
            value={applyTarget}
            onChange={onApplyTargetChange}
          />
        </div>
      </div>

      {notice && (
        <div className="mb-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
          {notice}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          加载本地壁纸失败：{error}
        </div>
      )}

      {loading ? (
        <SkeletonGrid />
      ) : items.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-600">
          本地壁纸目录为空，先在搜索页下载壁纸吧
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <div
              key={item.absolutePath}
              className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <button
                type="button"
                onClick={() => void openPreview(item.absolutePath)}
                className="block w-full cursor-pointer"
                title="点击预览大图"
              >
                <ThumbImage path={item.absolutePath} alt={item.fileName} />
              </button>
              <div className="p-2 text-xs">
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span
                    className="truncate text-gray-700 dark:text-gray-200"
                    title={item.fileName}
                  >
                    {item.fileName}
                  </span>
                  <label className="flex shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={selected.has(item.absolutePath)}
                      onChange={(e) =>
                        toggleSelected(item.absolutePath, e.target.checked)
                      }
                      aria-label={`选择 ${item.fileName}`}
                      className="h-3.5 w-3.5"
                    />
                  </label>
                </div>
                <div className="mb-2 text-gray-500">
                  {formatFileSize(item.sizeBytes)} ·{" "}
                  {formatModifiedTime(item.modifiedAtMs)}
                </div>
                <div className="flex items-center justify-between gap-1">
                  <WallpaperTargetSelect
                    value={applyTarget}
                    onChange={onApplyTargetChange}
                    compact
                  />
                  <button
                    onClick={() => void handleApply(item.absolutePath)}
                    disabled={applyingPath === item.absolutePath}
                    className="rounded-md bg-blue-600 px-2 py-0.5 text-white disabled:opacity-50"
                  >
                    {applyingPath === item.absolutePath ? "应用中..." : "应用"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewPath && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="本地壁纸预览"
          className="fixed inset-0 z-50 bg-black/80"
          onClick={(e) => {
            if (e.target === e.currentTarget) closePreview();
          }}
        >
          <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md bg-gray-900/80 p-2 text-white shadow-lg">
            <span className="max-w-48 truncate text-xs text-gray-300">
              {previewPath.split("/").pop()}
            </span>
            <button
              onClick={closePreview}
              aria-label="关闭预览"
              className="rounded-md bg-red-600 px-2 py-1 text-sm hover:bg-red-500"
            >
              ✕
            </button>
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {previewLoading && (
              <div
                className="pointer-events-auto animate-pulse text-gray-300"
                role="status"
              >
                加载中...
              </div>
            )}
            {previewError && !previewLoading && (
              <div
                className="pointer-events-auto text-gray-200"
                role="alert"
              >
                预览加载失败：{previewError}
              </div>
            )}
            {previewUrl && !previewLoading && (
              <img
                src={previewUrl}
                alt={previewPath.split("/").pop() ?? ""}
                className="max-h-[85vh] max-w-[90vw] select-none"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
