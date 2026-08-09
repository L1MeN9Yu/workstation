## Context

仓库当前为空占位：已初始化 Tauri 2 / openspec / codegraph 与 AI 工具规则，但无任何应用代码。目标应用是"工作任务管理 + 研发工具"桌面程序，两大功能方向：cmux/ghosty 配置 GUI 化、常用 Web 研发工具集成。本 change 只搭骨架，不实现具体业务。

## Goals / Non-Goals

**Goals:**
- 建立可运行的 Tauri 2 工程（`src-tauri/` Rust 后端 + 根目录前端）
- 前端有路由、基础布局、主题与导航，能承载多个功能模块
- 定义 `config-store`（Tauri command 层）作为本地配置读写的统一抽象，为 cmux/ghosty 接入铺路
- 预留 `cmux-config`、`dev-tools-catalog` 两个模块的入口与目录结构
- 开发/构建命令与文档就绪

**Non-Goals:**
- 不实现 cmux/ghosty 配置的实际解析与编辑（后续 change 细化）
- 不实现具体研发工具逻辑（base64 等仅目录框架）
- 不做移动端/Web 发布，仅桌面
- 不引入 CI/CD（后续按需）

## Decisions

- **前端栈：React + TypeScript + Vite**
  Tauri 2 官方脚手架首选、生态最大、类型友好。备选 Vue/Svelte（Tauri 同样支持）——如后续偏好变化可在初始化一步内替换。
- **路由：react-router**。任务管理与工具集是典型多页面应用，需要可扩展路由。
- **状态管理：zustand 或 React Context**。先以轻量方案起步，避免早期过度设计；具体在初始化时二选一，倾向 zustand（更少样板）。
- **UI 层：Tailwind CSS**（v4）+ 少量自建基础组件。初期不绑重组件库，降低依赖面。
- **配置读写（config-store）抽象在 Rust command 层**，前端不直接碰文件系统。配置文件路径策略：应用自身偏好存 `app_config_dir`；cmux/ghosty 等外部配置由 `cmux-config` 负责定位（HOME 下手写文件），本 change 仅定义接口形状。
- **dev-tools-catalog 采用注册表模式**：前端维护 `{id, label, component}` 注册列表，导航栏与路由从同一份列表渲染，新增工具=加一条注册，不改布局。

## Risks / Trade-offs

- [Rust command 需要文件权限时被 Tauri capability 拦截] → 初始化时按需配置 `capabilities` 白名单，缺权限先加再测
- [ghosty/cmux 配置格式未知导致抽象过度] → config-store 只做通用读写形状，格式专有解析留在各自模块，避免过早绑定
- [前端框架若需更换成本高] → 在移动端/Web 发布与团队偏好确认前，骨架保持薄、可替换
- [注册表模式初期"过度设计"风险] → 工具列表尚少，注册表仅 20 行左右，收益（导航/路由同步）大于成本
