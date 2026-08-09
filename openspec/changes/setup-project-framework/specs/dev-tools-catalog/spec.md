## ADDED Requirements

### Requirement: 研发工具注册表
系统 SHALL 提供研发工具集合并基于注册表渲染导航与路由，新增工具免改布局。

#### Scenario: 基于注册表渲染导航
- **WHEN** 工具注册表中存在一条工具记录
- **THEN** 侧边导航与路由自动包含该工具，无需改动布局代码

#### Scenario: 新增工具
- **WHEN** 向注册表新增一条 `{id, label, component}` 记录
- **THEN** 新工具出现在导航并可访问其页面

### Requirement: 工具页面占位
系统 SHALL 为通用工具页提供统一容器，供 base64、加解密、URL encoding、hash、颜色 picker 等后续实现复用。

#### Scenario: 访问占位工具页
- **WHEN** 用户点击某个已注册但未实现的工具
- **THEN** 显示统一容器及"功能开发中"占位内容

#### Scenario: 至少一个完整示例工具
- **WHEN** 本 change 初始化完成
- **THEN** 注册表中至少包含一个可用的示例工具（如 base64 编解码），用于验证注册表链路
