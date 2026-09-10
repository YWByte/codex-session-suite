# Codex Session Suite

Codex Session Suite 是一套本机优先的 Codex 工作台，用于管理对话、计划、架构文档、收藏内容和 Git 审查。一个 npm 命令会启动 Session、Plan、Arch 与 Collect；Difgraph 和采用 MIT 许可证的 `difit` 包仅在需要时启动。

[English](./README.md)

## 界面截图

所有截图均使用隔离的演示工作区，不包含个人会话、文档、收藏内容或真实源代码仓库。

### Session

![Codex Session Viewer](./docs/screenshots/session.png)

### Plan

![Plan Viewer](./docs/screenshots/plan.png)

### Arch

![Arch Viewer](./docs/screenshots/arch.png)

### Collect

![Collect Viewer](./docs/screenshots/collect.png)

### Difgraph

![Difgraph](./docs/screenshots/difgraph.png)

### Difit

![Difit](./docs/screenshots/difit.png)

## 环境要求

- macOS 可使用全部功能，包括文件夹选择、打开本地路径和将文档移入废纸篓
- Node.js 22 或更高版本
- `PATH` 中存在 Codex CLI 0.153.2，或通过 `codex.bin`／`CODEX_BIN` 指定

其他操作系统可以使用对话、文档、收藏与只读 Git 功能。不支持的桌面集成功能会被禁用，不会降级为不可恢复的操作。

## 安装与启动

```sh
npm install -g codex-session-suite
codex-session-suite doctor
codex-session-suite start
```

默认命令为 `start`。使用 `--no-open` 阻止自动打开浏览器，使用 `--locale en|zh-CN` 选择语言，使用 `--config <路径>` 加载指定 TOML 文件。

## 配置

将 `config.example.toml` 复制为当前目录下的 `config.toml`。优先级依次为 CLI 参数、环境变量、TOML 和安全默认值。所有 HTTP 服务只绑定 `127.0.0.1`。

默认端口：

- Plan：3458
- Arch：3459
- Session：3460
- Collect：3461

Plan、Arch 与 Collect 数据默认保存在 `CODEX_HOME` 下。卸载 npm 包不会删除这些数据；删除或迁移前请备份配置的数据路径。

## 语言

界面与 CLI 提供英文和简体中文。解析顺序为页面显式语言或 `--locale`、跨端口共享语言 Cookie、TOML、浏览器／系统语言，最后回退英文。所有代码注释均使用英文。

## 安全模型

套件仅在本机运行，拒绝非 loopback HTTP Host 和不安全的跨域写入，校验文档路径，并拒绝在 TOML 中配置凭据。Codex 始终是外部前置条件。发布前请运行 `npm run check:release`。

## 开发

```sh
npm install
npm test
npm run check:release
npm pack --dry-run
```

更多信息见 [CONTRIBUTING.md](./CONTRIBUTING.md)、[SECURITY.md](./SECURITY.md) 与 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。
