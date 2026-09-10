import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { createApp as createPlanApp } from "../apps/plan/server.js";
import { createApp as createArchApp } from "../apps/arch/server.js";

async function start(app) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test("Plan and Arch viewers load local assets and switch languages", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-doc-viewers-"));
  const planDirectory = path.join(directory, "plans");
  const archDirectory = path.join(directory, "arch");
  for (const target of [planDirectory, archDirectory]) {
    await mkdir(path.join(target, "project", "2026-09-10"), { recursive: true });
    await writeFile(path.join(target, "project", "2026-09-10", "Document.md"), "# Document\n");
  }
  const plan = await start(createPlanApp({ plansDir: planDirectory }));
  const arch = await start(createArchApp({ archDir: archDirectory }));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const fixture of [plan, arch]) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${fixture.origin}/?locale=zh-CN`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("#language-select").inputValue(), "zh-CN");
      await page.locator("#language-select").selectOption("en");
      assert.equal(await page.locator("#language-select").inputValue(), "en");
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    await Promise.all([plan, arch].map(({ server }) => new Promise((resolve) => server.close(resolve))));
    await rm(directory, { recursive: true, force: true });
  }
});
