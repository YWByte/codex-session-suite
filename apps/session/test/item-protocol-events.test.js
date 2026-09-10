import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { EventBus } from "../src/http/event-bus.js";
import { normalizeItem, normalizeTurn } from "../src/services/item-normalizer.js";
import { connectProtocolEvents } from "../src/services/protocol-events.js";

class FakeClient extends EventEmitter {}

test("item normalizer maps known items, preserves lifecycle timing, and safely degrades unknown items", () => {
  assert.deepEqual(normalizeItem({ id: "u1", type: "userMessage", content: [{ type: "text", text: "你好" }] }, { threadId: "t", turnId: "r" }), {
    id: "u1", threadId: "t", turnId: "r", type: "userMessage", status: null, text: "你好", images: [], unavailableImages: [], clientId: null,
  });
  const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
  const media = normalizeItem({
    id: "u2",
    type: "userMessage",
    content: [
      { type: "text", text: "看图" },
      { type: "image", url: imageUrl, detail: "high" },
      { type: "localImage", path: "/private/secret.png" },
      { type: "image", url: "https://example.test/image.png" },
    ],
  });
  assert.equal(media.text, "看图");
  assert.deepEqual(media.images, [{ kind: "inline", src: imageUrl, detail: "high" }]);
  assert.deepEqual(media.unavailableImages, [
    { kind: "local", label: "本地图片不可预览" },
    { kind: "invalid", label: "图片不可预览" },
  ]);
  assert.doesNotMatch(JSON.stringify(media), /private\/secret/);

  const fullCommandOutput = `OUTPUT-${"😀".repeat(2_000)}`;
  const command = normalizeItem({ id: "command", type: "commandExecution", output: fullCommandOutput });
  assert.equal(command.output, fullCommandOutput, "protocol normalization must retain full tool output");

  const reasoning = normalizeItem({
    id: "reason",
    type: "reasoning",
    summary: ["第一段", "第二段"],
    content: ["正文"],
    startedAtMs: 100,
    completedAtMs: 200,
  });
  assert.equal(reasoning.summary, "第一段第二段");
  assert.equal(reasoning.content, "正文");
  assert.equal(reasoning.startedAtMs, 100);
  assert.equal(reasoning.completedAtMs, 200);

  const collaboration = normalizeItem({
    id: "collab",
    type: "collabAgentToolCall",
    senderThreadId: "parent",
    receiverThreadIds: ["child"],
    tool: "spawn_agent",
    model: "gpt-test",
    reasoningEffort: "high",
    agentsStates: { child: "running" },
  });
  assert.equal(collaboration.senderThreadId, "parent");
  assert.deepEqual(collaboration.receiverThreadIds, ["child"]);
  assert.equal(collaboration.model, "gpt-test");
  assert.equal(collaboration.reasoningEffort, "high");
  const activity = normalizeItem({ id: "activity", type: "subAgentActivity", agentThreadId: "child", agentPath: "parent/child" });
  assert.equal(activity.agentThreadId, "child");
  assert.equal(activity.agentPath, "parent/child");
  const compaction = normalizeItem({ id: "compact", type: "contextCompaction" });
  assert.equal(compaction.message, "上下文已压缩");

  const unknown = normalizeItem({ id: "x", type: "futureItem", nested: { html: "<script>alert(1)</script>" } });
  assert.equal(unknown.type, "futureItem");
  assert.match(unknown.summary, /暂不支持/);
  assert.equal(Object.hasOwn(unknown, "raw"), false);

  const turn = normalizeTurn({
    id: "r",
    status: "completed",
    createdAt: 10,
    completedAt: 20,
    durationMs: 10_000,
    items: [{ id: "a", type: "agentMessage", text: "done" }],
  }, "t");
  assert.equal(turn.startedAt, 10);
  assert.equal(turn.completedAt, 20);
  assert.equal(turn.durationMs, 10_000);
  assert.equal(turn.items[0].text, "done");
  assert.equal(turn.items[0].turnId, "r");
});

test("protocol events preserve thread status, lifecycle notifications, and item protocol details", () => {
  const client = new FakeClient();
  const emitted = [];
  const eventBus = new EventBus();
  eventBus.on("event", (event) => emitted.push(event));
  const calls = [];
  const activeTurns = new Map();
  const navigation = {
    upsert(thread) { calls.push(["upsert", thread]); return thread; },
    getThread() { return { id: "thread-1", name: "old" }; },
    remove(id) { calls.push(["remove", id]); },
    markArchived(id) { calls.push(["archive", id]); },
    removeArchived(id) { calls.push(["unarchive", id]); },
    updateStatus(id, status) {
      calls.push(["status", id, status]);
      return { id, status: status.type || status, activeFlags: status.activeFlags || [] };
    },
  };
  const sessions = {
    setActiveTurn(threadId, turnId) {
      calls.push(["turn", threadId, turnId]);
      activeTurns.set(threadId, turnId);
    },
    completeActiveTurn(threadId, turnId) {
      calls.push(["complete", threadId, turnId]);
      if (activeTurns.get(threadId) !== turnId) return false;
      activeTurns.delete(threadId);
      return true;
    },
    recordThreadStarted(thread) { calls.push(["started", thread?.id]); },
    recordThreadSettings(threadId, settings) { calls.push(["settings", threadId, settings]); },
    closeThread(threadId) { calls.push(["close", threadId]); activeTurns.delete(threadId); },
    forgetThread(threadId) { calls.push(["forget", threadId]); activeTurns.delete(threadId); },
    resetConnection() { calls.push(["reset"]); },
  };
  const requests = {
    add(request) { calls.push(["request", request]); },
    expireAll(reason) { calls.push(["expire", reason]); },
    markResolvedByRpcId(id) { calls.push(["resolved", id]); },
  };
  connectProtocolEvents(client, navigation, sessions, requests, eventBus);

  client.emit("notification", {
    method: "thread/started",
    params: { thread: { id: "thread-child", parentThreadId: "thread-1" } },
  });
  client.emit("notification", {
    method: "thread/name/updated",
    params: { threadId: "thread-child", threadName: "Named child" },
  });
  client.emit("notification", {
    method: "thread/status/changed",
    params: { threadId: "thread-1", status: { type: "active", activeFlags: ["waitingOnApproval", "waitingOnUserInput"] } },
  });
  client.emit("notification", {
    method: "thread/settings/updated",
    params: { threadId: "thread-1", threadSettings: { model: "model-new", effort: "high" } },
  });
  const tokenUsage = {
    last: { inputTokens: 5_152, cachedInputTokens: 3_072, outputTokens: 16, reasoningOutputTokens: 0, totalTokens: 5_168 },
    total: { inputTokens: 91_234, outputTokens: 8_765, totalTokens: 99_999 },
    modelContextWindow: 258_400,
  };
  client.emit("notification", {
    method: "thread/tokenUsage/updated",
    params: { threadId: "thread-1", turnId: "turn-new", tokenUsage },
  });
  client.emit("notification", { method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-old", status: "inProgress" } } });
  client.emit("notification", { method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-new", status: "inProgress" } } });
  client.emit("notification", { method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-old", status: "completed" } } });
  assert.equal(activeTurns.get("thread-1"), "turn-new", "an old completion must not clear the newer active turn");

  client.emit("notification", { method: "item/started", params: { threadId: "thread-1", turnId: "turn-new", item: { id: "item-1", type: "reasoning" }, startedAtMs: 100 } });
  client.emit("notification", { method: "item/reasoning/summaryTextDelta", params: { threadId: "thread-1", turnId: "turn-new", itemId: "item-1", summaryIndex: 2, delta: "summary" } });
  client.emit("notification", { method: "item/reasoning/textDelta", params: { threadId: "thread-1", turnId: "turn-new", itemId: "item-1", contentIndex: 3, delta: "content" } });
  const fullOutputDelta = `DELTA-${"字".repeat(2_000)}`;
  client.emit("notification", { method: "item/commandExecution/outputDelta", params: { threadId: "thread-1", turnId: "turn-new", itemId: "command-1", delta: fullOutputDelta } });
  client.emit("notification", { method: "item/plan/delta", params: { threadId: "thread-1", turnId: "turn-new", itemId: "plan-1", delta: "plan" } });
  client.emit("notification", { method: "item/completed", params: { threadId: "thread-1", turnId: "turn-new", item: { id: "late", type: "agentMessage", text: "late" }, completedAtMs: 200 } });
  client.emit("notification", { method: "serverRequest/resolved", params: { threadId: "thread-1", requestId: 42 } });

  for (const method of ["thread/archived", "thread/deleted", "thread/unarchived", "thread/closed"]) {
    client.emit("notification", { method, params: { threadId: "thread-1" } });
  }

  const status = emitted.find((event) => event.type === "thread.status");
  assert.deepEqual(status.data.activeFlags, ["waitingOnApproval", "waitingOnUserInput"]);
  assert.ok(calls.some(([type, id]) => type === "started" && id === "thread-child"));
  assert.ok(emitted.some((event) => event.type === "thread.name.updated" && event.data.name === "Named child"));
  assert.ok(emitted.some((event) => event.type === "thread.settings" && event.data.thread.model === "model-new" && event.data.thread.reasoningEffort === "high"));
  assert.ok(emitted.some((event) => event.type === "item.started" && event.data.item.startedAtMs === 100));
  assert.ok(emitted.some((event) => event.type === "item.completed" && event.data.item.completedAtMs === 200));
  assert.ok(emitted.some((event) => event.type === "item.delta" && event.data.field === "summary" && event.data.summaryIndex === 2));
  assert.ok(emitted.some((event) => event.type === "item.delta" && event.data.field === "content" && event.data.contentIndex === 3));
  assert.equal(emitted.find((event) => event.type === "item.delta" && event.data.field === "output")?.data.delta, fullOutputDelta);
  assert.ok(emitted.some((event) => event.type === "item.delta" && event.data.itemType === "plan"));
  assert.deepEqual(emitted.find((event) => event.type === "thread.tokenUsage")?.data, {
    threadId: "thread-1",
    turnId: "turn-new",
    tokenUsage,
  });
  assert.ok(emitted.some((event) => event.type === "turn.completed" && event.data.turn.status === "completed"));
  for (const type of ["thread.archived", "thread.deleted", "thread.unarchived", "thread.closed"]) {
    assert.ok(emitted.some((event) => event.type === type));
  }
  assert.equal(emitted.filter((event) => event.type === "navigation.invalidated").length, 4);
  assert.ok(calls.some(([type, id]) => type === "resolved" && id === 42));
});
