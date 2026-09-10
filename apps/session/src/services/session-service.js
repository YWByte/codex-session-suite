import { randomUUID } from "node:crypto";
import { AppError } from "../errors.js";
import { normalizeItem, normalizeTurn } from "./item-normalizer.js";
import { hasMessageContent, normalizeImageInputs } from "./image-input.js";
import { normalizeThread } from "./navigation.js";

const VIEWER_THREAD_PERMISSIONS = Object.freeze({
  approvalPolicy: "never",
  sandbox: "danger-full-access",
});
const VIEWER_SANDBOX_POLICY = Object.freeze({ type: "dangerFullAccess" });
const PERMISSION_UPDATE_TIMEOUT_MS = 5_000;
const COLLABORATION_MODES = new Set(["default", "plan"]);
const SELECTABLE_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
const MAX_MODEL_PAGES = 20;
const HISTORICAL_RESEND_CONTEXT = "这条消息是用户编辑历史消息后作为当前会话的最新请求重新发送的。请将紧随此说明的用户消息视为最新且有效的要求；若它与此前任何用户请求、计划或待执行方向冲突，以该消息为准并停止沿用冲突内容。保留不冲突的上下文、已经完成的事实和当前工作区状态。";

function collaborationModeOf(value) {
  const mode = value === undefined ? "default" : value;
  if (typeof mode !== "string" || !COLLABORATION_MODES.has(mode)) {
    throw new AppError(400, "invalid_collaboration_mode", "collaborationMode 必须是 default 或 plan");
  }
  return mode;
}

function collaborationModeSettings(mode, model, reasoningEffort = mode === "plan" ? "medium" : null) {
  if (typeof model !== "string" || !model) {
    throw new AppError(409, "thread_model_unavailable", "Codex 未返回当前 Thread 的模型，无法设置对话模式");
  }
  return {
    mode,
    settings: {
      model,
      reasoning_effort: reasoningEffort,
      developer_instructions: null,
    },
  };
}

function normalizeReasoningOptions(model) {
  const options = model?.supportedReasoningEfforts ?? model?.supported_reasoning_efforts;
  if (!Array.isArray(options)) return [];
  return options.flatMap((option) => {
    const reasoningEffort = typeof option === "string"
      ? option
      : option?.reasoningEffort ?? option?.reasoning_effort;
    if (!SELECTABLE_REASONING_EFFORTS.has(reasoningEffort)) return [];
    return [{
      reasoningEffort,
      description: typeof option?.description === "string" ? option.description : "",
    }];
  });
}

function normalizeModel(model) {
  const value = typeof model?.model === "string" ? model.model.trim() : "";
  if (!value || model?.hidden === true) return null;
  const supportedReasoningEfforts = normalizeReasoningOptions(model);
  const defaultReasoningEffort = model?.defaultReasoningEffort ?? model?.default_reasoning_effort;
  return {
    id: typeof model.id === "string" && model.id ? model.id : value,
    model: value,
    displayName: typeof model.displayName === "string" && model.displayName
      ? model.displayName
      : typeof model.display_name === "string" && model.display_name
        ? model.display_name
        : value,
    description: typeof model.description === "string" ? model.description : "",
    supportedReasoningEfforts,
    defaultReasoningEffort: supportedReasoningEfforts.some((option) => option.reasoningEffort === defaultReasoningEffort)
      ? defaultReasoningEffort
      : supportedReasoningEfforts[0]?.reasoningEffort || null,
    isDefault: model.isDefault === true || model.is_default === true,
  };
}

function selectedModelSettings(body, models, fallbackModel, mode) {
  const hasModel = body.model !== undefined;
  const hasEffort = body.reasoningEffort !== undefined;
  if (!hasModel && !hasEffort) {
    return { model: fallbackModel, reasoningEffort: mode === "plan" ? "medium" : null };
  }
  if (!hasModel || !hasEffort || typeof body.model !== "string" || typeof body.reasoningEffort !== "string") {
    throw new AppError(400, "invalid_model_selection", "model 和 reasoningEffort 必须同时提供");
  }
  const model = models.find((entry) => entry.model === body.model);
  if (!model) throw new AppError(400, "invalid_model_selection", "所选模型当前不可用");
  if (!SELECTABLE_REASONING_EFFORTS.has(body.reasoningEffort)
    || !model.supportedReasoningEfforts.some((option) => option.reasoningEffort === body.reasoningEffort)) {
    throw new AppError(400, "invalid_model_selection", "所选模型不支持该推理强度");
  }
  return { model: model.model, reasoningEffort: body.reasoningEffort };
}

function unwrapThread(result) {
  return result?.thread || result;
}

function page(result, key) {
  if (Array.isArray(result)) return { data: result, nextCursor: null, backwardsCursor: null };
  return {
    data: result?.data || result?.[key] || [],
    nextCursor: result?.nextCursor ?? result?.next_cursor ?? null,
    backwardsCursor: result?.backwardsCursor ?? result?.backwards_cursor ?? null,
  };
}

function hasUnknownOutcome(error) {
  return error?.code === "RPC_TIMEOUT" || error?.code === "APP_SERVER_OFFLINE";
}

function directInputCapability(thread) {
  if (Object.hasOwn(thread || {}, "canAcceptDirectInput")) return thread.canAcceptDirectInput;
  if (Object.hasOwn(thread || {}, "can_accept_direct_input")) return thread.can_accept_direct_input;
  return undefined;
}

function permissionSettings(value) {
  const settings = value?.threadSettings || value?.thread_settings || value?.settings || value || {};
  const approvalPolicy = settings.approvalPolicy ?? settings.approval_policy;
  const sandbox = settings.sandboxPolicy ?? settings.sandbox_policy ?? settings.sandbox;
  const sandboxType = typeof sandbox === "string" ? sandbox : sandbox?.type;
  return {
    approvalPolicy,
    sandboxType,
    present: approvalPolicy !== undefined || sandbox !== undefined,
  };
}

function hasViewerPermissions(value) {
  const settings = permissionSettings(value);
  return settings.approvalPolicy === VIEWER_THREAD_PERMISSIONS.approvalPolicy
    && [VIEWER_THREAD_PERMISSIONS.sandbox, VIEWER_SANDBOX_POLICY.type].includes(settings.sandboxType);
}

function sortDirection(value, fallback) {
  const direction = value || fallback;
  if (direction !== "asc" && direction !== "desc") {
    throw new AppError(400, "invalid_direction", "direction 必须是 asc 或 desc");
  }
  return direction;
}

function limitOf(value) {
  const limit = Number(value || 50);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw new AppError(400, "invalid_limit", "limit 必须为 1 到 200 的整数");
  }
  return limit;
}

function nameOf(value) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new AppError(400, "invalid_name", "名称不能为空");
  if (name.length > 200) throw new AppError(400, "invalid_name", "名称不能超过 200 个字符");
  return name;
}

export class SessionService {
  #client;
  #navigation;
  #resumed = new Set();
  #permissionConfirmed = new Set();
  #permissionWaiters = new Map();
  #activeTurns = new Map();
  #pendingCompactions = new Set();
  #terminalTurns = new Map();
  #writeLocks = new Set();
  #uncertainCreates = new Map();
  #uncertainTurns = new Map();
  #treeMutation = false;
  #activeRootThreads = new Set();
  #currentSubagents = new Map();
  #unmaterializedThreads = new Set();
  #pendingNames = new Map();
  #tokenUsageReader;

  constructor(client, navigation, { tokenUsageReader = null } = {}) {
    this.#client = client;
    this.#navigation = navigation;
    this.#tokenUsageReader = tokenUsageReader;
  }

  activeTurn(threadId) {
    return this.#activeTurns.get(threadId) || null;
  }

  currentSubagentIds() {
    return [...new Set([...this.#currentSubagents.values()].flatMap((threadIds) => [...threadIds]))];
  }

  assertRestartSafe() {
    const hasActiveThread = this.#navigation.threads().some((thread) => thread.status === "active");
    if (
      hasActiveThread
      || this.#treeMutation
      || this.#writeLocks.size
      || this.#activeTurns.size
      || this.#pendingCompactions.size
      || this.#permissionWaiters.size
    ) {
      throw new AppError(409, "restart_blocked", "当前仍有会话操作正在进行，请等待完成后再重启");
    }
  }

  recordThreadSettings(threadId, settings) {
    const normalized = permissionSettings(settings);
    if (!threadId || !normalized.present) return;
    if (hasViewerPermissions(settings)) {
      this.#permissionConfirmed.add(threadId);
      const waiter = this.#permissionWaiters.get(threadId);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.#permissionWaiters.delete(threadId);
        waiter.resolve();
      }
      return;
    }
    this.#permissionConfirmed.delete(threadId);
  }

  recordThreadStarted(thread) {
    if (!thread?.id) return;
    if (!thread.parentThreadId) {
      this.#activeRootThreads.add(thread.id);
      if (!this.#currentSubagents.has(thread.id)) this.#currentSubagents.set(thread.id, new Set());
      return;
    }
    let current = thread;
    const seen = new Set();
    while (current?.parentThreadId && !seen.has(current.id)) {
      seen.add(current.id);
      current = this.#navigation.getThread(current.parentThreadId);
    }
    const rootId = current?.id;
    if (!rootId || !this.#activeRootThreads.has(rootId)) return;
    const subagents = this.#currentSubagents.get(rootId) || new Set();
    subagents.add(thread.id);
    this.#currentSubagents.set(rootId, subagents);
  }

  #beginRuntimeCycle(threadId) {
    this.#activeRootThreads.add(threadId);
    this.#currentSubagents.set(threadId, new Set());
  }

  #forgetRuntimeThread(threadId) {
    if (this.#activeRootThreads.delete(threadId)) this.#currentSubagents.delete(threadId);
    for (const subagents of this.#currentSubagents.values()) subagents.delete(threadId);
  }

  resetConnection() {
    for (const threadId of this.#unmaterializedThreads) this.#navigation.releasePreservedThread(threadId);
    this.#resumed.clear();
    this.#permissionConfirmed.clear();
    for (const waiter of this.#permissionWaiters.values()) waiter.reject(new AppError(503, "connection_reset", "Codex 连接已重置"));
    this.#permissionWaiters.clear();
    this.#activeTurns.clear();
    this.#pendingCompactions.clear();
    this.#terminalTurns.clear();
    this.#writeLocks.clear();
    this.#treeMutation = false;
    this.#activeRootThreads.clear();
    this.#currentSubagents.clear();
    this.#unmaterializedThreads.clear();
    this.#pendingNames.clear();
  }

  setActiveTurn(threadId, turnId) {
    if (!turnId) {
      this.#activeTurns.delete(threadId);
      return true;
    }
    if (this.#terminalTurns.get(threadId)?.has(turnId)) return false;
    this.#pendingCompactions.delete(threadId);
    this.#activeTurns.set(threadId, turnId);
    return true;
  }

  completeActiveTurn(threadId, turnId) {
    if (!turnId) return false;
    this.#pendingCompactions.delete(threadId);
    let terminal = this.#terminalTurns.get(threadId);
    if (!terminal) {
      terminal = new Set();
      this.#terminalTurns.set(threadId, terminal);
    }
    terminal.add(turnId);
    while (terminal.size > 100) terminal.delete(terminal.values().next().value);
    if (this.#unmaterializedThreads.delete(threadId)) {
      if (this.#pendingNames.has(threadId)) {
        void this.#persistPendingName(threadId).finally(() => this.#navigation.releasePreservedThread(threadId));
      } else {
        this.#navigation.releasePreservedThread(threadId);
      }
    }
    if (this.#activeTurns.get(threadId) !== turnId) return false;
    this.#activeTurns.delete(threadId);
    return true;
  }

  async #persistPendingName(threadId) {
    const name = this.#pendingNames.get(threadId);
    if (!name) return;
    try {
      await this.#client.request("thread/name/set", { threadId, name });
      if (this.#pendingNames.get(threadId) !== name) return;
      this.#pendingNames.delete(threadId);
      const thread = this.#navigation.getThread(threadId);
      if (thread) this.#navigation.upsert({ ...thread, name });
    } catch {}
  }

  closeThread(threadId) {
    this.#resumed.delete(threadId);
    this.#permissionConfirmed.delete(threadId);
    this.#pendingCompactions.delete(threadId);
    const permissionWaiter = this.#permissionWaiters.get(threadId);
    if (permissionWaiter) {
      clearTimeout(permissionWaiter.timer);
      this.#permissionWaiters.delete(threadId);
      permissionWaiter.reject(new AppError(409, "thread_closed", "Thread 已关闭"));
    }
    this.#activeTurns.delete(threadId);
    this.#terminalTurns.delete(threadId);
    this.#uncertainTurns.delete(threadId);
    this.#unmaterializedThreads.delete(threadId);
    this.#navigation.releasePreservedThread(threadId);
    this.#pendingNames.delete(threadId);
    if (this.#activeRootThreads.delete(threadId)) this.#currentSubagents.delete(threadId);
  }

  forgetThread(threadId) {
    this.closeThread(threadId);
    this.#forgetRuntimeThread(threadId);
  }

  async #normalThread(threadId) {
    const existing = this.#navigation.getThread(threadId);
    if (existing) return existing;
    await this.#navigation.refresh();
    return this.#navigation.requireThread(threadId);
  }

  async #archivedThread(threadId) {
    try {
      return this.#navigation.requireArchivedThread(threadId);
    } catch (error) {
      if (error?.code !== "thread_not_found") throw error;
      await this.#navigation.refreshArchived();
      return this.#navigation.requireArchivedThread(threadId);
    }
  }

  async #anyThread(threadId) {
    const normal = this.#navigation.getThread(threadId);
    if (normal) return { thread: normal, archived: false };
    try {
      return { thread: this.#navigation.requireArchivedThread(threadId), archived: true };
    } catch (error) {
      if (error?.code !== "thread_not_found") throw error;
    }
    await this.#navigation.refresh();
    const refreshed = this.#navigation.getThread(threadId);
    if (refreshed) return { thread: refreshed, archived: false };
    return { thread: await this.#archivedThread(threadId), archived: true };
  }

  #assertNoActiveTurn(threadId, thread) {
    if (this.#activeTurns.has(threadId) || thread.status === "active") {
      throw new AppError(409, "thread_busy", "当前会话仍在运行，请先中断或等待回合完成");
    }
    return thread;
  }

  #assertDirectInput(thread) {
    if (thread?.canAcceptDirectInput !== true) {
      throw new AppError(409, "direct_input_not_allowed", "Codex 未确认当前 Thread 可直接输入");
    }
    return thread;
  }

  #waitForViewerPermissions(threadId) {
    const existing = this.#permissionWaiters.get(threadId);
    if (existing) return existing.promise;
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    promise.catch(() => {});
    const timer = setTimeout(() => {
      if (this.#permissionWaiters.get(threadId)?.promise !== promise) return;
      this.#permissionWaiters.delete(threadId);
      reject(new AppError(504, "permission_update_timeout", "Codex 未确认 Thread 已恢复最高权限"));
    }, PERMISSION_UPDATE_TIMEOUT_MS);
    timer.unref?.();
    this.#permissionWaiters.set(threadId, { promise, resolve, reject, timer });
    return promise;
  }

  async #ensureViewerPermissions(threadId) {
    if (this.#permissionConfirmed.has(threadId)) return;
    const resumed = await this.#client.request("thread/resume", {
      threadId,
      excludeTurns: true,
      ...VIEWER_THREAD_PERMISSIONS,
    });
    this.#navigation.releaseLocallyClosed(threadId);
    if (resumed?.thread) this.#navigation.upsert(resumed.thread);
    this.#beginRuntimeCycle(threadId);
    this.#resumed.add(threadId);
    if (hasViewerPermissions(resumed)) {
      this.#permissionConfirmed.add(threadId);
      return;
    }

    const confirmed = this.#waitForViewerPermissions(threadId);
    try {
      await this.#client.request("thread/settings/update", {
        threadId,
        approvalPolicy: VIEWER_THREAD_PERMISSIONS.approvalPolicy,
        sandboxPolicy: VIEWER_SANDBOX_POLICY,
      });
      await confirmed;
    } catch (error) {
      const waiter = this.#permissionWaiters.get(threadId);
      if (waiter?.promise === confirmed) {
        clearTimeout(waiter.timer);
        this.#permissionWaiters.delete(threadId);
      }
      throw error;
    }
  }

  async #idleThread(threadId) {
    await this.#normalThread(threadId);
    const current = unwrapThread(await this.#client.request("thread/read", { threadId, includeTurns: false }));
    return this.#assertNoActiveTurn(threadId, this.#navigation.upsert(current));
  }

  async #idleSubtree(threadId) {
    const descendants = await this.#navigation.listDescendants(threadId);
    const active = descendants.filter((thread) => thread.status === "active" || this.#activeTurns.has(thread.id));
    if (active.length) {
      throw new AppError(409, "thread_subtree_busy", `${active.length} 个子 Thread 仍在运行，请先等待其完成`);
    }
    return descendants;
  }

  async #withLifecycleLock(threadId, operation) {
    if (this.#treeMutation || this.#writeLocks.has(threadId) || this.#activeTurns.has(threadId)) {
      throw new AppError(409, "thread_busy", "当前会话仍在运行或另一项会话树操作正在进行");
    }
    this.#writeLocks.add(threadId);
    try {
      return await operation();
    } finally {
      this.#writeLocks.delete(threadId);
    }
  }

  async #withTreeLifecycleLock(threadId, operation) {
    if (this.#treeMutation || this.#writeLocks.has(threadId) || this.#activeTurns.has(threadId)) {
      throw new AppError(409, "thread_busy", "当前会话仍在运行或另一项会话树操作正在进行");
    }
    this.#treeMutation = true;
    this.#writeLocks.add(threadId);
    try {
      return await operation();
    } finally {
      this.#writeLocks.delete(threadId);
      this.#treeMutation = false;
    }
  }

  #unknownLifecycle(action, details) {
    return new AppError(409, "write_outcome_unknown", `${action}请求的结果无法确认，已重新读取 Codex 状态，请刷新后重试`, details);
  }

  async rename(threadId, name) {
    const thread = await this.#normalThread(threadId);
    const cleanName = nameOf(name);
    if (this.#unmaterializedThreads.has(threadId)) {
      this.#pendingNames.set(threadId, cleanName);
      this.#navigation.preserveThread(threadId, { name: cleanName });
      return this.#navigation.upsert({ ...thread, name: cleanName });
    }
    try {
      await this.#client.request("thread/name/set", { threadId, name: cleanName });
    } catch (error) {
      if (!hasUnknownOutcome(error)) throw error;
      try {
        const current = unwrapThread(await this.#client.request("thread/read", { threadId, includeTurns: false }));
        if (current?.name === cleanName) return this.#navigation.upsert(current);
      } catch {}
      throw this.#unknownLifecycle("重命名");
    }
    return this.#navigation.upsert({ ...thread, name: cleanName });
  }

  async unsubscribe(threadId) {
    return this.#withLifecycleLock(threadId, async () => {
      await this.#idleThread(threadId);
      let result;
      try {
        result = await this.#client.request("thread/unsubscribe", { threadId });
      } catch (error) {
        if (!hasUnknownOutcome(error)) throw error;
        try {
          await this.#navigation.refresh();
          if (this.#navigation.getThread(threadId)?.status === "notLoaded") {
            this.forgetThread(threadId);
            return { status: "notLoaded", reconciled: true };
          }
        } catch {}
        throw this.#unknownLifecycle("卸载");
      }
      this.forgetThread(threadId);
      this.#navigation.markLocallyClosed(threadId);
      return result;
    });
  }

  async archive(threadId) {
    return this.#withTreeLifecycleLock(threadId, async () => {
      await this.#idleThread(threadId);
      const descendants = await this.#idleSubtree(threadId);
      const expectedIds = [threadId, ...descendants.map((thread) => thread.id)];
      let result;
      try {
        result = await this.#client.request("thread/archive", { threadId });
      } catch (error) {
        if (!hasUnknownOutcome(error)) throw error;
        try {
          await Promise.all([this.#navigation.refresh(), this.#navigation.refreshArchived()]);
          const archivedIds = new Set(this.#navigation.archivedThreads().map((thread) => thread.id));
          const remainingThreadIds = expectedIds.filter((id) => !archivedIds.has(id));
          if (!remainingThreadIds.length) {
            this.forgetThread(threadId);
            return { reconciled: true, affectedThreadIds: expectedIds, remainingThreadIds: [], archivedThreadIds: expectedIds };
          }
          throw this.#unknownLifecycle("归档", { expectedThreadIds: expectedIds, remainingThreadIds });
        } catch (reconcileError) {
          if (reconcileError instanceof AppError) throw reconcileError;
        }
        throw this.#unknownLifecycle("归档", { expectedThreadIds: expectedIds });
      }
      this.forgetThread(threadId);
      await Promise.all([this.#navigation.refresh(), this.#navigation.refreshArchived()]);
      const archivedIds = new Set(this.#navigation.archivedThreads().map((thread) => thread.id));
      return {
        result,
        affectedThreadIds: expectedIds,
        remainingThreadIds: expectedIds.filter((id) => this.#navigation.getThread(id)),
        archivedThreadIds: expectedIds.filter((id) => archivedIds.has(id)),
      };
    });
  }

  async delete(threadId) {
    return this.#withTreeLifecycleLock(threadId, async () => {
      const { archived } = await this.#anyThread(threadId);
      if (!archived) await this.#idleThread(threadId);
      const descendants = await this.#idleSubtree(threadId);
      const expectedIds = [threadId, ...descendants.map((thread) => thread.id)];
      let result;
      try {
        result = await this.#client.request("thread/delete", { threadId });
      } catch (error) {
        if (!hasUnknownOutcome(error)) throw error;
        try {
          await Promise.all([this.#navigation.refresh(), this.#navigation.refreshArchived()]);
          const archivedIds = new Set(this.#navigation.archivedThreads().map((entry) => entry.id));
          const remainingThreadIds = expectedIds.filter((id) => this.#navigation.getThread(id) || archivedIds.has(id));
          if (!remainingThreadIds.length) {
            this.forgetThread(threadId);
            return { reconciled: true, affectedThreadIds: expectedIds, remainingThreadIds: [] };
          }
          throw this.#unknownLifecycle("删除", { expectedThreadIds: expectedIds, remainingThreadIds });
        } catch (reconcileError) {
          if (reconcileError instanceof AppError) throw reconcileError;
        }
        throw this.#unknownLifecycle("删除", { expectedThreadIds: expectedIds });
      }
      this.forgetThread(threadId);
      await Promise.all([this.#navigation.refresh(), this.#navigation.refreshArchived()]);
      const archivedIds = new Set(this.#navigation.archivedThreads().map((thread) => thread.id));
      return {
        result,
        affectedThreadIds: expectedIds,
        remainingThreadIds: expectedIds.filter((id) => this.#navigation.getThread(id) || archivedIds.has(id)),
      };
    });
  }

  async unarchive(threadId) {
    return this.#withTreeLifecycleLock(threadId, async () => {
      const thread = await this.#archivedThread(threadId);
      let result;
      try {
        result = await this.#client.request("thread/unarchive", { threadId });
      } catch (error) {
        if (!hasUnknownOutcome(error)) throw error;
        try {
          await Promise.all([this.#navigation.refresh(), this.#navigation.refreshArchived()]);
          const restored = this.#navigation.getThread(threadId);
          const stillArchived = this.#navigation.archivedThreads().some((entry) => entry.id === threadId);
          if (restored && !stillArchived) {
            this.forgetThread(threadId);
            return restored;
          }
        } catch {}
        throw this.#unknownLifecycle("恢复归档");
      }
      this.forgetThread(threadId);
      this.#navigation.removeArchived(threadId);
      return this.#navigation.upsert({ ...thread, ...unwrapThread(result), id: threadId });
    });
  }

  async create(projectId, name) {
    const project = this.#navigation.requireWritableProject(projectId);
    return this.#createForWorkspace(project, name);
  }

  async createForCwd(cwd, name) {
    return this.#createForWorkspace(this.#navigation.workspaceForCwd(cwd), name);
  }

  async #createForWorkspace(project, name) {
    const cleanName = typeof name === "string" ? name.trim() : "";
    if (cleanName.length > 200) throw new AppError(400, "invalid_name", "名称不能超过 200 个字符");

    const uncertain = this.#uncertainCreates.get(project.id);
    if (uncertain) {
      await this.#navigation.refresh();
      const candidates = this.#navigation.threads()
        .filter((thread) => thread.projectId === project.id
          && !uncertain.knownThreadIds.has(thread.id)
          && Number(thread.createdAt || 0) >= uncertain.startedAtSeconds - 1)
        .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0));
      if (candidates.length > 1) {
        throw new AppError(409, "write_outcome_ambiguous", "发现多个可能由上一次请求创建的会话，已停止重试以避免重复创建");
      }
      if (candidates[0]) {
        this.#uncertainCreates.delete(project.id);
        return { session: candidates[0], warning: "上一次创建请求的响应中断；已从 Codex 权威列表恢复该会话，未重复创建。" };
      }
      throw new AppError(409, "write_outcome_unknown", "上一次创建请求的结果仍无法确认，已停止重试以避免重复创建");
    }

    const knownThreadIds = new Set(this.#navigation.threads().map((thread) => thread.id));
    const startedAtSeconds = Math.floor(Date.now() / 1_000);
    let result;
    try {
      result = await this.#client.request("thread/start", {
        cwd: project.cwd,
        ...VIEWER_THREAD_PERMISSIONS,
      });
    } catch (error) {
      if (hasUnknownOutcome(error)) this.#uncertainCreates.set(project.id, { knownThreadIds, startedAtSeconds });
      throw error;
    }
    const rawThread = unwrapThread(result);
    const threadId = rawThread?.id || result?.threadId;
    if (!threadId) throw new AppError(502, "invalid_app_server_response", "thread/start 未返回 thread ID");
    this.#beginRuntimeCycle(threadId);
    this.#resumed.add(threadId);
    this.#permissionConfirmed.add(threadId);
    this.#unmaterializedThreads.add(threadId);
    this.#navigation.preserveThread(threadId, { name: cleanName });
    this.#navigation.upsert({
      ...rawThread,
      id: threadId,
      cwd: rawThread?.cwd || project.cwd,
      ...(cleanName ? { name: cleanName } : {}),
    });
    if (cleanName) this.#pendingNames.set(threadId, cleanName);

    let warning = null;
    let authoritative = rawThread;
    try {
      authoritative = unwrapThread(await this.#client.request("thread/read", { threadId, includeTurns: false }));
    } catch (error) {
      warning = `会话已创建，但回查失败：${error.message}`;
    }
    const session = this.#navigation.upsert({
      ...authoritative,
      id: threadId,
      cwd: authoritative?.cwd || project.cwd,
      ...(cleanName ? { name: cleanName } : {}),
    });
    return { session, warning };
  }

  async models() {
    const models = [];
    const cursors = new Set();
    let cursor = null;
    let pages = 0;
    do {
      if (++pages > MAX_MODEL_PAGES) {
        throw new AppError(502, "model_pagination_limit", "Codex 模型目录分页超过安全上限");
      }
      const result = await this.#client.request("model/list", {
        cursor,
        limit: 100,
        includeHidden: false,
      });
      const resultPage = page(result, "models");
      for (const rawModel of resultPage.data) {
        const model = normalizeModel(rawModel);
        if (model && !models.some((entry) => entry.model === model.model)) models.push(model);
      }
      if (resultPage.nextCursor && cursors.has(resultPage.nextCursor)) {
        throw new AppError(502, "model_pagination_cursor_cycle", "Codex 模型目录分页游标重复");
      }
      if (resultPage.nextCursor) cursors.add(resultPage.nextCursor);
      cursor = resultPage.nextCursor;
    } while (cursor);
    return models;
  }

  async read(threadId) {
    const archived = this.#navigation.archivedThreads().some((thread) => thread.id === threadId);
    const known = archived
      ? this.#navigation.archivedThreads().find((thread) => thread.id === threadId)
      : this.#navigation.getThread(threadId);
    const result = await this.#client.request("thread/read", { threadId, includeTurns: false });
    const raw = unwrapThread(result);
    if (!raw?.id) throw new AppError(404, "thread_not_found", "会话不存在或不可访问");
    let tokenUsage = raw.tokenUsage || raw.usage || known?.tokenUsage || null;
    if (!tokenUsage && this.#tokenUsageReader) {
      tokenUsage = await this.#tokenUsageReader.readLatest(threadId, { archived });
    }
    const hydrated = tokenUsage ? { ...raw, tokenUsage } : raw;
    return archived ? normalizeThread(hydrated) : this.#navigation.upsert(hydrated);
  }

  async refreshTokenUsage(threadId) {
    if (!this.#tokenUsageReader) return null;
    let tokenUsage;
    try {
      tokenUsage = await this.#tokenUsageReader.readLatest(threadId, { archived: false });
    } catch {
      return null;
    }
    const thread = this.#navigation.getThread(threadId);
    if (thread && tokenUsage) this.#navigation.upsert({ ...thread, tokenUsage });
    return tokenUsage;
  }

  async turns(threadId, query = {}) {
    const result = await this.#client.request("thread/turns/list", {
      threadId,
      cursor: query.cursor || null,
      limit: limitOf(query.limit),
      sortDirection: sortDirection(query.direction, "desc"),
      itemsView: "summary",
    });
    const resultPage = page(result, "turns");
    return {
      data: resultPage.data.map((turn) => normalizeTurn(turn, threadId)),
      nextCursor: resultPage.nextCursor,
      backwardsCursor: resultPage.backwardsCursor,
    };
  }

  async items(threadId, query = {}) {
    let result;
    try {
      result = await this.#client.request("thread/items/list", {
        threadId,
        cursor: query.cursor || null,
        limit: limitOf(query.limit),
        sortDirection: sortDirection(query.direction, "asc"),
        ...(query.turnId ? { turnId: query.turnId } : {}),
      });
    } catch (error) {
      if (error?.code === -32601) {
        throw new AppError(501, "items_pagination_unsupported", "当前 Codex 存储不支持 Item 分页");
      }
      throw error;
    }
    const resultPage = page(result, "items");
    return {
      data: resultPage.data.map((entry) => {
        const item = entry?.item || entry;
        const turnId = entry?.turnId || query.turnId;
        return normalizeItem(item, { threadId, turnId });
      }),
      nextCursor: resultPage.nextCursor,
      backwardsCursor: resultPage.backwardsCursor,
    };
  }

  async resume(threadId) {
    return this.#withLifecycleLock(threadId, async () => {
      const thread = await this.#normalThread(threadId);
      if (thread.parentThreadId && thread.canAcceptDirectInput !== true) {
        throw new AppError(409, "direct_input_not_allowed", "此子代理由父 Thread 控制，不能由 Viewer 直接恢复");
      }
      await this.#ensureViewerPermissions(threadId);
      const current = unwrapThread(await this.#client.request("thread/read", { threadId, includeTurns: false }));
      if (directInputCapability(current) !== true) {
        throw new AppError(409, "direct_input_unavailable", "Codex 未确认该 Thread 可直接输入");
      }
      return this.#assertDirectInput(this.#navigation.upsert(current));
    });
  }

  async compact(threadId) {
    return this.#withLifecycleLock(threadId, async () => {
      const thread = await this.#normalThread(threadId);
      if (thread.parentThreadId) {
        throw new AppError(409, "direct_input_not_allowed", "此子代理由父 Thread 控制，不能由 Viewer 直接压缩");
      }
      if (this.#pendingCompactions.has(threadId)) {
        throw new AppError(409, "thread_busy", "当前会话正在启动上下文压缩");
      }
      await this.#ensureViewerPermissions(threadId);
      const current = unwrapThread(await this.#client.request("thread/read", { threadId, includeTurns: false }));
      const authoritative = this.#assertDirectInput(this.#navigation.upsert(current));
      this.#assertNoActiveTurn(threadId, authoritative);
      this.#pendingCompactions.add(threadId);
      try {
        await this.#client.request("thread/compact/start", { threadId });
      } catch (error) {
        this.#pendingCompactions.delete(threadId);
        throw error;
      }
      return { status: "started" };
    });
  }

  async reconcileTurn(threadId) {
    await this.#normalThread(threadId);
    const uncertain = this.#uncertainTurns.get(threadId);
    if (!uncertain) return { status: "clear" };
    let history;
    try {
      history = await this.#client.request("thread/items/list", {
        threadId,
        limit: 100,
        sortDirection: "desc",
      });
    } catch {
      return { status: "unknown" };
    }
    const recorded = page(history, "items").data.find((entry) => (entry?.item || entry)?.clientId === uncertain.clientUserMessageId);
    if (!recorded) return { status: "unknown" };
    this.#uncertainTurns.delete(threadId);
    return { status: "recorded", clientUserMessageId: uncertain.clientUserMessageId, turnId: recorded.turnId || null };
  }

  async startTurn(threadId, body = {}) {
    const collaborationMode = collaborationModeOf(body.collaborationMode);
    if (body.historicalResend !== undefined && typeof body.historicalResend !== "boolean") {
      throw new AppError(400, "invalid_historical_resend", "historicalResend 必须是布尔值");
    }
    const historicalResend = body.historicalResend === true;
    const text = typeof body.text === "string" ? body.text : "";
    const submittedImages = Array.isArray(body.images)
      ? body.images.map((image) => ({ dataUrl: image?.dataUrl, detail: image?.detail }))
      : body.images;
    const imageInputs = normalizeImageInputs(submittedImages);
    if (!hasMessageContent(text.trim(), imageInputs)) throw new AppError(400, "invalid_message", "消息或图片不能为空");
    if (text.length > 200_000) throw new AppError(413, "message_too_large", "消息过长");
    let thread = this.#navigation.getThread(threadId);
    if (!thread && this.#unmaterializedThreads.has(threadId)) {
      const current = unwrapThread(await this.#client.request("thread/read", { threadId, includeTurns: false }));
      if (current?.id) thread = this.#navigation.upsert(current);
    }
    if (!thread) thread = this.#navigation.requireThread(threadId);
    if (thread.parentThreadId) {
      throw new AppError(409, "direct_input_not_allowed", "此子代理由父 Thread 控制，不能由 Viewer 直接输入");
    }
    if (directInputCapability(thread) === false) this.#assertDirectInput(thread);
    if (this.#treeMutation || this.#writeLocks.has(threadId) || this.#activeTurns.has(threadId) || this.#pendingCompactions.has(threadId) || thread.status === "active") {
      throw new AppError(409, "thread_busy", "当前会话已有活动回合");
    }

    this.#writeLocks.add(threadId);
    try {
      await this.#ensureViewerPermissions(threadId);
      const current = unwrapThread(await this.#client.request("thread/read", { threadId, includeTurns: false }));
      const capability = directInputCapability(current);
      if (capability !== true) {
        throw new AppError(409, "direct_input_unavailable", "Codex 未确认该 Thread 可直接输入");
      }
      const authoritative = this.#navigation.upsert(current);
      this.#assertDirectInput(authoritative);
      if (authoritative?.status === "active") {
        throw new AppError(409, "thread_busy", "当前会话已有活动回合");
      }
      const currentModel = authoritative?.model || thread.model;
      const hasModelSelection = body.model !== undefined || body.reasoningEffort !== undefined;
      const selection = selectedModelSettings(
        body,
        hasModelSelection ? await this.models() : [],
        currentModel,
        collaborationMode
      );
      const collaborationModeConfig = collaborationModeSettings(
        collaborationMode,
        selection.model,
        selection.reasoningEffort
      );
      const uncertain = this.#uncertainTurns.get(threadId);
      if (uncertain) {
        let history;
        try {
          history = await this.#client.request("thread/items/list", {
            threadId,
            limit: 100,
            sortDirection: "desc",
          });
        } catch (error) {
          throw new AppError(409, "write_outcome_unknown", "上一次发送结果仍无法确认，请刷新会话后再试");
        }
        const entries = page(history, "items").data;
        const recovered = entries.find((entry) => (entry?.item || entry)?.clientId === uncertain.clientUserMessageId);
        if (recovered) {
          this.#uncertainTurns.delete(threadId);
          throw new AppError(409, "previous_turn_recorded", "上一次消息已由 Codex 记录，已阻止重复发送");
        }
        throw new AppError(409, "write_outcome_unknown", "上一次消息的结果仍无法确认，已停止重试以避免重复发送");
      }
      const clientUserMessageId = typeof body.clientUserMessageId === "string" && body.clientUserMessageId
        ? body.clientUserMessageId
        : randomUUID();
      let result;
      try {
        result = await this.#client.request("turn/start", {
          threadId,
          input: [
            ...(text ? [{ type: "text", text }] : []),
            ...imageInputs,
          ],
          clientUserMessageId,
          collaborationMode: collaborationModeConfig,
          ...(historicalResend ? {
            additionalContext: {
              [`codex_session_history_resend_${randomUUID().replaceAll("-", "")}`]: {
                kind: "application",
                value: HISTORICAL_RESEND_CONTEXT,
              },
            },
          } : {}),
        });
      } catch (error) {
        if (hasUnknownOutcome(error)) this.#uncertainTurns.set(threadId, { clientUserMessageId });
        throw error;
      }
      const turn = result?.turn || result;
      const turnId = turn?.id || result?.turnId;
      if (turnId) this.setActiveTurn(threadId, turnId);
      return { turn: normalizeTurn({ ...turn, id: turnId }, threadId), clientUserMessageId };
    } finally {
      this.#writeLocks.delete(threadId);
    }
  }

  async interrupt(threadId, turnId) {
    this.#navigation.requireThread(threadId);
    const current = unwrapThread(await this.#client.request("thread/read", { threadId, includeTurns: false }));
    this.#assertDirectInput(this.#navigation.upsert(current));
    const activeTurnId = this.#activeTurns.get(threadId);
    if (activeTurnId && activeTurnId !== turnId) {
      throw new AppError(409, "turn_mismatch", "目标回合不是当前活动回合");
    }
    return this.#client.request("turn/interrupt", { threadId, turnId });
  }
}
