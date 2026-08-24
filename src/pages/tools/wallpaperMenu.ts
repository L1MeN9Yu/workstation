import { useEffect, useRef } from "react";

/** 卡片菜单预估尺寸（宽×高，px）：用于右键菜单弹出位置视口收敛 */
export const CARD_MENU_WIDTH = 112;
export const CARD_MENU_HEIGHT = 132;

/** 将右键菜单左上角限制在视口内，避免超出窗口边界（光标贴近边缘时内移） */
export function clampMenuPosition(
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

/** 卡片菜单通用按钮文字样式（危险项用红色） */
export const MENU_INNER_CLASS =
  "block w-full px-3 py-1 text-left text-xs text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800";
export const MENU_DANGER_CLASS =
  "block w-full px-3 py-1 text-left text-xs text-red-600 hover:bg-gray-100 dark:text-red-400 dark:hover:bg-gray-800";

/**
 * 卡片菜单关闭交互：菜单打开期间监听点击外部、滚动与 Esc 键关闭；
 * 关闭回调经 ref 读取以避免每次渲染重新挂载监听。
 */
export function useContextMenuCloser(
  open: boolean,
  onClose: () => void,
): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const close = () => onCloseRef.current();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
}