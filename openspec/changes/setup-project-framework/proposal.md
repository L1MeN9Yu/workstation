## Why

当前仓库是空的 Tauri 2 占位（仅有 AI 工具规则与 openspec/codegraph 初始化）。需要先搭出可运行的应用骨架，才能逐步承载 cmux/ghosty 配置 GUI 与研发工具集成两大功能方向。

## What Changes

- 初始化 Tauri 2 桌面应用工程结构（`src-tauri/` Rust 后端 + 根目录 Web 前端）
- 建立前端应用骨架：路由、状态管理、基础布局与主题
- 预留两个核心功能模块的入口：cmux 配置管理、研发工具集合
- 定义中立的"应用配置"边界（后端读写本地配置文件 + 前端展示），为后续接入 cmux/ghosty 手写配置文件铺路
- Rust 后端提供基础能力：配置读写、文件访问、与前端交互的 Tauri command

## Capabilities

### New Capabilities
- `app-shell`: 应用主窗口、侧边导航、主题与布局骨架，承载所有功能模块
- `config-store`: 本地配置文件/数据的读写抽象（Tauri command 层），后续 cmux/ghosty 配置和工具偏好设置的统一入口
- `cmux-config`: cmux / ghosty 手写配置文件的读取、解析与 GUI 可视化编辑（本 change 仅搭模块骨架，具体解析在后续 change 细化）
- `dev-tools-catalog`: 研发工具集合（base64、加解密、URL encoding、hash、颜色 picker 等）的插件式目录与通用工具页框架

### Modified Capabilities
<!-- 无已有 spec，本 change 首次引入 -->

## Impact

- 工程结构：新增 `src-tauri/`（Rust）、根目录前端源码、构建/开发脚本、配置文件
- 依赖：tauri 2、前端框架及其工具链（均在初始化时确定）
- 系统：支持 macOS（开发环境为 darwin），Tauri 2 默认能力范围；后续如需文件系统更深入操作再评估 permission 配置
