import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
}

/** 虚线边框的空态/占位块 */
export default function EmptyState({ children, className = "flex h-40" }: Props) {
  return (
    <div
      className={`${className} items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-600`}
    >
      {children}
    </div>
  );
}
