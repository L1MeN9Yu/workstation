import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "dangerText";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "rounded-md bg-accent-600 px-4 py-1.5 text-sm text-white disabled:opacity-50",
  secondary:
    "rounded-md bg-gray-200 px-4 py-1.5 text-sm text-gray-700 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200",
  danger: "rounded-md bg-red-600 px-4 py-1.5 text-sm text-white disabled:opacity-50",
  dangerText:
    "shrink-0 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
}

/** 应用内统一按钮：primary（强调）/ secondary（次要）/ danger（红色）/ dangerText（红色文字小按钮） */
export default function Button({ variant = "secondary", children, className, ...rest }: Props) {
  return (
    <button className={`${VARIANT_CLASSES[variant]} ${className ?? ""}`} {...rest}>
      {children}
    </button>
  );
}
