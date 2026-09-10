# Codex Session Suite

Codex Session Suite is a local-first web workspace for Codex conversations, plans, architecture notes, reusable collections, and Git review. One npm command starts the Session, Plan, Arch, and Collect viewers; Difgraph and the MIT-licensed `difit` package start only when requested.

[简体中文](./README.zh-CN.md)

## Screenshots

All screenshots use an isolated demo workspace with no personal sessions, documents, collections, or source repositories.

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

## Requirements

- macOS for the complete experience (folder chooser, opening local paths, and moving documents to Trash)
- Node.js 22 or newer
- Codex CLI 0.153.2 available on `PATH`, or configured through `codex.bin`/`CODEX_BIN`

Other operating systems can use conversations, documents, collections, and read-only Git features. Unsupported desktop integrations are disabled rather than replaced with destructive behavior.

## Install and start

```sh
npm install -g codex-session-suite
codex-session-suite doctor
codex-session-suite start
```

The default command is `start`. Use `--no-open` to avoid opening a browser, `--locale en|zh-CN` to select a language, and `--config <path>` to load a specific TOML file.

## Configuration

Copy `config.example.toml` to `config.toml` in the working directory. The precedence is CLI options, environment variables, TOML, then safe defaults. All HTTP services bind to `127.0.0.1`.

Default ports:

- Plan: 3458
- Arch: 3459
- Session: 3460
- Collect: 3461

Plans, architecture documents, and collections are stored under `CODEX_HOME` by default. Uninstalling the npm package does not remove that data. Back up the configured data paths before deleting or migrating them.

## Languages

The UI and CLI support English and Simplified Chinese. An explicit page locale or `--locale` wins, followed by the shared language cookie, TOML, browser/system language, and English fallback. All code comments are English.

## Security model

The suite is local-only, rejects non-loopback HTTP hosts and unsafe cross-origin writes, validates document paths, and never accepts credentials in TOML. Codex remains an external prerequisite. Run `npm run check:release` before publishing.

## Development

```sh
npm install
npm test
npm run check:release
npm pack --dry-run
```

See [CONTRIBUTING.md](./CONTRIBUTING.md), [SECURITY.md](./SECURITY.md), and [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
