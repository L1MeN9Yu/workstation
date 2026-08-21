import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { ToolPage } from "../ToolPage";
import { WallpaperTargetSelect } from "../../components/WallpaperTargetSelect";
import { toast } from "../../lib/toast";
import EmptyState from "../../components/EmptyState";
import Alert from "../../components/Alert";
import { WallpaperLibrary } from "./WallpaperLibrary";
import {
  BIT_GROUPS,
  RATIO_OPTIONS,
  addBlacklistedWallpapers,
  applyWallpaper,
  bitsToSelections,
  clearBlacklistedWallpapers,
  downloadWallpaper,
  fetchBlacklistedThumb,
  generateSeed,
  hasWallpaperFullCache,
  listBlacklistedWallpaperPage,
  loadWallpaperSettings,
  previewWallpaper,
  removeBlacklistedWallpapers,
  saveWallpaperProxy,
  saveWallpaperSources,
  searchWallpapers,
  selectionsToBits,
  thumbUrl,
  type ApplyWallpaperTarget,
  type BlacklistEntry,
  type SourceSettings,
  type WallpaperItem,
  type WallpaperSettings,
} from "../../lib/wallpaper";
import { listIterm2Profiles } from "../../lib/iterm2Config";
import {
  WALLPAPER_SOURCES,
  getSourceMeta,
} from "../../lib/wallpaperSources";
import { describeSearchError } from "../../lib/wallpaperErrors";
import {
  HISTORY_PAGE_SIZE,
  addWallpaperHistory,
  clearWallpaperHistory,
  deleteWallpaperHistory,
  listWallpaperHistory,
  type WallpaperHistoryItem,
} from "../../lib/wallpaperHistory";
import { confirmDialog } from "../../lib/confirm";

interface SearchError {
  source: string;
  message: string;
}

const MAX_THUMB_ATTEMPTS = 6;
const THUMB_RETRY_MS = 1000;
const SOURCE_SAVE_DEBOUNCE_MS = 500;
const ZOOM_STEP = 1.2;
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
/** 拖拽超过该距离（px）才视为平移，用于抑制拖拽结束后的 click 关闭 */
const DRAG_THRESHOLD_PX = 4;

/** 卡片菜单预估尺寸（宽×高，px）：用于右键菜单弹出位置视口收敛 */
const CARD_MENU_WIDTH = 112;
const CARD_MENU_HEIGHT = 132;

/** 将右键菜单左上角限制在视口内，避免超出窗口边界（光标贴近边缘时内移） */
function clampMenuPosition(
  x: number,
  y: number,
): { left: number; top: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  return {
    left: Math.max(0, Math.min(x, vw - CARD_MENU_WIDTH)),
    top: Math.max(0, Math.min(y, vh - CARD_MENU_HEIGHT)),
  };
}

/** 将缩放值限制在允许范围内 */
function clampZoom(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** 复制文本到系统剪贴板：优先 Web Clipboard API，环境不支持时报错 */
async function copyTextToClipboard(text: string): Promise<void> {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    throw new Error("当前环境不支持剪贴板");
  }
  await navigator.clipboard.writeText(text);
}

/**
 * 将平移 offset 限制在视口内：图片（缩放后）小于视口时不允许平移，
 * 大于视口时最多拖到边缘对齐（图片不离开视口）。布局不可用时不做限制。
 */
function clampOffsetToViewport(
  offset: { x: number; y: number },
  scale: number,
  imgWidth: number,
  imgHeight: number,
  viewWidth: number,
  viewHeight: number,
): { x: number; y: number } {
  if (
    imgWidth <= 0 ||
    imgHeight <= 0 ||
    viewWidth <= 0 ||
    viewHeight <= 0
  ) {
    return offset;
  }
  const scaledWidth = imgWidth * scale;
  const scaledHeight = imgHeight * scale;
  const maxX = Math.max(0, (scaledWidth - viewWidth) / 2);
  const maxY = Math.max(0, (scaledHeight - viewHeight) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, offset.x)),
    y: Math.min(maxY, Math.max(-maxY, offset.y)),
  };
}

/** 每个 hash 的缩略图就绪版本号：后端按 hash 广播，前端只刷新对应缩略图 */
const thumbReadyListeners = new Map<string, Set<() => void>>();
const thumbReadyVersions = new Map<string, number>();

function subscribeThumbReady(hash: string, listener: () => void): () => void {
  let set = thumbReadyListeners.get(hash);
  if (!set) {
    set = new Set();
    thumbReadyListeners.set(hash, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) {
      thumbReadyListeners.delete(hash);
    }
  };
}

function getThumbReadyVersion(hash: string): number {
  return thumbReadyVersions.get(hash) ?? 0;
}

void listen<string>("thumb-ready", (event) => {
  const hash = event?.payload;
  // 旧版空载荷广播不携带 hash，忽略以免触发全局重挂载
  if (typeof hash !== "string" || !hash) return;
  thumbReadyVersions.set(hash, (thumbReadyVersions.get(hash) ?? 0) + 1);
  const set = thumbReadyListeners.get(hash);
  if (set) {
    for (const listener of [...set]) listener();
  }
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
    (listener) => subscribeThumbReady(hash, listener),
    () => getThumbReadyVersion(hash),
    () => getThumbReadyVersion(hash),
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
        onClick={(e) => {
          e.stopPropagation();
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

/** 右键菜单的「下载并应用」进行中状态文案 */
const APPLYING_TEXT = "应用中...";

interface CardMenuProps {
  item: WallpaperItem;
  applying: boolean;
  mode: "button" | "context";
  x: number;
  y: number;
  onClose: () => void;
  onPreview: (item: WallpaperItem) => void;
  onApply: (item: WallpaperItem) => void;
  onCopyUrl: (item: WallpaperItem) => void;
  onBlacklist: (item: WallpaperItem) => void;
}

/** 卡片菜单通用按钮文字样式（危险项用红色） */
const MENU_INNER_CLASS =
  "block w-full px-3 py-1 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800";
const MENU_DANGER_CLASS =
  "block w-full px-3 py-1 text-left text-xs text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-800";

/** 脚手架的容器样式，接受绝对/固定两种定位的差集 */
function cardMenuContainerClass(mode: "button" | "context"): string {
  const base =
    "min-w-28 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900";
  return mode === "button"
    ? `absolute right-0 top-7 z-20 ${base}`
    : `${base}`;
}

/**
 * 壁纸卡片通用菜单：供「⋯」按钮（mode=button，卡片内绝对定位）与右键（mode=context，
 * 视口内固定定位）共用同一份结构与动作。点击菜单项后先关闭菜单再执行动作。
 */
function CardMenu({
  item,
  applying,
  mode,
  x,
  y,
  onClose,
  onPreview,
  onApply,
  onCopyUrl,
  onBlacklist,
}: CardMenuProps) {
  const runAction = (action: () => void) => {
    onClose();
    action();
  };
  const positionStyle =
    mode === "context"
      ? clampMenuPosition(x, y)
      : undefined;
  return (
    <div
      role="menu"
      className={[
        cardMenuContainerClass(mode),
        mode === "context" ? "fixed z-50" : "",
      ].join(" ")}
      style={positionStyle}
    >
      <button
        type="button"
        role="menuitem"
        onClick={(e) => {
          e.stopPropagation();
          runAction(() => onPreview(item));
        }}
        className={MENU_INNER_CLASS}
      >
        预览大图
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={(e) => {
          e.stopPropagation();
          runAction(() => onApply(item));
        }}
        className={MENU_INNER_CLASS}
      >
        {applying ? APPLYING_TEXT : "下载并应用"}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={(e) => {
          e.stopPropagation();
          runAction(() => onCopyUrl(item));
        }}
        className={MENU_INNER_CLASS}
      >
        复制 URL
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={(e) => {
          e.stopPropagation();
          runAction(() => onBlacklist(item));
        }}
        className={MENU_DANGER_CLASS}
      >
        拉黑
      </button>
    </div>
  );
}

/** 黑名单管理面板单条缩略图：独立请求 data URL，就绪前骨架脉冲块、失败显示占位 */
/** 从原图 URL 推断图源标签（wallhaven/Danbooru/Safebooru/其他域名） */
function blacklistSourceLabel(url: string): string {
  const host = url.replace(/^[a-z]+:\/\//i, "").split("/")[0].toLowerCase();
  if (host.includes("wallhaven")) return "wallhaven";
  if (host.includes("danbooru")) return "Danbooru";
  if (host.includes("safebooru")) return "Safebooru";
  return host || "未知";
}

function BlacklistThumb({ url, alt }: { url: string; alt: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchBlacklistedThumb(url)
      .then((data) => {
        if (!cancelled) setDataUrl(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) {
    return (
      <div className="flex h-10 w-16 shrink-0 items-center justify-center bg-gray-100 text-[10px] text-gray-400 dark:bg-gray-800 dark:text-gray-500">
        加载失败
      </div>
    );
  }
  if (!dataUrl) {
    return (
      <div
        role="status"
        aria-label={`加载缩略图 ${alt}`}
        className="h-10 w-16 shrink-0 animate-pulse bg-gray-200 dark:bg-gray-700"
      />
    );
  }
  return (
    <img
      src={dataUrl}
      alt={alt}
      className="h-10 w-16 shrink-0 rounded object-cover"
    />
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
  const [settings, setSettings] = useState<WallpaperSettings | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showBlacklist, setShowBlacklist] = useState(false);
  const [blacklist, setBlacklist] = useState<BlacklistEntry[]>([]);
  const [blacklistTotal, setBlacklistTotal] = useState(0);
  const [blacklistPage, setBlacklistPage] = useState(1);
  const [blacklistKeyword, setBlacklistKeyword] = useState("");
  const [blacklistLoading, setBlacklistLoading] = useState(false);
  /** 当前展开「更多操作」菜单的卡片实例；null 表示未展开 */
  const [openMenu, setOpenMenu] = useState<{
    id: string;
    x: number;
    y: number;
    mode: "button" | "context";
  } | null>(null);

  /** 黑名单每页条数（分页展示避免长列表卡顿） */
  const BLACKLIST_PAGE_SIZE = 20;
  /** 黑名单总页数（至少 1 页） */
  const blacklistPageCount = Math.max(
    1,
    Math.ceil(blacklistTotal / BLACKLIST_PAGE_SIZE),
  );
  const [applyingId, setApplyingId] = useState<string | null>(null);
  /** 本次应用目标（单次切换，不持久化） */
  const [applyTarget, setApplyTarget] = useState<ApplyWallpaperTarget>("cmux");
  /** iTerm2 Dynamic Profile 列表（设置中目标 Profile 下拉选项） */
  const [iterm2Profiles, setIterm2Profiles] = useState<string[]>([]);
  const [checkboxBlocked, setCheckboxBlocked] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  /** 当前图源搜索历史分页状态（8 条/页，切换图源时重置） */
  const [historyPage, setHistoryPage] = useState(1);
  const [historyItems, setHistoryItems] = useState<WallpaperHistoryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const pageRef = useRef(1);
  const saveTimerRef = useRef<number | null>(null);
  /** 当前视图：search（搜索）或 library（本地壁纸库） */
  const [view, setView] = useState<"search" | "library">("search");

  // ---- Lightbox 预览状态 ----
  /** 当前预览的壁纸在搜索列表 `items` 中的索引；null 表示未打开 */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  /** 当前展示的图片 data URL（原图）；缩略图阶段为 null */
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  /** 是否已切换为原图展示（未切换时展示缩略图） */
  const [showFull, setShowFull] = useState(false);
  /** 原图加载中 */
  const [fullLoading, setFullLoading] = useState(false);
  /** 原图加载失败信息（自动回退缩略图后可重试） */
  const [fullError, setFullError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const lightboxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  /** 递增的请求序号，用于丢弃过期的预览请求结果 */
  const previewReqRef = useRef(0);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  /** 拖拽结束后抑制紧随其后的 click，避免拖拽释放时误关预览 */
  const justDraggedRef = useRef(false);

  /** 当前预览的壁纸：按索引从搜索结果列表推导，索引越界（列表刷新）时自动回到关闭态 */
  const previewItem =
    previewIndex === null ? null : (items[previewIndex] ?? null);
  /** 是否可切换上一张/下一张（首末张边界） */
  const canPrev = previewIndex !== null && previewIndex > 0;
  const canNext = previewIndex !== null && previewIndex < items.length - 1;

  const closePreview = useCallback(() => {
    previewReqRef.current += 1;
    setPreviewIndex(null);
    setDataUrl(null);
    setShowFull(false);
    setFullLoading(false);
    setFullError(null);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
  }, []);

  /** 加载并展示当前预览壁纸的原图（供「查看原图」按钮与缓存命中路径调用） */
  const loadFullImage = useCallback(async (item: WallpaperItem): Promise<void> => {
    const reqId = previewReqRef.current + 1;
    previewReqRef.current = reqId;
    setFullLoading(true);
    setFullError(null);
    try {
      const url = await previewWallpaper(item);
      if (previewReqRef.current !== reqId) return;
      setDataUrl(url);
      setShowFull(true);
    } catch (e) {
      if (previewReqRef.current !== reqId) return;
      // 失败自动退回缩略图，可重试
      setShowFull(false);
      setFullError(String(e));
    } finally {
      if (previewReqRef.current === reqId) {
        setFullLoading(false);
      }
    }
  }, []);

  const openPreview = useCallback(
    async (index: number): Promise<void> => {
      const item = items[index];
      const reqId = previewReqRef.current + 1;
      previewReqRef.current = reqId;
      setPreviewIndex(index);
      setDataUrl(null);
      setShowFull(false);
      setFullLoading(false);
      setFullError(null);
      setScale(1);
      setOffset({ x: 0, y: 0 });
      // 原图已在缓存时直接展示原图（零网络），否则保持缩略图
      try {
        const cached = await hasWallpaperFullCache(item);
        if (previewReqRef.current !== reqId) return;
        if (cached) {
          void loadFullImage(item);
        }
      } catch {
        // 缓存查询失败时保持缩略图，不阻塞浏览
      }
    },
    [items, loadFullImage],
  );

  const goPrev = useCallback((): void => {
    if (previewIndex === null || previewIndex <= 0) return;
    void openPreview(previewIndex - 1);
  }, [previewIndex, openPreview]);

  const goNext = useCallback((): void => {
    if (previewIndex === null || previewIndex >= items.length - 1) return;
    void openPreview(previewIndex + 1);
  }, [previewIndex, items.length, openPreview]);

  function handleRetryPreview(): void {
    if (previewItem !== null) {
      void loadFullImage(previewItem);
    }
  }

  /** 按新缩放值调整 offset（可选光标锚点，缺省以视口中心为锚点） */
  const applyZoom = useCallback(
    (nextScale: number, anchor?: { x: number; y: number }): void => {
      const img = imgRef.current;
      const mask = lightboxRef.current;
      if (!img || !mask) return;
      const clamped = clampZoom(nextScale);
      const k = clamped / scale;
      const nextOffset = anchor
        ? {
            x: anchor.x * (1 - k) + offset.x * k,
            y: anchor.y * (1 - k) + offset.y * k,
          }
        : { x: offset.x * k, y: offset.y * k };
      setOffset(
        clampOffsetToViewport(
          nextOffset,
          clamped,
          img.offsetWidth,
          img.offsetHeight,
          mask.clientWidth,
          mask.clientHeight,
        ),
      );
      setScale(clamped);
    },
    [scale, offset],
  );

  function handleZoomIn(): void {
    applyZoom(scale * ZOOM_STEP);
  }

  function handleZoomOut(): void {
    applyZoom(scale / ZOOM_STEP);
  }

  function handleZoomReset(): void {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: offset.x,
      originY: offset.y,
    };
    setDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    const img = imgRef.current;
    const mask = lightboxRef.current;
    if (!drag || !img || !mask) return;
    setOffset(
      clampOffsetToViewport(
        {
          x: drag.originX + e.clientX - drag.startX,
          y: drag.originY + e.clientY - drag.startY,
        },
        scale,
        img.offsetWidth,
        img.offsetHeight,
        mask.clientWidth,
        mask.clientHeight,
      ),
    );
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current;
    if (!drag) return;
    const moved =
      Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) >=
      DRAG_THRESHOLD_PX;
    dragRef.current = null;
    setDragging(false);
    if (moved) {
      justDraggedRef.current = true;
    }
  }

  function handleMaskClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target !== e.currentTarget) return;
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    closePreview();
  }

  // Esc 关闭预览、方向键切换上一张/下一张
  useEffect(() => {
    if (!previewItem) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePreview();
      } else if (e.key === "ArrowLeft") {
        goPrev();
      } else if (e.key === "ArrowRight") {
        goNext();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [previewItem, previewIndex, items.length, closePreview, goPrev, goNext]);

  // 滚轮缩放（以光标为锚点），挂原生非被动监听以便 preventDefault；
  // 缩略图与原图均可缩放（图片已铺满舞台，缩放对二者都有意义）
  useEffect(() => {
    const mask = lightboxRef.current;
    if (!previewItem || !mask) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const img = imgRef.current;
      if (!img) return;
      const rect = mask.getBoundingClientRect();
      applyZoom(scale * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP), {
        x: e.clientX - rect.left - rect.width / 2,
        y: e.clientY - rect.top - rect.height / 2,
      });
    };
    mask.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      mask.removeEventListener("wheel", onWheel);
    };
  }, [previewItem, scale, offset, applyZoom]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // 卡片「更多操作」菜单：点击外部、滚动或按 Esc 关闭（菜单按钮自身 stopPropagation 不会触发关闭）
  useEffect(() => {
    if (openMenu === null) return;
    const close = () => setOpenMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  function scheduleSourceSave(
    sources: WallpaperSettings["sources"],
  ): void {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void saveWallpaperSources(sources)
        .then(() => toast.success("参数已自动保存"))
        .catch((e) => toast.error(`自动保存失败：${String(e)}`));
    }, SOURCE_SAVE_DEBOUNCE_MS);
  }

  useEffect(() => {
    let cancelled = false;
    void listIterm2Profiles()
      .then((profiles) => {
        if (!cancelled) {
          setIterm2Profiles(profiles.map((p) => p.name));
        }
      })
      .catch(() => {
        // 非 Tauri 环境（测试）或 iTerm2 目录不可用时忽略，下拉显示空
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const meta = useMemo(() => getSourceMeta(source), [source]);

  /** 拉取指定图源某页搜索历史；失败 toast 提示但不阻塞搜索主流程 */
  const loadHistory = useCallback(
    async (sourceId: string, page: number): Promise<void> => {
      try {
        const result = await listWallpaperHistory(
          sourceId,
          page,
          HISTORY_PAGE_SIZE,
        );
        setHistoryItems(result.items);
        setHistoryTotal(result.total);
        setHistoryPage(result.page);
      } catch (e) {
        toast.error(`加载搜索历史失败：${String(e)}`);
      }
    },
    [],
  );

  /** 挂载时拉取初始图源第 1 页历史（切换图源由 tab handler 重置并重新拉取） */
  const initialSourceRef = useRef(source);
  useEffect(() => {
    void loadHistory(initialSourceRef.current, 1);
  }, [loadHistory]);

  async function runSearch(
    random: boolean,
    page: number,
    keywordOverride?: string,
  ): Promise<void> {
    if (!settings) return;
    setSearching(true);
    setErrors([]);
    try {
      const result = await searchWallpapers(
        {
          source,
          keywords: random ? "" : (keywordOverride ?? keywords),
          random,
          page,
        },
        settings,
      );
      setItems((prev) => (page > 1 ? [...prev, ...result] : result));
      setHasMore(result.length > 0);
      if (result.length === 0 && page === 1) {
        toast.info("没有找到匹配的壁纸，试试更换关键词或图源");
      }
    } catch (e) {
      if (page === 1) {
        setErrors([{ source, message: String(e) }]);
      } else {
        toast.error(`加载更多失败：${String(e)}`);
      }
    } finally {
      setSearching(false);
    }
  }

  async function handleSearch(random: boolean, keywordOverride?: string) {
    pageRef.current = 1;
    setItems([]);
    if (!random) {
      const trimmed = (keywordOverride ?? keywords).trim();
      if (trimmed !== "") {
        // 发起即记（随机除外）：不阻塞搜索，失败静默；成功后刷新当前页让新词置顶可见
        addWallpaperHistory(source, trimmed)
          .then(() => {
            void loadHistory(source, historyPage);
          })
          .catch(() => {
            // 历史记录失败不影响搜索主流程
          });
      }
    }
    await runSearch(random, 1, keywordOverride);
  }

  async function handleLoadMore() {
    const next = pageRef.current + 1;
    pageRef.current = next;
    await runSearch(false, next);
  }

  /** 删除单条历史后刷新当前页 */
  async function handleDeleteHistory(item: WallpaperHistoryItem): Promise<void> {
    try {
      await deleteWallpaperHistory(source, item.keyword);
      void loadHistory(source, historyPage);
    } catch (e) {
      toast.error(`删除搜索历史失败：${String(e)}`);
    }
  }

  /** 清空当前图源全部历史（二次确认），完成后回到第 1 页 */
  async function handleClearHistory(): Promise<void> {
    const label = meta?.label ?? source;
    const ok = await confirmDialog(
      `确认清空「${label}」的全部搜索历史？此操作不可恢复。`,
    );
    if (!ok) return;
    try {
      await clearWallpaperHistory(source);
      setHistoryPage(1);
      void loadHistory(source, 1);
      toast.success("搜索历史已清空");
    } catch (e) {
      toast.error(`清空搜索历史失败：${String(e)}`);
    }
  }

  /** 历史区块总页数（至少 1 页） */
  const totalPages = Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE));

  async function handleApply(item: WallpaperItem) {
    if (applyTarget === "iterm2" && !settings?.iterm2Profile) {
      setShowSettings(true);
      toast.error("未选择 iTerm2 目标 Profile，请在上方设置中选择后再应用");
      return;
    }
    setApplyingId(item.id);
    try {
      const path = await downloadWallpaper(item);
      const result = await applyWallpaper(path, applyTarget, settings?.iterm2Profile);
      toast.success(
        `已下载并应用到 ${result.target === "iterm2" ? "iTerm2" : "cmux"}：${result.imagePath}。${result.reloadMessage}`,
      );
    } catch (e) {
      toast.error(`应用失败：${String(e)}`);
    } finally {
      setApplyingId(null);
    }
  }

  /**
   * 拉黑一张壁纸：后端写入成功后从当前列表即时移除并适配预览索引
   * （被删项在当前预览索引之前则索引 -1；删除的是当前预览项则关闭预览），
   * 失败保持列表不变。
   */
  async function handleBlacklist(item: WallpaperItem): Promise<void> {
    try {
      await addBlacklistedWallpapers([
        { url: item.full_url, thumbUrl: item.thumb_url },
      ]);
      const removedIndex = items.findIndex(
        (it) => it.full_url === item.full_url,
      );
      setItems((prev) => prev.filter((it) => it.full_url !== item.full_url));
      if (previewIndex !== null) {
        if (removedIndex === previewIndex) {
          setPreviewIndex(null);
        } else if (removedIndex < previewIndex) {
          setPreviewIndex(previewIndex - 1);
        }
      }
      toast.success("已加入黑名单");
    } catch (e) {
      toast.error(`拉黑失败：${String(e)}`);
    }
  }

  /** 复制壁纸原图 URL 到剪贴板 */
  async function handleCopyUrl(item: WallpaperItem): Promise<void> {
    try {
      await copyTextToClipboard(item.full_url);
      toast.success("已复制原图 URL");
    } catch (e) {
      toast.error(`复制失败：${String(e)}`);
    }
  }

  /** 打开黑名单管理面板并拉取第 1 页；加载失败提示并关闭面板 */
  async function handleOpenBlacklist(): Promise<void> {
    setShowBlacklist(true);
    setBlacklistKeyword("");
    try {
      const res = await listBlacklistedWallpaperPage(1, BLACKLIST_PAGE_SIZE, "");
      setBlacklist(res.items);
      setBlacklistTotal(res.total);
      setBlacklistPage(1);
    } catch (e) {
      toast.error(`加载黑名单失败：${String(e)}`);
      setShowBlacklist(false);
    }
  }

  /** 按关键词加载黑名单第 page 页（页码/关键词变化时重新拉取） */
  async function loadBlacklistPage(page: number, keyword: string): Promise<void> {
    setBlacklistLoading(true);
    try {
      const res = await listBlacklistedWallpaperPage(
        page,
        BLACKLIST_PAGE_SIZE,
        keyword,
      );
      setBlacklist(res.items);
      setBlacklistTotal(res.total);
      setBlacklistPage(page);
    } catch (e) {
      toast.error(`加载黑名单失败：${String(e)}`);
    } finally {
      setBlacklistLoading(false);
    }
  }

  /** 搜索框输入：回到第 1 页并按关键词过滤 */
  function handleBlacklistSearch(value: string): void {
    setBlacklistKeyword(value);
    void loadBlacklistPage(1, value);
  }

  /** 翻页（越界忽略） */
  function goBlacklistPage(page: number): void {
    if (page < 1 || page > blacklistPageCount) return;
    void loadBlacklistPage(page, blacklistKeyword);
  }

  /** 移除单条黑名单：刷新当前页并提示；当前已加载搜索结果保持不变 */
  async function handleRemoveBlacklist(url: string): Promise<void> {
    try {
      await removeBlacklistedWallpapers([url]);
      toast.success("已移除，重新搜索后可见");
      await loadBlacklistPage(blacklistPage, blacklistKeyword);
    } catch (e) {
      toast.error(`移除黑名单失败：${String(e)}`);
    }
  }

  /** 清空全部黑名单（二次确认） */
  async function handleClearBlacklist(): Promise<void> {
    const ok = await confirmDialog("确认清空全部黑名单？此操作不可恢复。");
    if (!ok) return;
    try {
      await clearBlacklistedWallpapers();
      setBlacklist([]);
      setBlacklistTotal(0);
      setBlacklistPage(1);
      toast.success("黑名单已清空");
    } catch (e) {
      toast.error(`清空黑名单失败：${String(e)}`);
    }
  }

  /** 本地库应用 iTerm2 但未配置 Profile 时：打开设置面板并提示 */
  function handleRequireProfile(): void {
    setShowSettings(true);
    toast.error("未选择 iTerm2 目标 Profile，请在上方设置中选择后再应用");
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
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    try {
      await saveWallpaperSources(updated.sources);
      toast.success("seed 已刷新并保存");
    } catch (e) {
      toast.error(`保存 seed 失败：${String(e)}`);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void loadWallpaperSettings().then((s) => {
      if (!cancelled) {
        setSettings(s);
        // 以默认目标初始化本次应用目标（用户单次切换后不再覆盖）
        setApplyTarget(s.defaultApplyTarget);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveSettings() {
    if (!settings) return;
    try {
      await saveWallpaperProxy(settings);
      toast.success("设置已保存");
      setShowSettings(false);
    } catch (e) {
      toast.error(`保存设置失败：${String(e)}`);
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
      description="从 wallhaven / Danbooru / Safebooru 搜索壁纸，下载并应用到 cmux 或 iTerm2 终端背景"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setView("search")}
            className={`rounded-md px-3 py-1 text-sm ${
              view === "search"
                ? "bg-accent-600 text-white"
                : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            }`}
          >
            在线搜索
          </button>
          <button
            onClick={() => setView("library")}
            className={`rounded-md px-3 py-1 text-sm ${
              view === "library"
                ? "bg-accent-600 text-white"
                : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
            }`}
          >
            本地壁纸库
          </button>
        </div>
        <div className="flex gap-2">
          {view === "search" && (
            <button
              onClick={() => void handleOpenBlacklist()}
              className="rounded-md bg-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              type="button"
            >
              黑名单
            </button>
          )}
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="rounded-md bg-accent-600 px-3 py-1 text-sm text-white"
          >
            设置
          </button>
        </div>
      </div>

      {view === "search" && (
        <div className="mb-3 flex gap-2">
          {WALLPAPER_SOURCES.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSource(s.id);
                setErrors([]);
                setItems([]);
                setHasMore(false);
                pageRef.current = 1;
                setHistoryPage(1);
                void loadHistory(s.id, 1);
              }}
              className={`rounded-md px-3 py-1 text-sm ${
                source === s.id
                  ? "bg-accent-600 text-white"
                  : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {view === "search" && meta && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs text-gray-500">{meta.description}</p>
          <a
            href={meta.homepage}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent-600 underline hover:text-accent-800 dark:text-accent-400 dark:hover:text-accent-300"
          >
            {meta.label} 官网
          </a>
        </div>
      )}

      {showSettings && settings && (
        <div className="mb-3 space-y-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="text-sm font-medium">统一设置</div>
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
          <label className="block text-sm">
            默认应用目标
            <select
              value={settings.defaultApplyTarget}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  defaultApplyTarget: e.target.value as ApplyWallpaperTarget,
                })
              }
              className={inputClass}
            >
              <option value="cmux">cmux（ghosty 配置）</option>
              <option value="iterm2">iTerm2</option>
            </select>
          </label>
          <label className="block text-sm">
            iTerm2 目标 Profile（应用目标为 iTerm2 时使用）
            <select
              value={settings.iterm2Profile}
              onChange={(e) =>
                setSettings({ ...settings, iterm2Profile: e.target.value })
              }
              className={inputClass}
            >
              <option value="">请选择 Profile</option>
              {iterm2Profiles.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => void handleSaveSettings()}
            className="rounded-md bg-accent-600 px-3 py-1 text-sm text-white"
          >
            保存设置
          </button>
        </div>
      )}

      {view === "search" && settings && meta && (
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

      {view === "library" ? (
        <WallpaperLibrary
          applyTarget={applyTarget}
          onApplyTargetChange={setApplyTarget}
          iterm2Profile={settings?.iterm2Profile ?? ""}
          onRequireProfile={handleRequireProfile}
        />
      ) : (
        <>
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
          className="rounded-md bg-accent-600 px-4 py-1 text-sm text-white disabled:opacity-50"
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

      {historyItems.length > 0 && (
        <div className="mb-3 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">
              {meta?.label ?? source} 搜索历史
            </span>
            <button
              onClick={() => void handleClearHistory()}
              className="rounded-md bg-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              type="button"
            >
              清空
            </button>
          </div>
          <ul className="space-y-1">
            {historyItems.map((item) => (
              <li
                key={item.keyword}
                className="group flex items-center justify-between gap-2"
              >
                <button
                  onClick={() => {
                    setKeywords(item.keyword);
                    void handleSearch(false, item.keyword);
                  }}
                  title={`搜索「${item.keyword}」`}
                  className="truncate rounded px-1 py-0.5 text-left text-sm text-accent-600 hover:bg-gray-100 hover:text-accent-800 dark:text-accent-400 dark:hover:bg-gray-800 dark:hover:text-accent-300"
                  type="button"
                >
                  {item.keyword}
                </button>
                <button
                  onClick={() => void handleDeleteHistory(item)}
                  aria-label={`删除 ${item.keyword}`}
                  className="shrink-0 rounded px-1 py-0.5 text-xs text-gray-400 opacity-0 hover:bg-red-100 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-900/40 dark:hover:text-red-400"
                  type="button"
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
          {historyTotal > HISTORY_PAGE_SIZE && (
            <div className="mt-2 flex items-center justify-center gap-2 text-xs">
              <button
                onClick={() => {
                  const next = historyPage - 1;
                  setHistoryPage(next);
                  void loadHistory(source, next);
                }}
                disabled={historyPage <= 1}
                className="rounded-md bg-gray-200 px-2 py-0.5 text-gray-700 disabled:opacity-40 dark:bg-gray-700 dark:text-gray-200"
                type="button"
              >
                上一页
              </button>
              <span className="text-gray-500">
                第 {historyPage} / {totalPages} 页
              </span>
              <button
                onClick={() => {
                  const next = historyPage + 1;
                  setHistoryPage(next);
                  void loadHistory(source, next);
                }}
                disabled={historyPage >= totalPages}
                className="rounded-md bg-gray-200 px-2 py-0.5 text-gray-700 disabled:opacity-40 dark:bg-gray-700 dark:text-gray-200"
                type="button"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-3 space-y-2">
          {errors.map((e) => (
            <Alert key={e.source} variant="error">
              {describeSearchError(e.source, e.message)}
            </Alert>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item, index) => (
            <div
              key={item.id}
              onClick={() => {
                if (openMenu?.id === item.id) {
                  setOpenMenu(null);
                  return;
                }
                void openPreview(index);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setOpenMenu({
                  id: item.id,
                  x: e.clientX,
                  y: e.clientY,
                  mode: "context",
                });
              }}
              className="relative cursor-pointer overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
            >
              <div className="absolute right-1.5 top-1.5 z-10">
                <button
                  type="button"
                  aria-label={`更多操作 ${item.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenu((cur) =>
                      cur?.id === item.id && cur.mode === "button"
                        ? null
                        : { id: item.id, x: 0, y: 0, mode: "button" },
                    );
                  }}
                  className="rounded-md bg-black/50 px-1.5 py-0.5 text-sm leading-none text-white hover:bg-black/70"
                >
                  ⋯
                </button>
                {openMenu?.id === item.id && openMenu.mode === "button" && (
                  <CardMenu
                    item={item}
                    applying={applyingId === item.id}
                    mode="button"
                    x={0}
                    y={0}
                    onClose={() => setOpenMenu(null)}
                    onPreview={() => void openPreview(index)}
                    onApply={handleApply}
                    onCopyUrl={handleCopyUrl}
                    onBlacklist={handleBlacklist}
                  />
                )}
              </div>
              {openMenu?.id === item.id && openMenu.mode === "context" && (
                <CardMenu
                  item={item}
                  applying={applyingId === item.id}
                  mode="context"
                  x={openMenu.x}
                  y={openMenu.y}
                  onClose={() => setOpenMenu(null)}
                  onPreview={() => void openPreview(index)}
                  onApply={handleApply}
                  onCopyUrl={handleCopyUrl}
                  onBlacklist={handleBlacklist}
                />
              )}
              <ProxiedThumb
                hash={item.thumb_hash}
                alt={item.id}
                className="h-32 w-full"
              />
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 p-2 text-xs">
                <span className="text-gray-500">
                  {item.width}×{item.height}
                </span>
                <div className="flex items-center gap-1">
                  <WallpaperTargetSelect
                    value={applyTarget}
                    onChange={setApplyTarget}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleApply(item);
                    }}
                    disabled={applyingId === item.id}
                    className="rounded-md bg-accent-600 px-2 py-0.5 text-white disabled:opacity-50"
                  >
                    {applyingId === item.id ? "应用中..." : "下载并应用"}
                  </button>
                </div>
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

      {!searching && !errors.length && items.length === 0 && (
        <EmptyState>搜索壁纸以预览，点击「下载并应用」设置终端背景</EmptyState>
      )}

      {previewItem && (
        <div
          ref={lightboxRef}
          role="dialog"
          aria-modal="true"
          aria-label="壁纸预览"
          className={`fixed inset-0 z-50 bg-black/80 ${
            dragging ? "cursor-grabbing" : ""
          }`}
          onClick={handleMaskClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {/* 顶部工具条：缩放与关闭 */}
          <div
            className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 items-center gap-2 rounded-md bg-gray-900/80 p-2 text-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => void handleZoomIn()}
              className="rounded-md bg-gray-700 px-2 py-1 text-sm hover:bg-gray-600"
              title="放大"
            >
              ＋
            </button>
            <button
              onClick={() => void handleZoomOut()}
              className="rounded-md bg-gray-700 px-2 py-1 text-sm hover:bg-gray-600"
              title="缩小"
            >
              －
            </button>
            <button
              onClick={handleZoomReset}
              className="rounded-md bg-gray-700 px-2 py-1 text-sm hover:bg-gray-600"
              title="复位到 100%"
            >
              100%
            </button>
            <span className="px-1 text-xs text-gray-300">
              {Math.round(scale * 100)}%
            </span>
            <span className="px-1 text-xs text-gray-400" aria-label="预览位置">
              {previewIndex !== null ? `${previewIndex + 1} / ${items.length}` : ""}
            </span>
            <button
              onClick={closePreview}
              aria-label="关闭预览"
              className="rounded-md bg-red-600 px-2 py-1 text-sm hover:bg-red-500"
            >
              ✕
            </button>
          </div>

          {/* 图片舞台：居中展示，加载/错误占位 */}
          <div
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {fullLoading && (
              <div
                className="pointer-events-auto flex animate-pulse items-center gap-2 text-gray-300"
                role="status"
              >
                原图加载中...
              </div>
            )}
            {fullError && !fullLoading && (
              <div
                className="pointer-events-auto absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-md bg-gray-900/80 px-3 py-2 text-sm text-gray-200"
                role="alert"
              >
                <span>原图加载失败：{fullError}</span>
                <button
                  onClick={() => void handleRetryPreview()}
                  className="rounded-md bg-accent-600 px-3 py-1 text-xs text-white hover:bg-accent-500"
                >
                  重试
                </button>
              </div>
            )}
            {!showFull && !fullLoading && (
              <img
                ref={imgRef}
                src={thumbUrl(previewItem.thumb_hash)}
                alt={previewItem.id}
                className="pointer-events-auto h-[85vh] w-[90vw] select-none object-contain"
                style={{
                  transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                }}
              />
            )}
            {showFull && dataUrl && !fullLoading && (
              <img
                ref={imgRef}
                src={dataUrl}
                alt={previewItem.id}
                className="pointer-events-auto h-[85vh] w-[90vw] select-none object-contain"
                style={{
                  transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                }}
              />
            )}
          </div>

          {/* 左右切换按钮 */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!canPrev}
            aria-label="上一张"
            className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-gray-900/70 px-3 py-2 text-2xl text-white shadow-lg hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!canNext}
            aria-label="下一张"
            className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-gray-900/70 px-3 py-2 text-2xl text-white shadow-lg hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-30"
          >
            ›
          </button>

          {/* 底部信息栏：分辨率 / 图源 / 下载应用 */}
          <div
            className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-md bg-gray-900/80 px-3 py-2 text-sm text-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span>
              {previewItem.width}×{previewItem.height}
            </span>
            <span className="text-gray-300">
              {getSourceMeta(previewItem.source)?.label ?? previewItem.source}
            </span>
            <WallpaperTargetSelect value={applyTarget} onChange={setApplyTarget} dark />
            {!showFull && (
              <button
                onClick={() => void loadFullImage(previewItem)}
                disabled={fullLoading}
                className="rounded-md bg-gray-600 px-2 py-1 text-white hover:bg-gray-500 disabled:opacity-50"
              >
                {fullLoading ? "原图加载中..." : "查看原图"}
              </button>
            )}
            <button
              onClick={() => void handleApply(previewItem)}
              disabled={applyingId === previewItem.id}
              className="rounded-md bg-accent-600 px-2 py-1 text-white disabled:opacity-50"
            >
              {applyingId === previewItem.id ? "应用中..." : "下载并应用"}
            </button>
            <button
              onClick={() => void handleBlacklist(previewItem)}
              className="rounded-md bg-red-600 px-2 py-1 text-white hover:bg-red-500"
              type="button"
            >
              拉黑
            </button>
          </div>
        </div>
      )}

      {showBlacklist && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="壁纸黑名单"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowBlacklist(false);
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-2 dark:border-gray-700">
              <span className="text-sm font-medium">壁纸黑名单</span>
              <span className="text-xs text-gray-500" aria-label="黑名单总数">
                共 {blacklistTotal} 条
              </span>
              <button
                onClick={() => setShowBlacklist(false)}
                aria-label="关闭黑名单"
                className="rounded-md px-2 py-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                type="button"
              >
                ✕
              </button>
            </div>
            <div className="border-b border-gray-200 px-4 py-2 dark:border-gray-700">
              <input
                value={blacklistKeyword}
                onChange={(e) => handleBlacklistSearch(e.target.value)}
                placeholder="按 URL 搜索..."
                aria-label="搜索黑名单"
                className="w-full rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-900"
              />
            </div>
            <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
              {blacklist.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-gray-500">
                  {blacklistLoading ? "加载中..." : "暂无黑名单"}
                </li>
              ) : (
                blacklist.map((entry) => (
                  <li
                    key={entry.url}
                    className="flex items-center gap-3 px-4 py-2"
                  >
                    {entry.thumbUrl && (
                      <BlacklistThumb url={entry.thumbUrl} alt={entry.url} />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="mb-0.5 inline-block rounded-sm bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {blacklistSourceLabel(entry.url)}
                      </span>
                      <div
                        className="truncate text-xs text-gray-600 dark:text-gray-300"
                        title={entry.url}
                      >
                        {entry.url}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleRemoveBlacklist(entry.url)}
                      className="shrink-0 rounded-md bg-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-red-100 hover:text-red-600 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-red-900/40 dark:hover:text-red-400"
                      type="button"
                    >
                      移除
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 dark:border-gray-700">
              <button
                onClick={() => void handleClearBlacklist()}
                className="rounded-md bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500"
                type="button"
              >
                清空全部
              </button>
              <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <button
                  onClick={() => goBlacklistPage(blacklistPage - 1)}
                  disabled={blacklistPage <= 1}
                  className="rounded-md bg-gray-200 px-2 py-0.5 text-gray-700 disabled:opacity-40 dark:bg-gray-700 dark:text-gray-200"
                  type="button"
                >
                  上一页
                </button>
                <span aria-label="黑名单页码">
                  第 {blacklistPage} / {blacklistPageCount} 页
                </span>
                <button
                  onClick={() => goBlacklistPage(blacklistPage + 1)}
                  disabled={blacklistPage >= blacklistPageCount}
                  className="rounded-md bg-gray-200 px-2 py-0.5 text-gray-700 disabled:opacity-40 dark:bg-gray-700 dark:text-gray-200"
                  type="button"
                >
                  下一页
                </button>
              </div>
              <button
                onClick={() => setShowBlacklist(false)}
                className="rounded-md bg-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
                type="button"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </ToolPage>
  );
}
