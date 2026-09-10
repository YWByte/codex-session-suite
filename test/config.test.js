import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadSuiteConfig } from "../src/config.js";
import { normalizeLocale, translator } from "../src/i18n.js";

const emptyEnv = { HOME: os.homedir(), PATH: process.env.PATH };

test("loads safe defaults and resolves Codex from PATH", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-suite-config-"));
  const config = await loadSuiteConfig({ cwd: directory, env: emptyEnv });
  assert.deepEqual(config.ports, { session: 3460, plan: 3458, arch: 3459, collect: 3461 });
  assert.equal(config.host, "127.0.0.1");
  assert.ok(config.codexBin?.endsWith("codex"));
  assert.equal(config.data.plansDir, path.join(os.homedir(), ".codex-cli", "plans"));
  assert.equal(config.data.collectFile, path.join(os.homedir(), ".codex-cli", "collections", "collections.json"));
});

test("applies CLI, environment, and TOML precedence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-suite-config-"));
  const configPath = path.join(directory, "suite.toml");
  await writeFile(configPath, '[services]\nsession_port = 4100\nplan_port = 4101\narch_port = 4102\ncollect_port = 4103\n[ui]\nlocale = "en"\n[data]\nplans_dir = "./plans"\n');
  const config = await loadSuiteConfig({ configPath, env: { ...emptyEnv, CODEX_SESSION_PORT: "4200" }, cli: { locale: "zh-CN", openBrowser: false } });
  assert.equal(config.ports.session, 4200);
  assert.equal(config.ports.plan, 4101);
  assert.equal(config.locale, "zh-CN");
  assert.equal(config.openBrowser, false);
  assert.equal(config.data.plansDir, path.join(directory, "plans"));
});

test("rejects unknown, credential-like, duplicate-port, and invalid-locale settings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-suite-config-"));
  for (const [name, body, pattern] of [
    ["unknown.toml", "[mystery]\nvalue = 1\n", /Unknown configuration section/],
    ["secret.toml", "[codex]\napi_key = 'nope'\n", /Credential-like/],
    ["ports.toml", "[services]\nsession_port = 4000\nplan_port = 4000\n", /must be unique/],
    ["locale.toml", "[ui]\nlocale = 'fr'\n", /ui.locale/],
  ]) {
    const file = path.join(directory, name);
    await writeFile(file, body);
    await assert.rejects(loadSuiteConfig({ configPath: file, env: emptyEnv }), pattern);
  }
});

test("normalizes supported locales and falls back to English", () => {
  assert.equal(normalizeLocale("zh-Hans"), "zh-CN");
  assert.equal(normalizeLocale("zh_Hans_CN.UTF-8"), "zh-CN");
  assert.equal(normalizeLocale("zh-TW"), "en");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("fr"), "en");
  assert.equal(translator("zh-CN")("doctorOk"), "所有必需检查均已通过。");
  assert.equal(translator("fr")("doctorOk"), "All required checks passed.");
});
