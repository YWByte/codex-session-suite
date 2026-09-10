import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";

export const SUPPORTED_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/permissions/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
]);

function boundedValue(value, depth = 0) {
  if (depth > 6) return "[truncated]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 100_000 ? `${value.slice(0, 100_000)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => boundedValue(entry, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, entry]) => [key, boundedValue(entry, depth + 1)]));
  }
  return String(value);
}

function publicRequest(entry) {
  return {
    requestId: entry.requestId,
    method: entry.method,
    threadId: entry.threadId,
    turnId: entry.turnId,
    itemId: entry.itemId,
    params: boundedValue(entry.params),
    receivedAt: entry.receivedAt,
    status: entry.status,
  };
}

function sameJson(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameJson(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameJson(left[key], right[key]));
}

function validateSchemaValue(value, schema, path) {
  if (!schema || typeof schema !== "object") throw new AppError(400, "unsupported_schema", `${path} 的表单定义不受支持`);
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => sameJson(entry, value))) {
    throw new AppError(400, "invalid_content", `${path} 不在允许选项中`);
  }
  switch (schema.type) {
    case "string":
      if (typeof value !== "string") throw new AppError(400, "invalid_content", `${path} 必须是字符串`);
      if (Number.isFinite(schema.minLength) && value.length < schema.minLength) throw new AppError(400, "invalid_content", `${path} 长度不足`);
      if (Number.isFinite(schema.maxLength) && value.length > schema.maxLength) throw new AppError(400, "invalid_content", `${path} 长度超限`);
      return;
    case "number":
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value))) {
        throw new AppError(400, "invalid_content", `${path} 必须是有效数字`);
      }
      if (Number.isFinite(schema.minimum) && value < schema.minimum) throw new AppError(400, "invalid_content", `${path} 小于最小值`);
      if (Number.isFinite(schema.maximum) && value > schema.maximum) throw new AppError(400, "invalid_content", `${path} 超过最大值`);
      return;
    case "boolean":
      if (typeof value !== "boolean") throw new AppError(400, "invalid_content", `${path} 必须是布尔值`);
      return;
    default:
      throw new AppError(400, "unsupported_schema", `${path} 的字段类型不受支持`);
  }
}

function validateFormContent(schema, content) {
  if (!schema || schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") {
    throw new AppError(400, "unsupported_schema", "该 MCP 表单结构不受支持，只能拒绝或取消");
  }
  const allowed = new Set(Object.keys(schema.properties));
  for (const key of Object.keys(content)) {
    if (!allowed.has(key)) throw new AppError(400, "invalid_content", `MCP 表单包含未知字段：${key}`);
  }
  for (const key of schema.required || []) {
    if (!Object.hasOwn(content, key)) throw new AppError(400, "invalid_content", `MCP 表单缺少必填字段：${key}`);
  }
  for (const [key, value] of Object.entries(content)) validateSchemaValue(value, schema.properties[key], key);
}

function isPermissionSubset(requested, granted, depth = 0) {
  if (depth > 8) return false;
  if (!granted || typeof granted !== "object" || Array.isArray(granted)) return false;
  if (!requested || typeof requested !== "object" || Array.isArray(requested)) return Object.keys(granted).length === 0;

  for (const [category, grant] of Object.entries(granted)) {
    const request = requested[category];
    if (request === undefined) return false;
    if (grant == null) continue;
    if (Array.isArray(grant)) {
      if (!Array.isArray(request) || grant.some((value) => !request.some((candidate) => sameJson(candidate, value)))) return false;
      continue;
    }
    if (typeof grant === "object") {
      if (!isPermissionSubset(request, grant, depth + 1)) return false;
      continue;
    }
    if (grant !== request) return false;
  }
  return true;
}

export class RequestRegistry {
  #client;
  #eventBus;
  #entries = new Map();

  constructor(client, eventBus) {
    this.#client = client;
    this.#eventBus = eventBus;
  }

  add(request) {
    if (!SUPPORTED_SERVER_REQUESTS.has(request.method)) {
      this.#client.respondError(request.id, -32601, `Unsupported client request: ${request.method}`);
      this.#eventBus.publish("request.unsupported", { method: request.method });
      return null;
    }
    const params = request.params || {};
    const requestId = `req_${randomUUID()}`;
    const entry = {
      requestId,
      rpcId: request.id,
      method: request.method,
      threadId: params.threadId || params.thread_id || null,
      turnId: params.turnId || params.turn_id || null,
      itemId: params.itemId || params.item_id || null,
      params,
      receivedAt: new Date().toISOString(),
      status: "pending",
    };
    this.#entries.set(requestId, entry);
    this.#eventBus.publish("request.pending", publicRequest(entry));
    return publicRequest(entry);
  }

  pending() {
    return [...this.#entries.values()].filter((entry) => entry.status === "pending" || entry.status === "responding").map(publicRequest);
  }

  expireAll(reason = "app_server_offline") {
    for (const entry of this.#entries.values()) {
      if (entry.status !== "pending" && entry.status !== "responding") continue;
      entry.status = "expired";
      entry.resolvedAt = new Date().toISOString();
      this.#eventBus.publish("request.expired", {
        requestId: entry.requestId,
        method: entry.method,
        threadId: entry.threadId,
        turnId: entry.turnId,
        itemId: entry.itemId,
        reason,
      });
    }
  }

  markResolvedByRpcId(rpcId) {
    const entry = [...this.#entries.values()].find((candidate) => candidate.rpcId === rpcId && (candidate.status === "pending" || candidate.status === "responding"));
    if (!entry) return null;
    entry.status = "resolved";
    entry.resolvedAt = new Date().toISOString();
    this.#eventBus.publish("request.resolved", {
      requestId: entry.requestId,
      method: entry.method,
      threadId: entry.threadId,
      turnId: entry.turnId,
      itemId: entry.itemId,
    });
    return publicRequest(entry);
  }

  resolve(requestId, body) {
    const entry = this.#entries.get(requestId);
    if (!entry) throw new AppError(404, "request_not_found", "待处理请求不存在");
    if (entry.status !== "pending") throw new AppError(409, "request_resolved", "该请求已经处理");

    const result = this.#validate(entry, body || {});
    this.#client.respond(entry.rpcId, result);
    entry.status = "responding";
    entry.respondedAt = new Date().toISOString();
    this.#eventBus.publish("request.responding", publicRequest(entry));
    return { requestId, status: entry.status };
  }

  #validate(entry, body) {
    if (entry.method === "item/commandExecution/requestApproval") {
      const configured = Array.isArray(entry.params.availableDecisions) ? entry.params.availableDecisions : null;
      const defaults = ["accept", "acceptForSession", "decline", "cancel"];
      const allowed = configured || defaults;
      if (!allowed.some((decision) => sameJson(decision, body.decision))) {
        throw new AppError(400, "invalid_decision", "该命令审批不允许此选择");
      }
      return { decision: body.decision };
    }
    if (entry.method === "item/fileChange/requestApproval") {
      const allowed = new Set(["accept", "acceptForSession", "decline", "cancel"]);
      if (!allowed.has(body.decision)) throw new AppError(400, "invalid_decision", "审批选择无效");
      return { decision: body.decision };
    }
    if (entry.method === "item/permissions/requestApproval") {
      const scope = body.scope || "turn";
      if (scope !== "turn" && scope !== "session") {
        throw new AppError(400, "invalid_scope", "权限范围无效");
      }
      const permissions = body.permissions || {};
      if (!isPermissionSubset(entry.params.permissions, permissions)) {
        throw new AppError(400, "invalid_permissions", "只能授予请求权限的子集");
      }
      return { scope, permissions };
    }
    if (entry.method === "item/tool/requestUserInput") {
      if (!body.answers || typeof body.answers !== "object" || Array.isArray(body.answers)) {
        throw new AppError(400, "invalid_answers", "用户问题必须提交 answers 对象");
      }
      const questions = Array.isArray(entry.params.questions) ? entry.params.questions : [];
      const questionIds = new Set(questions.map((question) => question.id));
      if (Object.keys(body.answers).some((id) => !questionIds.has(id)) || questions.some((question) => !Object.hasOwn(body.answers, question.id))) {
        throw new AppError(400, "invalid_answers", "答案必须与本次所有问题一一对应");
      }
      for (const question of questions) {
        const answer = body.answers[question.id];
        if (!answer || !Array.isArray(answer.answers) || answer.answers.length === 0 || answer.answers.some((value) => typeof value !== "string")) {
          throw new AppError(400, "invalid_answers", "每个问题必须提交至少一个字符串答案");
        }
        if (!question.multiSelect && answer.answers.length !== 1) {
          throw new AppError(400, "invalid_answers", `${question.id} 只能提交一个答案`);
        }
        const labels = new Set((question.options || []).map((option) => option.label));
        if (labels.size && !question.isOther && answer.answers.some((value) => !labels.has(value))) {
          throw new AppError(400, "invalid_answers", `${question.id} 只能选择给定选项`);
        }
      }
      return { answers: body.answers };
    }
    if (entry.method === "mcpServer/elicitation/request") {
      const allowed = new Set(["accept", "decline", "cancel"]);
      if (!allowed.has(body.action)) throw new AppError(400, "invalid_action", "MCP 表单选择无效");
      const formMode = entry.params.mode === "form" || entry.params.mode === "openaiForm" || entry.params.mode === "openai/form";
      if (body.action === "accept" && formMode && (!body.content || typeof body.content !== "object" || Array.isArray(body.content))) {
        throw new AppError(400, "invalid_content", "接受 MCP 表单时必须提交内容对象");
      }
      if (body.content != null && (typeof body.content !== "object" || Array.isArray(body.content))) {
        throw new AppError(400, "invalid_content", "MCP 表单内容必须是对象");
      }
      if (body.action === "accept" && formMode) validateFormContent(entry.params.requestedSchema, body.content);
      if (body.action === "accept" && entry.params.mode !== "url" && !formMode) {
        throw new AppError(400, "unsupported_schema", "该 MCP 请求模式不受支持，只能拒绝或取消");
      }
      return { action: body.action, content: body.content ?? null, _meta: null };
    }
    throw new AppError(400, "unsupported_request", "不支持该请求");
  }
}
