# SUSTech Student Assistant

[English version](./README.md)

SUSTech Student Assistant 是一款面向南方科技大学学生的本地桌面应用。它把聊天助手、待办规划、日程管理、Blackboard 同步，以及来自南科手册等资料的南科校园知识整合到一个应用中。

本项目是一个小型本地原型，使用 Electron、原生 JavaScript、FastAPI 和 TinyDB 构建。正常使用时，Electron 负责桌面外壳，并会自动启动 Python 后端。

## 核心功能

- 通过 OpenAI 兼容模型与 Python 后端聊天助手交互。
- 上传本地文件到临时工作区，供助手查看和处理。
- 管理待办事项，包括截止时间、完成状态、搜索、排序、筛选、批量清理和删除后撤销。
- 将带截止时间的待办事项同步生成关联日程。
- 在日历视图中创建和更新日程事件。
- 在独立窗口登录 SUSTech Blackboard，同步远程项目，并在应用到待办或日程前人工审核建议。
- 搜索基于南科手册和相关内置文档构建的南科校园知识。
- 配置后端端口、模型、接口地址、API key 和界面语言。

## 技术栈

- 桌面外壳：Electron
- 前端界面：HTML、CSS、原生 JavaScript
- 后端 API：FastAPI
- Agent 运行时：`agent-framework` 与 OpenAI 兼容聊天客户端
- 本地存储：TinyDB
- 富文本聊天渲染：`markdown-it` 和 KaTeX
- 打包：`electron-builder` 生成 Windows NSIS 安装包

## 仓库结构

```text
backend/        FastAPI 路由、服务、仓库、Blackboard 同步和 agent 运行时
src/electron/   Electron 主进程、preload 桥接、IPC 和后端进程控制
src/renderer/   Chat、Todo、Schedule、Blackboard 和 Config 页面
tests/          后端测试和 Electron 侧测试
docs/           产品、架构、后端、开发和打包文档
tools/          语料构建和 CI 辅助脚本
vendor/         内置第三方资料和南科相关资料
```

## 环境要求

- Node.js 和 npm
- 可通过 `python` 命令调用的较新 Python 解释器
- 如果要使用聊天助手，需要能访问已配置的 OpenAI 兼容聊天接口
- 如果要使用 Blackboard 同步，需要 SUSTech Blackboard 账号

## 安装

安装 JavaScript 依赖：

```powershell
npm install
```

安装 Python 依赖：

```powershell
python -m pip install -r backend/requirements.txt
```

可选：重新构建本地南科手册语料：

```powershell
npm run build:sustech-manual
```

## 配置

开发环境的配置文件是仓库根目录下的 `config.json`。应用会读取以下字段：

| 字段 | 用途 |
| --- | --- |
| `backendPort` | Electron 连接本地 FastAPI 后端使用的端口 |
| `openaiApiKey` | 已配置聊天服务商的 API key |
| `openaiChatModel` | 助手运行时使用的模型名称 |
| `openaiEndpoint` | OpenAI 兼容接口的 base URL |
| `appLanguage` | UI 和默认助手语言，通常为 `zh-CN` 或 `en` |

配置文件示例：

```json
{
  "backendPort": 8765,
  "openaiApiKey": "YOUR_API_KEY",
  "openaiChatModel": "YOUR_MODEL_NAME",
  "openaiEndpoint": "https://api.example.com/v1",
  "appLanguage": "zh-CN"
}
```

不要提交真实 API key 或个人凭据。TinyDB 数据会存储在有效配置文件旁边的 `db.json` 中。Electron 还会创建本地 `workspace/` 目录，用于保存上传文件和生成产物；该目录会在应用启动时清空并重建。

## 运行桌面应用

在仓库根目录运行：

```powershell
npm start
```

Electron 会打开桌面界面并自动启动 Python 后端。当后端可访问且聊天模型配置完成后，应用状态会变为 `ready`。

## 仅运行后端

如果只想测试 API，而不启动 Electron，可以运行：

```powershell
python -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

然后检查健康检查接口：

```powershell
curl.exe http://127.0.0.1:8765/health
```

## 使用示例

### 聊天助手

1. 使用 `npm start` 打开桌面应用。
2. 进入 Chat 页面。
3. 输入类似下面的问题：

```text
Summarize my upcoming todos and schedule events for this week.
```

4. 如果助手在修改本地待办、日程或工作区文件前请求授权，请先检查请求内容，再决定是否批准。

### 待办规划

1. 打开 Todo 页面。
2. 创建一个包含标题和截止时间的任务，例如：

```text
Title: Submit CS304 milestone report
Due: 2026-06-03 23:59
```

3. 待办事项会持久化到 TinyDB。如果它有截止时间，应用还会创建一个关联日程事件。
4. 标记待办完成或编辑截止时间时，关联日程也会随之更新。

### 日程管理

1. 打开 Schedule 页面。
2. 添加一个日程事件，例如：

```text
Title: Group meeting
Time: 2026-06-01 15:00-16:00
Location: Library
```

3. 通过月份导航查看之后的事件。

### Blackboard 同步

1. 打开 Blackboard 页面。
2. 启动 Blackboard 登录流程，并在独立窗口中登录。
3. 执行同步，获取公告、课程内容和成绩册项目。
4. 在将建议应用到 Todo 或 Schedule 前，先人工审核生成的建议。

### 后端 API 快照

当后端运行在 `8765` 端口时，可以直接创建和读取待办事项：

```powershell
curl.exe -X POST http://127.0.0.1:8765/api/todos `
  -H "Content-Type: application/json" `
  -d "{\"title\":\"Read NanKe Manual\",\"dueAt\":\"2026-06-01T10:00:00\"}"

curl.exe http://127.0.0.1:8765/api/todos
```

## 截图 / 快照

建议在项目报告或演示中加入以下截图：

- Chat 页面展示已渲染的助手回复
- Todo 页面展示一个带截止时间的待办
- Schedule 页面展示一个关联日程
- Blackboard 页面展示待审核建议
- Config 页面展示不包含秘密信息的本地设置

可以将截图放在 `docs/screenshots/` 目录下，并在本节中链接。截图中不要包含 API key、Blackboard 凭据或私人学生数据。

## 测试

运行完整测试：

```powershell
npm test
```

只运行后端测试：

```powershell
npm run test:backend
```

只运行 Electron 侧测试：

```powershell
npm run test:electron
```

## Windows 打包

Windows 打包流程会先重建南科手册语料，然后运行 `electron-builder`：

```powershell
npm run package:win
```

关于内置 Python 运行时和安装包产物，请查看 [docs/windows-packaging.md](./docs/windows-packaging.md)。

## 已知问题和限制

- 本项目是本地原型，不是托管的多用户服务。
- 聊天助手需要可用的 OpenAI 兼容接口和 API key。
- Blackboard 同步是 SUSTech 专用功能，并依赖当前 Blackboard 登录和会话流程。
- 内置校园知识是南科专用知识，不是通用学生知识库。
- 提醒、本地通知、Microsoft To Do 同步和外部日历同步不在当前 Release 1 范围内。
- 本地 `workspace/` 目录会在每次应用启动时重建，因此不要把它当作长期存储。

## 更多资源

- [文档索引](./docs/README.md)
- [产品范围](./docs/product.md)
- [功能需求](./docs/feature.md)
- [架构文档](./docs/architecture.md)
- [后端 API 和模块](./docs/backend.md)
- [开发指南](./docs/development.md)
- [Windows 打包指南](./docs/windows-packaging.md)
- [历史 proposal](./docs/presentation/proposal-26s-29.md)
