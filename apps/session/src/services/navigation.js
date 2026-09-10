import { createHash } from "node:crypto";
import path from "node:path";
import { AppError } from "../errors.js";

const UNKNOWN_CWD = null;

function projectIdFor(cwd) {
  return `prj_${createHash("sha256").update(cwd || "unknown").digest("hex").slice(0, 20)}`;
}

function normalizeCwd(cwd) {
  if (typeof cwd !== "string" || !path.isAbsolute(cwd)) return UNKNOWN_CWD;
  const normalized = path.normalize(cwd);
  try {
    const resolved = path.resolve(cwd);
    const canonical = globalThis.process?.platform === "darwin" ? resolved.normalize("NFC") : resolved;
    return canonical.length > path.parse(canonical).root.length
      ? canonical.replace(/[\\/]+$/, "")
      : canonical;
  } catch {
    return normalized.length > path.parse(normalized).root.length
      ? normalized.replace(/[\\/]+$/, "")
      : normalized;
  }
}

const ACTIVE_FLAGS = new Set(["waitingOnApproval", "waitingOnUserInput"]);

function normalizeStatus(status) {
  if (typeof status === "string") return status;
  if (status && typeof status === "object") return status.type || status.status || "unknown";
  return "unknown";
}

function normalizeActiveFlags(status, thread) {
  const flags = status && typeof status === "object" ? status.activeFlags : thread?.activeFlags;
  if (!Array.isArray(flags)) return [];
  return [...new Set(flags.filter((flag) => ACTIVE_FLAGS.has(flag)))];
}

function normalizeThreadStatus(thread) {
  const status = normalizeStatus(thread?.status);
  return {
    status,
    activeFlags: status === "active" ? normalizeActiveFlags(thread?.status, thread) : [],
  };
}

function threadField(thread, camelCase, snakeCase) {
  return thread?.[camelCase] ?? thread?.[snakeCase] ?? null;
}

export function normalizeThread(thread) {
  const cwd = normalizeCwd(thread?.cwd);
  return {
    id: String(thread?.id || ""),
    name: thread?.name || thread?.title || null,
    preview: thread?.preview || "",
    cwd,
    // projectId is the viewer's cwd-derived grouping key; retain Codex's native ID separately.
    projectId: projectIdFor(cwd),
    codexProjectId: threadField(thread, "projectId", "project_id"),
    sessionId: threadField(thread, "sessionId", "session_id"),
    parentThreadId: threadField(thread, "parentThreadId", "parent_thread_id"),
    forkedFromId: threadField(thread, "forkedFromId", "forked_from_id"),
    agentNickname: threadField(thread, "agentNickname", "agent_nickname"),
    agentRole: threadField(thread, "agentRole", "agent_role"),
    source: threadField(thread, "source", "source"),
    threadSource: threadField(thread, "threadSource", "thread_source"),
    canAcceptDirectInput: threadField(thread, "canAcceptDirectInput", "can_accept_direct_input"),
    ephemeral: threadField(thread, "ephemeral", "ephemeral"),
    historyMode: threadField(thread, "historyMode", "history_mode"),
    modelProvider: threadField(thread, "modelProvider", "model_provider"),
    ...normalizeThreadStatus(thread),
    createdAt: thread?.createdAt ?? thread?.created_at ?? null,
    updatedAt: thread?.updatedAt ?? thread?.updated_at ?? null,
    model: thread?.model || null,
    reasoningEffort: threadField(thread, "reasoningEffort", "reasoning_effort"),
    tokenUsage: thread?.tokenUsage || thread?.usage || null,
  };
}

function resultPage(result) {
  if (Array.isArray(result)) return { data: result, nextCursor: null };
  const data = result?.data ?? result?.threads;
  const nextCursor = result?.nextCursor ?? result?.next_cursor;
  return {
    data: Array.isArray(data) ? data : [],
    nextCursor: typeof nextCursor === "string" && nextCursor ? nextCursor : null,
  };
}

function relationshipId(value, name) {
  const threadId = typeof value === "string" ? value.trim() : "";
  if (!threadId) throw new AppError(400, "invalid_thread_id", `${name} 必须是非空字符串`);
  return threadId;
}

const THREAD_SOURCE_KINDS = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
];

export class NavigationService {
  #client;
  #config;
  #threads = new Map();
  #archivedThreads = new Map();
  #projects = new Map();
  #preservedThreadIds = new Set();
  #preservedThreadNames = new Map();
  #locallyClosedThreadIds = new Set();

  constructor(client, config) {
    this.#client = client;
    this.#config = config;
  }

  getThread(threadId) {
    return this.#threads.get(threadId) || null;
  }

  threads() {
    return [...this.#threads.values()];
  }

  preserveThread(threadId, { name = null } = {}) {
    if (!threadId) return;
    this.#preservedThreadIds.add(threadId);
    if (name) this.#preservedThreadNames.set(threadId, name);
  }

  releasePreservedThread(threadId) {
    this.#preservedThreadIds.delete(threadId);
    this.#preservedThreadNames.delete(threadId);
  }

  #withPreservedName(thread) {
    if (!this.#preservedThreadIds.has(thread.id)) return thread;
    const name = this.#preservedThreadNames.get(thread.id);
    return name ? { ...thread, name } : thread;
  }

  markLocallyClosed(threadId) {
    this.updateStatus(threadId, { type: "notLoaded" });
    this.#locallyClosedThreadIds.add(threadId);
  }

  releaseLocallyClosed(threadId) {
    this.#locallyClosedThreadIds.delete(threadId);
  }

  archivedThreads() {
    return [...this.#archivedThreads.values()]
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  async refreshArchived() {
    this.#archivedThreads = new Map((await this.#listThreads({ archived: true })).map((thread) => [thread.id, thread]));
    return this.archivedThreads();
  }

  async listChildren(parentThreadId) {
    const parentId = relationshipId(parentThreadId, "parentThreadId");
    const pages = await Promise.all([
      this.#listThreads({ parentThreadId: parentId }),
      this.#listThreads({ parentThreadId: parentId, archived: true }),
    ]);
    const threads = new Map(pages.flat().map((thread) => [thread.id, thread]));
    return [...threads.values()].filter((thread) => thread.id !== parentId && thread.parentThreadId === parentId);
  }

  async listDescendants(ancestorThreadId) {
    const ancestorId = relationshipId(ancestorThreadId, "ancestorThreadId");
    const pages = await Promise.all([
      this.#listThreads({ ancestorThreadId: ancestorId }),
      this.#listThreads({ ancestorThreadId: ancestorId, archived: true }),
    ]);
    const threads = [...new Map(pages.flat().map((thread) => [thread.id, thread])).values()];
    const childrenByParent = new Map();
    for (const thread of threads) {
      if (!thread.parentThreadId || thread.id === thread.parentThreadId) continue;
      const children = childrenByParent.get(thread.parentThreadId) || [];
      children.push(thread.id);
      childrenByParent.set(thread.parentThreadId, children);
    }

    const descendants = new Set([ancestorId]);
    const pending = [ancestorId];
    while (pending.length) {
      const parentId = pending.pop();
      for (const childId of childrenByParent.get(parentId) || []) {
        if (descendants.has(childId)) continue;
        descendants.add(childId);
        pending.push(childId);
      }
    }
    descendants.delete(ancestorId);
    return threads.filter((thread) => descendants.has(thread.id));
  }

  requireThread(threadId) {
    const thread = this.getThread(threadId);
    if (!thread) throw new AppError(404, "thread_not_found", "会话不存在或尚未载入");
    return thread;
  }

  requireArchivedThread(threadId) {
    const thread = this.#archivedThreads.get(threadId);
    if (!thread) throw new AppError(404, "thread_not_found", "归档会话不存在或尚未载入");
    return thread;
  }

  requireAnyThread(threadId) {
    return this.#threads.get(threadId) || this.requireArchivedThread(threadId);
  }

  requireProject(projectId) {
    const project = this.#projects.get(projectId);
    if (!project) throw new AppError(404, "project_not_found", "工作区不存在或尚未载入");
    return project;
  }

  requireWritableProject(projectId) {
    const project = this.requireProject(projectId);
    if (!project.cwd) throw new AppError(409, "project_not_writable", "未知工作区不能创建会话");
    return project;
  }

  workspaceForCwd(cwd) {
    const normalized = normalizeCwd(cwd);
    if (!normalized) throw new AppError(400, "invalid_workspace_directory", "工作目录必须是绝对路径");
    return {
      id: projectIdFor(normalized),
      cwd: normalized,
      name: path.basename(normalized) || normalized,
    };
  }

  async #listThreads({ archived = false, parentThreadId = null, ancestorThreadId = null } = {}) {
    if (parentThreadId != null && ancestorThreadId != null) {
      throw new AppError(400, "invalid_thread_relation", "parentThreadId 和 ancestorThreadId 不能同时指定");
    }

    const threads = new Map();
    const cursors = new Set();
    let cursor = null;
    let pages = 0;
    do {
      if (++pages > this.#config.maxThreadPages) {
        throw new AppError(502, "pagination_limit", "Codex 会话分页超过安全上限");
      }
      const result = await this.#client.request("thread/list", {
        cursor,
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: THREAD_SOURCE_KINDS,
        ...(archived ? { archived: true } : {}),
        ...(parentThreadId ? { parentThreadId } : {}),
        ...(ancestorThreadId ? { ancestorThreadId } : {}),
      });
      const page = resultPage(result);
      for (const thread of page.data.map(normalizeThread)) {
        if (thread.id && !threads.has(thread.id)) threads.set(thread.id, thread);
      }
      if (page.nextCursor && cursors.has(page.nextCursor)) {
        throw new AppError(502, "pagination_cursor_cycle", "Codex 会话分页游标重复");
      }
      if (page.nextCursor) cursors.add(page.nextCursor);
      cursor = page.nextCursor;
    } while (cursor);
    return [...threads.values()];
  }

  async refresh() {
    const threads = (await this.#listThreads()).map((thread) => this.#withPreservedName(thread));
    const refreshed = new Map(threads.map((thread) => {
      if (!this.#locallyClosedThreadIds.has(thread.id)) return [thread.id, thread];
      if (thread.status === "notLoaded") {
        this.#locallyClosedThreadIds.delete(thread.id);
        return [thread.id, thread];
      }
      return [thread.id, { ...thread, status: "notLoaded", activeFlags: [] }];
    }));
    for (const threadId of this.#preservedThreadIds) {
      if (!refreshed.has(threadId) && this.#threads.has(threadId)) {
        refreshed.set(threadId, this.#threads.get(threadId));
      }
    }

    this.#threads = refreshed;
    const grouped = new Map();
    for (const thread of this.#threads.values()) {
      let project = grouped.get(thread.projectId);
      if (!project) {
        project = {
          id: thread.projectId,
          cwd: thread.cwd,
          name: thread.cwd ? path.basename(thread.cwd) || thread.cwd : "未知工作区",
          sessions: [],
        };
        grouped.set(project.id, project);
      }
      project.sessions.push(thread);
    }
    for (const project of grouped.values()) {
      project.sessions.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
    }
    this.#projects = grouped;
    return this.projects();
  }

  projects() {
    return [...this.#projects.values()]
      .map((project) => ({ ...project, sessionCount: project.sessions.length }))
      .sort((a, b) => {
        if (!a.cwd) return 1;
        if (!b.cwd) return -1;
        return a.name.localeCompare(b.name);
      });
  }

  sessions(projectId) {
    return this.requireProject(projectId).sessions;
  }

  search(query) {
    const needle = String(query || "").normalize("NFKC").trim().toLocaleLowerCase();
    if (!needle) return [];
    return [...this.#threads.values()].filter((thread) =>
      [thread.name, thread.preview, thread.cwd].some((value) =>
        String(value || "").normalize("NFKC").toLocaleLowerCase().includes(needle)
      )
    );
  }

  upsert(rawThread) {
    let thread = normalizeThread(rawThread);
    if (!thread.id) return null;
    thread = this.#withPreservedName(thread);
    const previous = this.#threads.get(thread.id);
    if (thread.tokenUsage == null && previous?.tokenUsage != null) thread.tokenUsage = previous.tokenUsage;
    if (previous && previous.projectId !== thread.projectId) {
      const previousProject = this.#projects.get(previous.projectId);
      if (previousProject) {
        previousProject.sessions = previousProject.sessions.filter((entry) => entry.id !== thread.id);
        previousProject.sessionCount = previousProject.sessions.length;
        if (!previousProject.sessions.length) this.#projects.delete(previous.projectId);
      }
    }
    this.#threads.set(thread.id, thread);
    const oldProject = this.#projects.get(thread.projectId);
    if (!oldProject) {
      this.#projects.set(thread.projectId, {
        id: thread.projectId,
        cwd: thread.cwd,
        name: thread.cwd ? path.basename(thread.cwd) || thread.cwd : "未知工作区",
        sessionCount: 1,
        sessions: [thread],
      });
    } else {
      const index = oldProject.sessions.findIndex((entry) => entry.id === thread.id);
      if (index >= 0) oldProject.sessions[index] = thread;
      else oldProject.sessions.unshift(thread);
      oldProject.sessionCount = oldProject.sessions.length;
    }
    return thread;
  }

  remove(threadId) {
    const thread = this.#threads.get(threadId) || this.#archivedThreads.get(threadId);
    this.#preservedThreadIds.delete(threadId);
    this.#preservedThreadNames.delete(threadId);
    this.#locallyClosedThreadIds.delete(threadId);
    this.#archivedThreads.delete(threadId);
    if (!thread) return null;
    this.#threads.delete(threadId);
    const project = this.#projects.get(thread.projectId);
    if (project) {
      project.sessions = project.sessions.filter((entry) => entry.id !== threadId);
      project.sessionCount = project.sessions.length;
      if (!project.sessions.length) this.#projects.delete(project.id);
    }
    return thread;
  }

  markArchived(threadId) {
    this.#preservedThreadIds.delete(threadId);
    this.#preservedThreadNames.delete(threadId);
    this.#locallyClosedThreadIds.delete(threadId);
    const thread = this.#threads.get(threadId);
    if (!thread) return this.#archivedThreads.get(threadId) || null;
    this.#threads.delete(threadId);
    const project = this.#projects.get(thread.projectId);
    if (project) {
      project.sessions = project.sessions.filter((entry) => entry.id !== threadId);
      project.sessionCount = project.sessions.length;
      if (!project.sessions.length) this.#projects.delete(project.id);
    }
    this.#archivedThreads.set(threadId, thread);
    return thread;
  }

  removeArchived(threadId) {
    const thread = this.#archivedThreads.get(threadId) || null;
    this.#archivedThreads.delete(threadId);
    return thread;
  }

  updateStatus(threadId, status) {
    const thread = this.#threads.get(threadId);
    if (!thread) return null;
    const updated = { ...thread, ...normalizeThreadStatus({ status, activeFlags: thread.activeFlags }) };
    this.upsert(updated);
    return updated;
  }
}
