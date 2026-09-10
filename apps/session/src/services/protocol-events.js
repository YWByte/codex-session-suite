import { normalizeItem, normalizeTurn } from "./item-normalizer.js";

function statusType(status) {
  if (typeof status === "string") return status;
  if (status && typeof status === "object") return status.type || status.status || "unknown";
  return "unknown";
}

function activeFlags(status) {
  return statusType(status) === "active" && Array.isArray(status?.activeFlags)
    ? status.activeFlags
    : [];
}

export function connectProtocolEvents(client, navigation, sessions, requests, eventBus) {
  client.on("state", (health) => {
    if (health.state === "offline" || health.state === "stopped") {
      requests.expireAll(health.state);
      sessions.resetConnection();
    }
    eventBus.publish("connection.state", health);
  });
  client.on("serverRequest", (request) => requests.add(request));
  client.on("protocolError", () => eventBus.publish("connection.protocolError", { message: "Codex 协议流无效" }));

  client.on("notification", ({ method, params }) => {
    const threadId = params.threadId || params.thread?.id || null;
    const turnId = params.turnId || params.turn?.id || null;
    const itemId = params.itemId || params.item?.id || null;

    switch (method) {
      case "thread/started": {
        const thread = navigation.upsert(params.thread);
        sessions.recordThreadStarted(thread);
        eventBus.publish("thread.started", { thread });
        break;
      }
      case "thread/status/changed": {
        const thread = navigation.updateStatus(threadId, params.status);
        eventBus.publish("thread.status", {
          threadId,
          status: thread?.status || statusType(params.status),
          activeFlags: thread?.activeFlags || activeFlags(params.status),
        });
        break;
      }
      case "thread/name/updated": {
        const existing = navigation.getThread(threadId);
        const thread = existing ? navigation.upsert({ ...existing, name: params.threadName || null }) : null;
        eventBus.publish("thread.name.updated", { threadId, name: params.threadName || null, thread });
        break;
      }
      case "thread/settings/updated": {
        const existing = navigation.getThread(threadId);
        const settings = params.threadSettings || params.settings || {};
        sessions.recordThreadSettings(threadId, settings);
        const thread = existing ? navigation.upsert({
          ...existing,
          ...(typeof settings.model === "string" ? { model: settings.model } : {}),
          ...(typeof (settings.reasoningEffort ?? settings.reasoning_effort ?? settings.effort) === "string"
            ? { reasoningEffort: settings.reasoningEffort ?? settings.reasoning_effort ?? settings.effort }
            : {}),
        }) : null;
        eventBus.publish("thread.settings", { threadId, thread });
        break;
      }
      case "thread/archived":
        sessions.forgetThread(threadId);
        navigation.markArchived(threadId);
        eventBus.publish("thread.archived", { threadId });
        eventBus.publish("navigation.invalidated", { threadId });
        break;
      case "thread/deleted":
        sessions.forgetThread(threadId);
        navigation.remove(threadId);
        eventBus.publish("thread.deleted", { threadId });
        eventBus.publish("navigation.invalidated", { threadId });
        break;
      case "thread/unarchived":
        sessions.forgetThread(threadId);
        navigation.removeArchived(threadId);
        eventBus.publish("thread.unarchived", { threadId });
        eventBus.publish("navigation.invalidated", { threadId });
        break;
      case "thread/closed":
        sessions.closeThread(threadId);
        navigation.updateStatus(threadId, { type: "notLoaded" });
        eventBus.publish("thread.closed", { threadId });
        eventBus.publish("navigation.invalidated", { threadId });
        break;
      case "turn/started":
        sessions.setActiveTurn(threadId, turnId);
        eventBus.publish("turn.started", { threadId, turn: normalizeTurn(params.turn, threadId) });
        break;
      case "item/started":
        eventBus.publish("item.started", {
          threadId,
          turnId,
          item: {
            ...normalizeItem({ ...params.item, startedAtMs: params.startedAtMs }, { threadId, turnId }),
            lifecycleStatus: "started",
          },
        });
        break;
      case "item/agentMessage/delta":
        eventBus.publish("item.delta", { threadId, turnId, itemId, field: "text", delta: params.delta || "" });
        break;
      case "item/reasoning/summaryTextDelta":
        eventBus.publish("item.delta", {
          threadId,
          turnId,
          itemId,
          field: "summary",
          delta: params.delta || "",
          summaryIndex: params.summaryIndex ?? null,
        });
        break;
      case "item/reasoning/textDelta":
        eventBus.publish("item.delta", {
          threadId,
          turnId,
          itemId,
          field: "content",
          delta: params.delta || "",
          contentIndex: params.contentIndex ?? null,
        });
        break;
      case "item/plan/delta":
        eventBus.publish("item.delta", {
          threadId,
          turnId,
          itemId,
          itemType: "plan",
          field: "text",
          delta: params.delta || "",
        });
        break;
      case "item/commandExecution/outputDelta":
        eventBus.publish("item.delta", { threadId, turnId, itemId, field: "output", delta: params.delta || "" });
        break;
      case "item/fileChange/patchUpdated":
        eventBus.publish("item.patch", { threadId, turnId, itemId, changes: params.changes || [] });
        break;
      case "item/mcpToolCall/progress":
        eventBus.publish("item.progress", { threadId, turnId, itemId, message: params.message || "" });
        break;
      case "item/completed":
        eventBus.publish("item.completed", {
          threadId,
          turnId,
          item: {
            ...normalizeItem({ ...params.item, completedAtMs: params.completedAtMs }, { threadId, turnId }),
            lifecycleStatus: "completed",
          },
        });
        break;
      case "turn/diff/updated":
        eventBus.publish("turn.diff", { threadId, turnId, diff: params.diff || "" });
        break;
      case "turn/plan/updated":
        eventBus.publish("turn.plan", { threadId, turnId, plan: params.plan || [] });
        break;
      case "turn/completed": {
        const turn = normalizeTurn(params.turn, threadId);
        sessions.completeActiveTurn(threadId, turnId);
        eventBus.publish("turn.completed", { threadId, turn });
        if (sessions.refreshTokenUsage) {
          void sessions.refreshTokenUsage(threadId).then((tokenUsage) => {
            if (tokenUsage) eventBus.publish("thread.tokenUsage", { threadId, turnId, tokenUsage });
          });
        }
        break;
      }
      case "thread/tokenUsage/updated": {
        const tokenUsage = params.tokenUsage || params.usage || null;
        const thread = navigation.getThread(threadId);
        if (thread && tokenUsage) navigation.upsert({ ...thread, tokenUsage });
        eventBus.publish("thread.tokenUsage", { threadId, turnId, tokenUsage });
        break;
      }
      case "serverRequest/resolved":
        requests.markResolvedByRpcId(params.requestId);
        break;
      case "error":
        eventBus.publish("turn.error", {
          threadId,
          turnId,
          error: params.error?.message || "Codex 执行发生错误",
          willRetry: Boolean(params.willRetry),
        });
        break;
      default:
        break;
    }
  });
}
