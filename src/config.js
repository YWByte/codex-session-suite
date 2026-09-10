import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { SuiteError } from "./errors.js";

const SCHEMA = Object.freeze({
  services: new Set(["session_port", "plan_port", "arch_port", "collect_port"]),
  ui: new Set(["locale", "open_browser"]),
  codex: new Set(["bin", "home", "expected_version"]),
  timeouts: new Set(["rpc_ms", "initialize_ms", "folder_picker_ms", "file_picker_ms"]),
  limits: new Set(["thread_pages"]),
  data: new Set(["plans_dir", "arch_dir", "collect_file"]),
});
const SECRET_PATTERN = /(token|secret|password|api[_-]?key|credential|auth)/i;

function expandPath(value, baseDirectory) {
  if (!value) return "";
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return path.resolve(baseDirectory, value);
}

function integer(value, fallback, name, { min = 1, max = 65_535 } = {}) {
  if (value == null || value === "") return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new SuiteError("invalid_integer", `${name} must be an integer from ${min} to ${max}`, { name, min, max });
  }
  return value;
}

function boolean(value, fallback, name) {
  if (value == null) return fallback;
  if (typeof value !== "boolean") throw new SuiteError("invalid_boolean", `${name} must be a boolean`, { name });
  return value;
}

function validateShape(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) throw new SuiteError("config_root", "TOML root must be a table");
  for (const [section, value] of Object.entries(document)) {
    if (SECRET_PATTERN.test(section)) throw new SuiteError("credential_key", `Credential-like configuration key is not allowed: ${section}`, { key: section });
    if (!SCHEMA[section]) throw new SuiteError("unknown_section", `Unknown configuration section: ${section}`, { section });
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new SuiteError("invalid_section", `${section} must be a table`, { section });
    for (const key of Object.keys(value)) {
      if (SECRET_PATTERN.test(key)) throw new SuiteError("credential_key", `Credential-like configuration key is not allowed: ${section}.${key}`, { key: `${section}.${key}` });
      if (!SCHEMA[section].has(key)) throw new SuiteError("unknown_key", `Unknown configuration key: ${section}.${key}`, { key: `${section}.${key}` });
    }
  }
}

async function fileExists(filePath) {
  try { await access(filePath, constants.R_OK); return true; } catch { return false; }
}

export async function findExecutable(name, envPath = process.env.PATH || "") {
  for (const directory of envPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    try { await access(candidate, constants.X_OK); return candidate; } catch {}
  }
  return null;
}

export async function loadSuiteConfig({ configPath, cwd = process.cwd(), env = process.env, cli = {} } = {}) {
  const selectedPath = configPath ? path.resolve(cwd, configPath) : path.join(cwd, "config.toml");
  let document = {};
  if (await fileExists(selectedPath)) {
    document = parse(await readFile(selectedPath, "utf8"));
    validateShape(document);
  } else if (configPath) {
    throw new SuiteError("config_not_found", `Configuration file not found: ${selectedPath}`, { path: selectedPath });
  }

  const baseDirectory = path.dirname(selectedPath);
  const services = document.services || {};
  const codex = document.codex || {};
  const ui = document.ui || {};
  const timeouts = document.timeouts || {};
  const limits = document.limits || {};
  const data = document.data || {};
  const ports = Object.freeze({
    session: integer(Number(env.CODEX_SESSION_PORT || services.session_port || 3460), 3460, "services.session_port"),
    plan: integer(Number(env.CODEX_PLAN_PORT || services.plan_port || 3458), 3458, "services.plan_port"),
    arch: integer(Number(env.CODEX_ARCH_PORT || services.arch_port || 3459), 3459, "services.arch_port"),
    collect: integer(Number(env.CODEX_COLLECT_PORT || services.collect_port || 3461), 3461, "services.collect_port"),
  });
  if (new Set(Object.values(ports)).size !== Object.keys(ports).length) throw new SuiteError("duplicate_ports", "Service ports must be unique");

  const codexHome = expandPath(env.CODEX_HOME || codex.home || path.join(os.homedir(), ".codex-cli"), baseDirectory);
  const configuredCodexBin = env.CODEX_BIN || codex.bin || "";
  const codexBin = configuredCodexBin ? expandPath(configuredCodexBin, baseDirectory) : await findExecutable("codex", env.PATH);
  const locale = cli.locale || env.CODEX_SUITE_LOCALE || ui.locale || "auto";
  if (!["auto", "en", "zh-CN"].includes(locale)) throw new SuiteError("invalid_locale", "ui.locale must be auto, en, or zh-CN");

  return Object.freeze({
    configPath: await fileExists(selectedPath) ? selectedPath : null,
    host: "127.0.0.1",
    ports,
    origins: Object.freeze(Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, `http://127.0.0.1:${port}`]))),
    locale,
    openBrowser: cli.openBrowser ?? boolean(ui.open_browser, true, "ui.open_browser"),
    codexBin,
    codexHome,
    expectedCodexVersion: String(codex.expected_version || "0.153.2"),
    timeouts: Object.freeze({
      rpcMs: integer(Number(env.CODEX_RPC_TIMEOUT_MS || timeouts.rpc_ms || 15_000), 15_000, "timeouts.rpc_ms", { max: 600_000 }),
      initializeMs: integer(Number(env.CODEX_INITIALIZE_TIMEOUT_MS || timeouts.initialize_ms || 20_000), 20_000, "timeouts.initialize_ms", { max: 600_000 }),
      folderPickerMs: integer(Number(env.CODEX_FOLDER_PICKER_TIMEOUT_MS || timeouts.folder_picker_ms || 120_000), 120_000, "timeouts.folder_picker_ms", { max: 600_000 }),
      filePickerMs: integer(Number(timeouts.file_picker_ms || 120_000), 120_000, "timeouts.file_picker_ms", { max: 600_000 }),
    }),
    maxThreadPages: integer(Number(env.CODEX_MAX_THREAD_PAGES || limits.thread_pages || 1_000), 1_000, "limits.thread_pages", { max: 100_000 }),
    data: Object.freeze({
      plansDir: expandPath(data.plans_dir || path.join(codexHome, "plans"), baseDirectory),
      archDir: expandPath(data.arch_dir || path.join(codexHome, "arch"), baseDirectory),
      collectFile: expandPath(data.collect_file || path.join(codexHome, "collections", "collections.json"), baseDirectory),
    }),
  });
}
