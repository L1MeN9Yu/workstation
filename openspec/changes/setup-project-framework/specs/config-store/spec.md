## ADDED Requirements

### Requirement: 配置读写统一入口
系统 SHALL 通过 Tauri command 提供本地配置文件的读取与写入能力，前端 SHALL NOT 直接访问文件系统。

#### Scenario: 读取配置
- **WHEN** 前端调用读取配置的 command 并传入配置识别键
- **THEN** 返回该配置的当前内容，若不存在则返回空/默认值

#### Scenario: 写入配置
- **WHEN** 前端调用写入配置的 command 并传入配置识别键与内容
- **THEN** 内容被持久化到对应本地文件，后续读取返回新内容

### Requirement: 配置路径策略
系统 SHALL 将应用自身偏好存储于应用配置目录，把外部工具（如 cmux/ghosty 手写配置）的定位留给专用模块处理。

#### Scenario: 应用偏好持久化
- **WHEN** 前端保存应用自身偏好设置
- **THEN** 数据写入应用配置目录下的文件

#### Scenario: 外部工具配置隔离
- **WHEN** 前端需要操作 cmux/ghosty 等外部配置文件
- **THEN** 走 `cmux-config` 模块定位与解析，而非 config-store 通用存储
