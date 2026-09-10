#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadSuiteConfig } from "../src/config.js";
import { runDoctor } from "../src/doctor.js";
import { localizeError, normalizeLocale, systemLocale, translator } from "../src/i18n.js";
import { openBrowser, startSuite } from "../src/suite.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      config: { type: "string" },
      locale: { type: "string" },
      open: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
    strict: true,
    allowNegative: true,
  });
  const command = positionals[0] || "start";
  if (positionals.length > 1 || !["start", "doctor"].includes(command)) throw new Error(`Unknown command: ${positionals.join(" ")}`);
  const requestedLocale = values.locale || systemLocale();
  const t = translator(normalizeLocale(requestedLocale));
  if (values.help) { console.log(t("usage")); return; }
  if (values.version) { console.log(manifest.version); return; }

  const config = await loadSuiteConfig({
    configPath: values.config,
    cli: { locale: values.locale, openBrowser: values.open },
  });
  const localized = translator(config.locale === "auto" ? systemLocale() : config.locale);
  const diagnosis = await runDoctor(config);
  if (command === "doctor") {
    console.log(localized("configOk"));
    console.log(localized("codexOk", diagnosis.codex));
    console.log(localized("doctorOk"));
    return;
  }

  console.log(localized("starting"));
  let stopSuite = async () => {};
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log(localized("stopping"));
    await stopSuite();
  };
  process.once("SIGINT", () => void stop().then(() => process.exit(0)));
  process.once("SIGTERM", () => void stop().then(() => process.exit(0)));
  const suite = await startSuite(config, { registerStop: (handler) => { stopSuite = handler; } });
  console.log(localized("started", { url: suite.url }));
  if (config.openBrowser) openBrowser(suite.url);
  await suite.done;
}

main().catch((error) => {
  const t = translator(systemLocale());
  console.error(t("error", { message: localizeError(error, t) }));
  process.exitCode = 1;
});
