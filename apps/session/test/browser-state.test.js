import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { chromium } from "playwright";
import { createApp } from "../src/http/app.js";
import { EventBus } from "../src/http/event-bus.js";
import { NavigationService } from "../src/services/navigation.js";
import { RequestRegistry } from "../src/services/request-registry.js";
import { SessionService } from "../src/services/session-service.js";

async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

class BrowserFixtureClient extends EventEmitter {
  constructor() {
    super();
    this.threads = new Map([
      ["thread-a", { id: "thread-a", cwd: "/workspace/project", name: "Alpha", model: "test-model-a", status: { type: "idle" }, canAcceptDirectInput: true, updatedAt: 20 }],
      ["thread-child", { id: "thread-child", cwd: "/workspace/project", name: "Research", model: "test-model-a", status: { type: "idle" }, parentThreadId: "thread-a", canAcceptDirectInput: false, agentRole: "Explore", updatedAt: 15 }],
      ["thread-old-child", { id: "thread-old-child", cwd: "/workspace/project", name: "Historical research", model: "test-model-a", status: { type: "notLoaded" }, parentThreadId: "thread-a", canAcceptDirectInput: false, agentRole: "Explore", updatedAt: 14 }],
      ["thread-c", { id: "thread-c", cwd: "/workspace/project", name: "Gamma", model: "test-model-c", status: { type: "notLoaded" }, canAcceptDirectInput: null, updatedAt: 12 }],
      ["thread-b", { id: "thread-b", cwd: "/workspace/project", name: "Beta", model: "test-model-b", status: { type: "idle" }, canAcceptDirectInput: true, updatedAt: 10 }],
    ]);
    this.archived = new Map();
    this.threadListCalls = 0;
    this.threadReadCalls = 0;
    this.turnListCalls = 0;
    this.itemListCalls = 0;
    this.createdThreads = 0;
    this.turnStarts = [];
    this.compactStarts = [];
    this.restartCalls = 0;
    this.interrupts = [];
    this.responses = [];
    this.itemsByTurn = new Map();
    this.failNextTurn = null;
    this.threadLoadGate = null;
    this.staleUnsubscribeThreadIds = new Set();
  }

  health() {
    return { state: "ready", ready: true, expectedVersion: "0.153.2", actualVersion: "0.153.2", compatible: true, error: null };
  }

  async restart() {
    this.restartCalls += 1;
    const thread = this.threads.get("thread-a");
    thread.status = { type: "notLoaded" };
    thread.canAcceptDirectInput = null;
    return this.health();
  }

  async request(method, params) {
    if (this.threadLoadGate?.threadId === params.threadId && ["thread/read", "thread/turns/list"].includes(method)) {
      await this.threadLoadGate.promise;
    }
    if (method === "model/list") return {
      data: [
        {
          id: "test-model-a",
          model: "test-model-a",
          displayName: "Test Model A",
          description: "Primary test model",
          hidden: false,
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
        {
          id: "test-model-b",
          model: "test-model-b",
          displayName: "Test Model B",
          description: "Secondary test model",
          hidden: false,
          supportedReasoningEfforts: ["low", "high"].map((reasoningEffort) => ({ reasoningEffort, description: reasoningEffort })),
          defaultReasoningEffort: "low",
          isDefault: false,
        },
        {
          id: "test-model-c",
          model: "test-model-c",
          displayName: "Test Model C",
          description: "Historical test model",
          hidden: false,
          supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "medium" }],
          defaultReasoningEffort: "medium",
          isDefault: false,
        },
        {
          id: "test-model-created",
          model: "test-model-created",
          displayName: "Created Model",
          description: "New thread model",
          hidden: false,
          supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "medium" }],
          defaultReasoningEffort: "medium",
          isDefault: false,
        },
      ],
      nextCursor: null,
    };
    if (method === "thread/list") {
      this.threadListCalls += 1;
      const threads = [...(params.archived ? this.archived : this.threads).values()]
        .filter((thread) => !thread.id.startsWith("thread-created-") || thread.materialized)
        .map((thread) => ({
          ...thread,
          ...(thread.id === "thread-c" ? { canAcceptDirectInput: null } : {}),
        }));
      return { data: threads, nextCursor: null };
    }
    if (method === "thread/start") {
      const id = `thread-created-${++this.createdThreads}`;
      const thread = { id, cwd: params.cwd, name: null, model: "test-model-created", status: { type: "idle" }, canAcceptDirectInput: true, updatedAt: 30, materialized: false };
      this.threads.set(id, thread);
      return { thread };
    }
    if (method === "thread/read") {
      this.threadReadCalls += 1;
      return { thread: this.threads.get(params.threadId) || this.archived.get(params.threadId) };
    }
    if (method === "thread/turns/list") {
      this.turnListCalls += 1;
      if (params.threadId.startsWith("thread-created-")) throw new Error("new thread history is not materialized yet");
      return { data: [], nextCursor: null };
    }
    if (method === "thread/items/list") {
      this.itemListCalls += 1;
      return { data: this.itemsByTurn.get(params.turnId) || [], nextCursor: null };
    }
    if (method === "thread/resume") {
      const thread = this.threads.get(params.threadId);
      if (thread) {
        thread.status = { type: "idle" };
        thread.canAcceptDirectInput = true;
      }
      return {
        thread,
        approvalPolicy: "never",
        sandbox: { type: "dangerFullAccess" },
      };
    }
    if (method === "thread/compact/start") {
      this.compactStarts.push(params);
      return {};
    }
    if (method === "turn/start") {
      const thread = this.threads.get(params.threadId);
      if (thread) thread.materialized = true;
      this.turnStarts.push(params);
      if (this.failNextTurn) {
        const error = this.failNextTurn;
        this.failNextTurn = null;
        throw error;
      }
      return new Promise((resolve) => { this.resolveTurnStart = resolve; });
    }
    if (method === "turn/interrupt") {
      this.interrupts.push(params);
      return { interrupted: true };
    }
    if (method === "thread/name/set") {
      this.threads.get(params.threadId).name = params.name;
      return {};
    }
    if (method === "thread/unsubscribe") {
      if (!this.staleUnsubscribeThreadIds.has(params.threadId)) {
        this.threads.get(params.threadId).status = { type: "notLoaded" };
      }
      return { status: "unsubscribed" };
    }
    if (method === "thread/archive") {
      const thread = this.threads.get(params.threadId);
      this.threads.delete(params.threadId);
      if (thread) this.archived.set(params.threadId, thread);
      return {};
    }
    if (method === "thread/unarchive") {
      const thread = this.archived.get(params.threadId);
      this.archived.delete(params.threadId);
      if (thread) this.threads.set(params.threadId, thread);
      return { thread };
    }
    if (method === "thread/delete") {
      this.threads.delete(params.threadId);
      this.archived.delete(params.threadId);
      return {};
    }
    throw new Error(`unexpected RPC ${method}`);
  }

  respond(id, result) {
    this.responses.push({ id, result });
  }
  respondError() {}
}

test("browser keeps thread state coherent across turn races and lifecycle actions", { timeout: 30_000 }, async () => {
  const client = new BrowserFixtureClient();
  const config = { maxRequestBytes: "1mb", maxThreadPages: 2, difitCli: "/missing/difit" };
  const eventBus = new EventBus();
  const navigation = new NavigationService(client, config);
  await navigation.refresh();
  const historicalTokenUsage = {
    last: { inputTokens: 8_507, outputTokens: 139, totalTokens: 8_646 },
    total: { inputTokens: 14_421, outputTokens: 234, totalTokens: 14_655 },
    modelContextWindow: null,
  };
  const sessions = new SessionService(client, navigation, {
    tokenUsageReader: {
      async readLatest(threadId) {
        return threadId === "thread-c" ? historicalTokenUsage : null;
      },
    },
  });
  sessions.recordThreadStarted(navigation.getThread("thread-a"));
  sessions.recordThreadStarted(navigation.getThread("thread-child"));
  const requests = new RequestRegistry(client, eventBus);
  const folderSelections = ["/workspace/new-project", "/workspace/cancel-project", null];
  const openedPaths = [];
  const openedPathOptions = [];
  const app = createApp({
    config,
    client,
    navigation,
    sessions,
    requests,
    eventBus,
    folderPicker: {
      async choose() {
        const cwd = folderSelections.shift();
        return cwd ? { cancelled: false, cwd } : { cancelled: true };
      },
    },
    pathOpener: {
      async open(target, options) {
        openedPaths.push(target);
        openedPathOptions.push(options);
        return {
          kind: target.endsWith(".js") ? "file" : "directory",
          ...(options.application ? { application: options.application } : {}),
        };
      },
    },
  });
  const server = await listen(app);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.setDefaultTimeout(5_000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  try {
    const { port } = server.address();
    await page.addInitScript(() => {
      localStorage.setItem("codex-session.expandedProjects", "not-json");
      localStorage.setItem("codex-session.unreadThreads", "null");
      sessionStorage.setItem("codex-session.scrollPositions", "[]");
    });
    await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });

    const projectRow = page.locator(".project-item").first();
    if (!/collapsed/.test(await projectRow.getAttribute("class"))) await projectRow.locator(".project-toggle").click();
    await projectRow.locator(".project-header").click({ position: { x: 2, y: 2 } });
    assert.doesNotMatch(await projectRow.getAttribute("class"), /collapsed/);
    await projectRow.locator(".project-header .badge").click();
    assert.match(await projectRow.getAttribute("class"), /collapsed/);

    await page.locator('[data-thread-id="thread-a"]').first().click();
    await page.waitForSelector("#composer-text:not([disabled])");
    await page.waitForSelector("#git-rail.unavailable:not([hidden])");
    assert.equal(await page.locator("#arch-viewer-button").isEnabled(), true);
    assert.equal(await page.locator("#plan-viewer-button").isEnabled(), true);
    assert.equal(await page.locator("#collect-viewer-button").isEnabled(), true);
    assert.match(await page.locator("#git-base-note").textContent(), /Git/);

    const historyRow = page.locator('[data-thread-id="thread-b"].session-item:visible').first();
    await historyRow.click({ position: { x: 2, y: 2 } });
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Beta");
    await page.locator('[data-thread-id="thread-a"]:visible').first().click({ position: { x: 2, y: 2 } });
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Alpha");

    await page.waitForTimeout(200);
    const initialReadCalls = client.threadReadCalls;
    const initialTurnListCalls = client.turnListCalls;
    const initialTimeline = await page.locator("#timeline").evaluate((node) => {
      window.__initialTimelineNode = node;
      window.__initialSidebarRow = document.querySelector('[data-thread-id="thread-b"].session-item');
      return node.childElementCount;
    });
    eventBus.publish("connection.state", client.health());
    await page.waitForTimeout(150);
    assert.equal(client.threadReadCalls, initialReadCalls);
    assert.equal(client.turnListCalls, initialTurnListCalls);
    assert.equal(await page.locator("#timeline").evaluate((node) => node === window.__initialTimelineNode), true);
    assert.equal(await page.locator("#timeline").evaluate((node) => node.childElementCount), initialTimeline);
    assert.equal(await page.locator('[data-thread-id="thread-b"].session-item').evaluate((node) => node === window.__initialSidebarRow), true);
    await page.evaluate(() => {
      delete window.__initialTimelineNode;
      delete window.__initialSidebarRow;
    });
    const listCallsBeforeInvalidation = client.threadListCalls;
    eventBus.publish("navigation.invalidated", { threadId: "thread-a" });
    eventBus.publish("navigation.invalidated", { threadId: "thread-a" });
    eventBus.publish("navigation.invalidated", { threadId: "thread-a" });
    await page.waitForTimeout(250);
    assert.equal(client.threadListCalls, listCallsBeforeInvalidation + 2);
    const restartBox = await page.locator("#composer-restart").boundingBox();
    const modeBox = await page.locator("#composer-mode-toggle").boundingBox();
    assert.ok(restartBox.x < modeBox.x, "restart control must appear to the left of Default mode");
    await page.locator("#composer-text").fill("重启后保留的草稿");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }),
      page.locator("#composer-restart").click(),
    ]);
    await page.waitForSelector("#composer-text:not([disabled])");
    assert.equal(client.restartCalls, 1);
    assert.equal(await page.locator("#thread-title").textContent(), "Alpha");
    assert.equal(await page.locator("#composer-text").inputValue(), "重启后保留的草稿");
    await page.locator("#composer-text").fill("");
    sessions.recordThreadStarted(navigation.getThread("thread-child"));

    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-navigation-one",
      item: { id: "user-navigation-one", type: "userMessage", text: "第一条用于快速导航的用户消息" },
    });
    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-navigation-two",
      item: { id: "user-navigation-two", type: "userMessage", text: "第二条用户消息包含一段更长的摘要，用于验证悬停预览。" },
    });
    await page.waitForFunction(() => document.querySelectorAll("#conversation-rail .conversation-rail-marker").length === 2);
    const userCardLayout = await page.locator('.msg.user[data-item-id="user-navigation-one"]').evaluate((message) => {
      const inner = message.querySelector(".msg-inner").getBoundingClientRect();
      const card = message.querySelector(".user-question-card");
      const cardBounds = card.getBoundingClientRect();
      const role = message.querySelector(".msg-role").getBoundingClientRect();
      const bubble = message.querySelector(".user-bubble").getBoundingClientRect();
      return {
        cardLeft: Math.abs(inner.left - cardBounds.left),
        contentLeft: Math.abs(role.left - bubble.left),
        cardWidth: cardBounds.width,
        background: getComputedStyle(card).backgroundColor,
        accentWidth: getComputedStyle(card, "::before").width,
        bodyFontSize: getComputedStyle(message.querySelector(".msg-body")).fontSize,
        roleLabel: message.querySelector(".msg-role").firstChild.nodeValue.trim(),
        editGlyph: message.querySelector(".message-edit")?.textContent,
      };
    });
    assert.ok(userCardLayout.cardLeft <= 1, `user question card should align with the content column, offset was ${userCardLayout.cardLeft}px`);
    assert.ok(userCardLayout.contentLeft <= 1, `question label and body should share a left edge, offset was ${userCardLayout.contentLeft}px`);
    assert.equal(userCardLayout.cardWidth, 900);
    assert.equal(userCardLayout.background, "rgb(243, 240, 233)");
    assert.equal(userCardLayout.accentWidth, "3px");
    assert.equal(userCardLayout.bodyFontSize, "17px");
    assert.equal(userCardLayout.roleLabel, "Question · You");
    assert.equal(userCardLayout.editGlyph, "⌁");
    const secondMarker = page.locator('.conversation-rail-marker[data-item-id="user-navigation-two"]');
    await secondMarker.hover();
    const navigatorPlacement = await page.evaluate(() => {
      const content = document.querySelector('.msg.user[data-item-id="user-navigation-one"] .msg-inner').getBoundingClientRect();
      const rail = document.querySelector("#conversation-rail").getBoundingClientRect();
      const preview = document.querySelector('.conversation-rail-marker[data-item-id="user-navigation-two"] .conversation-rail-preview').getBoundingClientRect();
      return {
        contentGap: rail.left - content.right,
        previewGap: preview.left - rail.right,
        previewRight: preview.right,
        viewportWidth: window.innerWidth,
      };
    });
    assert.ok(Math.abs(navigatorPlacement.contentGap - 12) <= 1, `conversation navigator should sit beside content, gap was ${navigatorPlacement.contentGap}px`);
    assert.ok(navigatorPlacement.previewGap >= 0, `conversation preview should open to the right, gap was ${navigatorPlacement.previewGap}px`);
    assert.ok(navigatorPlacement.previewRight <= navigatorPlacement.viewportWidth, "conversation preview should stay inside the viewport");
    assert.match(await secondMarker.locator(".conversation-rail-preview-text").textContent(), /第二条用户消息/);
    await secondMarker.click();
    assert.equal(await secondMarker.getAttribute("aria-current"), "true");
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.conversation-rail-marker[data-item-id="user-navigation-two"]'), "::after").width === "36px");
    eventBus.publish("item.started", {
      threadId: "thread-a",
      turnId: "turn-navigation-stream",
      item: { id: "answer-navigation-stream", type: "agentMessage", lifecycleStatus: "started", text: "" },
    });
    await page.waitForSelector('[data-item-id="answer-navigation-stream"]');
    await page.evaluate(() => {
      const list = document.querySelector("#conversation-rail-list");
      window.__railMarker = list.querySelector('[data-item-id="user-navigation-two"]');
      window.__stableTimelineTurn = document.querySelector('[data-turn-id="turn-navigation-one"]');
      window.__streamTimelineTurn = document.querySelector('[data-turn-id="turn-navigation-stream"]');
      window.__streamItemNode = document.querySelector('[data-item-id="answer-navigation-stream"]');
      window.__stableSidebarRow = document.querySelector('[data-thread-id="thread-b"].session-item');
      window.__composerNode = document.querySelector("#composer-text");
      window.__composerNode.value = "流式更新期间保留";
      window.__composerNode.dispatchEvent(new Event("input", { bubbles: true }));
      window.__composerNode.focus();
      window.__railMutations = 0;
      window.__railObserver = new MutationObserver((records) => {
        for (const record of records) {
          window.__railMutations += [...record.addedNodes, ...record.removedNodes]
            .filter((node) => node.nodeType === Node.ELEMENT_NODE && node.matches?.(".conversation-rail-marker")).length;
        }
      });
      window.__railObserver.observe(list, { childList: true });
    });
    for (const delta of ["流式", "模型", "回答内容逐步增长"]) {
      eventBus.publish("item.delta", {
        threadId: "thread-a",
        turnId: "turn-navigation-stream",
        itemId: "answer-navigation-stream",
        itemType: "agentMessage",
        field: "text",
        delta,
      });
      await page.waitForFunction((expected) => document.querySelector('[data-item-id="answer-navigation-stream"]')?.textContent.includes(expected), delta);
    }
    const stableRail = await page.evaluate(() => {
      const current = document.querySelector('.conversation-rail-marker[data-item-id="user-navigation-two"]');
      const result = {
        sameNode: current === window.__railMarker,
        connected: window.__railMarker?.isConnected,
        mutations: window.__railMutations,
        active: current?.classList.contains("active"),
        ariaCurrent: current?.getAttribute("aria-current"),
        width: current ? getComputedStyle(current, "::after").width : null,
        sameTimelineTurn: document.querySelector('[data-turn-id="turn-navigation-one"]') === window.__stableTimelineTurn,
        sameStreamTurn: document.querySelector('[data-turn-id="turn-navigation-stream"]') === window.__streamTimelineTurn,
        sameStreamItem: document.querySelector('[data-item-id="answer-navigation-stream"]') === window.__streamItemNode,
        sameSidebarRow: document.querySelector('[data-thread-id="thread-b"].session-item') === window.__stableSidebarRow,
        sameComposer: document.querySelector("#composer-text") === window.__composerNode,
        composerFocused: document.activeElement === window.__composerNode,
        composerValue: window.__composerNode?.value,
      };
      window.__railObserver.disconnect();
      delete window.__railObserver;
      delete window.__railMarker;
      delete window.__stableTimelineTurn;
      delete window.__streamTimelineTurn;
      delete window.__streamItemNode;
      delete window.__stableSidebarRow;
      delete window.__composerNode;
      delete window.__railMutations;
      return result;
    });
    assert.deepEqual(stableRail, {
      sameNode: true,
      connected: true,
      mutations: 0,
      active: true,
      ariaCurrent: "true",
      width: "36px",
      sameTimelineTurn: true,
      sameStreamTurn: true,
      sameStreamItem: true,
      sameSidebarRow: true,
      sameComposer: true,
      composerFocused: true,
      composerValue: "流式更新期间保留",
    });
    await page.locator("#composer-text").fill("");

    let releaseThreadLoad;
    client.threadLoadGate = {
      threadId: "thread-c",
      promise: new Promise((resolve) => { releaseThreadLoad = resolve; }),
    };
    await page.locator('[data-thread-id="thread-c"] .session-open').first().dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Gamma");
    await page.locator('[data-thread-id="thread-b"] .session-open').first().dispatchEvent("pointerdown", { pointerType: "mouse", button: 0 });
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Beta");
    releaseThreadLoad();
    client.threadLoadGate = null;
    await page.waitForSelector("#composer-text:not([disabled])");
    await page.locator('[data-thread-id="thread-a"]').first().click();
    await page.waitForSelector("#composer-text:not([disabled])");

    await page.waitForFunction(() => document.querySelector("#composer-model")?.textContent === "Test Model A");
    assert.equal(await page.locator("#composer-effort").textContent(), "· medium");
    assert.equal(await page.locator("#composer-model-toggle").isEnabled(), true);
    assert.equal(await page.locator("#composer-model-toggle").getAttribute("aria-expanded"), "false");
    await page.locator("#composer-model-toggle").click();
    await page.waitForSelector("#composer-model-menu:not([hidden])");
    assert.equal(await page.locator("#composer-model-options .model-menu-item").count(), 4);
    await page.locator("#composer-model-options .model-menu-item").filter({ hasText: "Test Model B" }).click();
    assert.equal(await page.locator("#composer-model").textContent(), "Test Model B");
    assert.equal(await page.locator("#composer-effort").textContent(), "· low");
    assert.equal(await page.getByRole("menuitemradio", { name: "Medium", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("menuitemradio", { name: "XHigh", exact: true }).isDisabled(), true);
    await page.getByRole("menuitemradio", { name: "High", exact: true }).click();
    assert.equal(await page.locator("#composer-effort").textContent(), "· high");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#composer-model-menu").getAttribute("hidden"), "");
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("codex-session.composerSettings"))["thread-a"]), {
      model: "test-model-b",
      reasoningEffort: "high",
    });

    assert.equal(await page.locator("#composer-mode-label").textContent(), "Default");
    assert.equal(await page.locator("#composer-mode-toggle").isEnabled(), true);
    await page.locator("#composer-mode-toggle").click();
    assert.equal(await page.locator("#composer-mode-label").textContent(), "Plan");
    assert.equal(await page.locator("#composer-mode-toggle").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#composer-token-group").getAttribute("hidden"), "");
    assert.equal(await page.locator("#composer-token-in").textContent(), "");
    assert.equal(await page.locator("#composer-token-out").textContent(), "");
    eventBus.publish("thread.tokenUsage", {
      threadId: "thread-a",
      turnId: "turn-token-a",
      tokenUsage: {
        last: { inputTokens: 5_152, cachedInputTokens: 3_072, outputTokens: 16, reasoningOutputTokens: 0, totalTokens: 5_168 },
        total: { inputTokens: 91_234, outputTokens: 8_765, totalTokens: 99_999 },
        modelContextWindow: 258_400,
      },
    });
    await page.waitForFunction(() => document.querySelector("#composer-token-in")?.textContent === "IN 5k");
    assert.equal(await page.locator("#composer-token-out").textContent(), "OUT 16");
    assert.equal(await page.locator("#composer-token-group").getAttribute("hidden"), null);
    eventBus.publish("connection.state", { state: "offline", ready: false, expectedVersion: "0.153.2", actualVersion: "0.153.2" });
    await page.waitForFunction(() => document.querySelector("#connection-label")?.textContent === "Offline");
    assert.equal(await page.locator("#composer").isVisible(), false);
    assert.equal(await page.locator("#thread-readonly-state").isVisible(), true);
    eventBus.publish("connection.state", { state: "ready", ready: true, expectedVersion: "0.153.2", actualVersion: "0.153.2" });
    await page.waitForSelector("#composer-text:not([disabled])");
    assert.equal(await page.locator("#composer-token-in").textContent(), "IN 5k");
    assert.equal(await page.locator(".turn-state").count(), 0);
    assert.equal(await page.locator(".workflow-reminder").isVisible(), true);
    assert.equal(await page.locator("#composer-attach").count(), 0);
    assert.equal(await page.locator("#composer-image-input").count(), 0);
    const reminderCenterOffset = await page.locator(".composer-controls").evaluate((controls) => {
      const reminder = controls.querySelector(".workflow-reminder");
      const controlsRect = controls.getBoundingClientRect();
      const reminderRect = reminder.getBoundingClientRect();
      return Math.abs((controlsRect.left + controlsRect.width / 2) - (reminderRect.left + reminderRect.width / 2));
    });
    assert.ok(reminderCenterOffset <= 1, `workflow reminder should be centered, offset was ${reminderCenterOffset}px`);
    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-reasoning",
      item: { id: "reasoning-hidden", type: "reasoning", summary: "不应显示的推理摘要" },
    });
    await page.waitForTimeout(50);
    assert.equal(await page.getByText("不应显示的推理摘要").count(), 0);
    assert.equal(await page.getByText("推理摘要", { exact: true }).count(), 0);

    await page.locator('[data-thread-id="thread-c"].session-item').first().click();
    await page.waitForSelector("#thread-readonly-state:not([hidden])");
    await page.waitForFunction(() => document.querySelector("#composer-token-in")?.textContent === "IN 8k");
    assert.equal(await page.locator("#composer-mode-label").textContent(), "Default");
    assert.equal(await page.locator("#composer-mode-toggle").isDisabled(), true);
    assert.equal(await page.locator("#composer-token-group").getAttribute("hidden"), null);
    assert.equal(await page.locator("#composer-token-in").textContent(), "IN 8k");
    assert.equal(await page.locator("#composer-token-out").textContent(), "OUT 139");
    assert.equal(await page.locator("#activate-thread").isVisible(), true);
    await page.locator("#activate-thread").click();
    await page.waitForSelector("#composer-text:not([disabled])");
    assert.equal(await page.locator("#composer-token-group").getAttribute("hidden"), null);
    assert.equal(await page.locator("#composer-token-in").textContent(), "IN 8k");
    assert.equal(await page.locator("#composer-token-out").textContent(), "OUT 139");
    await page.locator('[data-thread-id="thread-a"]').first().click();
    await page.waitForSelector("#composer-text:not([disabled])");
    assert.equal(await page.locator("#composer-mode-label").textContent(), "Plan");
    assert.equal(await page.locator("#composer-model").textContent(), "Test Model B");
    assert.equal(await page.locator("#composer-effort").textContent(), "· high");
    await page.locator("#composer-mode-toggle").click();
    assert.equal(await page.locator("#composer-mode-label").textContent(), "Default");
    assert.equal(await page.locator("#composer-token-in").textContent(), "IN 5k");
    assert.equal(await page.locator("#composer-token-out").textContent(), "OUT 16");

    const child = page.locator('[data-thread-id="thread-child"].subagent-item').first();
    assert.equal(await child.count(), 1);
    assert.equal(await page.locator('.session-list [data-thread-id="thread-child"]').count(), 0);
    assert.equal(await page.locator('[data-thread-id="thread-old-child"]').count(), 0);
    const projectSection = page.locator('[data-thread-id="thread-a"].session-item').locator("xpath=ancestor::section[contains(@class,'project-item')]");
    assert.equal(await projectSection.locator(".badge").textContent(), "3");
    await child.click();
    await page.waitForFunction(() => document.querySelector("#thread-meta")?.textContent.includes("read-only"));
    assert.equal(await page.locator("#composer").isVisible(), false);
    assert.match(await page.locator("#thread-project").textContent(), /Alpha \/ Research/);
    await page.locator("#thread-project").click();
    await page.waitForSelector("#composer-text:not([disabled])");

    eventBus.publish("request.pending", {
      requestId: "req-child",
      method: "item/tool/requestUserInput",
      threadId: "thread-child",
      receivedAt: new Date().toISOString(),
      params: { questions: [{ id: "choice", question: "继续吗？", options: [{ label: "是" }] }] },
    });
    await page.waitForFunction(() => document.querySelector("#global-requests-count")?.textContent === "1");
    const pendingToggleCenterOffset = await page.locator("#global-requests-toggle").evaluate((toggle) => {
      const bounds = toggle.getBoundingClientRect();
      return Math.abs(window.innerWidth / 2 - (bounds.left + bounds.width / 2));
    });
    assert.ok(pendingToggleCenterOffset <= 1, `pending request toggle should be screen-centered, offset was ${pendingToggleCenterOffset}px`);
    await page.locator("#global-requests-toggle").click();
    const pendingPanelCenterOffset = await page.locator("#global-requests-panel").evaluate((panel) => {
      const bounds = panel.getBoundingClientRect();
      return Math.abs(window.innerWidth / 2 - (bounds.left + bounds.width / 2));
    });
    assert.ok(pendingPanelCenterOffset <= 1, `pending request panel should be screen-centered, offset was ${pendingPanelCenterOffset}px`);
    await page.locator("#global-requests-panel .global-request-item").first().click();
    await page.waitForFunction(() => document.querySelector("#thread-meta")?.textContent.includes("read-only"));
    eventBus.publish("request.expired", { requestId: "req-child", threadId: "thread-child" });
    await page.waitForFunction(() => document.querySelector("#global-requests-toggle")?.hidden === true);
    assert.equal(await page.locator("#global-requests-panel .global-request-item").count(), 0);
    await page.locator("#thread-project").click();
    await page.waitForSelector("#composer-text:not([disabled])");

    const inputRequest = requests.add({
      id: "rpc-user-input",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-a",
        turnId: "turn-input",
        itemId: "item-input",
        questions: [
          {
            id: "topic",
            question: "你更喜欢哪种开发主题？",
            options: [
              { label: "后端开发", description: "关注 API、数据和服务端可靠性。" },
              { label: "前端开发", description: "关注界面、交互和浏览器体验。" },
            ],
            isOther: true,
          },
          {
            id: "priorities",
            question: "你最关注哪些方面？",
            multiSelect: true,
            options: [
              { label: "可维护性", description: "代码结构清晰，便于持续演进。" },
              { label: "性能", description: "减少延迟和资源消耗。" },
            ],
          },
        ],
      },
    });
    const requestCard = page.locator("#request-dock .request-user-input");
    await requestCard.waitFor();
    assert.equal(await requestCard.locator("h3").count(), 0);
    assert.equal(await requestCard.locator("select").count(), 0);
    assert.equal(await requestCard.locator(".request-question").count(), 2);
    assert.equal(await requestCard.locator(".request-question-prompt").first().textContent(), "你更喜欢哪种开发主题？");
    assert.equal(await requestCard.locator(".request-option-description").first().textContent(), "关注 API、数据和服务端可靠性。");
    assert.equal(await requestCard.locator('input[type="radio"]').count(), 3);
    assert.equal(await requestCard.locator('input[type="checkbox"]').count(), 2);
    const requestBounds = await page.locator("#request-dock").boundingBox();
    const composerBounds = await page.locator("#composer").boundingBox();
    assert.ok(Math.abs(requestBounds.width - composerBounds.width) <= 1);
    assert.ok(requestBounds.y + requestBounds.height < composerBounds.y);
    const otherAnswer = requestCard.locator(".request-other-input");
    assert.equal(await otherAnswer.isVisible(), false);
    await requestCard.locator(".request-option-other").click();
    await otherAnswer.fill("移动端开发");
    await requestCard.locator(".request-question").nth(1).getByText("可维护性", { exact: true }).click();
    const resolveResponse = page.waitForResponse((response) => response.url().endsWith(`/api/requests/${inputRequest.requestId}/resolve`));
    await requestCard.locator(".request-actions .primary").click();
    assert.equal((await resolveResponse).status(), 200);
    assert.deepEqual(client.responses.at(-1), {
      id: "rpc-user-input",
      result: {
        answers: {
          topic: { answers: ["移动端开发"] },
          priorities: { answers: ["可维护性"] },
        },
      },
    });
    await page.waitForFunction(() => document.querySelector("#request-dock")?.textContent.includes("Response sent"));
    requests.markResolvedByRpcId("rpc-user-input");
    await page.waitForFunction(() => document.querySelector("#request-dock")?.hidden === true);

    client.threads.get("thread-a").status = { type: "active", activeFlags: ["waitingOnApproval"] };
    eventBus.publish("thread.status", { threadId: "thread-a", status: "active", activeFlags: ["waitingOnApproval"] });
    await page.waitForFunction(() => document.querySelector("#thread-status .label")?.textContent === "Waiting for approval");
    assert.equal(await page.locator("#working-indicator").isVisible(), true);
    assert.equal(await page.locator(".workflow-reminder").isVisible(), false);
    const workingCenterOffset = await page.locator(".composer-controls").evaluate((controls) => {
      const indicator = controls.querySelector("#working-indicator");
      const controlsRect = controls.getBoundingClientRect();
      const indicatorRect = indicator.getBoundingClientRect();
      return Math.abs((controlsRect.left + controlsRect.width / 2) - (indicatorRect.left + indicatorRect.width / 2));
    });
    assert.ok(workingCenterOffset <= 1, `working indicator should be centered, offset was ${workingCenterOffset}px`);
    client.threads.get("thread-a").status = { type: "idle" };
    eventBus.publish("thread.status", { threadId: "thread-a", status: "idle", activeFlags: [] });
    await page.waitForSelector("#composer-text:not([disabled])");

    const listCallsBeforeCreate = client.threadListCalls;
    await page.locator(".project-item .spawn-btn").first().click();
    await page.locator(".new-session-form input").fill("Fresh thread");
    await page.locator(".new-session-form button[type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Fresh thread");
    assert.equal(client.threadListCalls, listCallsBeforeCreate, "creating a thread must not immediately call thread/list before its first turn");
    assert.equal(await page.getByText("This session is archived, deleted, or no longer accessible.").count(), 0);
    await page.locator('[data-thread-id="thread-created-1"]').first().click();
    await page.waitForSelector("#composer-text:not([disabled])");
    assert.equal(await page.getByText(/Failed to read session/).count(), 0);
    await page.locator('[data-thread-id="thread-a"]').first().click();
    await page.waitForSelector("#composer-text:not([disabled])");

    await page.locator(".projects-create-btn").click();
    const folderName = page.locator('[data-thread-id="thread-created-2"] .pending-session-name-input');
    await folderName.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-thread-id="thread-created-2"] .pending-session-name-input') === document.activeElement);
    assert.equal(client.threads.get("thread-created-2").cwd, "/workspace/new-project");
    await folderName.fill("Folder thread");
    await folderName.press("Enter");
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Folder thread");
    assert.equal(await page.locator('[data-thread-id="thread-created-2"] .session-title').textContent(), "Folder thread");
    await page.locator("#composer-text").fill("first folder message");
    await page.locator("#send").click();
    await page.waitForFunction(() => document.querySelector("#composer-send-status")?.textContent.includes("Sending"));
    assert.equal(client.turnStarts.at(-1).threadId, "thread-created-2");
    client.emit("notification", {
      method: "thread/started",
      params: { thread: { ...client.threads.get("thread-created-2"), name: "未命名的会话" } },
    });
    eventBus.publish("navigation.invalidated", {});
    await page.waitForTimeout(150);
    assert.equal(await page.locator("#thread-title").textContent(), "Folder thread");
    assert.equal(await page.locator('[data-thread-id="thread-created-2"] .session-title').textContent(), "Folder thread");
    eventBus.publish("turn.completed", { threadId: "thread-created-2", turn: { id: "turn-folder", status: "completed" } });
    client.resolveTurnStart({ turn: { id: "turn-folder", status: "inProgress" } });
    await page.waitForSelector("#composer-text:not([disabled])");
    sessions.completeActiveTurn("thread-created-2", "turn-folder");

    await page.locator(".projects-create-btn").click();
    const canceledName = page.locator('[data-thread-id="thread-created-3"] .pending-session-name-input');
    await canceledName.waitFor();
    await canceledName.press("Escape");
    await page.waitForFunction(() => !document.querySelector('[data-thread-id="thread-created-3"]'));
    assert.equal(client.threads.has("thread-created-3"), false);

    const createdBeforeFinderCancel = client.createdThreads;
    await page.locator(".projects-create-btn").click();
    await page.waitForFunction(() => !document.querySelector(".projects-create-btn")?.disabled);
    assert.equal(client.createdThreads, createdBeforeFinderCancel);

    await page.locator('[data-thread-id="thread-a"]').first().click();
    await page.waitForSelector("#composer-text:not([disabled])");

    let releaseProjects;
    let projectsCaptured;
    const projectsCapturedPromise = new Promise((resolve) => { projectsCaptured = resolve; });
    const projectsHold = new Promise((resolve) => { releaseProjects = resolve; });
    await page.route("**/api/projects", async (route) => {
      const response = await route.fetch();
      projectsCaptured();
      await projectsHold;
      await route.fulfill({ response });
    });
    eventBus.publish("navigation.invalidated", {});
    await projectsCapturedPromise;
    eventBus.publish("thread.status", { threadId: "thread-a", status: "active", activeFlags: ["waitingOnApproval"] });
    await page.waitForFunction(() => document.querySelector("#thread-status .label")?.textContent === "Waiting for approval");
    releaseProjects();
    await page.waitForTimeout(150);
    assert.equal(await page.locator("#thread-status .label").textContent(), "Waiting for approval");
    await page.unroute("**/api/projects");
    eventBus.publish("thread.status", { threadId: "thread-a", status: "idle", activeFlags: [] });
    await page.waitForSelector("#composer-text:not([disabled])");

    await page.locator("#composer-mode-toggle").click();
    assert.equal(await page.locator("#composer-mode-label").textContent(), "Plan");
    await page.locator("#composer-text").fill("fast response");
    await page.locator("#send").click();
    await page.waitForFunction(() => document.querySelector("#composer-send-status")?.textContent.includes("Sending"));
    assert.equal(await page.locator("#composer-mode-toggle").isDisabled(), true);
    assert.equal(await page.locator("#composer-model-toggle").isDisabled(), true);
    assert.deepEqual(client.turnStarts.at(-1).collaborationMode, {
      mode: "plan",
      settings: {
        model: "test-model-b",
        reasoning_effort: "high",
        developer_instructions: null,
      },
    });
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-fast", status: "completed" } });
    client.resolveTurnStart({ turn: { id: "turn-fast", status: "inProgress" } });
    await page.waitForSelector("#composer-text:not([disabled])");
    sessions.completeActiveTurn("thread-a", "turn-fast");
    assert.equal(await page.locator("#composer-mode-toggle").isEnabled(), true);
    await page.locator("#composer-mode-toggle").click();
    assert.equal(await page.locator("#composer-mode-label").textContent(), "Default");
    assert.equal(await page.locator("#interrupt").isVisible(), false);

    assert.equal(await page.locator("#composer-compact").isEnabled(), true);
    await page.locator("#composer-compact").click();
    await page.waitForFunction(() => document.querySelector("#composer-status")?.textContent === "Compacting context");
    assert.deepEqual(client.compactStarts, [{ threadId: "thread-a" }]);
    assert.equal(await page.locator("#composer-compact").isDisabled(), true);
    sessions.setActiveTurn("thread-a", "turn-compact-button");
    eventBus.publish("turn.started", { threadId: "thread-a", turn: { id: "turn-compact-button", status: "inProgress" } });
    eventBus.publish("item.started", {
      threadId: "thread-a",
      turnId: "turn-compact-button",
      item: { id: "compact-button", type: "contextCompaction", lifecycleStatus: "started" },
    });
    await page.waitForFunction(() => document.querySelector('[data-item-id="compact-button"] .context-marker')?.textContent === "Compacting context");
    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-compact-button",
      item: { id: "compact-button", type: "contextCompaction", lifecycleStatus: "completed", message: "Context compacted" },
    });
    sessions.completeActiveTurn("thread-a", "turn-compact-button");
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-compact-button", status: "completed" } });
    await page.waitForFunction(() => document.querySelector('[data-item-id="compact-button"] .context-marker')?.textContent === "Context compacted");
    await page.waitForFunction(() => document.querySelector("#composer-compact")?.disabled === false);

    const turnsBeforeSlashCompact = client.turnStarts.length;
    await page.locator("#composer-text").fill("/compact");
    await page.locator("#send").click();
    await page.waitForFunction(() => document.querySelector("#composer-text")?.value === "");
    assert.equal(client.compactStarts.length, 2);
    assert.equal(client.turnStarts.length, turnsBeforeSlashCompact, "/compact must not be sent as a normal user turn");
    sessions.setActiveTurn("thread-a", "turn-compact-slash");
    eventBus.publish("turn.started", { threadId: "thread-a", turn: { id: "turn-compact-slash", status: "inProgress" } });
    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-compact-slash",
      item: { id: "compact-slash", type: "contextCompaction", lifecycleStatus: "completed" },
    });
    sessions.completeActiveTurn("thread-a", "turn-compact-slash");
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-compact-slash", status: "completed" } });
    await page.waitForFunction(() => document.querySelector("#composer-compact")?.disabled === false);

    eventBus.publish("turn.started", { threadId: "thread-a", turn: { id: "turn-order", status: "inProgress" } });
    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-order",
      item: { id: "answer-order", type: "agentMessage", lifecycleStatus: "completed", text: "最终回答" },
    });
    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-order",
      item: { id: "command-order", type: "commandExecution", lifecycleStatus: "completed", command: "true", output: "done" },
    });
    await page.waitForFunction(() => {
      const children = [...document.querySelector('[data-turn-id="turn-order"]')?.children || []];
      return children.findIndex((child) => child.matches('[data-item-id="answer-order"]'))
        < children.findIndex((child) => child.classList.contains("tool_use"));
    });
    client.itemsByTurn.set("turn-order", [
      { turnId: "turn-order", item: { id: "command-order", type: "commandExecution", lifecycleStatus: "completed", command: "true", output: "done" } },
      { turnId: "turn-order", item: { id: "answer-order", type: "agentMessage", lifecycleStatus: "completed", text: "最终回答" } },
    ]);
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-order", status: "completed" } });
    await page.waitForFunction(() => {
      const children = [...document.querySelector('[data-turn-id="turn-order"]')?.children || []];
      return children[0]?.classList.contains("tool_use")
        && children[1]?.matches('[data-item-id="answer-order"]');
    });
    assert.equal(await page.locator('[data-turn-id="turn-order"] > .tool_use [data-item-id="command-order"]').count(), 1);

    eventBus.publish("turn.started", { threadId: "thread-a", turn: { id: "turn-image-view", status: "inProgress" } });
    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-image-view",
      item: { id: "image-view", type: "imageView", lifecycleStatus: "completed" },
    });
    const imageView = page.locator('[data-turn-id="turn-image-view"] [data-item-id="image-view"]');
    await imageView.waitFor();
    assert.equal(await imageView.locator("xpath=ancestor::*[contains(concat(' ', normalize-space(@class), ' '), ' tool_use ')]").count(), 1);
    const [imageViewBox, contentBox, turnBox] = await Promise.all([
      imageView.boundingBox(),
      page.locator('[data-turn-id="turn-image-view"] .msg-body').boundingBox(),
      page.locator('[data-turn-id="turn-image-view"]').boundingBox(),
    ]);
    assert.equal(Math.round(imageViewBox.width), Math.round(contentBox.width));
    assert.ok(imageViewBox.width < turnBox.width);
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-image-view", status: "completed" } });

    eventBus.publish("turn.started", { threadId: "thread-a", turn: { id: "turn-new", status: "inProgress" } });
    await page.waitForFunction(() => document.querySelector("#thread-status .label")?.textContent === "Running");
    assert.equal(await page.locator('[data-thread-id="thread-a"].session-item .delete-btn').count(), 0);
    eventBus.publish("item.started", { threadId: "thread-a", turnId: "turn-new", item: { id: "command-new", type: "commandExecution", lifecycleStatus: "started", command: '/bin/zsh -lc "printf done"', cwd: "/workspace/project" } });
    await page.waitForFunction(() => [...document.querySelectorAll(".tool-state-label")].some((node) => node.textContent === "Running"));
    const streamingToolOutput = `STREAM\rprogress-2\r${"中".repeat(1_600)}-TAIL-${"😀".repeat(900)}`;
    eventBus.publish("item.delta", { threadId: "thread-a", turnId: "turn-new", itemId: "command-new", itemType: "commandExecution", field: "output", delta: streamingToolOutput });
    await page.waitForFunction(() => document.querySelector('[data-item-id="command-new"] .tool-detail-output pre')?.textContent.includes("STREAM"));
    const commandDetails = page.locator('[data-item-id="command-new"]');
    assert.deepEqual(await commandDetails.locator(".tool-detail-title").allTextContents(), ["INPUT", "OUTPUT", "RESULT"]);
    assert.equal(await commandDetails.locator(".tool-detail-field").filter({ hasText: /^Env/ }).locator(".tool-detail-value").textContent(), "/bin/zsh -lc");
    assert.equal(await commandDetails.locator(".tool-detail-field").filter({ hasText: /^Command/ }).locator(".tool-detail-value").textContent(), "printf done");
    const cwdValue = commandDetails.locator(".tool-detail-field").filter({ hasText: /^CWD/ }).locator(".tool-detail-value");
    assert.equal(await cwdValue.textContent(), "project");
    assert.equal(await cwdValue.getAttribute("title"), "/workspace/project");
    const streamingToolDetail = await commandDetails.locator('.tool-detail-output pre').textContent();
    const truncationNotice = "\n\n… [middle of tool output truncated; kept the first 1500 and last 1000 characters] …\n\n";
    assert.equal(Array.from(streamingToolDetail.replace(truncationNotice, "")).length, 2_500);
    assert.equal(streamingToolDetail.includes("\r"), false);
    assert.match(streamingToolDetail, /^STREAM\nprogress-2\n/);
    assert.match(streamingToolDetail, /TAIL-/);
    assert.ok(streamingToolDetail.includes(truncationNotice));
    assert.equal(await page.locator('[data-item-id="command-new"] .tool-state-label').textContent(), "Running");
    assert.equal(await page.locator('[data-item-id="command-new"] .tool-preview').textContent(), "printf done");
    eventBus.publish("item.completed", { threadId: "thread-a", turnId: "turn-new", item: { id: "command-finished", type: "commandExecution", lifecycleStatus: "completed", command: "printf done", output: "界".repeat(2_500) } });
    const expandedGroup = page.locator('[data-turn-id="turn-new"] .tool-group');
    await expandedGroup.locator(".tool-group-summary").click();
    await expandedGroup.locator('[data-item-id="command-finished"] .tool-summary').click();
    const waitForExpandedTools = () => page.waitForFunction(() => {
      const group = document.querySelector('[data-turn-id="turn-new"] .tool-group');
      const tool = document.querySelector('[data-turn-id="turn-new"] [data-item-id="command-finished"]');
      return group?.classList.contains("open")
        && group.querySelector(":scope > .tool-group-summary")?.getAttribute("aria-expanded") === "true"
        && tool?.classList.contains("open")
        && tool.querySelector(":scope > .tool-summary")?.getAttribute("aria-expanded") === "true";
    });
    await waitForExpandedTools();
    const boundaryToolDetail = await page.locator('[data-item-id="command-finished"] .tool-detail-output pre').textContent();
    assert.equal(Array.from(boundaryToolDetail).length, 2_500);
    assert.equal(boundaryToolDetail.includes("middle of tool output truncated"), false);
    eventBus.publish("item.started", { threadId: "thread-a", turnId: "turn-new", item: { id: "answer-new", type: "agentMessage", lifecycleStatus: "started", text: "" } });
    await waitForExpandedTools();
    eventBus.publish("item.delta", { threadId: "thread-a", turnId: "turn-new", itemId: "answer-new", itemType: "agentMessage", field: "text", delta: "模型回答" });
    await page.waitForFunction(() => document.querySelector('[data-item-id="answer-new"]')?.textContent.includes("模型回答"));
    await waitForExpandedTools();
    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-new",
      item: {
        id: "answer-paths",
        type: "agentMessage",
        lifecycleStatus: "completed",
        text: "文件 /Users/example/Work/app.js，目录 `/Users/example/Work/tools`。VS Code vscode://file/Users/example/Work/tools/view/codex-session/public/app/navigation.js:110:1，[指定位置](vscode://file/Users/example/Work/linked.js:20:3)。[外部链接](https://example.com/docs)\n\n```text\n/Users/example/Work/ignored.js\nvscode://file/Users/example/Work/ignored.js:1:1\n```",
      },
    });
    const pathMessage = page.locator('[data-item-id="answer-paths"]');
    await pathMessage.locator('.local-path-link[data-local-path="/Users/example/Work/app.js"]').waitFor();
    assert.equal(await pathMessage.locator(".local-path-link").count(), 4);
    assert.equal(await pathMessage.locator(".vscode-path-link").count(), 2);
    assert.equal(await pathMessage.locator("pre .local-path-link").count(), 0);
    assert.equal(
      await pathMessage.locator('.vscode-path-link[data-local-path="/Users/example/Work/tools/view/codex-session/public/app/navigation.js"]').getAttribute("title"),
      "Open in VS Code"
    );
    assert.equal(await pathMessage.locator('a[href="https://example.com/docs"]').getAttribute("target"), "_blank");
    const pageUrl = page.url();
    const fileOpen = page.waitForResponse((response) => response.url().endsWith("/api/open-path"));
    await pathMessage.locator('.local-path-link[data-local-path="/Users/example/Work/app.js"]').click();
    assert.equal((await fileOpen).status(), 200);
    const directoryOpen = page.waitForResponse((response) => response.url().endsWith("/api/open-path"));
    await pathMessage.locator('.local-path-link[data-local-path="/Users/example/Work/tools"]').click();
    assert.equal((await directoryOpen).status(), 200);
    const vscodeOpen = page.waitForResponse((response) => response.url().endsWith("/api/open-path"));
    await pathMessage.locator('.vscode-path-link[data-vscode-line="110"][data-vscode-column="1"]').click();
    assert.equal((await vscodeOpen).status(), 200);
    assert.deepEqual(openedPaths, [
      "/Users/example/Work/app.js",
      "/Users/example/Work/tools",
      "/Users/example/Work/tools/view/codex-session/public/app/navigation.js",
    ]);
    assert.deepEqual(openedPathOptions[2], { application: "vscode", line: 110, column: 1 });
    assert.equal(page.url(), pageUrl);
    const finalToolOutput = `FINAL-${"结".repeat(1_600)}-ERROR-TAIL-${"末".repeat(900)}`;
    eventBus.publish("item.completed", { threadId: "thread-a", turnId: "turn-new", item: { id: "command-new", type: "commandExecution", lifecycleStatus: "completed", command: '/bin/zsh -lc "printf done"', output: finalToolOutput } });
    await waitForExpandedTools();
    await page.waitForFunction(() => document.querySelector('[data-item-id="command-new"] .tool-state-label')?.textContent === "Completed" && document.querySelector('[data-item-id="command-new"] .tool-detail-output pre')?.textContent.includes("FINAL-"));
    const finalToolDetail = await page.locator('[data-item-id="command-new"] .tool-detail-output pre').textContent();
    assert.equal(Array.from(finalToolDetail.replace(truncationNotice, "")).length, 2_500);
    assert.match(finalToolDetail, /^FINAL-/);
    assert.match(finalToolDetail, /ERROR-TAIL-/);
    assert.ok(finalToolDetail.includes(truncationNotice));
    assert.equal(await page.locator('[data-item-id="command-new"] .tool-preview').textContent(), "printf done");
    assert.equal(await page.locator("#thread-status .label").textContent(), "Running");
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-old", status: "completed" } });
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#thread-status .label").textContent(), "Running");
    assert.equal(await page.locator("#composer-text").isDisabled(), true);
    assert.equal(await page.locator("#interrupt").isVisible(), true);
    const interruptResponse = page.waitForResponse((response) => response.url().endsWith("/api/sessions/thread-a/turns/turn-new/interrupt"));
    await page.locator("#interrupt").click();
    assert.equal((await interruptResponse).status(), 200);
    assert.deepEqual(client.interrupts, [{ threadId: "thread-a", turnId: "turn-new" }]);

    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-new", status: "completed" } });
    await page.waitForSelector("#composer-text:not([disabled])");
    await waitForExpandedTools();
    assert.equal(await page.locator("#interrupt").isVisible(), false);
    await page.locator('[data-thread-id="thread-b"]').first().click();
    await page.waitForSelector("#composer-text:not([disabled])");
    await page.locator('[data-thread-id="thread-a"]').first().click();
    await page.waitForSelector("#composer-text:not([disabled])");
    eventBus.publish("item.completed", { threadId: "thread-a", turnId: "turn-new", item: { id: "command-new", type: "commandExecution", lifecycleStatus: "completed", command: "true", output: "ok" } });
    eventBus.publish("item.completed", { threadId: "thread-a", turnId: "turn-new", item: { id: "command-finished", type: "commandExecution", lifecycleStatus: "completed", command: "printf done", output: "done" } });
    await page.waitForSelector('[data-turn-id="turn-new"] .tool-group');
    assert.equal(await page.locator('[data-turn-id="turn-new"] .tool-group-summary').getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator('[data-turn-id="turn-new"] [data-item-id="command-finished"] .tool-summary').getAttribute("aria-expanded"), "false");

    await page.evaluate(() => {
      const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrLYAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
      document.querySelector("#composer-text").dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
    });
    await page.waitForSelector("#composer-image-tray .img-paste-item");
    await page.locator('[data-thread-id="thread-b"]').first().click();
    assert.equal(await page.locator("#composer-image-tray .img-paste-item").count(), 0);
    await page.locator('[data-thread-id="thread-a"]').first().click();
    await page.waitForSelector("#composer-image-tray .img-paste-item");
    await page.locator("#composer-image-tray .img-paste-remove").click();
    await page.evaluate(() => {
      const original = FileReader.prototype.readAsDataURL;
      FileReader.prototype.readAsDataURL = function delayedRead(blob) {
        setTimeout(() => original.call(this, blob), blob.name === "slow.png" ? 50 : 0);
      };
      const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrLYAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));
      for (const name of ["slow.png", "fast.png"]) {
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], name, { type: "image/png" }));
        document.querySelector("#composer-text").dispatchEvent(new ClipboardEvent("paste", { bubbles: true, clipboardData: transfer }));
      }
    });
    await page.waitForFunction(() => document.querySelectorAll("#composer-image-tray .img-paste-item").length === 2);
    await page.locator("#composer-image-tray .img-paste-remove").first().click();
    await page.locator("#composer-image-tray .img-paste-remove").first().click();
    await page.evaluate(() => {
      const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrLYAAAAASUVORK5CYII="), (character) => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }));
      document.querySelector("#composer").dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: transfer }));
    });
    await page.waitForSelector("#composer-image-tray .img-paste-item");
    assert.equal(await page.locator("#send").isEnabled(), true);
    await page.locator("#send").click();
    await page.waitForFunction(() => document.querySelector("#composer-send-status")?.textContent.includes("Sending"));
    assert.equal(client.turnStarts.at(-1).input[0].type, "image");
    const imageClientId = client.turnStarts.at(-1).clientUserMessageId;
    client.resolveTurnStart({ turn: { id: "turn-image", status: "inProgress" } });
    client.itemsByTurn.set("turn-image", [{
      turnId: "turn-image",
      item: { id: "user-image", type: "userMessage", clientId: imageClientId, content: [{ type: "image", url: client.turnStarts.at(-1).input[0].url, detail: "high" }] },
    }]);
    const itemListCallsBeforeImageCompletion = client.itemListCalls;
    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-image",
      item: { id: "user-image", type: "userMessage", clientId: imageClientId, text: "" },
    });
    sessions.completeActiveTurn("thread-a", "turn-image");
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-image", status: "completed" } });
    await page.waitForSelector("#composer-text:not([disabled])");
    assert.equal(await page.locator("#composer-image-tray .img-paste-item").count(), 0);
    await page.waitForSelector(".msg.user img");
    assert.equal(client.itemListCalls, itemListCallsBeforeImageCompletion + 1);
    assert.equal(await page.locator(".msg.user img").count() > 0, true);
    await page.locator(".msg.user .msg-image-button").last().click();
    await page.waitForSelector("dialog.image-preview-dialog[open]");
    await page.locator(".image-preview-close").click();

    // Edit the complete historical message and images, then resend it as the latest message.
    const editImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZrLYAAAAASUVORK5CYII=";
    client.itemsByTurn.set("turn-edit-source", [{
      turnId: "turn-edit-source",
      item: {
        id: "user-edit-source",
        type: "userMessage",
        content: [
          { type: "text", text: "完整的历史消息\n第二行" },
          { type: "image", url: editImage, detail: "high" },
        ],
      },
    }]);
    eventBus.publish("item.completed", {
      threadId: "thread-a",
      turnId: "turn-edit-source",
      item: { id: "user-edit-source", type: "userMessage", text: "不完整摘要" },
    });
    const editSource = page.locator('[data-item-id="user-edit-source"]');
    await editSource.locator(".message-edit").click();
    await page.waitForFunction(() => document.querySelector('[data-item-id="user-edit-source"] .history-message-editor')?.value === "完整的历史消息\n第二行");
    assert.equal(await editSource.locator(".history-message-editor").inputValue(), "完整的历史消息\n第二行");
    assert.equal(await editSource.locator(".msg-image-button").count(), 1);
    await editSource.locator(".history-message-edit-cancel").click();
    assert.equal(await editSource.locator(".history-message-editor").count(), 0);

    await page.locator("#composer-text").fill("底部草稿不得被历史重发清空");
    await editSource.locator(".message-edit").click();
    await editSource.locator(".history-message-editor").fill(" \n修改后的历史消息\n ");
    await editSource.locator(".history-message-edit-send").click();
    await page.waitForFunction(() => document.querySelector("#composer-send-status")?.textContent.includes("Sending"));
    assert.deepEqual(client.turnStarts.at(-1).input, [
      { type: "text", text: " \n修改后的历史消息\n " },
      { type: "image", url: editImage, detail: "high" },
    ]);
    const resendContext = Object.entries(client.turnStarts.at(-1).additionalContext);
    assert.equal(resendContext.length, 1);
    assert.match(resendContext[0][0], /^codex_session_history_resend_[a-f0-9]{32}$/);
    assert.equal(resendContext[0][1].kind, "application");
    assert.match(resendContext[0][1].value, /最新且有效的要求/);
    assert.equal(await page.locator(".message-edit").count(), 0);
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-edited", status: "completed" } });
    client.resolveTurnStart({ turn: { id: "turn-edited", status: "inProgress" } });
    sessions.completeActiveTurn("thread-a", "turn-edited");
    await page.waitForSelector("#composer-text:not([disabled])");
    assert.equal(await page.locator("#composer-text").inputValue(), "底部草稿不得被历史重发清空");
    assert.equal(await editSource.locator(".msg-body").textContent(), "完整的历史消息\n第二行");
    assert.equal(await editSource.locator(".message-resent-state").textContent(), "Edited and resent");
    assert.equal(await page.locator('.msg.user .msg-body').filter({ hasText: "修改后的历史消息" }).count(), 1);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("codex-session.resentMessages"))), [
      JSON.stringify(["thread-a", "user-edit-source"]),
    ]);

    // Reconciliation must not discard another historical message being edited.
    client.failNextTurn = Object.assign(new Error("timed out"), { code: "RPC_TIMEOUT" });
    await editSource.locator(".message-edit").click();
    await page.waitForFunction(() => document.querySelector('[data-item-id="user-edit-source"] .history-message-editor')?.disabled === false);
    await editSource.locator(".history-message-editor").fill("结果待确认的历史重发");
    await editSource.locator(".history-message-edit-send").click();
    await page.waitForSelector(".msg.uncertain .message-reconcile");
    await editSource.locator(".history-message-edit-cancel").click();
    const otherEditSource = page.locator('[data-item-id="user-image"]');
    await otherEditSource.locator(".message-edit").click();
    await page.waitForFunction(() => document.querySelector('[data-item-id="user-image"] .history-message-editor')?.disabled === false);
    await otherEditSource.locator(".history-message-editor").fill("另一条尚未发送的历史编辑");
    const historyUncertainClientId = client.turnStarts.at(-1).clientUserMessageId;
    client.itemsByTurn.set(undefined, [{
      turnId: "turn-history-uncertain",
      item: { id: "user-history-uncertain", type: "userMessage", clientId: historyUncertainClientId },
    }]);
    await page.locator(".msg.uncertain .message-reconcile").click();
    await page.waitForFunction(() => document.querySelector('[data-item-id="user-image"] .history-message-editor')?.value === "另一条尚未发送的历史编辑");
    await otherEditSource.locator(".history-message-edit-cancel").click();

    client.failNextTurn = Object.assign(new Error("timed out"), { code: "RPC_TIMEOUT" });
    await page.locator("#composer-text").fill("unknown delivery");
    await page.locator("#send").click();
    await page.waitForSelector(".msg.uncertain .message-reconcile");
    assert.equal(await page.locator(".message-delivery-state").textContent(), "Send result pending confirmation");
    assert.equal((await page.locator(".msg.uncertain").textContent()).includes("unknown delivery"), true);

    // Clear the uncertain state by recording the message and reconciling it.
    const uncertainClientId = client.turnStarts.at(-1).clientUserMessageId;
    client.itemsByTurn.set(undefined, [{
      turnId: "turn-uncertain",
      item: { id: "user-uncertain", type: "userMessage", clientId: uncertainClientId },
    }]);
    const reconcileResponse = await page.evaluate(async (threadId) => {
      const response = await fetch(`/api/sessions/${threadId}/turns/reconcile`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      return response.json();
    }, "thread-a");
    assert.equal(reconcileResponse.status, "recorded");

    // Collection: select text, add an optional note, and write to Collect Viewer.
    let collectionPayload = null;
    await page.route("**/api/collections", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": `http://127.0.0.1:${port}`,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
        return;
      }
      collectionPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        headers: { "Access-Control-Allow-Origin": `http://127.0.0.1:${port}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: "collection-test" }),
      });
    });
    const collectTarget = page.locator('[data-item-id="user-edit-source"] .user-bubble .msg-body');
    await collectTarget.evaluate((node) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
      document.querySelector("#timeline").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.locator('.ann-bubble [aria-label="Collect selection"]').click();
    await page.locator(".collection-popup textarea").fill("独立收藏批注");
    await page.locator(".collection-popup button.primary").click();
    await page.waitForTimeout(200);
    assert.ok(collectionPayload, await page.locator("#toast-region").textContent());
    await page.waitForFunction(() => !document.querySelector(".collection-popup"));
    assert.equal(collectionPayload.quote, "完整的历史消息\n第二行");
    assert.equal(collectionPayload.note, "独立收藏批注");
    assert.equal(collectionPayload.source.threadId, "thread-a");
    assert.equal(collectionPayload.source.turnId, "turn-edit-source");
    assert.equal(collectionPayload.source.itemId, "user-edit-source");
    assert.equal(collectionPayload.source.role, "user");
    assert.equal(collectionPayload.source.sessionTitle, "Alpha");
    assert.equal(collectionPayload.source.viewerOrigin, `http://127.0.0.1:${port}`);
    assert.equal(collectionPayload.source.segments.length, 1);
    await page.unroute("**/api/collections");

    // Annotation: select text, save from the popup, prefix on send, then clear on success.
    const annTarget = page.locator(".msg.uncertain .user-bubble .msg-body");
    await annTarget.evaluate((node) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
      document.querySelector("#timeline").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForSelector(".ann-bubble");
    assert.equal(await page.locator("#timeline > .turn").last().evaluate((turn) => getComputedStyle(turn).borderBottomWidth), "0px");
    assert.equal(await page.locator('.ann-bubble [aria-label="Collect selection"]').count(), 0);
    assert.equal(await page.locator('.ann-bubble [aria-label="Annotate selection"]').count(), 1);
    await page.locator('.ann-bubble [aria-label="Annotate selection"]').click();
    await page.locator(".ann-popup textarea").fill("第一条批注");
    await page.locator(".ann-popup button.primary").click();
    await page.waitForSelector("#annotation-list:not([hidden])");
    assert.equal(await page.locator("#annotation-list-title").textContent(), "Annotations (1)");
    assert.equal(await page.locator("#annotation-body .ann-item").count(), 1);
    assert.equal(await page.locator(".ann-mark").count(), 1);
    await page.locator("#composer-text").fill("");
    assert.equal(await page.locator("#send").isEnabled(), true);
    await page.locator("#send").click();
    await page.waitForFunction(() => document.querySelector("#composer-send-status")?.textContent.includes("Sending"));
    assert.equal(client.turnStarts.at(-1).input[0].text, '1. "unknown delivery"\n\n   第一条批注');
    client.resolveTurnStart({ turn: { id: "turn-annotated", status: "inProgress" } });
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-annotated", status: "completed" } });
    sessions.completeActiveTurn("thread-a", "turn-annotated");
    await page.waitForFunction(() => document.querySelector("#annotation-list")?.hidden === true);
    assert.equal(await page.locator(".ann-mark").count(), 0);

    await annTarget.evaluate((node) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
      document.querySelector("#timeline").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    await page.waitForSelector(".ann-bubble");
    await page.locator('.ann-bubble [aria-label="Annotate selection"]').click();
    await page.locator(".ann-popup textarea").fill("第二条批注");
    await page.locator(".ann-popup button.primary").click();
    await page.locator("#composer-text").focus();
    await page.locator("#composer-text").press("Enter");
    await page.waitForFunction(() => document.querySelector("#composer-send-status")?.textContent.includes("Sending"));
    assert.equal(client.turnStarts.at(-1).input[0].text, '1. "unknown delivery"\n\n   第二条批注');
    client.resolveTurnStart({ turn: { id: "turn-annotated-enter", status: "inProgress" } });
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-annotated-enter", status: "completed" } });
    sessions.completeActiveTurn("thread-a", "turn-annotated-enter");
    await page.waitForFunction(() => document.querySelector("#annotation-list")?.hidden === true);

    eventBus.publish("thread.tokenUsage", {
      threadId: "thread-b",
      turnId: "turn-token-b",
      tokenUsage: {
        last: { inputTokens: 9_999, outputTokens: 2_400, totalTokens: 12_399 },
        total: { inputTokens: 400_000, outputTokens: 50_000, totalTokens: 450_000 },
      },
    });
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#composer-token-in").textContent(), "IN 5k");
    await page.locator('[data-thread-id="thread-b"]').first().click();
    await page.waitForSelector("#composer-text:not([disabled])");
    assert.equal(await page.locator("#composer-token-in").textContent(), "IN 9k");
    assert.equal(await page.locator("#composer-token-out").textContent(), "OUT 2k");
    await page.waitForTimeout(200);
    await page.locator("#timeline").evaluate((timeline) => { window.__backgroundTimelineChild = timeline.firstElementChild; });
    eventBus.publish("turn.started", { threadId: "thread-a", turn: { id: "turn-background", status: "inProgress" } });
    eventBus.publish("turn.completed", { threadId: "thread-a", turn: { id: "turn-background", status: "completed" } });
    await page.waitForFunction(() => document.querySelector('[data-thread-id="thread-a"] .status-dot')?.classList.contains("unread"));
    assert.equal(await page.locator("#timeline").evaluate((timeline) => timeline.firstElementChild === window.__backgroundTimelineChild), true);
    await page.evaluate(() => { delete window.__backgroundTimelineChild; });

    await page.locator('[data-thread-id="thread-a"]').first().click();
    await page.waitForFunction(() => document.querySelector("#thread-status .label")?.textContent === "Idle");
    client.staleUnsubscribeThreadIds.add("thread-a");
    await page.locator('[data-thread-id="thread-a"] .active-kill').first().click();
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Select a session");
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[data-thread-id="thread-a"].active-item').count(), 0);
    assert.equal(await page.locator('[data-thread-id="thread-a"].session-item').count(), 1);
    assert.equal(await page.locator('[data-thread-id="thread-child"]').count(), 0);

    let betaHistory = page.locator('[data-thread-id="thread-b"].session-item:not(.archived-item)');
    if (!(await betaHistory.isVisible())) await page.locator(".project-toggle").first().click();
    await betaHistory.hover();
    page.once("dialog", (dialog) => dialog.accept());
    await betaHistory.locator(".archive-btn").click();
    let archivedHeading = page.locator(".archived-label");
    const archivedBeta = page.locator('[data-thread-id="thread-b"].archived-item');
    await archivedHeading.waitFor();
    assert.equal(await archivedHeading.getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("#archived-session-list").isHidden(), true);
    assert.equal(await archivedBeta.isHidden(), true);
    await archivedHeading.click();
    assert.equal(await archivedHeading.getAttribute("aria-expanded"), "true");
    await archivedBeta.waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("codex-session.archivedExpanded")), "true");
    await page.reload({ waitUntil: "networkidle" });
    archivedHeading = page.locator(".archived-label");
    await archivedHeading.waitFor();
    assert.equal(await archivedHeading.getAttribute("aria-expanded"), "true");
    await archivedBeta.waitFor();
    await archivedBeta.locator(".session-open").click();
    await page.waitForFunction(() => document.querySelector("#thread-meta")?.textContent.includes("Archived · read-only"));
    assert.equal(await page.locator("#composer").isVisible(), false);
    assert.equal(await page.locator("#git-rail").isVisible(), true);
    assert.equal(await page.locator("#collect-viewer-button").isVisible(), true);
    assert.equal(await page.locator("#git-branch-button").isVisible(), false);
    await archivedBeta.hover();
    await archivedBeta.locator(".archive-btn").click();
    betaHistory = page.locator('[data-thread-id="thread-b"].session-item:not(.archived-item)');
    await betaHistory.waitFor();
    if (!(await betaHistory.isVisible())) await page.locator(".project-toggle").first().click();
    assert.equal(await page.locator(".session-item .delete-btn").count(), 0);
    const project = betaHistory.locator("xpath=ancestor::section[contains(@class,'project-item')]");
    await project.locator(".project-header").hover();
    await project.locator(".bulk-delete-btn").click();
    await betaHistory.locator(".session-select").check();
    assert.equal(await project.locator(".bulk-count").textContent(), "1 sessions selected");
    page.once("dialog", (dialog) => dialog.accept());
    await project.locator(".bulk-delete").click();
    await page.waitForFunction(() => !document.querySelector('[data-thread-id="thread-b"]'));

    await page.locator("#resizer").focus();
    const sidebarWidth = Number(await page.locator("#resizer").getAttribute("aria-valuenow"));
    await page.keyboard.press("ArrowRight");
    assert.equal(Number(await page.locator("#resizer").getAttribute("aria-valuenow")), sidebarWidth + 10);
    assert.equal(await page.locator("#composer-text").getAttribute("aria-label"), "Message to Codex");

    eventBus.publish("connection.state", { state: "offline", ready: false, expectedVersion: "0.153.2", actualVersion: "0.153.2" });
    await page.waitForFunction(() => document.querySelector("#connection-label")?.textContent === "Offline");
    assert.equal(await page.locator("#working-indicator").isVisible(), false);

    await page.setViewportSize({ width: 375, height: 812 });
    assert.equal(await page.locator("#mobile-nav-toggle").isVisible(), true);
    await page.locator("#mobile-nav-toggle").click();
    await page.locator('[data-thread-id="thread-a"].session-item .session-open').first().click();
    await page.waitForFunction(() => document.querySelector("#thread-title")?.textContent === "Alpha");
    const narrowRailDisplays = await page.evaluate(() => {
      const conversationRail = document.querySelector("#conversation-rail");
      const gitRail = document.querySelector("#git-rail");
      conversationRail.hidden = false;
      gitRail.hidden = false;
      return {
        conversation: getComputedStyle(conversationRail).display,
        git: getComputedStyle(gitRail).display,
      };
    });
    assert.equal(narrowRailDisplays.conversation, "flex");
    assert.equal(narrowRailDisplays.git, "flex");
    assert.equal(await page.locator("#conversation-head").isVisible(), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector("#conversation-head")).opacity), "1");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 375);
    await page.locator("#mobile-nav-toggle").click();
    assert.equal(await page.evaluate(() => document.body.classList.contains("nav-open")), true);
    assert.equal(await page.locator("#scrim").isVisible(), true);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector('[data-thread-id="thread-a"]'));
    await page.waitForFunction(() => document.querySelector("#composer-model")?.textContent === "Test Model B");
    assert.equal(await page.locator("#composer-effort").textContent(), "· high");
    assert.equal(await page.locator("#composer-mode-label").textContent(), "Default");
    assert.equal(await page.locator("#composer-mode-toggle").getAttribute("aria-pressed"), "false");
    assert.equal(errors.filter((message) => message.includes("504")).length, 2);
    assert.deepEqual(errors.filter((message) => !message.includes("504")), []);
  } finally {
    await browser.close();
    await close(server);
  }
});
