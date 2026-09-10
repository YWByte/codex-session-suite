export function installRuntime(context) {
  const {
    state, elements, unreadThreadIds, resentMessageKeys, annotationState,
    TRUTH_ICON, COPY_ICON, EDIT_ICON, ARCHIVE_ICON, DELETE_ICON, CLOSE_ICON,
    UNREAD_STORAGE_KEY, RESENT_MESSAGES_STORAGE_KEY, RESTART_STATE_KEY,
    ANNOTATION_STORAGE_PREFIX, COLLECT_VIEWER_ORIGIN, ANNOTATION_BLOCK_SELECTOR,
    IMAGE_TYPES, MAX_IMAGE_COUNT, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES,
    TOOL_OUTPUT_HEAD_LIMIT, TOOL_OUTPUT_TAIL_LIMIT, TOOL_TRUNCATION_NOTICE,
    REASONING_EFFORTS, TERMINAL_TURN_STATUSES, isLoadedSessionStatus,
    normalizeSessionStatus, commandPresentation, storedArray,
  } = context;
  const { actions, t } = context;

function runtimeFor(threadId) {
  if (!threadId) return null;
  let runtime = state.runtime.get(threadId);
  if (!runtime) {
    runtime = {
      protocolStatus: "unknown",
      protocolFlags: new Set(),
      requestFlags: new Set(),
      activeTurnId: null,
      phase: "idle",
      unread: unreadThreadIds.has(threadId),
      terminalStatus: null,
      terminalTurnIds: new Set(),
      connectionGeneration: state.connectionGeneration,
      syncState: "unknown",
      pendingClose: false,
      compactPending: false,
      protocolRevision: 0,
    };
    state.runtime.set(threadId, runtime);
  }
  return runtime;
}

function persistUnread() {
  localStorage.setItem(UNREAD_STORAGE_KEY, JSON.stringify([...unreadThreadIds]));
}

function resentMessageKey(threadId, itemId) {
  return JSON.stringify([threadId, itemId]);
}

function isHistoricalMessageResent(threadId, itemId) {
  return Boolean(threadId && itemId && resentMessageKeys.has(resentMessageKey(threadId, itemId)));
}

function markHistoricalMessageResent(threadId, itemId) {
  if (!threadId || !itemId) return;
  resentMessageKeys.add(resentMessageKey(threadId, itemId));
  localStorage.setItem(RESENT_MESSAGES_STORAGE_KEY, JSON.stringify([...resentMessageKeys]));
}

function clearResentMessages(threadId) {
  let changed = false;
  for (const key of resentMessageKeys) {
    try {
      if (JSON.parse(key)?.[0] !== threadId) continue;
    } catch {
      continue;
    }
    resentMessageKeys.delete(key);
    changed = true;
  }
  if (changed) localStorage.setItem(RESENT_MESSAGES_STORAGE_KEY, JSON.stringify([...resentMessageKeys]));
}

function setUnread(threadId, unread) {
  const runtime = runtimeFor(threadId);
  if (!runtime) return;
  runtime.unread = unread;
  if (unread) unreadThreadIds.add(threadId);
  else unreadThreadIds.delete(threadId);
  persistUnread();
}

function isReady() {
  return Boolean((state.health?.appServer || state.health)?.ready) && state.connectionState === "ready";
}

function isTurnActive(runtime) {
  return Boolean(runtime?.activeTurnId) && !runtime.terminalTurnIds.has(runtime.activeTurnId);
}

function isThreadActive(session, runtime = runtimeFor(session?.id)) {
  return isReady() && (runtime?.compactPending || isTurnActive(runtime) || ["active", "inprogress"].includes(normalizeSessionStatus(session?.status)) && runtime?.syncState !== "unknown");
}

function hasRestartBlocker() {
  if (state.restartPending || state.pendingRequests.size) return true;
  if ([...state.runtime.values()].some((runtime) => runtime.compactPending || isTurnActive(runtime))) return true;
  return [...state.sessions.values()].some((session) => ["active", "inprogress"].includes(normalizeSessionStatus(session.status)));
}

function threadVisualState(session, runtime = runtimeFor(session?.id)) {
  if (!session) return { kind: "idle", label: t("status.notSelected") };
  if (!isReady()) return { kind: "error", label: t("status.codexUnavailable") };
  if (runtime?.protocolFlags.has("approval") || runtime?.requestFlags.has("approval")) return { kind: "busy", label: t("status.waitingForApproval") };
  if (runtime?.protocolFlags.has("input") || runtime?.requestFlags.has("input")) return { kind: "busy", label: t("status.waitingForInput") };
  if (isThreadActive(session, runtime)) {
    const labels = { typing: t("status.typing"), tool: t("status.toolRunning"), compacting: t("status.compacting"), interrupting: t("status.interrupting"), unknown: t("status.runtimePendingSync") };
    return { kind: "busy", label: labels[runtime?.phase] || t("status.running") };
  }
  if (runtime?.unread) return { kind: "unread", label: t("status.completedUnread") };
  const terminal = String(runtime?.terminalStatus || normalizeSessionStatus(session.status) || "").toLowerCase();
  if (["failed", "error", "systemerror", "declined"].includes(terminal)) return { kind: "error", label: terminal === "declined" ? t("status.declined") : terminal === "systemerror" ? t("status.systemError") : t("status.failed") };
  if (["interrupted", "cancelled", "canceled"].includes(terminal)) return { kind: "interrupted", label: t("status.interrupted") };
  if (["notloaded", "not_loaded"].includes(terminal)) return { kind: "idle", label: t("status.notLoaded") };
  return { kind: "idle", label: t("status.idle") };
}

function syncRuntimeFromSession(session) {
  if (!session?.id) return null;
  const runtime = runtimeFor(session.id);
  runtime.protocolStatus = normalizeSessionStatus(session.status);
  runtime.protocolFlags.clear();
  for (const flag of session.activeFlags || []) {
    if (flag === "waitingOnApproval") runtime.protocolFlags.add("approval");
    if (flag === "waitingOnUserInput") runtime.protocolFlags.add("input");
  }
  if (TERMINAL_TURN_STATUSES.has(runtime.protocolStatus)) runtime.terminalStatus = runtime.protocolStatus;
  return runtime;
}

  Object.assign(actions, {
    runtimeFor,
    persistUnread,
    resentMessageKey,
    isHistoricalMessageResent,
    markHistoricalMessageResent,
    clearResentMessages,
    setUnread,
    isReady,
    isTurnActive,
    isThreadActive,
    hasRestartBlocker,
    threadVisualState,
    syncRuntimeFromSession
  });
}
