import type { ReactNode } from "react";

const VARIANT_CLASSES: Record<AlertVariant, string> = {
  error:
    "rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  warning:
    "rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  info: "rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200",
};

export type AlertVariant = "error" | "warning" | "info";

interface Props {
  variant?: AlertVariant;
  children: ReactNode;
  className?: string;
}

/** 带边框的提示块：error 红色 / warning 琥珀色 / info 灰色 */
export default function Alert({
  variant = "info",
  children,
  className = "mb-3",
}: Props) {
  return <div className={`${VARIANT_CLASSES[variant]} ${className}`}>{children}</div>;
}
