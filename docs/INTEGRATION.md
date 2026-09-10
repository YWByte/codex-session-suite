# Codex Session Suite integration guide

[简体中文](./INTEGRATION.zh-CN.md) · [Back to README](../README.md)

This guide explains how to connect Codex Session Suite to an existing Codex CLI environment, make Session discover conversations, and make model-generated Plan and Arch documents appear in the correct viewers.

## 1. How the integration works

Codex Session Suite does not replace Codex CLI and does not require credentials in its own configuration.

1. Codex CLI remains responsible for authentication, models, conversations, and the app-server protocol.
2. Session reads and continues conversations through the local Codex app-server.
3. Plan and Arch watch configured local directories for generated documents.
4. Collect stores reusable conversation excerpts in a local JSON file.
5. Difgraph and Difit are launched on demand for Git inspection.

All suite HTTP services bind to `127.0.0.1`.

## 2. Prerequisites

- Node.js 22 or newer
- Codex CLI 0.153.2
- A working Codex CLI setup with an existing `CODEX_HOME`
- macOS for all desktop integrations; other operating systems retain browser-based and read-only capabilities

Verify the tools first:

```sh
node --version
codex --version
```

If your Codex version differs from the version required by the suite, read [Compatibility and debugging](#8-compatibility-and-debugging) before changing the expected version.

## 3. Install and verify the suite

```sh
npm install -g codex-session-suite
codex-session-suite --version
codex-session-suite doctor
```

`doctor` checks that:

- the configuration is valid;
- `CODEX_HOME` exists;
- the Codex executable is available and executable;
- the Codex version matches `expected_version`;
- all configured ports are available.

Do not continue until `doctor` reports that all required checks passed.

## 4. Configure Codex and local storage

The suite loads `config.toml` from the current working directory by default. You can also pass an explicit file with `--config`.

Start from the packaged example:

```sh
cp config.example.toml config.toml
```

A practical configuration looks like this:

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
# Use an absolute path when Codex is not discoverable from PATH.
bin = ""
# Leave empty to use CODEX_HOME or ~/.codex-cli.
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
# Leave empty to derive these locations from the Codex home directory.
plans_dir = ""
arch_dir = ""
collect_file = ""
```

### Default data locations

| Data | Default location |
| --- | --- |
| Codex sessions | Managed by Codex under `CODEX_HOME` |
| Plan documents | `~/.codex-cli/plans` |
| Arch documents | `~/.codex-cli/arch` |
| Collections | `~/.codex-cli/collections/collections.json` |

Relative paths in TOML are resolved relative to that TOML file. For predictable model instructions, customized `plans_dir` and `arch_dir` values should be absolute paths.

### Configuration precedence

The effective value is selected in this order:

1. CLI option
2. Environment variable
3. TOML value
4. Safe default

Common environment variables include `CODEX_HOME`, `CODEX_BIN`, `CODEX_SESSION_PORT`, `CODEX_PLAN_PORT`, `CODEX_ARCH_PORT`, `CODEX_COLLECT_PORT`, and `CODEX_SUITE_LOCALE`.

> [!IMPORTANT]
> Do not put API keys, tokens, passwords, or other credentials in `config.toml`. Credential-like keys are rejected intentionally. Authentication remains owned by Codex CLI.

## 5. Add model rules for Plan and Arch

This is the most important integration step. Plan and Arch are directory-backed viewers: if the model writes a document somewhere else, the suite cannot discover it.

First resolve the real absolute roots. For the defaults:

```sh
printf 'Plan: %s\nArch: %s\n' "$HOME/.codex-cli/plans" "$HOME/.codex-cli/arch"
```

Then add rules like the following to the model's system or developer instructions. Replace every placeholder with the actual absolute value.

```text
# Codex Session Suite document integration

- Save implementation Plan documents under <ABSOLUTE_PLAN_ROOT>.
- Save Arch documents that explain current code behavior or existing project knowledge under <ABSOLUTE_ARCH_ROOT>.
- Use this document layout: <ROOT>/<PROJECT_KEY>/<YYYY-MM-DD>/<TITLE>.md.
- Build PROJECT_KEY from the project's absolute path by replacing each path separator with a hyphen. Keep the leading hyphen for an absolute Unix path.
- Create parent directories when needed.
- Write Markdown unless HTML is explicitly required.
- In conversation responses and generated documents, reference local source files with absolute paths.
- Add line and column positions when a precise VS Code jump is useful.
- Do not place credentials, personal conversation exports, or unrelated project data in Plan or Arch documents.
```

For example, a project at `<ABSOLUTE_PROJECT_PATH>` should produce a directory such as:

```text
<ABSOLUTE_PLAN_ROOT>/<ENCODED_PROJECT_PATH>/2026-09-10/Implementation-plan.md
<ABSOLUTE_ARCH_ROOT>/<ENCODED_PROJECT_PATH>/2026-09-10/Current-system-overview.md
```

### What belongs in each viewer

- **Plan** answers: What do we intend to change, in what order, with which checks and risks?
- **Arch** answers: How does the current system work, where is that behavior implemented, and what existing knowledge should be preserved?

Avoid storing a proposed implementation as Arch, or a current-state code explanation as Plan.

## 6. Start and validate the integration

Start all core services:

```sh
codex-session-suite start
```

To use a specific configuration without opening a browser automatically:

```sh
codex-session-suite start --config /absolute/path/to/config.toml --no-open
```

Default URLs:

| View | URL |
| --- | --- |
| Session | `http://127.0.0.1:3460` |
| Plan | `http://127.0.0.1:3458` |
| Arch | `http://127.0.0.1:3459` |
| Collect | `http://127.0.0.1:3461` |

Run this acceptance check:

1. Open Session and confirm that existing Codex projects and conversations appear.
2. Continue a test conversation and confirm that streamed messages and tools render.
3. Ask the model to create a small Plan using the installed model rule.
4. Open Plan and confirm that the document appears under the expected project and date.
5. Ask the model to document an existing module as Arch.
6. Open Arch and confirm that the document appears and its source links are usable.
7. Select conversation text, add an annotation, and collect it.
8. Open Collect and use the source link to return to the original conversation.
9. Click an absolute source reference and confirm the expected VS Code or default-application behavior.

Stop the suite with `Ctrl+C`; the launcher stops its child services together.

## 7. Recommended daily workflow

1. Use **Session** to find or continue a Codex conversation.
2. Switch between **Default** and **Plan** mode as the task requires.
3. Ask the model to save formal plans and current-system explanations to the configured roots.
4. Review the result in **Plan** or **Arch**, and use annotations for follow-up points.
5. Collect reusable excerpts into **Collect**.
6. Open **Difgraph** or **Difit** from Session when reviewing Git history or changes.
7. Archive completed conversations; use bulk deletion only for sessions that should be permanently removed.

## 8. Compatibility and debugging

The current integration primarily covers conversation streams, tool streams, compaction, and common session operations. Additional Codex server `item` events still need adapters and visualizations.

The official Codex API and server protocol may change. If a personal deployment stops working after a Codex upgrade:

1. Run `codex --version` and `codex-session-suite doctor`.
2. Confirm that `codex.bin`, `codex.home`, and `expected_version` describe the executable actually in use.
3. Start the suite in a terminal and retain the visible error output.
4. Reproduce the problem with the smallest safe conversation or fixture possible.
5. Use an AI coding assistant to compare the current Codex event or response shape with the adapters under `apps/session/src` when a local compatibility fix is required.
6. Report the bug in [GitHub Issues](https://github.com/YWByte/codex-session-suite/issues), including the Codex version, operating system, logs with secrets removed, and reproduction steps.

Do not paste access tokens, credentials, private conversation content, or proprietary source code into an issue.

## 9. Troubleshooting

### `Codex CLI was not found on PATH`

Set an absolute executable path in TOML:

```toml
[codex]
bin = "/absolute/path/to/codex"
```

Or export `CODEX_BIN` before starting the suite.

### Codex version mismatch

Install the expected Codex CLI version first. Change `expected_version` only when you have verified that the target protocol is compatible or have made the necessary adapter changes.

### A port is unavailable

Choose four unique free ports under `[services]`, then rerun `doctor` with the same configuration.

### Plan or Arch is empty

Check all of the following:

- the model rule contains the effective absolute root;
- the file is under `<root>/<project-key>/<date>/`;
- the document extension is `.md` or `.html`;
- the suite was started with the expected TOML file;
- the suite process can read the document and its parent directories.

### Absolute paths do not open

Full local path opening is currently a macOS desktop integration. Source references intended for VS Code should point to regular files and may include a line and column.

### A collection cannot return to its source

The original session must still exist. Deleting a conversation permanently can leave a collection without a navigable source.

## 10. Security checklist

- Keep services on loopback; do not place them behind a public reverse proxy.
- Keep credentials in the Codex-owned authentication mechanism, not suite TOML files.
- Review Plan, Arch, and Collect data before sharing or backing it up externally.
- Remove secrets and private content from issue reports.
- Back up configured data paths before migration or deletion.
