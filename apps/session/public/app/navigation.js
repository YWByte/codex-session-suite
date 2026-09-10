export function installNavigation(context) {
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
  const loadAnnotations = (...args) => actions.loadAnnotations(...args);
  const runtimeFor = (...args) => actions.runtimeFor(...args);
  const persistUnread = (...args) => actions.persistUnread(...args);
  const clearResentMessages = (...args) => actions.clearResentMessages(...args);
  const setUnread = (...args) => actions.setUnread(...args);
  const isReady = (...args) => actions.isReady(...args);
  const isTurnActive = (...args) => actions.isTurnActive(...args);
  const isThreadActive = (...args) => actions.isThreadActive(...args);
  const threadVisualState = (...args) => actions.threadVisualState(...args);
  const syncRuntimeFromSession = (...args) => actions.syncRuntimeFromSession(...args);
  const el = (...args) => actions.el(...args);
  const bindImmediateMouseAction = (...args) => actions.bindImmediateMouseAction(...args);
  const listFrom = (...args) => actions.listFrom(...args);
  const api = (...args) => actions.api(...args);
  const toast = (...args) => actions.toast(...args);
  const statusName = (...args) => actions.statusName(...args);
  const applyAllAnnotations = (...args) => actions.applyAllAnnotations(...args);
  const removeAnnotationBubble = (...args) => actions.removeAnnotationBubble(...args);
  const closeAnnotationPopup = (...args) => actions.closeAnnotationPopup(...args);
  const renderAnnotationList = (...args) => actions.renderAnnotationList(...args);
  const sessionTitle = (...args) => actions.sessionTitle(...args);
  const canAcceptDirectInput = (...args) => actions.canAcceptDirectInput(...args);
  const isChildThread = (...args) => actions.isChildThread(...args);
  const composerImages = (...args) => actions.composerImages(...args);
  const composerSetting = (...args) => actions.composerSetting(...args);
  const persistComposerSettings = (...args) => actions.persistComposerSettings(...args);
  const closeComposerModelMenu = (...args) => actions.closeComposerModelMenu(...args);
  const saveScrollPosition = (...args) => actions.saveScrollPosition(...args);
  const threadPath = (...args) => actions.threadPath(...args);
  const formatTime = (...args) => actions.formatTime(...args);
  const renderComposerTokenUsage = (...args) => actions.renderComposerTokenUsage(...args);
  const installTurns = (...args) => actions.installTurns(...args);
  const hydrateItems = (...args) => actions.hydrateItems(...args);
  const loadGitContext = (...args) => actions.loadGitContext(...args);
  const renderTimeline = (...args) => actions.renderTimeline(...args);
  const updateComposer = (...args) => actions.updateComposer(...args);
  const setSendStatus = (...args) => actions.setSendStatus(...args);
  const renderRequests = (...args) => actions.renderRequests(...args);
  const applyEvent = (...args) => actions.applyEvent(...args);
  const closeMobileNav = (...args) => actions.closeMobileNav(...args);

function saveExpanded() {
  localStorage.setItem("codex-session.expandedProjects", JSON.stringify([...state.expandedProjects]));
}

function actionIcon(label, className, icon, handler) {
  const button = el("button", className);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon;
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("keydown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    void handler();
  });
  return button;
}

function renderPendingSessionName(session) {
  const row = el("div", "session-item pending-session-name active");
  row.dataset.threadId = session.id;
  row.append(el("span", "status-dot idle"), el("span", "time", formatTime(session.updatedAt)));

  const form = el("form", "pending-session-name-form");
  const input = el("input", "pending-session-name-input");
  input.type = "text";
  input.maxLength = 200;
  input.required = true;
  input.placeholder = t("composer.enterSessionName");
  input.value = state.pendingNameDraft;
  input.disabled = state.pendingNameBusy;
  input.dataset.threadId = session.id;
  input.setAttribute("aria-label", t("navigation.newSessionName"));
  input.addEventListener("input", () => { state.pendingNameDraft = input.value; });
  input.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key !== "Escape") return;
    event.preventDefault();
    void cancelPendingSessionName(session.id);
  });
  const submit = el("button", "pending-session-name-submit", state.pendingNameBusy ? "…" : "✓");
  submit.type = "submit";
  submit.disabled = state.pendingNameBusy;
  submit.title = t("actions.confirmName");
  submit.setAttribute("aria-label", t("actions.confirmSessionName"));
  form.append(input, submit);
  form.addEventListener("click", (event) => event.stopPropagation());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void commitPendingSessionName(session.id);
  });
  row.append(form);
  return row;
}

function renderSessionButton(session, mode = "history", depth = 0, orphan = false) {
  const active = mode === "active" || mode === "loaded";
  const search = mode === "search";
  const archived = mode === "archived";
  const runtime = syncRuntimeFromSession(session);
  const visual = threadVisualState(session, runtime);
  if (!active && !search && !archived && state.pendingNameThreadId === session.id) {
    return renderPendingSessionName(session);
  }
  if (search) {
    const button = el("button", "session-search-result");
    button.type = "button";
    button.dataset.threadId = session.id;
    if (state.selectedThreadId === session.id) button.classList.add("selected");
    button.append(el("span", "session-search-result-title", threadPath(session)));
    const meta = el("span", "session-search-result-meta");
    const location = isChildThread(session) ? `${session.cwd || t("common.unknownWorkspace")} · ${t("common.childThread")}` : session.cwd || t("common.unknownWorkspace");
    meta.append(el("span", "", location), el("time", "", formatTime(session.updatedAt)));
    button.append(meta);
    button.addEventListener("click", () => void selectThread(session.id));
    return button;
  }

  const child = isChildThread(session) || depth > 0;
  const baseClass = active ? "active-item" : archived ? "session-item archived-item" : "session-item";
  const row = el("div", `${baseClass}${child ? " subagent-item" : ""}`);
  row.dataset.threadId = session.id;
  row.dataset.threadDepth = String(depth);
  if (child) row.style.setProperty("--thread-depth", String(depth || 1));
  if (orphan) row.classList.add("orphan-thread");
  if (state.selectedThreadId === session.id) row.classList.add("active");
  const open = el("button", "session-open");
  open.type = "button";
  open.disabled = false;
  if (active) {
    row.dataset.status = visual.kind;
    open.append(el("span", `status-dot ${visual.kind}`), el("span", child ? "subagent-title" : "active-title", sessionTitle(session)));
    if (child) open.append(el("span", "subagent-type", session.agentRole || session.agentNickname || t("common.subagent")));
    else open.append(el("span", "active-meta", visual.label));
    row.append(open);
    if (!child) row.append(
      actionIcon(t("actions.rename"), "active-rename", EDIT_ICON, () => renameSession(session.id)),
      actionIcon(t("actions.closeOrUnload"), "active-kill", CLOSE_ICON, () => closeOrUnloadSession(session.id)),
    );
  } else if (archived) {
    open.append(el("span", "time", formatTime(session.updatedAt)), el("span", "session-title", sessionTitle(session)));
    row.append(open, actionIcon(t("actions.unarchive"), "archive-btn", ARCHIVE_ICON, () => unarchiveSession(session.id)));
  } else {
    const selecting = state.selectionProjectId === session.projectId;
    const selectable = !child && !isThreadActive(session, runtime);
    if (selecting) {
      const checkbox = el("input", "session-select");
      checkbox.type = "checkbox";
      checkbox.checked = state.selectedThreadIds.has(session.id);
      checkbox.disabled = !selectable || state.bulkDeleting;
      checkbox.setAttribute("aria-label", selectable ? t("navigation.selectSession", { name: sessionTitle(session) }) : child ? t("navigation.managedByParent", { name: sessionTitle(session) }) : t("navigation.runningCannotDelete", { name: sessionTitle(session) }));
      checkbox.addEventListener("change", () => toggleBulkSession(session.id, checkbox.checked));
      row.append(checkbox);
    }
    const historyStatus = el("span", `status-dot ${visual.kind}`);
    historyStatus.title = visual.label;
    open.append(historyStatus, el("span", "time", formatTime(session.updatedAt)), el("span", "session-title", sessionTitle(session)));
    row.append(open);
    if (!child) {
      row.append(actionIcon(t("actions.rename"), "rename-btn", EDIT_ICON, () => renameSession(session.id)));
      if (!selecting) row.append(actionIcon(t("actions.archive"), "archive-btn", ARCHIVE_ICON, () => archiveSession(session.id)));
    }
  }
  bindImmediateMouseAction(row, (event) => {
    const interactive = event.target.closest?.("button, input");
    if (interactive && interactive !== open) return;
    if (!archived && state.selectionProjectId === session.projectId) {
      const runtime = runtimeFor(session.id);
      if (!child && !isThreadActive(session, runtime)) toggleBulkSession(session.id, !state.selectedThreadIds.has(session.id));
      return;
    }
    void selectThread(session.id, { archived });
  });
  return row;
}

function upsertSessionLocally(session) {
  if (!session?.id) return null;
  const previous = state.sessions.get(session.id);
  const merged = { ...previous, ...session };
  state.sessions.set(merged.id, merged);

  if (previous?.projectId && previous.projectId !== merged.projectId) {
    const previousProject = state.projects.find((project) => project.id === previous.projectId);
    if (previousProject) {
      previousProject.sessions = (previousProject.sessions || []).filter((entry) => entry.id !== merged.id);
      previousProject.sessionCount = previousProject.sessions.length;
    }
  }

  let project = state.projects.find((entry) => entry.id === merged.projectId);
  if (!project && merged.projectId) {
    project = {
      id: merged.projectId,
      cwd: merged.cwd || null,
      name: merged.cwd?.split("/").filter(Boolean).at(-1) || t("common.unknownWorkspace"),
      sessions: [],
      sessionCount: 0,
    };
    state.projects.push(project);
  }
  if (project) {
    const index = (project.sessions || []).findIndex((entry) => entry.id === merged.id);
    if (index >= 0) project.sessions[index] = merged;
    else project.sessions = [merged, ...(project.sessions || [])];
    project.sessionCount = project.sessions.length;
  }
  return merged;
}

function clearPendingSessionName() {
  state.pendingNameThreadId = null;
  state.pendingNameDraft = "";
  state.pendingNameBusy = false;
}

async function commitPendingSessionName(threadId) {
  if (state.pendingNameThreadId !== threadId || state.pendingNameBusy) return;
  const name = state.pendingNameDraft.trim();
  if (!name) {
    toast(t("errors.sessionNameRequired"), "error");
    elements.sidebar.querySelector(".pending-session-name-input")?.focus();
    return;
  }
  state.pendingNameBusy = true;
  renderSidebar();
  try {
    const payload = await api(`/api/sessions/${encodeURIComponent(threadId)}`, {
      method: "PATCH",
      body: { name },
    });
    const session = upsertSessionLocally(payload.session || { ...state.sessions.get(threadId), name });
    if (state.selectedThreadId === threadId) state.selectedSession = session;
    clearPendingSessionName();
    renderSidebar();
    renderHeader();
  } catch (error) {
    state.pendingNameBusy = false;
    toast(t("errors.renameFailed", { message: error.message }), "error");
    renderSidebar();
  }
}

async function cancelPendingSessionName(threadId) {
  if (state.pendingNameThreadId !== threadId || state.pendingNameBusy) return;
  state.pendingNameBusy = true;
  renderSidebar();
  try {
    await api(`/api/sessions/${encodeURIComponent(threadId)}`, { method: "DELETE", body: {} });
    state.freshThreadIds.delete(threadId);
    clearPendingSessionName();
    removeThreadLocally(threadId);
  } catch (error) {
    state.pendingNameBusy = false;
    toast(t("errors.cancelNewSessionFailed", { message: error.message }), "error");
    renderSidebar();
  }
}

async function createSessionFromFolder() {
  if (state.folderCreatePending || state.pendingNameThreadId || !isReady()) return;
  state.folderCreatePending = true;
  renderSidebar();
  try {
    const payload = await api("/api/sessions/from-folder", { method: "POST", body: {} });
    if (payload.canceled) return;
    const session = upsertSessionLocally(payload.session);
    if (!session) throw new Error(t("errors.codexNoSession"));
    state.freshThreadIds.add(session.id);
    state.pendingNameThreadId = session.id;
    state.pendingNameDraft = "";
    const project = state.projects.find((entry) => entry.id === session.projectId);
    if (project) {
      state.projects = [project, ...state.projects.filter((entry) => entry.id !== project.id)];
      state.expandedProjects.add(project.id);
      saveExpanded();
    }
    renderSidebar();
    await selectThread(session.id, { fresh: true });
  } catch (error) {
    toast(t("errors.createSessionFailed", { message: error.message }), "error");
  } finally {
    state.folderCreatePending = false;
    renderSidebar();
  }
}

function showNewSessionForm(project, container) {
  if (container.querySelector(".new-session-form")) return;
  const form = el("form", "new-session-form");
  const input = el("input");
  input.type = "text";
  input.maxLength = 200;
  input.placeholder = t("navigation.newSessionNameOptional");
  input.setAttribute("aria-label", t("navigation.newSessionName"));
  const submit = el("button", "", t("actions.create"));
  submit.type = "submit";
  form.append(input, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const payload = await api(`/api/projects/${encodeURIComponent(project.id)}/sessions`, {
        method: "POST",
        body: input.value.trim() ? { name: input.value.trim() } : {},
      });
      if (payload.warning) toast(payload.warning, "error");
      const session = upsertSessionLocally(payload.session);
      if (session) {
        state.freshThreadIds.add(session.id);
        renderSidebar();
        await selectThread(session.id, { fresh: true });
      }
    } catch (error) {
      toast(error.message, "error");
    } finally {
      submit.disabled = false;
    }
  });
  container.append(form);
  input.focus();
}

function clearBulkSelection() {
  state.selectionProjectId = null;
  state.selectedThreadIds.clear();
  state.bulkDeleting = false;
  renderSidebar();
}

function beginBulkSelection(projectId) {
  if (state.selectionProjectId === projectId) {
    clearBulkSelection();
    return;
  }
  state.selectionProjectId = projectId;
  state.selectedThreadIds.clear();
  state.expandedProjects.add(projectId);
  saveExpanded();
  renderSidebar();
}

function toggleBulkSession(threadId, selected) {
  if (selected) state.selectedThreadIds.add(threadId);
  else state.selectedThreadIds.delete(threadId);
  renderSidebar();
}

async function lifecyclePreview(threadId) {
  const payload = await api(`/api/sessions/${encodeURIComponent(threadId)}/relations`);
  return {
    children: listFrom(payload, "children"),
    descendants: listFrom(payload, "descendants"),
  };
}

function relationThreadActive(thread) {
  return ["active", "inprogress"].includes(normalizeSessionStatus(thread?.status));
}

function lifecycleSummary(session, preview, action) {
  const children = preview.children || [];
  const descendants = preview.descendants || [];
  const details = descendants.length
    ? t("navigation.descendantSummary", { children: children.length, descendants: descendants.length, list: descendants.map((thread) => `• ${sessionTitle(thread)} · ${thread.agentRole || thread.agentNickname || t("common.subagent")} · ${statusName(thread.status)}`).join("\n") })
    : "\n" + t("navigation.noDescendants");
  return t("navigation.lifecycleSummary", { action, name: sessionTitle(session), details });
}

async function deleteSelectedSessions(projectId) {
  if (state.selectionProjectId !== projectId || state.bulkDeleting) return;
  const selected = [...state.selectedThreadIds].filter((threadId) => state.sessions.get(threadId)?.projectId === projectId);
  if (!selected.length) return;
  let previews;
  try {
    previews = new Map(await Promise.all(selected.map(async (threadId) => [threadId, await lifecyclePreview(threadId)])));
  } catch (error) {
    toast(t("errors.deleteImpactFailed", { message: error.message }), "error");
    return;
  }
  const selectedSet = new Set(selected);
  const covered = new Set();
  for (const preview of previews.values()) for (const child of preview.descendants) if (selectedSet.has(child.id)) covered.add(child.id);
  const targets = selected.filter((threadId) => !covered.has(threadId));
  const affected = new Set(targets);
  const activeDescendants = [];
  for (const threadId of targets) {
    for (const child of previews.get(threadId)?.descendants || []) {
      affected.add(child.id);
      if (relationThreadActive(child)) activeDescendants.push(child);
    }
  }
  if (activeDescendants.length) {
    toast(t("errors.activeDescendantsCannotDelete", { count: activeDescendants.length }), "error");
    return;
  }
  if (!window.confirm(t("navigation.confirmBulkDelete", { trees: targets.length, threads: affected.size }))) return;

  state.bulkDeleting = true;
  renderSidebar();
  const failures = [];
  for (const threadId of targets) {
    try {
      await api(`/api/sessions/${encodeURIComponent(threadId)}`, { method: "DELETE", body: {} });
      state.selectedThreadIds.delete(threadId);
      removeThreadLocally(threadId, false);
    } catch (error) {
      failures.push(`${sessionTitle(state.sessions.get(threadId))}：${error.message}`);
    }
  }
  state.bulkDeleting = false;
  if (!state.selectedThreadIds.size) state.selectionProjectId = null;
  await loadProjects(false);
  const remaining = [...affected].filter((threadId) => state.sessions.has(threadId) || state.archivedSessions.some((session) => session.id === threadId));
  if (remaining.length) failures.push(t("navigation.remainingThreads", { count: remaining.length }));
  if (failures.length) toast(t("errors.deleteIncomplete", { count: failures.length, details: failures.join("; ") }), "error");
}

function renderProjectSelectionBar(projectId) {
  const bar = el("div", "project-selection-bar");
  bar.append(el("span", "bulk-count", t("navigation.selectedSessions", { count: state.selectedThreadIds.size })));
  const cancel = el("button", "", t("actions.cancel"));
  cancel.type = "button";
  cancel.disabled = state.bulkDeleting;
  cancel.addEventListener("click", clearBulkSelection);
  const remove = el("button", "bulk-delete", state.bulkDeleting ? t("status.deleting") : t("actions.delete"));
  remove.type = "button";
  remove.disabled = state.bulkDeleting || state.selectedThreadIds.size === 0;
  remove.addEventListener("click", () => void deleteSelectedSessions(projectId));
  bar.append(cancel, remove);
  return bar;
}

function renderSidebar() {
  elements.sidebar.replaceChildren();
  const sessions = [...state.sessions.values()];
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const loadedRoots = sessions.filter((session) => !isChildThread(session) && isLoadedSessionStatus(session.status));
  const loadedRootIds = new Set(loadedRoots.map((session) => session.id));
  const activeRootIds = new Set(
    loadedRoots.filter((session) => isThreadActive(session, syncRuntimeFromSession(session))).map((session) => session.id)
  );
  const activeChildren = new Map();
  for (const session of sessions.filter((entry) => isChildThread(entry) && state.visibleSubagentIds.has(entry.id))) {
    let root = session;
    const seen = new Set();
    while (root.parentThreadId && byId.has(root.parentThreadId) && !seen.has(root.id)) {
      seen.add(root.id);
      root = byId.get(root.parentThreadId);
    }
    if (!loadedRootIds.has(root.id)) continue;
    const entries = activeChildren.get(session.parentThreadId) || [];
    entries.push(session);
    activeChildren.set(session.parentThreadId, entries);
    if (isThreadActive(session, syncRuntimeFromSession(session))) activeRootIds.add(root.id);
  }
  const active = loadedRoots.filter((session) => activeRootIds.has(session.id));
  const loaded = loadedRoots.filter((session) => !activeRootIds.has(session.id));
  const activeWithChildren = (root, mode) => {
    const nodes = [renderSessionButton(root, mode)];
    const visited = new Set([root.id]);
    const visit = (parentId, depth) => {
      for (const child of activeChildren.get(parentId) || []) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        nodes.push(renderSessionButton(child, isThreadActive(child, runtimeFor(child.id)) ? "active" : "loaded", depth));
        visit(child.id, depth + 1);
      }
    };
    visit(root.id, 1);
    return nodes;
  };
  const activeSection = el("section", "active-section");
  const activeHeader = el("div", "active-header");
  activeHeader.append(el("span", "active-dot"), el("span", "", t("navigation.activeConversations")));
  activeSection.append(activeHeader);
  if (active.length) activeSection.append(...active.flatMap((session) => activeWithChildren(session, "active")));
  else activeSection.append(el("div", "active-empty", t("navigation.noActiveCodex")));
  if (loaded.length) {
    const loadedHeader = el("div", "active-header loaded-header");
    loadedHeader.append(el("span", "", t("status.loaded")));
    activeSection.append(loadedHeader, ...loaded.flatMap((session) => activeWithChildren(session, "loaded")));
  }
  elements.sidebar.append(activeSection);

  const historyProjects = state.projects
    .map((project) => ({
      ...project,
      sessions: (project.sessions || []).filter((session) => !isChildThread(session)),
    }))
    .filter((project) => project.sessions.length > 0);
  const archivedRoots = state.archivedSessions.filter((session) => !isChildThread(session));
  const heading = el("div", "projects-label");
  const headingActions = el("div", "projects-label-actions");
  const createFromFolder = el("button", "projects-create-btn", state.folderCreatePending ? "…" : "+");
  createFromFolder.type = "button";
  createFromFolder.disabled = !isReady() || state.folderCreatePending || Boolean(state.pendingNameThreadId);
  createFromFolder.title = state.pendingNameThreadId ? t("errors.finishSessionNameFirst") : t("actions.chooseFolderAndCreate");
  createFromFolder.setAttribute("aria-label", t("actions.chooseFolderAndCreateCodex"));
  createFromFolder.addEventListener("click", () => void createSessionFromFolder());
  headingActions.append(el("span", "projects-count", `${historyProjects.length} projects`), createFromFolder);
  heading.append(el("span", "", t("navigation.historyProjects")), headingActions);
  elements.sidebar.append(heading);

  if (!historyProjects.length && !archivedRoots.length) {
    elements.sidebar.append(el("p", "active-empty", t("navigation.noSessions")));
    return;
  }

  for (const project of historyProjects) {
    const section = el("section", "project-item");
    section.dataset.id = project.id;
    const expanded = state.expandedProjects.has(project.id) || project.sessions?.some((session) => session.id === state.selectedThreadId);
    if (!expanded) section.classList.add("collapsed");
    if (state.selectionProjectId === project.id) section.classList.add("selecting");
    const row = el("div", "project-header");
    const toggleButton = el("button", "project-toggle");
    toggleButton.type = "button";
    toggleButton.setAttribute("aria-expanded", String(expanded));
    toggleButton.append(el("span", "chevron", "▼"), el("span", "name", project.name || project.cwd || t("common.unknownWorkspace")));
    const toggleProject = () => {
      if (state.expandedProjects.has(project.id)) {
        state.expandedProjects.delete(project.id);
        if (state.selectionProjectId === project.id) {
          state.selectionProjectId = null;
          state.selectedThreadIds.clear();
        }
      } else {
        state.expandedProjects.add(project.id);
      }
      saveExpanded();
      renderSidebar();
    };
    row.addEventListener("click", (event) => {
      const interactive = event.target.closest?.("button, input");
      if (interactive && interactive !== toggleButton) return;
      toggleProject();
    });
    row.append(toggleButton);
    if (project.cwd) {
      const add = el("button", "project-action-btn spawn-btn", "+");
      add.type = "button";
      add.title = t("actions.createCodexSession");
      add.setAttribute("aria-label", t("actions.createSessionIn", { name: project.name }));
      add.addEventListener("click", (event) => {
        event.stopPropagation();
        state.expandedProjects.add(project.id);
        saveExpanded();
        section.classList.remove("collapsed");
        toggleButton.setAttribute("aria-expanded", "true");
        showNewSessionForm(project, section);
      });
      row.append(add);
    }
    if (project.sessions?.length) {
      const bulkDelete = actionIcon(t("actions.bulkDeleteSessions"), "project-action-btn bulk-delete-btn", DELETE_ICON, () => beginBulkSelection(project.id));
      bulkDelete.classList.toggle("active", state.selectionProjectId === project.id);
      row.append(bulkDelete);
    }
    row.append(el("span", "badge", String(project.sessions.length)));
    section.append(row);
    if (state.selectionProjectId === project.id) section.append(renderProjectSelectionBar(project.id));
    const list = el("div", "session-list");
    for (const session of [...project.sessions].sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))) {
      list.append(renderSessionButton(session, "history"));
    }
    section.append(list);
    elements.sidebar.append(section);
  }

  if (archivedRoots.length) {
    const archivedHeading = el("button", "projects-label archived-label");
    archivedHeading.type = "button";
    archivedHeading.setAttribute("aria-expanded", String(state.archivedExpanded));
    archivedHeading.setAttribute("aria-controls", "archived-session-list");
    const archivedTitle = el("span", "archived-label-title", t("status.archived"));
    archivedTitle.prepend(el("span", "archived-chevron", "▼"));
    archivedHeading.append(archivedTitle, el("span", "archived-count", String(archivedRoots.length)));
    archivedHeading.addEventListener("click", () => {
      state.archivedExpanded = !state.archivedExpanded;
      localStorage.setItem("codex-session.archivedExpanded", String(state.archivedExpanded));
      renderSidebar();
    });
    const archivedList = el("div", "session-list archived-list");
    archivedList.id = "archived-session-list";
    archivedList.hidden = !state.archivedExpanded;
    for (const session of archivedRoots) archivedList.append(renderSessionButton(session, "archived"));
    elements.sidebar.append(archivedHeading, archivedList);
  }

  const pendingInput = elements.sidebar.querySelector(".pending-session-name-input");
  if (pendingInput && !pendingInput.disabled && document.activeElement !== pendingInput) {
    requestAnimationFrame(() => {
      if (!pendingInput.isConnected || state.pendingNameThreadId !== pendingInput.dataset.threadId) return;
      pendingInput.focus();
      pendingInput.setSelectionRange(pendingInput.value.length, pendingInput.value.length);
    });
  }
}

function updateSessionRows(threadId) {
  const session = state.sessions.get(threadId) || state.archivedSessions.find((entry) => entry.id === threadId);
  if (!session) return;
  const visual = threadVisualState(session, runtimeFor(threadId));
  for (const row of document.querySelectorAll(`[data-thread-id="${CSS.escape(threadId)}"]`)) {
    if (!row.matches(".session-item, .active-item, .subagent-item")) continue;
    row.classList.toggle("active", state.selectedThreadId === threadId);
    if (row.classList.contains("active-item")) row.dataset.status = visual.kind;
    const dot = row.querySelector(":scope .status-dot");
    if (dot) {
      dot.className = `status-dot ${visual.kind}`;
      dot.title = visual.label;
    }
    const title = row.querySelector(":scope .active-title, :scope .subagent-title, :scope .session-title");
    if (title) title.textContent = sessionTitle(session);
    const meta = row.querySelector(":scope .active-meta");
    if (meta) meta.textContent = visual.label;
  }
}

let projectsInvalidationRevision = 0;
function queueProjectsRefresh() {
  clearTimeout(scheduleProjectsRefresh.timer);
  scheduleProjectsRefresh.timer = setTimeout(() => {
    scheduleProjectsRefresh.timer = null;
    void loadProjects(false);
  }, 80);
}

function scheduleProjectsRefresh() {
  projectsInvalidationRevision++;
  queueProjectsRefresh();
}

let projectsLoadPromise = null;
async function loadProjects(restoreSelection = true) {
  if (projectsLoadPromise) return projectsLoadPromise;
  const invalidationRevision = projectsInvalidationRevision;
  projectsLoadPromise = performProjectsLoad(restoreSelection);
  try {
    return await projectsLoadPromise;
  } finally {
    projectsLoadPromise = null;
    if (invalidationRevision !== projectsInvalidationRevision) queueProjectsRefresh();
  }
}

async function performProjectsLoad(restoreSelection = true) {
  const sequence = ++projectLoadSequence;
  const protocolRevision = state.protocolRevision;
  try {
    const [payload, archivedPayload] = await Promise.all([
      api("/api/projects"),
      api("/api/sessions/archived"),
    ]);
    if (sequence !== projectLoadSequence) return;
    state.projects = listFrom(payload, "projects");
    state.archivedSessions = listFrom(archivedPayload, "sessions");
    state.visibleSubagentIds = new Set(
      (Array.isArray(payload.currentSubagentIds) ? payload.currentSubagentIds : []).filter((threadId) => typeof threadId === "string")
    );
    const knownSessions = new Map(state.sessions);
    const knownCapabilities = new Map([...knownSessions].map(([threadId, session]) => [threadId, session.canAcceptDirectInput]));
    const knownTokenUsage = new Map([...knownSessions].map(([threadId, session]) => [threadId, session.tokenUsage]));
    state.sessions.clear();
    for (const project of state.projects) {
      for (const session of project.sessions || []) {
        if (session.canAcceptDirectInput == null && knownCapabilities.get(session.id) != null) {
          session.canAcceptDirectInput = knownCapabilities.get(session.id);
        }
        if (session.tokenUsage == null && knownTokenUsage.get(session.id) != null) {
          session.tokenUsage = knownTokenUsage.get(session.id);
        }
        const runtime = runtimeFor(session.id);
        if (runtime.protocolRevision > protocolRevision) {
          session.status = runtime.protocolStatus;
          session.activeFlags = [
            ...(runtime.protocolFlags.has("approval") ? ["waitingOnApproval"] : []),
            ...(runtime.protocolFlags.has("input") ? ["waitingOnUserInput"] : []),
          ];
        }
        state.sessions.set(session.id, session);
        syncRuntimeFromSession(session).syncState = "synced";
      }
    }
    for (const threadId of state.freshThreadIds) {
      if (!state.sessions.has(threadId) && knownSessions.has(threadId)) upsertSessionLocally(knownSessions.get(threadId));
    }
    const selectedArchivedSession = state.archivedSessions.find((session) => session.id === state.selectedThreadId);
    if (state.selectedThreadId && state.sessions.has(state.selectedThreadId)) {
      state.selectedArchived = false;
      state.selectedSession = state.sessions.get(state.selectedThreadId);
    } else if (state.selectedThreadId && selectedArchivedSession) {
      state.selectedArchived = true;
      state.selectedSession = selectedArchivedSession;
    } else if (state.selectedThreadId) {
      clearSelection();
      toast(t("errors.sessionNoLongerAccessible"), "error");
    }
    renderSidebar();
    renderHeader();
    updateComposer();
    if (restoreSelection && !state.selectedThreadId) {
      const saved = localStorage.getItem("codex-session.selectedThread");
      if (saved && state.sessions.has(saved)) void selectThread(saved);
      else if (saved && state.archivedSessions.some((session) => session.id === saved)) void selectThread(saved, { archived: true });
    }
    if (elements.search.value.trim()) void runSearch();
  } catch (error) {
    elements.sidebar.replaceChildren(el("p", "nav-message error", error.message));
  }
}
async function selectThread(threadId, { force = false, archived = false, fresh = false } = {}) {
  if (!threadId || (!force && state.loadingThread && state.selectedThreadId === threadId)) return;
  state.editingUserMessage = null;
  const isFresh = fresh || state.freshThreadIds.has(threadId);
  const previousThreadId = state.selectedThreadId;
  if (previousThreadId && previousThreadId !== threadId) {
    state.composerDrafts.set(previousThreadId, elements.composerText.value);
    saveScrollPosition(previousThreadId, elements.timeline.scrollTop);
    state.toolExpansion.clear();
  }
  removeAnnotationBubble();
  closeAnnotationPopup();
  closeComposerModelMenu();
  state.selectionController?.abort();
  const controller = new AbortController();
  state.selectionController = controller;
  const version = ++state.selectionVersion;
  state.selectedThreadId = threadId;
  loadAnnotations();
  state.selectedArchived = archived || state.archivedSessions.some((session) => session.id === threadId);
  setSendStatus("");
  elements.composerText.value = state.composerDrafts.get(threadId) || "";
  state.selectedSession = state.sessions.get(threadId) || state.archivedSessions.find((session) => session.id === threadId) || { id: threadId };
  state.turns.clear();
  state.turnOrder = [];
  state.olderCursor = null;
  state.loadError = null;
  state.loadingOlder = false;
  const runtime = runtimeFor(threadId);
  setUnread(threadId, false);
  runtime.syncState = "hydrating";
  runtime.connectionGeneration = state.connectionGeneration;
  runtime.activeTurnId = null;
  state.loadingThread = true;
  state.queuedEvents = [];
  localStorage.setItem("codex-session.selectedThread", threadId);
  void loadGitContext(threadId);
  closeMobileNav();
  renderSidebar();
  renderHeader();
  renderTimeline(t("status.loadingSession"));
  updateComposer();

  try {
    if (isFresh) {
      const selectedRuntime = syncRuntimeFromSession(state.selectedSession);
      selectedRuntime.activeTurnId = null;
      selectedRuntime.phase = "idle";
      selectedRuntime.syncState = "synced";
    } else {
      const [detail, page] = await Promise.all([
        api(`/api/sessions/${encodeURIComponent(threadId)}`, { signal: controller.signal }),
        api(`/api/sessions/${encodeURIComponent(threadId)}/turns?direction=desc&limit=20`, { signal: controller.signal }),
      ]);
      if (version !== state.selectionVersion) return;
      const detailSession = detail.session || detail;
      const knownSession = state.sessions.get(threadId);
      state.selectedSession = {
        ...knownSession,
        ...detailSession,
        tokenUsage: detailSession.tokenUsage ?? knownSession?.tokenUsage ?? null,
      };
      if (!state.selectedArchived) state.sessions.set(threadId, state.selectedSession);
      const selectedRuntime = syncRuntimeFromSession(state.selectedSession);
      const newest = listFrom(page, "turns");
      installTurns([...newest].reverse());
      for (const turn of newest) {
        const turnStatus = String(turn.status || "").toLowerCase();
        if (TERMINAL_TURN_STATUSES.has(turnStatus)) selectedRuntime.terminalTurnIds.add(turn.id);
      }
      const activeTurn = newest.find((turn) => !TERMINAL_TURN_STATUSES.has(String(turn.status || "").toLowerCase()) && String(turn.status || "").toLowerCase() === "inprogress");
      selectedRuntime.activeTurnId = activeTurn?.id || null;
      selectedRuntime.phase = selectedRuntime.activeTurnId ? "running" : "idle";
      selectedRuntime.syncState = "synced";
      state.olderCursor = page.nextCursor || null;
      await hydrateItems(newest, version, controller.signal);
      if (version !== state.selectionVersion) return;
    }
  } catch (error) {
    if (error.name !== "AbortError" && version === state.selectionVersion) {
      state.loadError = error.message;
      runtimeFor(threadId).syncState = "error";
    }
  } finally {
    if (version === state.selectionVersion) {
      state.loadingThread = false;
      const queued = state.queuedEvents;
      state.queuedEvents = [];
      for (const event of queued) applyEvent(event.type, event.data);
      renderSidebar();
      renderHeader();
      renderTimeline();
      applyAllAnnotations();
      const savedScroll = Number(state.scrollPositions.get(threadId));
      elements.timeline.scrollTop = Number.isFinite(savedScroll) ? savedScroll : elements.timeline.scrollHeight;
      renderRequests();
      updateComposer();
    }
  }
}

async function loadOlderTurns() {
  if (!state.selectedThreadId || !state.olderCursor || state.loadingOlder) return;
  const threadId = state.selectedThreadId;
  const version = state.selectionVersion;
  const cursor = state.olderCursor;
  const signal = state.selectionController?.signal;
  state.loadingOlder = true;
  const oldHeight = elements.timeline.scrollHeight;
  try {
    const query = new URLSearchParams({ direction: "desc", limit: "20", cursor });
    const page = await api(`/api/sessions/${encodeURIComponent(threadId)}/turns?${query}`, { signal });
    if (threadId !== state.selectedThreadId || version !== state.selectionVersion) return;
    const older = listFrom(page, "turns");
    installTurns([...older].reverse(), true);
    state.olderCursor = page.nextCursor || null;
    await hydrateItems(older, version, signal);
    if (threadId !== state.selectedThreadId || version !== state.selectionVersion) return;
    renderTimeline();
    elements.timeline.scrollTop += elements.timeline.scrollHeight - oldHeight;
  } catch (error) {
    if (error.name !== "AbortError" && threadId === state.selectedThreadId && version === state.selectionVersion) toast(error.message, "error");
  } finally {
    if (threadId === state.selectedThreadId && version === state.selectionVersion) state.loadingOlder = false;
  }
}

function renderHeader() {
  const session = state.selectedSession;
  if (!session) {
    elements.title.textContent = t("navigation.selectASession");
    elements.project.textContent = "—";
    elements.project.dataset.parentThreadId = "";
    elements.project.classList.remove("parent-thread-link");
    elements.project.tabIndex = -1;
    elements.project.setAttribute("role", "presentation");
    elements.topProject.textContent = t("navigation.selectSession");
    elements.meta.textContent = t("navigation.localCodexSessions");
    elements.fork.hidden = true;
    elements.fork.dataset.threadId = "";
    elements.status.className = "conversation-state";
    elements.status.querySelector(".status-dot").className = "status-dot idle";
    elements.status.querySelector(".label").textContent = t("status.notSelected");
    elements.mark.classList.remove("working", "muted");
    elements.composerModel.textContent = "Codex";
    elements.composerEffort.textContent = "";
    closeComposerModelMenu();
    renderComposerTokenUsage(null);
    return;
  }
  const runtime = syncRuntimeFromSession(session);
  const visual = threadVisualState(session, runtime);
  const project = state.projects.find((entry) => entry.id === session.projectId);
  const parent = session.parentThreadId ? state.sessions.get(session.parentThreadId) : null;
  elements.title.textContent = sessionTitle(session);
  elements.project.textContent = parent
    ? `${sessionTitle(parent)} / ${sessionTitle(session)}`
    : project?.name || session.cwd || t("common.unknownWorkspace");
  elements.project.dataset.parentThreadId = parent?.id || "";
  elements.project.classList.toggle("parent-thread-link", Boolean(parent));
  elements.project.tabIndex = parent ? 0 : -1;
  elements.project.setAttribute("role", parent ? "button" : "presentation");
  elements.topProject.textContent = project?.name || t("common.unknownWorkspace");
  const totalTokens = session.tokenUsage?.total?.totalTokens ?? session.tokenUsage?.totalTokens;
  const inputMode = state.selectedArchived ? t("status.archivedReadOnly") : canAcceptDirectInput(session) ? null : isChildThread(session) ? t("status.subagentReadOnly") : t("status.readOnly");
  elements.meta.textContent = [session.agentRole || session.agentNickname, session.model || "Codex", inputMode, totalTokens != null ? `${Number(totalTokens).toLocaleString()} tokens` : null].filter(Boolean).join(" · ");
  elements.fork.hidden = !session.forkedFromId;
  elements.fork.dataset.threadId = session.forkedFromId || "";
  const setting = composerSetting(session.id, session);
  elements.composerModel.textContent = setting?.entry?.displayName || setting?.model || "Codex";
  elements.composerEffort.textContent = setting?.reasoningEffort ? `· ${setting.reasoningEffort}` : "";
  renderComposerTokenUsage(session.tokenUsage);
  elements.status.className = `conversation-state ${visual.kind}`;
  elements.status.querySelector(".status-dot").className = `status-dot ${visual.kind}`;
  elements.status.querySelector(".label").textContent = visual.label;
  elements.mark.classList.toggle("working", visual.kind === "busy" && isReady());
  elements.mark.classList.remove("muted");
}
function clearSelection() {
  const removed = state.selectedThreadId;
  state.selectionController?.abort();
  state.selectionController = null;
  state.selectionVersion++;
  state.loadingThread = false;
  state.loadingOlder = false;
  state.queuedEvents = [];
  state.selectedThreadId = null;
  state.selectedSession = null;
  state.selectedArchived = false;
  state.turns.clear();
  state.turnOrder = [];
  state.toolExpansion.clear();
  state.olderCursor = null;
  state.loadError = null;
  state.editingUserMessage = null;
  removeAnnotationBubble();
  closeAnnotationPopup();
  loadAnnotations();
  localStorage.removeItem("codex-session.selectedThread");
  if (removed) {
    unreadThreadIds.delete(removed);
    persistUnread();
  }
  elements.composerText.value = "";
  elements.gitRail.hidden = true;
  renderSidebar();
  renderHeader();
  renderTimeline();
  renderAnnotationList();
  renderRequests();
  updateComposer();
}

function removeThreadLocally(threadId, shouldRender = true) {
  state.sessions.delete(threadId);
  state.freshThreadIds.delete(threadId);
  if (state.pendingNameThreadId === threadId) clearPendingSessionName();
  state.selectedThreadIds.delete(threadId);
  state.archivedSessions = state.archivedSessions.filter((session) => session.id !== threadId);
  state.runtime.delete(threadId);
  state.composerImages.delete(threadId);
  state.composerDrafts.delete(threadId);
  state.composerModes.delete(threadId);
  state.composerSettings.delete(threadId);
  persistComposerSettings();
  state.uncertainTurnSources.delete(threadId);
  clearResentMessages(threadId);
  localStorage.removeItem(ANNOTATION_STORAGE_PREFIX + threadId);
  state.scrollPositions.delete(threadId);
  sessionStorage.setItem("codex-session.scrollPositions", JSON.stringify(Object.fromEntries(state.scrollPositions)));
  state.searchResults = state.searchResults.filter((session) => session.id !== threadId);
  searchSequence++;
  searchController?.abort();
  unreadThreadIds.delete(threadId);
  persistUnread();
  for (const project of state.projects) {
    project.sessions = (project.sessions || []).filter((session) => session.id !== threadId);
    project.sessionCount = project.sessions.length;
  }
  state.projects = state.projects.filter((project) => project.sessions.length);
  if (state.selectedThreadId === threadId) clearSelection();
  else if (shouldRender) renderSidebar();
}

function closeThreadLocally(threadId) {
  const session = state.sessions.get(threadId);
  if (session) {
    session.status = "notLoaded";
    session.activeFlags = [];
  }
  const runtime = runtimeFor(threadId);
  if (runtime) {
    runtime.protocolStatus = "notloaded";
    runtime.protocolFlags.clear();
    runtime.requestFlags.clear();
    runtime.activeTurnId = null;
    runtime.phase = "idle";
    runtime.pendingClose = false;
    runtime.syncState = "synced";
  }
  if (state.selectedThreadId === threadId) clearSelection();
  else renderSidebar();
}

async function renameSession(threadId) {
  const session = state.sessions.get(threadId);
  const name = window.prompt(t("navigation.sessionName"), sessionTitle(session));
  if (name == null || !name.trim() || name.trim() === sessionTitle(session)) return;
  try {
    await api(`/api/sessions/${encodeURIComponent(threadId)}`, { method: "PATCH", body: { name: name.trim() } });
    if (session) session.name = name.trim();
    if (state.selectedThreadId === threadId) state.selectedSession = session;
    renderSidebar(); renderHeader();
    if (elements.search.value.trim()) void runSearch();
  } catch (error) { toast(t("errors.renameFailed", { message: error.message }), "error"); }
}

async function archiveSession(threadId) {
  const session = state.sessions.get(threadId);
  let preview;
  try {
    preview = await lifecyclePreview(threadId);
  } catch (error) {
    toast(t("errors.archiveImpactFailed", { message: error.message }), "error");
    return;
  }
  const activeDescendants = preview.descendants.filter(relationThreadActive);
  if (activeDescendants.length) {
    toast(t("errors.activeDescendantsWait", { count: activeDescendants.length }), "error");
    return;
  }
  if (!window.confirm(lifecycleSummary(session, preview, t("actions.archiveWithSpace")))) return;
  try {
    await api(`/api/sessions/${encodeURIComponent(threadId)}/archive`, { method: "POST", body: {} });
    await loadProjects(false);
    const expected = [threadId, ...preview.descendants.map((thread) => thread.id)];
    const remaining = expected.filter((id) => state.sessions.has(id));
    if (remaining.length) toast(t("navigation.threadsNotArchived", { count: remaining.length }), "error");
  } catch (error) { toast(t("errors.archiveFailed", { message: error.message }), "error"); }
}

async function unarchiveSession(threadId) {
  try {
    await api(`/api/sessions/${encodeURIComponent(threadId)}/unarchive`, { method: "POST", body: {} });
    state.archivedSessions = state.archivedSessions.filter((session) => session.id !== threadId);
    await loadProjects(false);
  } catch (error) { toast(t("errors.unarchiveFailed", { message: error.message }), "error"); }
}

async function closeOrUnloadSession(threadId) {
  let runtime = runtimeFor(threadId);
  const session = state.sessions.get(threadId);
  if (isThreadActive(session, runtime) && !isTurnActive(runtime)) {
    await selectThread(threadId, { force: true });
    runtime = runtimeFor(threadId);
    if (isThreadActive(state.sessions.get(threadId), runtime) && !isTurnActive(runtime)) {
      toast(t("errors.activeTurnNotFound"), "error");
      return;
    }
  }
  if (isTurnActive(runtime)) {
    if (!window.confirm(t("navigation.confirmInterruptAndUnload"))) return;
    runtime.pendingClose = true;
    try {
      await api(`/api/sessions/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(runtime.activeTurnId)}/interrupt`, { method: "POST", body: {} });
      runtime.phase = "interrupting";
      renderSidebar(); renderHeader(); updateComposer();
    } catch (error) {
      runtime.pendingClose = false;
      toast(t("errors.interruptUnloadFailed", { message: error.message }), "error");
    }
    return;
  }
  try {
    await api(`/api/sessions/${encodeURIComponent(threadId)}/unsubscribe`, { method: "POST", body: {} });
    closeThreadLocally(threadId);
    void loadProjects(false);
  } catch (error) { toast(t("errors.unloadFailed", { message: error.message }), "error"); }
}
let projectLoadSequence = 0;
let searchTimer = null;
let searchController = null;
let searchSequence = 0;
async function runSearch() {
  const query = elements.search.value.trim();
  const sequence = ++searchSequence;
  searchController?.abort();
  searchController = null;
  elements.searchClear.hidden = !query;
  if (!query) {
    state.searchResults = [];
    state.searchIndex = -1;
    elements.searchResults.hidden = true;
    elements.sidebar.hidden = false;
    return;
  }
  searchController = new AbortController();
  elements.searchResults.replaceChildren(el("div", "search-summary", t("status.searching")));
  elements.searchResults.hidden = false;
  elements.sidebar.hidden = true;
  try {
    const payload = await api(`/api/sessions/search?q=${encodeURIComponent(query)}`, { signal: searchController.signal });
    if (sequence !== searchSequence || elements.search.value.trim() !== query) return;
    const results = listFrom(payload, "sessions").filter((session) => !isChildThread(session)).slice(0, 80);
    state.searchResults = results;
    state.searchIndex = results.length ? 0 : -1;
    elements.searchResults.replaceChildren(el("div", "search-summary", t("navigation.searchResults", { count: results.length })));
    results.forEach((session, index) => {
      const button = renderSessionButton(session, "search");
      button.dataset.searchIndex = String(index);
      button.classList.toggle("selected", index === state.searchIndex);
      elements.searchResults.append(button);
    });
  } catch (error) {
    if (error.name === "AbortError" || sequence !== searchSequence) return;
    elements.searchResults.replaceChildren(el("p", "nav-message error", t("errors.searchFailed", { message: error.message })));
  }
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void runSearch(), 120);
}

  Object.assign(actions, {
    saveExpanded,
    actionIcon,
    renderPendingSessionName,
    renderSessionButton,
    upsertSessionLocally,
    clearPendingSessionName,
    commitPendingSessionName,
    cancelPendingSessionName,
    createSessionFromFolder,
    showNewSessionForm,
    clearBulkSelection,
    beginBulkSelection,
    toggleBulkSession,
    lifecyclePreview,
    relationThreadActive,
    lifecycleSummary,
    deleteSelectedSessions,
    renderProjectSelectionBar,
    renderSidebar,
    updateSessionRows,
    queueProjectsRefresh,
    scheduleProjectsRefresh,
    loadProjects,
    performProjectsLoad,
    selectThread,
    loadOlderTurns,
    renderHeader,
    clearSelection,
    removeThreadLocally,
    closeThreadLocally,
    renameSession,
    archiveSession,
    unarchiveSession,
    closeOrUnloadSession,
    runSearch,
    scheduleSearch
  });
}
