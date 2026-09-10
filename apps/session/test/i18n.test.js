import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { localeMessages, initI18nFactory } = await import("../public/app/i18n.js");


async function serverAppErrorCodes() {
  const codes = new Set();
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile() && entry.name.endsWith(".js")) {
        const source = await readFile(filePath, "utf8");
        for (const match of source.matchAll(/new\s+[A-Za-z0-9_]*Error\s*\(\s*(?:(?:[^()"']|"[^"]*"|'[^']*'|\([^()]*\))*?)\s*,\s*"([a-z0-9_]+)"/g)) {
          codes.add(match[1]);
        }
      }
    }
  }
  await visit(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src"));
  return [...codes].sort();
}

const environments = [];

function browserEnvironment({ configLocale = "auto", languages = ["en"], cookies = "", search = "" } = {}) {
  const environment = {
    __CODEX_SUITE_CONFIG__: { locale: configLocale },

        document: Object.defineProperties({ documentElement: {} }, {
      cookie: { value: cookies, writable: true, configurable: true },
    }),
    navigator: { languages, language: languages[0] },
    window: { location: { search } },
  };
  environments.push(environment);
  return environment;
}

test("every server AppError code has a client translation in both locales", async () => {
  const codes = await serverAppErrorCodes();
  assert.ok(codes.length > 50);
  for (const code of codes) {
    assert.ok(Object.hasOwn(localeMessages.en, `error.${code}`), `missing English error.${code}`);
    assert.ok(Object.hasOwn(localeMessages["zh-CN"], `error.${code}`), `missing Chinese error.${code}`);
  }
});

test("translation resources provide the same stable key set in both locales", () => {
  assert.deepEqual(Object.keys(localeMessages["zh-CN"]).sort(), Object.keys(localeMessages.en).sort());
});

test("locale resolution follows explicit URL, shared cookie, server locale, and browser order", () => {
  browserEnvironment({ configLocale: "en", languages: ["en-US"], search: "?locale=zh-CN" });
  assert.equal(initI18nFactory(environments.at(-1)).getLocale(), "zh-CN");

  browserEnvironment({ configLocale: "en", languages: ["en-US"], cookies: "codex_suite_locale=zh-CN" });
  assert.equal(initI18nFactory(environments.at(-1)).getLocale(), "zh-CN");

  browserEnvironment({ configLocale: "zh-CN", languages: ["en-US"] });
  assert.equal(initI18nFactory(environments.at(-1)).getLocale(), "zh-CN");

  browserEnvironment({ configLocale: "auto", languages: ["zh-Hans", "en-US"] });
  assert.equal(initI18nFactory(environments.at(-1)).getLocale(), "zh-CN");

  browserEnvironment({ configLocale: "auto", languages: ["fr-FR", "en-US"] });
  assert.equal(initI18nFactory(environments.at(-1)).getLocale(), "en");
});

test("cookie language switching persists and missing keys fall back to English", () => {
  browserEnvironment({ configLocale: "auto", languages: ["en-US"] });
  const i18n = initI18nFactory(environments.at(-1));
  assert.equal(i18n.t("common.cancel"), "Cancel");
  i18n.setLocale("zh-CN");
  assert.equal(i18n.t("common.cancel"), "取消");
  assert.match(environments.at(-1).document.cookie, /codex_suite_locale=zh-CN/);
  const originalZh = localeMessages["zh-CN"]["error.not_found"];
  delete localeMessages["zh-CN"]["error.not_found"];
  try {
    assert.equal(i18n.t("error.not_found"), "Resource or endpoint not found");
  } finally {
    localeMessages["zh-CN"]["error.not_found"] = originalZh;
  }
  assert.equal(i18n.t("errors.modelsLoadFailed", { message: "boom" }), "模型目录加载失败：boom");

  assert.equal(i18n.t("missing.translation.key"), "missing.translation.key");
  assert.equal(i18n.isTranslatedKey("error.not_found"), true);
  assert.equal(i18n.isTranslatedKey("error.unknown_code"), false);
});
