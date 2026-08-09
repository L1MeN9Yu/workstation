import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import Home from "./pages/Home";
import CmuxConfig from "./pages/CmuxConfig";
import DevTools from "./pages/DevTools";
import { toolRegistry } from "./lib/toolsRegistry";
import { useTheme, useInitTheme } from "./store/theme";

interface NavEntry {
  path: string;
  label: string;
}

const staticNav: NavEntry[] = [
  { path: "/", label: "任务" },
  { path: "/cmux", label: "cmux" },
  { path: "/tools", label: "工具集" },
];

const toolNav: NavEntry[] = toolRegistry.map((t) => ({
  path: t.path,
  label: t.label,
}));

export default function App() {
  useInitTheme();
  const { theme, toggle } = useTheme();
  const [version, setVersion] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const v = await invoke<string>("app_version");
        if (!cancelled) setVersion(v);
      } catch {
        // version unavailable outside the Tauri runtime
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-full bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <aside className="flex w-56 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-800">
        <div className="flex items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold">Workstation</h1>
          <button
            onClick={toggle}
            title="切换明暗主题"
            className="rounded-md border border-gray-300 px-2 py-1 text-xs dark:border-gray-600"
          >
            {theme === "light" ? "暗" : "明"}
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
          {staticNav.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              end={n.path === "/"}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${
                  isActive
                    ? "bg-blue-600 font-medium text-white"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
          <div className="pt-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            研发工具
          </div>
          {toolNav.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm ${
                  isActive
                    ? "bg-blue-600 font-medium text-white"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-gray-200 px-4 py-2 text-xs text-gray-400 dark:border-gray-800">
          Workstation v{version || "0.1.0"}
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/cmux" element={<CmuxConfig />} />
          <Route path="/tools" element={<DevTools />} />
          {toolRegistry.map((t) => (
            <Route key={t.id} path={t.path} element={<t.component />} />
          ))}
        </Routes>
      </main>
    </div>
  );
}
