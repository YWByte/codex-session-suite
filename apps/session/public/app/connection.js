export function installConnection(context) {
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
  const runtimeFor = (...args) => actions.runtimeFor(...args);
  const setUnread = (...args) => actions.setUnread(...args);
  const isReady = (...args) => actions.isReady(...args);
  const syncRuntimeFromSession = (...args) => actions.syncRuntimeFromSession(...args);
  const api = (...args) => actions.api(...args);
  const toast = (...args) => actions.toast(...args);
  const statusName = (...args) => actions.statusName(...args);
  const canAcceptDirectInput = (...args) => actions.canAcceptDirectInput(...args);
  const persistComposerSettings = (...args) => actions.persistComposerSettings(...args);
  const renderComposerModelMenu = (...args) => actions.renderComposerModelMenu(...args);
  const upsertSessionLocally = (...args) => actions.upsertSessionLocally(...args);
  const renderSidebar = (...args) => actions.renderSidebar(...args);
  const updateSessionRows = (...args) => actions.updateSessionRows(...args);
  const scheduleProjectsRefresh = (...args) => actions.scheduleProjectsRefresh(...args);
  const loadProjects = (...args) => actions.loadProjects(...args);
  const ensureTurn = (...args) => actions.ensureTurn(...args);
  const mergeItem = (...args) => actions.mergeItem(...args);
  const refreshTurnItems = (...args) => actions.refreshTurnItems(...args);
  const loadGitContext = (...args) => actions.loadGitContext(...args);
  const selectThread = (...args) => actions.selectThread(...args);
  const renderHeader = (...args) => actions.renderHeader(...args);
  const timelineNearBottom = (...args) => actions.timelineNearBottom(...args);
  const scheduleItemRender = (...args) => actions.scheduleItemRender(...args);
  const scheduleTurnRender = (...args) => actions.scheduleTurnRender(...args);
  const updateComposer = (...args) => actions.updateComposer(...args);
  const activateThread = (...args) => actions.activateThread(...args);
  const syncRequestFlags = (...args) => actions.syncRequestFlags(...args);
  const renderRequests = (...args) => actions.renderRequests(...args);
  const removeThreadLocally = (...args) => actions.removeThreadLocally(...args);
  const closeThreadLocally = (...args) => actions.closeThreadLocally(...args);
  const closeOrUnloadSession = (...args) => actions.closeOrUnloadSession(...args);

function setConnection(health) {
  const previousAppServer = state.health?.appServer || state.health;
  const previousConnectionState = state.connectionState;
  state.health = health;
  const appServer = health?.appServer || health;
  const status = appServer?.state || "offline";
  const wasReady = previousConnectionState === "ready";
  state.connectionState = appServer?.ready ? "ready" : status;
  const connectionChanged = previousConnectionState !== state.connectionState
    || previousAppServer?.actualVersion !== appServer?.actualVersion
    || previousAppServer?.error !== appServer?.error;
  if (!appServer?.ready && ["offline", "stopped", "incompatible"].includes(status)) {
    for (const runtime of state.runtime.values()) {
      runtime.activeTurnId = null;
      runtime.phase = "idle";
      runtime.syncState = "unknown";
    }
    for (const session of state.sessions.values()) session.canAcceptDirectInput = null;
    if (state.selectedSession && !state.selectedArchived) {
      state.selectedSession = {
        ...state.selectedSession,
        canAcceptDirectInput: null,
      };
    }
  }
  elements.connection.className = `connection ${status}`;
  elements.connectionLabel.textContent = appServer?.ready ? `Codex ${appServer.actualVersion}` : statusName(status);
  elements.connection.title = t("errors.expectedCodexVersion", { version: appServer?.expectedVersion || "0.153.2" });
  renderEventStreamState();
  if (connectionChanged) {
    renderSidebar();
    renderHeader();
    updateComposer();
  }
  if (!wasReady && appServer?.ready) {
    state.connectionGeneration++;
    if (state.initialSyncComplete) scheduleViewerReconciliation();
  }
}

function renderEventStreamState() {
  if (state.eventStreamState === "reconnecting") {
    elements.connection.classList.add("reconnecting");
    elements.connectionLabel.textContent = t("status.liveReconnecting");
    return;
  }
  elements.connection.classList.remove("reconnecting");
  const appServer = state.health?.appServer || state.health;
  if (appServer) elements.connectionLabel.textContent = appServer.ready ? `Codex ${appServer.actualVersion}` : statusName(appServer.state || "offline");
}

function scheduleViewerReconciliation() {
  clearTimeout(scheduleViewerReconciliation.timer);
  scheduleViewerReconciliation.timer = setTimeout(async () => {
    if (state.reconciliationPending || !state.initialSyncComplete || !isReady()) return;
    state.reconciliationPending = true;
    const threadId = state.selectedThreadId;
    const archived = state.selectedArchived;
    try {
      await loadProjects(false);
      if (threadId && threadId === state.selectedThreadId && !state.loadingThread) {
        await selectThread(threadId, { force: true, archived });
      }
    } catch (error) {
      toast(t("errors.liveSyncFailed", { message: error.message }), "error");
    } finally {
      state.reconciliationPending = false;
    }
  }, 100);
}

async function loadHealth() {
  try {
    setConnection(await api("/health"));
  } catch (error) {
    setConnection({ appServer: { state: "offline", ready: false, error: error.message } });
  }
}

async function restoreAfterRestart() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(RESTART_STATE_KEY) || "null");
  } catch {}
  if (!saved?.threadId) return;
  if (!state.sessions.has(saved.threadId)) await loadProjects(false);
  sessionStorage.removeItem(RESTART_STATE_KEY);
  if (!state.sessions.has(saved.threadId)) return;
  await selectThread(saved.threadId, { force: true });
  if (state.selectedThreadId !== saved.threadId) return;
  if (saved.resume === true && !canAcceptDirectInput()) await activateThread();
  if (typeof saved.draft !== "string") return;
  elements.composerText.value = saved.draft;
  state.composerDrafts.set(saved.threadId, saved.draft);
  updateComposer();
}
function scheduleGitRefresh() {
  clearTimeout(scheduleGitRefresh.timer);
  scheduleGitRefresh.timer = setTimeout(() => void loadGitContext(), 300);
}

function recordProtocolEvent(runtime, status) {
  if (!runtime) return;
  runtime.protocolRevision = ++state.protocolRevision;
  if (status) runtime.protocolStatus = normalizeSessionStatus(status);
}

function applyEvent(type, data = {}) {
  if (state.loadingThread && data.threadId === state.selectedThreadId && !type.startsWith("connection.") && !type.startsWith("request.")) {
    state.queuedEvents.push({ type, data });
    return;
  }
  const runtime = runtimeFor(data.threadId);
  const selected = data.threadId === state.selectedThreadId;
  switch (type) {
    case "connection.state":
      setConnection({ appServer: data });
      return;
    case "connection.protocolError":
      state.connectionState = "incompatible";
      setConnection({ appServer: { ...(state.health?.appServer || {}), state: "incompatible", ready: false, error: data.message } });
      return;
    case "navigation.invalidated":
      scheduleProjectsRefresh();
      return;
    case "thread.started": {
      const thread = upsertSessionLocally(data.thread);
      if (!thread) return;
      if (thread.parentThreadId) state.visibleSubagentIds.add(thread.id);
      else state.freshThreadIds.add(thread.id);
      renderSidebar();
      if (selected) { state.selectedSession = thread; renderHeader(); updateComposer(); }
      return;
    }
    case "thread.name.updated": {
      const session = state.sessions.get(data.threadId);
      if (!session) return;
      const updated = upsertSessionLocally({ ...session, ...(data.thread || {}), name: data.name });
      if (selected) state.selectedSession = updated;
      updateSessionRows(data.threadId);
      if (selected) renderHeader();
      return;
    }
    case "thread.settings": {
      const session = state.sessions.get(data.threadId);
      if (!session || !data.thread) return;
      const updated = upsertSessionLocally({ ...session, ...data.thread });
      if (updated.model && updated.reasoningEffort) {
        state.composerSettings.set(updated.id, { model: updated.model, reasoningEffort: updated.reasoningEffort });
        persistComposerSettings();
      }
      if (selected) state.selectedSession = updated;
      updateSessionRows(data.threadId);
      if (selected) { renderHeader(); renderComposerModelMenu(); updateComposer(); }
      return;
    }
    case "thread.status": {
      const session = state.sessions.get(data.threadId);
      if (session) {
        session.status = normalizeSessionStatus(data.status);
        session.activeFlags = Array.isArray(data.activeFlags) ? data.activeFlags : [];
        syncRuntimeFromSession(session).syncState = "synced";
        if (selected) state.selectedSession = session;
      } else {
        runtime.protocolFlags.clear();
        for (const flag of data.activeFlags || []) {
          if (flag === "waitingOnApproval") runtime.protocolFlags.add("approval");
          if (flag === "waitingOnUserInput") runtime.protocolFlags.add("input");
        }
      }
      recordProtocolEvent(runtime, data.status);
      renderSidebar();
      if (selected) { renderHeader(); updateComposer(); }
      return;
    }
    case "turn.started": {
      const turnId = data.turn?.id || data.turnId;
      if (!turnId) return;
      if (selected) ensureTurn(turnId, data.turn || {});
      if (runtime.terminalTurnIds.has(turnId)) {
        renderSidebar();
        if (selected) { scheduleTurnRender(turnId); renderHeader(); updateComposer(); }
        return;
      }
      runtime.activeTurnId = turnId;
      runtime.phase = runtime.compactPending ? "compacting" : "running";
      runtime.compactPending = false;
      runtime.terminalStatus = null;
      recordProtocolEvent(runtime, "active");
      const session = state.sessions.get(data.threadId);
      if (session) session.status = "active";
      renderSidebar();
      if (selected) { scheduleTurnRender(turnId, { follow: timelineNearBottom() }); renderHeader(); updateComposer(); }
      return;
    }
    case "item.started":
    case "item.completed": {
      const itemType = data.item?.type;
      if (type === "item.started") {
        if (itemType === "agentMessage") runtime.phase = "typing";
        else if (itemType === "contextCompaction") runtime.phase = "compacting";
        else if (["commandExecution", "fileChange", "mcpToolCall", "collabAgentToolCall", "collabToolCall"].includes(itemType)) runtime.phase = "tool";
        else runtime.phase = "running";
      } else if (runtime.activeTurnId === data.turnId) {
        runtime.phase = itemType === "contextCompaction" ? "compacting" : "running";
      }
      if (selected) {
        const follow = timelineNearBottom();
        mergeItem(data.turnId, data.item);
        if (itemType !== "reasoning") scheduleTurnRender(data.turnId, { follow, refreshRail: itemType === "userMessage" });
        if (type === "item.completed" && itemType === "userMessage" && data.item?.clientId && !(data.item.images || []).length) {
          void refreshTurnItems(data.threadId, data.turnId);
        }
        renderHeader();
        updateComposer();
      }
      if (["fileChange", "commandExecution"].includes(itemType) && type === "item.completed") scheduleGitRefresh();
      updateSessionRows(data.threadId);
      return;
    }
    case "item.delta": {
      const previousPhase = runtime.phase;
      runtime.phase = data.itemType === "plan" ? "running" : data.field === "text" ? "typing" : data.field === "output" ? "tool" : runtime.phase;
      if (!selected) return;
      const typeForField = data.itemType || (["summary", "content"].includes(data.field) ? "reasoning" : data.field === "output" ? "commandExecution" : "agentMessage");
      const turn = ensureTurn(data.turnId);
      const existing = turn.items.get(data.itemId);
      const current = existing || { id: data.itemId, type: typeForField, status: "inProgress" };
      if (current.lifecycleStatus === "completed" || TERMINAL_TURN_STATUSES.has(String(turn.status || "").toLowerCase())) return;
      const indexName = data.field === "summary" ? "summaryIndex" : data.field === "content" ? "contentIndex" : null;
      if (indexName && Number.isInteger(data[indexName])) {
        const segmentsName = `${data.field}Segments`;
        const segments = Array.isArray(current[segmentsName]) ? current[segmentsName] : [];
        segments[data[indexName]] = `${segments[data[indexName]] || ""}${data.delta || ""}`.slice(-200_000);
        current[segmentsName] = segments;
        current[data.field] = segments.join("").slice(-200_000);
      } else {
        current[data.field] = `${current[data.field] || ""}${data.delta || ""}`.slice(-200_000);
      }
      mergeItem(data.turnId, current);
      if (typeForField !== "reasoning") scheduleItemRender(data.turnId, data.itemId, { follow: timelineNearBottom() });
      if (runtime.phase !== previousPhase) { updateSessionRows(data.threadId); renderHeader(); updateComposer(); }
      return;
    }
    case "item.patch": case "item.progress": case "turn.plan": case "turn.diff": {
      runtime.phase = "tool";
      updateSessionRows(data.threadId);
      if (!selected) return;
      let itemId = data.itemId;
      if (type === "item.patch") { const turn = ensureTurn(data.turnId); mergeItem(data.turnId, { ...(turn.items.get(data.itemId) || {}), id: data.itemId, type: "fileChange", status: "inProgress", changes: data.changes }); }
      else if (type === "item.progress") { const turn = ensureTurn(data.turnId); mergeItem(data.turnId, { ...(turn.items.get(data.itemId) || {}), id: data.itemId, type: "mcpToolCall", status: "inProgress", progress: data.message }); }
      else if (type === "turn.plan") { itemId = `${data.turnId}:plan`; mergeItem(data.turnId, { id: itemId, type: "plan", entries: data.plan, status: "inProgress" }); }
      else { itemId = `${data.turnId}:diff`; mergeItem(data.turnId, { id: itemId, type: "fileChange", diff: data.diff, status: "inProgress" }); }
      scheduleItemRender(data.turnId, itemId, { follow: timelineNearBottom() });
      renderHeader(); updateComposer();
      if (["item.patch", "turn.diff"].includes(type)) scheduleGitRefresh();
      return;
    }
    case "turn.completed": {
      const turnId = data.turn?.id || data.turnId;
      const alreadyTerminal = turnId ? runtime.terminalTurnIds.has(turnId) : false;
      if (turnId) {
        runtime.terminalTurnIds.add(turnId);
        while (runtime.terminalTurnIds.size > 100) runtime.terminalTurnIds.delete(runtime.terminalTurnIds.values().next().value);
        runtime.terminalStatus = String(data.turn?.status || "completed").toLowerCase();
        if (selected) { const turn = ensureTurn(turnId); turn.status = data.turn?.status || "completed"; turn.error = data.turn?.error; }
      }
      const completedCurrentTurn = runtime.activeTurnId === turnId;
      runtime.compactPending = false;
      const settlesIdle = completedCurrentTurn || (!runtime.activeTurnId && !alreadyTerminal);
      if (settlesIdle) {
        runtime.activeTurnId = null;
        runtime.phase = "idle";
        recordProtocolEvent(runtime, "idle");
        const session = state.sessions.get(data.threadId);
        if (session) {
          session.status = "idle";
          session.activeFlags = [];
        }
        runtime.protocolFlags.clear();
        runtime.requestFlags.clear();
        if (!selected) setUnread(data.threadId, true); else setUnread(data.threadId, false);
      }
      if (state.freshThreadIds.delete(data.threadId)) scheduleProjectsRefresh();
      renderSidebar();
      if (selected) { scheduleTurnRender(turnId, { follow: timelineNearBottom(), refreshRail: true }); renderHeader(); updateComposer(); }
      scheduleGitRefresh();
      if (selected && turnId) void refreshTurnItems(data.threadId, turnId);
      if (completedCurrentTurn && runtime.pendingClose) { runtime.pendingClose = false; void closeOrUnloadSession(data.threadId); }
      return;
    }
    case "thread.tokenUsage": {
      const session = state.sessions.get(data.threadId);
      if (session) upsertSessionLocally({ ...session, tokenUsage: data.tokenUsage });
      if (selected && state.selectedSession) {
        state.selectedSession = { ...state.selectedSession, tokenUsage: data.tokenUsage };
        renderHeader();
      }
      return;
    }
    case "turn.error": if (selected) toast(data.error, "error"); return;
    case "request.pending":
    case "request.responding": {
      state.pendingRequests.set(data.requestId, data);
      syncRequestFlags(data.threadId);
      updateSessionRows(data.threadId);
      if (selected) { renderHeader(); updateComposer(); }
      renderRequests(); return;
    }
    case "request.resolved": case "request.expired": {
      const request = state.pendingRequests.get(data.requestId);
      state.pendingRequests.delete(data.requestId);
      if (request?.threadId) {
        syncRequestFlags(request.threadId);
        updateSessionRows(request.threadId);
      }
      if (request?.threadId === state.selectedThreadId) { renderHeader(); updateComposer(); }
      renderRequests(); return;
    }
    case "request.unsupported":
      toast(t("errors.unsupportedServerRequest", { method: data.method || "unknown" }), "error");
      return;
    case "thread.archived":
    case "thread.deleted": {
      const threadId = data.threadId || data.thread?.id;
      if (!threadId) return;
      removeThreadLocally(threadId);
      scheduleProjectsRefresh();
      return;
    }
    case "thread.closed": {
      const threadId = data.threadId || data.thread?.id;
      if (!threadId) return;
      closeThreadLocally(threadId);
      scheduleProjectsRefresh();
      return;
    }
    case "thread.unarchived": scheduleProjectsRefresh(); return;
    default: return;
  }
}

function connectEvents() {
  const source = new EventSource("/api/events");
  const seenEventIds = new Set();
  const names = [
    "connection.state", "connection.protocolError", "navigation.invalidated", "thread.started", "thread.name.updated", "thread.settings", "thread.status",
    "thread.archived", "thread.deleted", "thread.unarchived", "thread.closed",
    "turn.started", "turn.completed", "turn.diff", "turn.plan", "turn.error", "thread.tokenUsage",
    "item.started", "item.completed", "item.delta", "item.patch", "item.progress",
    "request.pending", "request.responding", "request.resolved", "request.expired", "request.unsupported",
  ];
  for (const name of names) source.addEventListener(name, (event) => {
    if (event.lastEventId) {
      if (seenEventIds.has(event.lastEventId)) return;
      seenEventIds.add(event.lastEventId);
      if (seenEventIds.size > 10_000) seenEventIds.delete(seenEventIds.values().next().value);
    }
    try { applyEvent(name, JSON.parse(event.data)); } catch { toast(t("errors.invalidLiveEvent"), "error"); }
  });
  source.onopen = () => {
    const recovered = state.eventStreamState === "reconnecting";
    state.eventStreamState = "connected";
    renderEventStreamState();
    if (recovered) scheduleViewerReconciliation();
  };
  source.onerror = () => {
    state.eventStreamState = "reconnecting";
    renderEventStreamState();
  };
}

  Object.assign(actions, {
    setConnection,
    renderEventStreamState,
    scheduleViewerReconciliation,
    loadHealth,
    restoreAfterRestart,
    scheduleGitRefresh,
    recordProtocolEvent,
    applyEvent,
    connectEvents
  });
}
