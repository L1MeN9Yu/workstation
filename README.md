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

## 发布（macOS）

打 `v*.*.*` tag 触发 `.github/workflows/release.yml`：在 macOS 上构建 universal 安装包（`.app` / `.dmg`），使用 **ad-hoc 自签名**（无需 Apple 开发者证书，不做公证），并将产物（含 updater 的 `latest.json` 与 `.sig` 签名）上传为 GitHub Release **草稿**，人工确认后发布。

发布流程：

1. 版本管理：`package.json` 为唯一版本来源。日常提交通过 changesets 声明变更集（`.changeset/*.md`），`npm run release` 依据变更集自动递增版本并生成 CHANGELOG。
2. 本地发布：`npm run release` 会自动：递增版本 → 写回 `src-tauri/tauri.conf.json`（附加 build 号 `X.Y.Z+build.<n>`，`n` 取 CI 流水号或 git 提交计数）→ 构建安装包与 updater 签名产物（需 `TAURI_SIGNING_PRIVATE_KEY`）→ 结束后清除 build 段。
3. 提交后打 tag：`git tag v<版本号>`（如 `v0.2.0`），`git push origin v<版本号>`。workflow 会校验 tag 与 `tauri.conf.json` 主版本一致，不一致直接失败。
4. 在 GitHub Releases 页面检查草稿产物（`.dmg`、`.app` 压缩包、`latest.json`、`.sig`），确认后手动发布。
5. 用户侧：应用设置页「应用更新」可手动检查更新，启动时会静默检查一次；有新版本时下载安装并自动重启。

> 版本一致性由 CI 的 `npm run sync:version:check` 兜底：`tauri.conf.json` 与 `package.json` 主版本不一致时构建失败。

> **注意（未公证应用的限制）**：由于未做 Apple 公证，用户首次打开 `.app`/`.dmg` 时系统会提示"无法验证开发者"。需右键（或按住 Control 点击）图标选择"打开"，或执行 `xattr -cr /Applications/Workstation.app` 后正常打开。应用内更新（updater）不受影响，但仍可能触发一次同样的首次打开提示。

### 所需 GitHub Secrets

| Secret | 用途 |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | updater 签名私钥（由 `npx @tauri-apps/cli signer generate` 生成，公钥已内置于 `tauri.conf.json`） |

> 私钥丢失会使更新包无法签名（无法发布新版本），泄露则存在更新包伪造风险，请妥善保管；如需更换，重新生成密钥对并同步更新 `tauri.conf.json` 中的公钥。

## OpenSpec

本仓库使用 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 做 spec 驱动开发。

```bash
/opsx:propose "你的需求"   # 提出变更（生成 proposal/design/specs/tasks）
/opsx:apply               # 实施 tasks（会自动创建 change/<name> 分支）
/opsx:archive             # 归档已完成变更（需先回 main 并 pull）
```
