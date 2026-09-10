#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { chromium } from "playwright";
import { PNG } from "pngjs";

const VIEWERS = {
  claude: process.env.CLAUDE_VIEWER_URL || "http://127.0.0.1:3457",
  codex: process.env.CODEX_VIEWER_URL || "http://127.0.0.1:3460",
};
const VIEWPORT = { width: 1600, height: 1100 };
const ARTIFACT_DIR = process.env.SHELL_ARTIFACT_DIR || "/tmp/codex-session-shell-e2e";
const MAX_SHELL_PIXELS = Number(process.env.SHELL_MAX_DIFFERENT_PIXELS || 15_000);
const MAX_COMPOSER_PIXELS = Number(process.env.COMPOSER_MAX_DIFFERENT_PIXELS || 500);

const SELECTORS = {
  claude: {
    search: "#session-search-input",
    sidebarBody: "#sidebar-body",
    title: "#conversation-title",
    project: "#conversation-project",
    meta: "#conversation-kind",
    status: "#conversation-state",
    chat: "#chat",
    connection: "header .connection",
  },
  codex: {
    search: "#session-search",
    sidebarBody: "#sidebar-content",
    title: "#thread-title",
    project: "#thread-project",
    meta: "#thread-meta",
    status: "#thread-status",
    chat: "#timeline",
    connection: "#connection",
  },
};

const FIXTURE_STYLE = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
  html { overflow: hidden !important; }
  .request-dock, .toast-region, .mobile-nav-toggle, .scrim,
  .img-paste-tray, .send-status, .working-indicator { display: none !important; }
  .conversation-head { opacity: 1 !important; transform: translateY(0) !important; pointer-events: none !important; }
  .chat-area { overflow: hidden !important; }
  .tool-group-content, #fixture-shell .tool-content { display: block !important; }
  #fixture-shell .tool-summary, #fixture-shell .tool-group-summary { cursor: default !important; }
`;

const FIXTURE_HTML = `
  <div id="fixture-shell">
    <section class="turn">
      <article class="msg user"><div class="msg-inner">
        <div class="user-question-card">
          <div class="msg-role">Question · You</div>
          <div class="user-bubble"><div class="msg-body">A fixed user message for shell comparison.</div></div>
        </div>
      </div></article>
      <article class="msg assistant"><div class="msg-inner">
        <div class="msg-role"><span class="role-icon"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="22" fill="#1B1B18"/><circle cx="32" cy="32" r="6" fill="#FFFFFF"/></svg></span>Truth</div>
        <div class="msg-body"><p>A fixed assistant response keeps the transcript geometry stable.</p></div>
        <div class="tool-block tool-done open"><div class="tool-summary"><span class="chevron">▶</span><span class="tool-state-dot"></span><span class="tool-name-inline">命令执行</span><span class="tool-state-label">完成</span><span class="tool-preview">$ git status --short</span></div><div class="tool-content"><pre>$ git status --short\nexit: 0</pre></div></div>
      </div></article>
    </section>
    <section class="turn"><div class="msg tool_use"><div class="msg-inner">
      <div class="tool-group tool-group-done open"><button class="tool-group-summary" type="button" aria-expanded="true"><span class="chevron">▶</span><span class="tool-group-icon"><i></i><i></i><i></i></span><span class="tool-group-title">2 个工具调用</span><span class="tool-group-counts"><span class="tool-group-count done">成功 2</span></span><span class="tool-group-types">文件修改 / 命令执行</span></button><div class="tool-group-content"><div class="tool-block tool-done open"><div class="tool-summary"><span class="chevron">▶</span><span class="tool-state-dot"></span><span class="tool-name-inline">文件修改</span><span class="tool-state-label">完成</span></div><div class="tool-content"><pre>2 files changed</pre></div></div></div></div>
    </div></div></section>
  </div>`;

function near(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}±${tolerance}, received ${actual}`);
}

async function selectConversation(page, name) {
  const composer = page.locator("#note-dock .ann-note-section");
  if (await composer.isVisible().catch(() => false)) {
    await page.waitForTimeout(300);
    return;
  }
  await page.waitForSelector(".active-item, .session-item", { state: "attached" });
  if (name === "claude") {
    const active = page.locator(".active-item:visible").first();
    if (await active.count()) await active.click();
    else {
      const collapsed = page.locator(".project-item.collapsed .project-toggle").first();
      if (await collapsed.count()) await collapsed.click();
      await page.locator(".session-item:visible").first().click();
    }
  } else {
    let candidates = page.locator(".active-item:not(.subagent-item):visible .session-open, .session-item:not(.subagent-item):not(.archived-item):visible .session-open");
    if (!await candidates.count()) {
      const collapsed = page.locator(".project-item.collapsed .project-toggle");
      for (let index = 0; index < await collapsed.count(); index++) await collapsed.nth(index).click();
      candidates = page.locator(".active-item:not(.subagent-item):visible .session-open, .session-item:not(.subagent-item):not(.archived-item):visible .session-open");
    }
    for (let index = 0; index < await candidates.count(); index++) {
      await candidates.nth(index).click();
      await page.waitForTimeout(300);
      if (await composer.isVisible().catch(() => false)) break;
      const activate = page.locator("#activate-thread");
      if (await activate.isVisible().catch(() => false)) {
        await activate.click({ timeout: 2_000 }).catch(() => {});
        await page.waitForTimeout(300);
      }
      if (await composer.isVisible().catch(() => false)) break;
    }
  }
  await composer.waitFor({ state: "visible" });
  await page.waitForTimeout(300);
}

async function computedSnapshot(page, selector) {
  return page.locator(selector).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      rect: [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 100) / 100),
      display: style.display,
      position: style.position,
      padding: style.padding,
      border: style.border,
      borderRadius: style.borderRadius,
      background: style.background,
      color: style.color,
      font: style.font,
      lineHeight: style.lineHeight,
      minHeight: style.minHeight,
      maxHeight: style.maxHeight,
    };
  });
}

async function assertNativeShell(page, name) {
  const selectors = SELECTORS[name];
  const shellSelectors = ["header", "#sidebar", "#resizer", ".chat-column", "#conversation-head", selectors.chat, "#git-rail", "#note-dock", selectors.search, ".ann-note-section", ".ann-note-editor", ".ann-note-send"];
  if (name === "codex") shellSelectors.push("#conversation-rail");
  for (const selector of shellSelectors) {
    assert.equal(await page.locator(selector).count(), 1, `${name}: expected one ${selector}`);
  }
  const geometry = await page.evaluate((chatSelector) => {
    const rect = (selector) => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    return {
      header: rect("header"), sidebar: rect("#sidebar"), resizer: rect("#resizer"),
      chat: rect(".chat-column"), head: rect("#conversation-head"), dock: rect("#note-dock"),
      headPosition: getComputedStyle(document.querySelector("#conversation-head")).position,
      conversationRailPosition: document.querySelector("#conversation-rail") ? getComputedStyle(document.querySelector("#conversation-rail")).position : null,
      railPosition: getComputedStyle(document.querySelector("#git-rail")).position,
      chatAria: document.querySelector(chatSelector).getAttribute("aria-label"),
    };
  }, selectors.chat);
  near(geometry.header.height, 62, 1, `${name}: top bar height`);
  near(geometry.sidebar.y, 62, 1, `${name}: sidebar top`);
  near(geometry.sidebar.width, 336, 1, `${name}: sidebar width`);
  near(geometry.resizer.width, 5, .1, `${name}: resizer width`);
  near(geometry.chat.x, 336, 1, `${name}: chat start`);
  near(geometry.head.height, 76, 1, `${name}: conversation head height`);
  assert.equal(geometry.headPosition, "absolute");
  if (name === "codex") assert.equal(geometry.conversationRailPosition, "fixed");
  assert.equal(geometry.railPosition, "fixed");
}

async function assertRealComposerMatches(claude, codex) {
  const selectors = [
    "#note-dock .ann-preview",
    "#note-dock .ann-note-section",
    "#note-dock .ann-note-section .ann-preview-head",
    "#note-dock .ann-note-editor",
    "#note-dock .model-badge",
    "#note-dock .ann-note-copy",
    "#note-dock .ann-note-clear",
    "#note-dock .ann-note-send",
  ];
  for (const selector of selectors) {
    assert.deepEqual(await computedSnapshot(codex, selector), await computedSnapshot(claude, selector), `${selector} must match Claude Viewer`);
  }
  assert.equal(await codex.locator(".ann-note-editor").getAttribute("placeholder"), "在这里写笔记，Enter 发送，Shift+Enter 换行");
  assert.equal(await codex.locator("#working-indicator > #interrupt").count(), 1, "interrupt button must stay inside the working indicator");
  await codex.locator("#working-indicator").evaluate((node) => { node.hidden = false; });
  await codex.locator("#interrupt").evaluate((node) => { node.hidden = false; });
  assert.equal(await codex.locator("#interrupt").isVisible(), true, "interrupt button must be visible for an active turn");
  await codex.locator("#working-indicator").evaluate((node) => { node.hidden = true; });
  assert.equal(await codex.locator("#interrupt").isVisible(), false, "interrupt button must hide with the working indicator");
}

async function normalizeLiveComposer(page) {
  await page.evaluate(() => {
    const editor = document.querySelector("#note-dock .ann-note-editor");
    editor.disabled = false;
    editor.value = "Fixed input text";
    editor.placeholder = "在这里写笔记，Enter 发送，Shift+Enter 换行";
    document.querySelectorAll("#note-dock .ann-note-copy, #note-dock .ann-note-clear, #note-dock .ann-note-send").forEach((node) => { node.disabled = false; });
    const model = document.querySelector("#note-dock .model-name");
    if (model) model.textContent = "SESSION";
    document.querySelectorAll("#note-dock .model-token").forEach((node) => {
      node.textContent = "";
      node.classList.remove("has-data");
    });
    document.querySelectorAll("#note-dock .working-indicator, #note-dock .img-paste-tray, #note-dock .send-status").forEach((node) => { node.hidden = true; });
  });
}

async function installFixture(page, name) {
  const selectors = SELECTORS[name];
  await page.addStyleTag({ content: FIXTURE_STYLE });
  await normalizeLiveComposer(page);
  await page.evaluate(({ selectors, fixtureHtml }) => {
    document.body.classList.add("screen-center");
    document.querySelector("header h1").textContent = "Session Viewer";
    document.querySelector("header .brand-kicker").textContent = "LOCAL WORKSPACE";
    document.querySelector(".topbar-project").textContent = "Fixed workspace";
    const connection = document.querySelector(selectors.connection);
    connection.className = "connection ready";
    connection.innerHTML = '<span class="connection-dot"></span><span>Ready</span>';
    document.querySelector(selectors.sidebarBody).innerHTML = `
      <section class="active-section"><div class="active-header"><span class="active-dot"></span><span>活跃的对话</span></div><button class="active-item active" type="button"><span class="status-dot idle"></span><span class="active-title">Fixed active session</span><span class="active-meta">workspace</span></button></section>
      <div class="projects-label"><span>历史项目</span><span>1 project</span></div>
      <section class="project-item"><div class="project-header"><span class="chevron">▼</span><span class="name">/fixed/workspace</span><span class="badge">1</span></div><div class="session-list"><button class="session-item active" type="button"><span class="time">09/06 12:00</span><span class="session-title">Fixed history session</span></button></div></section>`;
    document.querySelector(selectors.title).textContent = "Fixed conversation title";
    document.querySelector(selectors.project).textContent = "/fixed/workspace";
    document.querySelector(selectors.meta).textContent = "Session · 8,192 tokens";
    const status = document.querySelector(selectors.status);
    status.className = "conversation-state";
    status.innerHTML = '<span class="status-dot idle"></span><span class="label">空闲</span>';
    document.querySelector(selectors.chat).innerHTML = fixtureHtml;
    const rail = document.querySelector("#git-rail");
    rail.hidden = false;
    for (const id of ["git-current-branch", "git-base-branch", "git-base-source"]) {
      const element = document.querySelector(`#${id}`);
      if (element) element.textContent = id === "git-current-branch" ? "feature/fixed" : "main";
    }
    for (const id of ["git-staged-count", "git-committed-count"]) {
      const element = document.querySelector(`#${id}`);
      if (element) { element.hidden = false; element.textContent = "2"; }
    }
  }, { selectors, fixtureHtml: FIXTURE_HTML });
  await page.waitForTimeout(100);
}

async function readPng(file) {
  return PNG.sync.read(await readFile(file));
}

async function compareImages(leftFile, rightFile, diffFile, maxPixels, label) {
  const [left, right] = await Promise.all([readPng(leftFile), readPng(rightFile)]);
  assert.equal(right.width, left.width, `${label}: width`);
  assert.equal(right.height, left.height, `${label}: height`);
  const diff = new PNG({ width: left.width, height: left.height });
  const pixels = pixelmatch(left.data, right.data, diff.data, left.width, left.height, { threshold: .1, includeAA: false });
  await writeFile(diffFile, PNG.sync.write(diff));
  assert.ok(pixels <= maxPixels, `${label}: ${pixels} different pixels exceeds ${maxPixels}; inspect ${diffFile}`);
  return pixels;
}

async function openViewer(browser, name, url, errors) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce" });
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") errors.push(`${name}: ${message.text()}`); });
  await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
  await selectConversation(page, name);
  await assertNativeShell(page, name);
  return page;
}

await mkdir(ARTIFACT_DIR, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const [claude, codex] = await Promise.all([
    openViewer(browser, "claude", VIEWERS.claude, errors),
    openViewer(browser, "codex", VIEWERS.codex, errors),
  ]);
  await assertRealComposerMatches(claude, codex);

  await Promise.all([normalizeLiveComposer(claude), normalizeLiveComposer(codex)]);
  const claudeComposer = path.join(ARTIFACT_DIR, "claude-composer.png");
  const codexComposer = path.join(ARTIFACT_DIR, "codex-composer.png");
  await Promise.all([
    claude.locator("#note-dock .ann-preview").screenshot({ path: claudeComposer, animations: "disabled" }),
    codex.locator("#note-dock .ann-preview").screenshot({ path: codexComposer, animations: "disabled" }),
  ]);
  const composerPixels = await compareImages(claudeComposer, codexComposer, path.join(ARTIFACT_DIR, "composer-diff.png"), MAX_COMPOSER_PIXELS, "real composer");

  await Promise.all([installFixture(claude, "claude"), installFixture(codex, "codex")]);
  const claudeShell = path.join(ARTIFACT_DIR, "claude-shell.png");
  const codexShell = path.join(ARTIFACT_DIR, "codex-shell.png");
  await Promise.all([
    claude.screenshot({ path: claudeShell, animations: "disabled" }),
    codex.screenshot({ path: codexShell, animations: "disabled" }),
  ]);
  const shellPixels = await compareImages(claudeShell, codexShell, path.join(ARTIFACT_DIR, "shell-diff.png"), MAX_SHELL_PIXELS, "full shell");
  assert.deepEqual(errors, []);
  console.log(`Shell acceptance passed: composer ${composerPixels} pixels, full shell ${shellPixels} pixels. Artifacts: ${ARTIFACT_DIR}`);
} finally {
  await browser.close();
}
