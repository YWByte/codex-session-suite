# Codex Session Suite 接入指南

[English](./INTEGRATION.md) · [返回 README](../README.zh-CN.md)

本文详细说明如何将 Codex Session Suite 接入现有 Codex CLI 环境，让 Session 发现会话，并让模型生成的 Plan 与 Arch 文档出现在对应查看器中。

## 1. 接入原理

Codex Session Suite 不会替代 Codex CLI，也不要求在自己的配置文件中保存凭据。

1. Codex CLI 继续负责身份验证、模型、对话和 app-server 协议。
2. Session 通过本地 Codex app-server 读取并继续对话。
3. Plan 和 Arch 监听配置后的本地目录，展示模型生成的文档。
4. Collect 将可复用的对话片段保存到本地 JSON 文件。
5. Difgraph 和 Difit 在需要检查 Git 时按需启动。

套件的所有 HTTP 服务只绑定 `127.0.0.1`。

## 2. 前置条件

- Node.js 22 或更高版本
- Codex CLI 0.153.2
- 已经可以正常使用的 Codex CLI 环境及 `CODEX_HOME`
- macOS 可使用全部桌面集成功能；其他操作系统仍可使用浏览器功能和只读能力

先检查工具版本：

```sh
node --version
codex --version
```

如果 Codex 版本与套件要求不一致，请先阅读[兼容性与问题排查](#8-兼容性与问题排查)，不要直接修改期望版本。

## 3. 安装并检查套件

```sh
npm install -g codex-session-suite
codex-session-suite --version
codex-session-suite doctor
```

`doctor` 会检查：

- 配置格式是否有效；
- `CODEX_HOME` 是否存在；
- Codex 可执行文件是否存在并且可以执行；
- Codex 版本是否与 `expected_version` 一致；
- 配置的端口是否都可以使用。

请在 `doctor` 报告所有必要检查均已通过后再继续。

## 4. 配置 Codex 与本地存储

默认情况下，套件读取当前工作目录中的 `config.toml`，也可以通过 `--config` 指定配置文件。

从项目提供的示例开始：

```sh
cp config.example.toml config.toml
```

一份实用配置如下：

```toml
[services]
session_port = 3460
plan_port = 3458
arch_port = 3459
collect_port = 3461

[ui]
locale = "auto"
open_browser = true

[codex]
# 如果无法从 PATH 找到 Codex，请填写可执行文件的绝对路径。
bin = ""
# 留空时使用 CODEX_HOME 或 ~/.codex-cli。
home = ""
expected_version = "0.153.2"

[timeouts]
rpc_ms = 15000
initialize_ms = 20000
folder_picker_ms = 120000
file_picker_ms = 120000

[limits]
thread_pages = 1000

[data]
# 留空时从 Codex 主目录推导这些位置。
plans_dir = ""
arch_dir = ""
collect_file = ""
```

### 默认数据位置

| 数据 | 默认位置 |
| --- | --- |
| Codex 会话 | 由 Codex 在 `CODEX_HOME` 下管理 |
| Plan 文档 | `~/.codex-cli/plans` |
| Arch 文档 | `~/.codex-cli/arch` |
| 收藏内容 | `~/.codex-cli/collections/collections.json` |

TOML 中的相对路径以该 TOML 文件所在目录为基准。为了让模型指令保持明确，建议将自定义的 `plans_dir` 和 `arch_dir` 配置成绝对路径。

### 配置优先级

实际生效值按以下顺序选择：

1. CLI 参数
2. 环境变量
3. TOML 配置
4. 安全默认值

常用环境变量包括 `CODEX_HOME`、`CODEX_BIN`、`CODEX_SESSION_PORT`、`CODEX_PLAN_PORT`、`CODEX_ARCH_PORT`、`CODEX_COLLECT_PORT` 和 `CODEX_SUITE_LOCALE`。

> [!IMPORTANT]
> 不要在 `config.toml` 中放置 API Key、Token、密码或其他凭据。套件会主动拒绝类似凭据的配置项，身份验证始终由 Codex CLI 管理。

## 5. 为 Plan 和 Arch 添加模型 Rule

这是接入过程中最重要的一步。Plan 和 Arch 都是基于目录的查看器：如果模型将文档写到其他位置，套件将无法发现它。

首先取得真实的绝对根目录。使用默认配置时可以执行：

```sh
printf 'Plan: %s\nArch: %s\n' "$HOME/.codex-cli/plans" "$HOME/.codex-cli/arch"
```

然后将下面的规则加入模型的系统提示词或开发者提示词，并将所有占位符替换为实际绝对路径：

```text
# Codex Session Suite 文档接入规则

- 实施计划必须作为 Plan 文档保存到 <PLAN_ROOT 的绝对路径> 下。
- 用于解释当前代码行为或现有项目知识的文档必须作为 Arch 文档保存到 <ARCH_ROOT 的绝对路径> 下。
- 文档目录结构必须为：<ROOT>/<PROJECT_KEY>/<YYYY-MM-DD>/<TITLE>.md。
- PROJECT_KEY 由项目绝对路径生成：将每个路径分隔符替换为连字符；Unix 绝对路径需要保留开头的连字符。
- 如果父目录不存在，则先创建父目录。
- 除非明确要求 HTML，否则使用 Markdown。
- 在对话回复和生成的文档中，使用绝对路径引用本地源文件。
- 需要精确跳转到 VS Code 时，附带行号和列号。
- 不要把凭据、个人对话导出或无关项目数据写入 Plan 或 Arch 文档。
```

例如，位于 `<项目绝对路径>` 的项目应生成类似结构：

```text
<PLAN_ROOT 的绝对路径>/<编码后的项目路径>/2026-09-10/实施计划.md
<ARCH_ROOT 的绝对路径>/<编码后的项目路径>/2026-09-10/现有系统梳理.md
```

### 两种文档分别应该记录什么

- **Plan** 回答：准备修改什么、按什么顺序实施、如何验证，以及有哪些风险？
- **Arch** 回答：当前系统如何工作、行为在哪里实现，以及哪些现有知识需要保留？

不要把尚未实施的方案当成 Arch，也不要把对当前代码的说明当成 Plan。

## 6. 启动并验收接入结果

启动全部核心服务：

```sh
codex-session-suite start
```

如果要使用指定配置且不自动打开浏览器：

```sh
codex-session-suite start --config /配置文件的绝对路径/config.toml --no-open
```

默认地址：

| 组件 | 地址 |
| --- | --- |
| Session | `http://127.0.0.1:3460` |
| Plan | `http://127.0.0.1:3458` |
| Arch | `http://127.0.0.1:3459` |
| Collect | `http://127.0.0.1:3461` |

按以下步骤验收：

1. 打开 Session，确认已有 Codex 项目和会话能够显示。
2. 继续一段测试对话，确认消息和工具调用可以流式展示。
3. 要求模型按照已安装的 Rule 创建一份简短 Plan。
4. 打开 Plan，确认文档出现在预期的项目和日期下。
5. 要求模型将一个现有模块梳理成 Arch。
6. 打开 Arch，确认文档正常显示，并且源码链接可以操作。
7. 选中一段对话内容，添加批注并执行收藏。
8. 打开 Collect，通过来源链接返回原始对话位置。
9. 点击一个绝对源码引用，确认能够按预期跳转 VS Code 或使用默认应用打开。

按 `Ctrl+C` 停止套件，启动器会一并停止所有子服务。

## 7. 推荐的日常工作流

1. 使用 **Session** 找到或继续 Codex 对话。
2. 根据任务需要，在 **Default** 和 **Plan** 模式之间切换。
3. 要求模型将正式计划与当前系统说明保存到配置后的根目录。
4. 在 **Plan** 或 **Arch** 中审阅结果，并通过批注记录后续问题。
5. 将可复用片段收藏到 **Collect**。
6. 审查 Git 历史或变更时，从 Session 打开 **Difgraph** 或 **Difit**。
7. 将已完成的对话归档；只有在确定不再需要时才使用批量删除。

## 8. 兼容性与问题排查

当前接入主要覆盖对话流、工具流、压缩流程和常用会话操作。Codex server 中仍有更多 `item` 事件需要后续适配和可视化。

Codex 官方 API 和 server 协议可能继续变化。如果个人部署在升级 Codex 后无法正常工作：

1. 执行 `codex --version` 和 `codex-session-suite doctor`。
2. 确认 `codex.bin`、`codex.home` 和 `expected_version` 与实际使用的可执行文件一致。
3. 在终端启动套件，保留可见的错误输出。
4. 使用尽可能小且安全的对话或测试数据复现问题。
5. 如果需要本地兼容修复，可以借助 AI 编程工具比较当前 Codex 事件或响应结构与 `apps/session/src` 下的适配代码。
6. 在 [GitHub Issues](https://github.com/YWByte/codex-session-suite/issues) 中提交问题，并附上 Codex 版本、操作系统、已移除敏感信息的日志和复现步骤。

不要在 Issue 中粘贴访问令牌、凭据、私人对话内容或专有源代码。

## 9. 常见问题

### 找不到 Codex CLI

在 TOML 中设置可执行文件的绝对路径：

```toml
[codex]
bin = "/Codex/可执行文件的绝对路径"
```

也可以在启动套件前导出 `CODEX_BIN`。

### Codex 版本不一致

优先安装套件要求的 Codex CLI 版本。只有在确认目标协议兼容或已经完成所需适配后，才修改 `expected_version`。

### 端口不可用

在 `[services]` 下选择四个互不相同的空闲端口，然后使用同一配置重新运行 `doctor`。

### Plan 或 Arch 中没有文档

逐项检查：

- 模型 Rule 是否包含实际生效的绝对根目录；
- 文件是否位于 `<根目录>/<项目标识>/<日期>/` 下；
- 文档扩展名是否为 `.md` 或 `.html`；
- 启动套件时是否使用了预期的 TOML；
- 套件进程是否有权读取文档及其父目录。

### 无法打开绝对路径

完整的本地路径打开功能目前属于 macOS 桌面集成。用于跳转 VS Code 的源码引用必须指向普通文件，并且可以包含行号和列号。

### 收藏内容无法返回来源

原始会话必须仍然存在。永久删除对话后，相关收藏可能无法再跳转到来源位置。

## 10. 安全检查清单

- 服务只保留在 loopback，不要通过公共反向代理暴露。
- 凭据继续使用 Codex 自己的身份验证机制，不要写入套件 TOML。
- 对外分享或备份前，检查 Plan、Arch 和 Collect 数据。
- 从 Issue 日志中移除密钥和私人内容。
- 迁移或删除前备份配置的数据路径。
