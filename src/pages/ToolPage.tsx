import type { ReactNode } from "react";

interface ToolPageProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function ToolPage({ title, description, children }: ToolPageProps) {
  return (
    <div className="w-full px-6 py-6">
      <h2 className="mb-1 text-xl font-semibold">{title}</h2>
      {description && <p className="mb-4 text-sm text-gray-500">{description}</p>}
      {children}
    </div>
  );
}

export function ToolPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-400 dark:border-gray-600">
      功能开发中：{label}
    </div>
  );
}
