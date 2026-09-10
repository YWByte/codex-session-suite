export function installGitTools(context) {
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
  const api = (...args) => actions.api(...args);
  const toast = (...args) => actions.toast(...args);
  const collectApi = (...args) => actions.collectApi(...args);
  const findAnnotationBlock = (...args) => actions.findAnnotationBlock(...args);
  const annotationTextNodeAt = (...args) => actions.annotationTextNodeAt(...args);
  const loadMoreItems = (...args) => actions.loadMoreItems(...args);
  const selectThread = (...args) => actions.selectThread(...args);
  const loadOlderTurns = (...args) => actions.loadOlderTurns(...args);

let gitContextSequence = 0;
function gitBaseSourceLabel(source) {
  if (source === "configured") return t("git.sourceConfigured");
  if (source === "reflog") return t("git.sourceReflog");
  if (source === "inferred") return t("git.sourceInferred");
  return t("git.sourceUndetermined");
}

function setGitBadge(id, count) {
  const badge = document.querySelector(`#${id}`);
  badge.textContent = String(count || 0);
  badge.hidden = !count;
}

function renderUnavailableGitContext(reason) {
  const message = reason || t("errors.gitContextUnavailable");
  elements.gitRail.classList.add("unavailable");
  elements.gitRail.hidden = false;
  elements.gitBranch.setAttribute("aria-disabled", "true");
  elements.gitGraph.disabled = true;
  elements.gitStaged.disabled = true;
  elements.gitCommitted.disabled = true;
  document.querySelector("#git-current-branch").textContent = t("common.unavailable");
  document.querySelector("#git-base-branch").textContent = "—";
  document.querySelector("#git-base-source").textContent = "—";
  document.querySelector("#git-base-note").textContent = message;
  document.querySelector("#git-graph-summary").textContent = message;
  document.querySelector("#git-staged-summary").textContent = message;
  document.querySelector("#git-committed-summary").textContent = message;
  setGitBadge("git-staged-count", 0);
  setGitBadge("git-committed-count", 0);
}

function renderGitContext(context) {
  if (!context?.available) {
    renderUnavailableGitContext(context?.reason);
    return;
  }
  elements.gitRail.classList.remove("unavailable");
  elements.gitBranch.setAttribute("aria-disabled", "false");
  elements.gitGraph.disabled = false;
  document.querySelector("#git-graph-summary").textContent = t("git.openDifgraphNewTab");
  document.querySelector("#git-current-branch").textContent = context.branch || t("common.unknown");
  document.querySelector("#git-base-branch").textContent = context.base || t("git.sourceUndetermined");
  document.querySelector("#git-base-source").textContent = gitBaseSourceLabel(context.baseSource);
  document.querySelector("#git-base-note").textContent = context.detached
    ? t("git.detachedHead")
    : context.baseSource === "inferred"
      ? t("git.inferredBaseline")
      : context.base
        ? t("git.baselinePriority")
        : t("git.noVerifiedBaseline");
  setGitBadge("git-staged-count", context.stagedFiles);
  setGitBadge("git-committed-count", context.committedCommits);
  elements.gitStaged.disabled = context.stagedFiles === 0;
  elements.gitCommitted.disabled = !context.base || context.committedCommits === 0;
  document.querySelector("#git-staged-summary").textContent = context.stagedFiles
    ? t("git.stagedSummary", { files: context.stagedFiles })
    : t("git.noStagedChanges");
  document.querySelector("#git-committed-summary").textContent = !context.base
    ? t("git.noBaseline")
    : context.committedCommits
      ? t("git.committedSummary", { commits: context.committedCommits, base: context.base, files: context.committedFiles })
      : t("git.noNewCommits", { base: context.base });
  elements.gitRail.hidden = false;
}

async function loadGitContext(threadId = state.selectedThreadId) {
  const sequence = ++gitContextSequence;
  if (!threadId) {
    elements.gitRail.hidden = true;
    return;
  }
  if (threadId === state.selectedThreadId && state.selectedArchived) {
    elements.gitRail.hidden = false;
    elements.gitRail.classList.add("collect-only");
    return;
  }
  elements.gitRail.classList.remove("collect-only");
  renderUnavailableGitContext(t("status.loadingGit"));
  try {
    const context = await api(`/api/sessions/${encodeURIComponent(threadId)}/git-context`);
    if (sequence !== gitContextSequence || threadId !== state.selectedThreadId) return;
    renderGitContext(context);
  } catch {
    if (sequence === gitContextSequence && threadId === state.selectedThreadId) {
      renderUnavailableGitContext(t("errors.gitLoadFailed"));
    }
  }
}

function openCollectViewer() {
  window.open(COLLECT_VIEWER_ORIGIN, "_blank", "noopener");
}

function collectionRange(segment) {
  const block = findAnnotationBlock(segment?.blockPath);
  if (!block || segment.start < 0 || segment.end > block.textContent.length || segment.start >= segment.end) return null;
  const start = annotationTextNodeAt(block, segment.start);
  const end = annotationTextNodeAt(block, segment.end, true);
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

function highlightCollectionSource(source) {
  const message = source?.itemId
    ? elements.timeline.querySelector(`[data-item-id="${CSS.escape(source.itemId)}"]`)
    : null;
  if (!message) return false;
  message.scrollIntoView({ block: "center" });
  const ranges = (source.segments || []).map(collectionRange).filter(Boolean);
  if (ranges.length && window.CSS?.highlights && window.Highlight) {
    CSS.highlights.set("collection-source", new Highlight(...ranges));
    setTimeout(() => CSS.highlights.delete("collection-source"), 15_000);
  } else {
    message.classList.add("collection-source-message");
    setTimeout(() => message.classList.remove("collection-source-message"), 15_000);
  }
  return true;
}

async function openCollectionSourceFromQuery() {
  const collectionId = new URLSearchParams(window.location.search).get("collection");
  if (!collectionId) return;
  try {
    const payload = await collectApi(`/api/collections/${encodeURIComponent(collectionId)}`);
    const collection = payload.collection || payload;
    const source = collection.source;
    if (!source?.threadId) throw new Error(t("errors.collectionSourceMissing"));
    const archived = state.archivedSessions.some((session) => session.id === source.threadId);
    await selectThread(source.threadId, { archived });
    while (source.itemId && !elements.timeline.querySelector(`[data-item-id="${CSS.escape(source.itemId)}"]`) && state.olderCursor) {
      const cursor = state.olderCursor;
      await loadOlderTurns();
      if (state.olderCursor === cursor) break;
    }
    const sourceTurn = source.turnId ? state.turns.get(source.turnId) : null;
    while (source.itemId && !elements.timeline.querySelector(`[data-item-id="${CSS.escape(source.itemId)}"]`) && sourceTurn?.itemsNextCursor) {
      const cursor = sourceTurn.itemsNextCursor;
      await loadMoreItems(source.turnId);
      if (sourceTurn.itemsNextCursor === cursor) break;
    }
    if (source.itemId && !elements.timeline.querySelector(`[data-item-id="${CSS.escape(source.itemId)}"]`) && sourceTurn?.itemsLoadError) {
      await loadMoreItems(source.turnId);
    }
    if (!highlightCollectionSource(source)) toast(t("errors.collectionSourcePositionMissing"), "error");
    history.replaceState(null, "", window.location.pathname);
  } catch (error) {
    toast(t("errors.collectionSourceOpenFailed", { message: error.message }), "error");
  }
}

async function openDifgraph() {
  if (!state.selectedThreadId || elements.gitGraph.disabled) return;
  const target = window.open("about:blank", "_blank");
  if (!target) {
    toast(t("errors.popupBlocked"), "error");
    return;
  }
  target.document.title = t("status.startingDifgraph");
  target.document.body.textContent = t("status.startingDifgraph");
  elements.gitGraph.disabled = true;
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(state.selectedThreadId)}/difgraph`, { method: "POST", body: {} });
    target.location.replace(result.url);
  } catch (error) {
    target.close();
    toast(t("errors.difgraphStartFailed", { message: error.message }), "error");
  } finally {
    await loadGitContext();
  }
}

async function openDifit(mode, button) {
  if (!state.selectedThreadId || button.disabled) return;
  const target = window.open("about:blank", "_blank");
  if (!target) {
    toast(t("errors.popupBlocked"), "error");
    return;
  }
  target.document.title = t("status.startingDifit");
  target.document.body.textContent = t("status.startingDifit");
  button.disabled = true;
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(state.selectedThreadId)}/difit`, { method: "POST", body: { mode } });
    target.location.replace(result.url);
  } catch (error) {
    target.close();
    toast(t("errors.difitStartFailed", { message: error.message }), "error");
  } finally {
    await loadGitContext();
  }
}

  Object.assign(actions, {
    gitBaseSourceLabel,
    setGitBadge,
    renderUnavailableGitContext,
    renderGitContext,
    loadGitContext,
    openCollectViewer,
    collectionRange,
    highlightCollectionSource,
    openCollectionSourceFromQuery,
    openDifgraph,
    openDifit
  });
}
