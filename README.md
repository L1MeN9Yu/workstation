# Workstation

一个基于 **Tauri 2** 的桌面应用，用于管理和优化开发者的日常工作任务。

## 核心功能方向

1. **cmux 终端管理 UI**：为 cmux（AI coding 终端）提供图形化配置界面，重点是把手写配置文件（尤其 **ghosty** 的配置）转为 GUI 可视化操作。
2. **研发工具集合**：集成常用 Web 工具，如 base64 编解码、加解密、URL encoding、hash 计算、颜色 picker 等。

## 技术栈

- **前端**：React 19 + TypeScript + Vite 7 + React Router + Zustand + Tailwind CSS v4
- **后端壳**：Tauri 2（Rust），配置读写等能力通过 Tauri command 暴露给前端

## 目录结构

```
src/                  # 前端源码
  components/         # 通用组件
  pages/              # 页面（Home / CmuxConfig / DevTools / tools/*）
  store/              # zustand 状态
  lib/                # 工具函数与注册表
src-tauri/            # Rust 后端
  src/lib.rs          # Tauri command（config 读写、app_version）
  capabilities/       # 权限配置
```

## 开发命令

```bash
npm install           # 安装前端依赖
npm run dev           # 仅启动前端（Vite）
npm run tauri dev     # 启动桌面应用（前端 + Rust，自动拉起）
npm run lint          # ESLint
npm run typecheck     # TypeScript 类型检查
npm run build         # 前端构建（tsc + vite build）
npm run tauri build   # 完整桌面应用构建（产出 .app/.dmg 等）
```

## CI

GitHub Actions（`.github/workflows/ci.yml`）在 push/PR 时于 **Windows / macOS / Linux** 三平台分别执行：

- 前端：`npm ci` → `lint` → `typecheck` → `build`
- 后端：`cargo fmt --check` → `clippy` → `test` → `build --release`

## OpenSpec

本仓库使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 做 spec 驱动开发。

```bash
/opsx:propose "你的需求"   # 提出变更（生成 proposal/design/specs/tasks）
/opsx:apply               # 实施 tasks（会自动创建 change/<name> 分支）
/opsx:archive             # 归档已完成变更（需先回 main 并 pull）
```
