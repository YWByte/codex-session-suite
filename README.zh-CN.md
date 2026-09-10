<div align="center">

# ✨ Codex Session Suite

**一套本机优先的 Codex 可视化工作台，集中管理对话、计划、架构知识、收藏内容与 Git 审查。**

<p>
  <a href="./README.md">English</a>
  ·
  <a href="#-快速开始">快速开始</a>
  ·
  <a href="#-界面预览">界面预览</a>
  ·
  <a href="https://github.com/YWByte/codex-session-suite/issues">问题反馈</a>
</p>

<p>
  <img alt="Node.js 22+" src="https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white">
  <img alt="英文和简体中文" src="https://img.shields.io/badge/i18n-English%20%7C%20简体中文-4F46E5">
  <img alt="本机优先" src="https://img.shields.io/badge/data-local--first-0F766E">
  <a href="./LICENSE"><img alt="MIT 许可证" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
</p>

</div>

Codex Session Suite 将原本分散在终端输出、Markdown 文档和 Git 工具中的 Codex 工作流程集中到一个浏览器工作台。一个命令即可启动 **Session**、**Plan**、**Arch** 和 **Collect**；需要审查仓库时，还可以使用 **Difgraph** 以及采用 MIT 许可证的 **Difit** 集成。

> [!NOTE]
> 套件仅在本机运行，所有 HTTP 服务只绑定 `127.0.0.1`。你的会话、文档和收藏内容都保留在本机。

## 🧭 按目标选择功能

| 组件 | 目标 | 主要能力 |
| --- | --- | --- |
| 💬 **Session** | 延续对话并快速定位代码 | 展示对话流、工具流和压缩流程；源码位置一键跳转 VS Code；绝对路径使用默认应用打开 |
| 🗺️ **Plan** | 方便查看实施计划 | 在执行前或执行过程中阅读、比较、批注、编辑和整理计划 |
| 🏛️ **Arch** | 梳理代码和现有知识 | 记录当前代码行为、关联源码位置，沉淀架构知识与领域知识 |
| 📚 **Collect** | 留存可复用内容 | 将有价值的片段和参考资料保存到单次对话之外 |
| 🌿 **Difgraph** | 理解仓库变更关系 | 可视化浏览 Git 历史与相关变更 |
| 🔍 **Difit** | 审查差异 | 在不打断对话流程的情况下集中查看 Git diff |

## 💬 Session 功能优势

Session 不只是对话记录查看器，它将 Codex Thread 变成一个可以阅读、整理、继续操作和审查结果的工作空间。

| 功能 | 带来的优势 |
| --- | --- |
| 📝 **批注** | 选中对话内容添加批注，随时回看高亮片段，并可在不再需要时统一清除批注 |
| ⭐ **一键收藏对话内容** | 将整条消息或选中的片段直接收藏到 Collect，可附加说明，并保留返回原始对话位置的关联 |
| 🕘 **快速查看对话历史** | 按项目浏览会话、搜索会话标题、在用户消息之间快速跳转，并按需加载更早或更完整的历史内容 |
| 🌳 **接入功能树与会话树** | 展示父 Thread、子 Thread、子代理和后代关系，可从工具或子代理活动直接跳转到关联会话 |
| 📦 **归档与恢复** | 将已完成会话移出活动列表，以只读方式查看归档内容，并可随时恢复 |
| 🗑️ **批量删除** | 一次选择并永久删除多棵会话树；删除前识别后代 Thread，并保护仍在运行的子会话 |
| 🧠 **模型切换** | 不离开 Session 即可切换当前对话可用的模型和推理强度 |
| 🔀 **对话模式切换** | 根据执行或规划场景，在 Default 与 Plan 协作模式之间切换 |
| ✏️ **编辑并重发历史消息** | 修改之前的用户消息，将其作为新的当前指令发送，同时保留已有对话上下文 |
| 🧰 **完整活动时间线** | 在同一条时间线查看模型回复、推理、计划、命令输出、文件变更、MCP 调用、子代理活动、审批和补充输入请求 |
| 🗜️ **上下文控制** | 查看 Token 使用情况、主动压缩上下文、中断正在进行的任务，并持续跟踪实时执行状态 |
| 🖼️ **图片支持** | 发送图片、预览图片消息、移除待发送图片，并在需要时打开大图 |
| 🔗 **可操作的文件路径** | 将源码位置精确打开到 VS Code 的行和列，其他绝对路径则使用系统默认应用打开 |
| 🌿 **集成 Git 审查** | 查看当前分支、使用 Difgraph 打开提交图，并通过 Difit 审查暂存或已提交的变更 |
| 🌐 **双语工作台** | 使用完整的英文或简体中文 Session 界面，并在套件组件之间共享语言偏好 |

## 📌 强烈建议加入模型 Rule

只有当模型将文档写入套件监听的目录后，Plan 和 Arch 才能展示文档。**强烈建议在模型的 Rule（系统提示词或开发者提示词）中明确配置后的 Plan 与 Arch 存储路径。**

默认根目录为：

- Plan：`~/.codex-cli/plans`
- Arch：`~/.codex-cli/arch`

如果自定义了 `[data].plans_dir` 或 `[data].arch_dir`，请改用配置后的路径。建议先展开 `~`，再把真实绝对路径提供给模型。

推荐加入含义如下的规则：

```text
Plan 文档必须保存到 <Plan 目录的绝对路径> 下。
Arch 文档必须保存到 <Arch 目录的绝对路径> 下。
在对话中引用本地文件时使用绝对路径，并在有帮助时附带行号和列号。
```

这样生成的文档才能被对应查看器稳定发现。源码位置可以直接跳转到 VS Code，其他绝对路径则可以使用操作系统的默认应用打开。

## 🚀 快速开始

### 环境要求

- **Node.js 22 或更高版本**
- `PATH` 中存在 **Codex CLI 0.153.2**，或通过 `codex.bin` / `CODEX_BIN` 指定
- 使用 **macOS** 可获得完整桌面体验，包括选择文件夹、打开本地路径和将文档移入废纸篓

其他操作系统仍可使用对话、文档、收藏与只读 Git 功能。不支持的桌面集成功能会被禁用，不会替换为具有破坏性的降级操作。

### 安装与运行

```sh
npm install -g codex-session-suite
codex-session-suite doctor
codex-session-suite start
```

默认命令为 `start`。

```sh
codex-session-suite start --no-open
codex-session-suite start --locale zh-CN
codex-session-suite start --config /配置文件的绝对路径/config.toml
```

| 参数 | 用途 |
| --- | --- |
| `--no-open` | 不自动打开浏览器 |
| `--locale en\|zh-CN` | 选择界面语言 |
| `--config <路径>` | 加载指定的 TOML 配置文件 |
| `doctor` | 检查配置、Codex CLI 可用性与版本兼容性 |

## 🖼️ 界面预览

所有截图均使用隔离的演示工作区，不包含个人会话、文档、收藏内容或真实源代码仓库。

### 💬 Session

包含消息、输入框、工具活动和代码导航的完整对话界面。

![Codex Session Viewer](./docs/screenshots/session.png)

### 🗺️ Plan

专门用于浏览和审阅实施计划。

![Plan Viewer](./docs/screenshots/plan.png)

### 🏛️ Arch

用于理解现有代码与架构知识。

![Arch Viewer](./docs/screenshots/arch.png)

### 📚 Collect

跨会话留存可复用的笔记和参考资料。

![Collect Viewer](./docs/screenshots/collect.png)

### 🌿 Difgraph

可视化查看仓库历史和变更关系。

![Difgraph](./docs/screenshots/difgraph.png)

### 🔍 Difit

集中审查 Git 差异。

![Difit](./docs/screenshots/difit.png)

## ⚙️ 配置

将 [`config.example.toml`](./config.example.toml) 复制为当前目录下的 `config.toml`。配置优先级为：**CLI 参数 → 环境变量 → TOML → 安全默认值**。

### 默认服务

| 服务 | 端口 |
| --- | ---: |
| Plan | `3458` |
| Arch | `3459` |
| Session | `3460` |
| Collect | `3461` |

Plan、Arch 与 Collect 数据默认保存在 `CODEX_HOME` 下。卸载 npm 包不会删除这些数据；删除或迁移前，请备份配置的数据路径。

## 🛣️ 当前适配范围与待开放路径

目前项目优先覆盖最常用的 Codex 体验，包括**对话流、工具流、压缩流程以及相关的会话操作**。Codex server 协议中仍有许多 `item` 事件尚未完成适配或可视化，这些事件将是后续持续开放和开发的主要方向。

> [!WARNING]
> Codex 官方 API 与 server 协议仍可能持续变化，当前适配层可能存在缺陷，也可能暂时落后于上游版本。个人部署时，可能需要借助 AI 针对正在使用的 Codex 版本排查问题并做少量兼容调整。如果遇到 Bug，欢迎尽情在 [GitHub Issues](https://github.com/YWByte/codex-session-suite/issues) 中提出；如果条件允许，请附上 Codex 版本、操作系统、相关日志与复现步骤。

欢迎参与以下方向：

- [ ] 适配并可视化更多 Codex server `item` 事件
- [ ] 跟进新版 Codex API 或协议的兼容性修复
- [ ] 补充可复现的集成样例与回归测试
- [ ] 改善跨平台桌面集成体验

## 🌐 语言

界面与 CLI 提供**英文**和**简体中文**。解析顺序为：页面显式语言或 `--locale`、跨端口共享语言 Cookie、TOML、浏览器／系统语言，最后回退到英文。所有代码注释均使用英文。

## 🔐 安全模型

- HTTP 服务只接受 loopback 流量
- 拒绝不安全的跨域写入
- 访问文档前校验路径
- TOML 配置不接受凭据
- Codex 是外部前置条件，不会被打包进套件

发布前请运行 `npm run check:release`。

## 🧑‍💻 开发

```sh
npm install
npm test
npm run test:pack
npm run check:release
npm pack --dry-run
```

参与贡献前，请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)、[SECURITY.md](./SECURITY.md)、[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) 与 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 📄 许可证

项目采用 [MIT License](./LICENSE)。
