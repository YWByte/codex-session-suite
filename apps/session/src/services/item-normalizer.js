import { normalizeImageInputs } from "./image-input.js";

function textParts(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part === "string" ? part : part && typeof part.text === "string" ? part.text : "")
    .join("");
}

function mediaParts(content) {
  if (!Array.isArray(content)) return { images: [], unavailableImages: [] };
  const images = [];
  const unavailableImages = [];
  for (const part of content) {
    if (part?.type === "image") {
      try {
        const [input] = normalizeImageInputs([{ url: part.url, detail: part.detail }]);
        images.push({ kind: "inline", src: input.url, detail: input.detail });
      } catch {
        unavailableImages.push({ kind: "invalid", label: "图片不可预览" });
      }
    } else if (part?.type === "localImage") {
      unavailableImages.push({ kind: "local", label: "本地图片不可预览" });
    }
  }
  return { images, unavailableImages };
}

function safeValue(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 200_000 ? `${value.slice(0, 200_000)}\n…[truncated]` : value;
  if (Array.isArray(value)) return value.slice(0, 500).map((entry) => safeValue(entry, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, entry]) => [key, safeValue(entry, depth + 1)]));
  }
  return String(value);
}

export function normalizeTurn(turn, threadId) {
  return {
    id: turn?.id || null,
    threadId: threadId || turn?.threadId || null,
    status: turn?.status || null,
    error: safeValue(turn?.error),
    startedAt: turn?.startedAt ?? turn?.started_at ?? turn?.createdAt ?? turn?.created_at ?? null,
    completedAt: turn?.completedAt ?? turn?.completed_at ?? null,
    durationMs: turn?.durationMs ?? turn?.duration_ms ?? null,
    items: Array.isArray(turn?.items)
      ? turn.items.map((item) => normalizeItem(item, { threadId: threadId || turn?.threadId, turnId: turn?.id }))
      : [],
  };
}

function itemTiming(item) {
  const startedAtMs = item?.startedAtMs ?? item?.started_at_ms;
  const completedAtMs = item?.completedAtMs ?? item?.completed_at_ms;
  return {
    ...(startedAtMs === undefined ? {} : { startedAtMs: safeValue(startedAtMs) }),
    ...(completedAtMs === undefined ? {} : { completedAtMs: safeValue(completedAtMs) }),
  };
}

export function normalizeItem(item, context = {}) {
  const base = {
    id: item?.id || context.itemId || null,
    threadId: context.threadId || item?.threadId || null,
    turnId: context.turnId || item?.turnId || null,
    type: item?.type || "unknown",
    status: item?.status || null,
    ...itemTiming(item),
  };

  switch (item?.type) {
    case "userMessage":
      return {
        ...base,
        text: textParts(item.content ?? item.text),
        ...mediaParts(item.content),
        clientId: item.clientId || null,
      };
    case "agentMessage":
      return { ...base, text: textParts(item.content ?? item.text), phase: item.phase || null };
    case "reasoning":
      return { ...base, summary: textParts(item.summary), content: textParts(item.content) };
    case "plan":
      return { ...base, text: textParts(item.text ?? item.content), entries: safeValue(item.entries || item.plan || []) };
    case "commandExecution":
      return {
        ...base,
        command: item.command || "",
        cwd: item.cwd || null,
        output: textParts(item.aggregatedOutput ?? item.output),
        exitCode: item.exitCode ?? null,
        durationMs: item.durationMs ?? null,
      };
    case "fileChange":
      return { ...base, changes: safeValue(item.changes || []), diff: textParts(item.diff) };
    case "mcpToolCall":
      return { ...base, server: item.server || item.serverName || null, tool: item.tool || item.toolName || null, arguments: safeValue(item.arguments), result: safeValue(item.result), error: safeValue(item.error) };
    case "collabAgentToolCall":
    case "collabToolCall":
      return {
        ...base,
        tool: item.tool || item.toolName || null,
        senderThreadId: item.senderThreadId || null,
        receiverThreadIds: safeValue(item.receiverThreadIds || []),
        prompt: item.prompt || null,
        model: item.model || null,
        reasoningEffort: item.reasoningEffort || null,
        agentsStates: safeValue(item.agentsStates || {}),
      };
    case "subAgentActivity":
      return { ...base, agentThreadId: item.agentThreadId || null, agentPath: safeValue(item.agentPath || []) };
    case "contextCompaction":
      return { ...base, message: "上下文已压缩" };
    default:
      return {
        ...base,
        summary: `暂不支持的 Item 类型：${base.type}`,
        metadata: safeValue({ name: item?.name, tool: item?.tool, phase: item?.phase }),
      };
  }
}
