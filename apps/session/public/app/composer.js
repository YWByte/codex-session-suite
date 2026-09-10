export function installComposer(context) {
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
  const annotationsPrefix = (...args) => actions.annotationsPrefix(...args);
  const runtimeFor = (...args) => actions.runtimeFor(...args);
  const markHistoricalMessageResent = (...args) => actions.markHistoricalMessageResent(...args);
  const isReady = (...args) => actions.isReady(...args);
  const isTurnActive = (...args) => actions.isTurnActive(...args);
  const isThreadActive = (...args) => actions.isThreadActive(...args);
  const hasRestartBlocker = (...args) => actions.hasRestartBlocker(...args);
  const threadVisualState = (...args) => actions.threadVisualState(...args);
  const el = (...args) => actions.el(...args);
  const listFrom = (...args) => actions.listFrom(...args);
  const api = (...args) => actions.api(...args);
  const toast = (...args) => actions.toast(...args);
  const applyAllAnnotations = (...args) => actions.applyAllAnnotations(...args);
  const renderSidebar = (...args) => actions.renderSidebar(...args);
  const loadProjects = (...args) => actions.loadProjects(...args);
  const ensureTurn = (...args) => actions.ensureTurn(...args);
  const renderHeader = (...args) => actions.renderHeader(...args);
  const renderTimeline = (...args) => actions.renderTimeline(...args);
  const renderRequests = (...args) => actions.renderRequests(...args);

function sessionTitle(session) {
  return session?.name || session?.preview || session?.agentNickname || t("common.unnamedSession");
}

function canAcceptDirectInput(session = state.selectedSession) {
  return session?.canAcceptDirectInput === true;
}

function isChildThread(session) {
  return Boolean(session?.parentThreadId);
}

function canEditHistoricalMessages() {
  const runtime = runtimeFor(state.selectedThreadId);
  return Boolean(
    isReady()
    && state.selectedThreadId
    && !state.selectedArchived
    && !state.loadingThread
    && !isChildThread(state.selectedSession)
    && canAcceptDirectInput()
    && !isThreadActive(state.selectedSession, runtime)
    && runtime?.protocolFlags.size === 0
    && runtime?.requestFlags.size === 0
  );
}

function canStartEditingUserMessage(item, turnId) {
  return canEditHistoricalMessages()
    && !state.editingUserMessage
    && Boolean(item?.id && turnId)
    && !item.optimistic
    && !item.failed
    && !item.uncertain;
}

function composerImages(threadId = state.selectedThreadId) {
  return threadId ? state.composerImages.get(threadId) || [] : [];
}

function composerMode(threadId = state.selectedThreadId) {
  return threadId ? state.composerModes.get(threadId) || "default" : "default";
}

function renderComposerMode() {
  const mode = composerMode();
  const isPlan = mode === "plan";
  elements.composerModeLabel.textContent = t(isPlan ? "common.plan" : "common.default");
  elements.composerModeToggle.classList.toggle("plan", isPlan);
  elements.composerModeToggle.setAttribute("aria-pressed", String(isPlan));
  elements.composerModeToggle.title = t(isPlan ? "actions.switchToDefaultMode" : "actions.switchToPlanMode");
}

function modelEntry(model) {
  return state.models.find((entry) => entry.model === model) || null;
}

function supportedEfforts(model) {
  return new Set((model?.supportedReasoningEfforts || []).map((option) => option.reasoningEffort));
}

function composerSetting(threadId = state.selectedThreadId, session = state.selectedSession) {
  if (!threadId || !session) return null;
  const saved = state.composerSettings.get(threadId);
  const fallbackModel = modelEntry(session.model)
    || state.models.find((entry) => entry.isDefault)
    || state.models[0]
    || null;
  const selectedModel = modelEntry(saved?.model) || fallbackModel;
  const efforts = supportedEfforts(selectedModel);
  const requestedEffort = saved?.reasoningEffort || session.reasoningEffort;
  const reasoningEffort = efforts.has(requestedEffort)
    ? requestedEffort
    : efforts.has(selectedModel?.defaultReasoningEffort)
      ? selectedModel.defaultReasoningEffort
      : selectedModel?.supportedReasoningEfforts?.[0]?.reasoningEffort || requestedEffort || null;
  return {
    model: selectedModel?.model || saved?.model || session.model || null,
    reasoningEffort,
    entry: selectedModel,
  };
}

function persistComposerSettings() {
  localStorage.setItem("codex-session.composerSettings", JSON.stringify(Object.fromEntries(state.composerSettings)));
}

function setComposerSetting(threadId, model, reasoningEffort) {
  if (!threadId || !model || !reasoningEffort) return;
  state.composerSettings.set(threadId, { model, reasoningEffort });
  persistComposerSettings();
  renderHeader();
  renderComposerModelMenu();
}

function closeComposerModelMenu({ focus = false } = {}) {
  state.modelMenuOpen = false;
  elements.composerModelMenu.hidden = true;
  elements.composerModelMenu.classList.remove("show");
  elements.composerModelToggle.setAttribute("aria-expanded", "false");
  if (focus && !elements.composerModelToggle.disabled) elements.composerModelToggle.focus();
}

function renderComposerModelMenu() {
  const selection = composerSetting();
  elements.composerModelOptions.replaceChildren();
  elements.composerEffortOptions.replaceChildren();
  elements.composerModelHint.hidden = true;
  elements.composerModelHint.textContent = "";

  if (state.modelsLoading) {
    elements.composerModelHint.textContent = t("status.loadingModels");
    elements.composerModelHint.hidden = false;
  } else if (state.modelsError) {
    elements.composerModelHint.textContent = t("errors.modelsLoadFailed", { message: state.modelsError });
    elements.composerModelHint.hidden = false;
  } else if (!state.models.length) {
    elements.composerModelHint.textContent = t("status.noModels");
    elements.composerModelHint.hidden = false;
  }

  for (const model of state.models) {
    const button = el("button", `model-menu-item${selection?.model === model.model ? " current" : ""}`);
    button.type = "button";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(selection?.model === model.model));
    button.title = model.description || model.displayName;
    button.append(el("span", "check", selection?.model === model.model ? "✓" : ""));
    button.append(el("span", "model-option-name", model.displayName || model.model));
    button.addEventListener("click", () => {
      const efforts = supportedEfforts(model);
      const effort = efforts.has(selection?.reasoningEffort)
        ? selection.reasoningEffort
        : efforts.has(model.defaultReasoningEffort)
          ? model.defaultReasoningEffort
          : model.supportedReasoningEfforts?.[0]?.reasoningEffort;
      if (effort) setComposerSetting(state.selectedThreadId, model.model, effort);
    });
    elements.composerModelOptions.append(button);
  }

  const efforts = supportedEfforts(selection?.entry);
  for (const option of REASONING_EFFORTS) {
    const button = el("button", `model-menu-item effort${selection?.reasoningEffort === option.value ? " current" : ""}`);
    button.type = "button";
    button.disabled = !efforts.has(option.value);
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(selection?.reasoningEffort === option.value));
    button.append(el("span", "check", selection?.reasoningEffort === option.value ? "✓" : ""));
    button.append(document.createTextNode(option.label));
    button.addEventListener("click", () => {
      if (selection?.model) setComposerSetting(state.selectedThreadId, selection.model, option.value);
    });
    elements.composerEffortOptions.append(button);
  }
}

async function loadModels({ force = false } = {}) {
  if (state.modelsLoading || (state.modelsLoaded && !force)) return;
  state.modelsLoading = true;
  state.modelsError = null;
  renderComposerModelMenu();
  try {
    const payload = await api("/api/models");
    state.models = listFrom(payload, "models");
    state.modelsLoaded = true;
  } catch (error) {
    state.modelsError = error.message;
  } finally {
    state.modelsLoading = false;
    renderHeader();
    renderComposerModelMenu();
    updateComposer();
  }
}

async function openComposerModelMenu() {
  if (elements.composerModelToggle.disabled) return;
  state.modelMenuOpen = true;
  elements.composerModelMenu.hidden = false;
  elements.composerModelMenu.classList.add("show");
  elements.composerModelToggle.setAttribute("aria-expanded", "true");
  renderComposerModelMenu();
  if (!state.modelsLoaded || state.modelsError) await loadModels({ force: Boolean(state.modelsError) });
}

function saveScrollPosition(threadId, value) {
  if (!threadId) return;
  state.scrollPositions.set(threadId, Math.max(0, Number(value) || 0));
  sessionStorage.setItem("codex-session.scrollPositions", JSON.stringify(Object.fromEntries(state.scrollPositions)));
}

function threadPath(session) {
  const labels = [sessionTitle(session)];
  let current = session;
  const seen = new Set([session.id]);
  while (current?.parentThreadId && !seen.has(current.parentThreadId)) {
    seen.add(current.parentThreadId);
    current = state.sessions.get(current.parentThreadId);
    if (!current) break;
    labels.unshift(sessionTitle(current));
  }
  return labels.join(" / ");
}

function formatTime(value) {
  if (!value) return "";
  const number = Number(value);
  const date = Number.isFinite(number)
    ? new Date(number < 10_000_000_000 ? number * 1_000 : number)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function tokenCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? count : null;
}

function formatInputTokens(value) {
  return `${Math.floor(value / 1_000)}k`;
}

function formatOutputTokens(value) {
  return value >= 1_000 ? `${Math.floor(value / 1_000)}k` : String(Math.floor(value));
}

function renderComposerTokenUsage(tokenUsage) {
  const input = tokenCount(tokenUsage?.last?.inputTokens);
  const output = tokenCount(tokenUsage?.last?.outputTokens);
  const hasInput = input != null;
  const hasOutput = output != null;
  elements.composerTokenIn.textContent = hasInput ? `IN ${formatInputTokens(input)}` : "";
  elements.composerTokenOut.textContent = hasOutput ? `OUT ${formatOutputTokens(output)}` : "";
  elements.composerTokenIn.classList.toggle("has-data", hasInput);
  elements.composerTokenOut.classList.toggle("has-data", hasOutput);
  elements.composerTokenGroup.hidden = !hasInput && !hasOutput;
}
function renderComposerImages() {
  const images = composerImages();
  const signature = images.map((image) => image.id).join("|");
  if (elements.composerImageTray.dataset.signature === signature) return;
  elements.composerImageTray.dataset.signature = signature;
  elements.composerImageTray.replaceChildren();
  for (const image of images) {
    const item = el("div", "img-paste-item");
    const preview = document.createElement("img");
    preview.src = image.dataUrl;
    preview.alt = image.name || t("composer.pendingImage");
    const remove = el("button", "img-paste-remove", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", t("actions.removeImage", { name: image.name || "" }));
    remove.addEventListener("click", () => {
      state.composerImages.set(state.selectedThreadId, composerImages().filter((entry) => entry.id !== image.id));
      renderComposerImages();
      updateComposer();
    });
    const meta = el("span", "img-paste-meta", `${image.type.replace("image/", "").toUpperCase()} · ${(image.size / 1024 / 1024).toFixed(1)} MiB`);
    item.append(preview, meta, remove);
    elements.composerImageTray.append(item);
  }
  elements.composerImageTray.classList.toggle("has-items", images.length > 0);
  elements.composerImageTray.setAttribute("aria-hidden", String(images.length === 0));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(t("errors.imageReadFailed")));
    reader.readAsDataURL(file);
  });
}

async function addComposerImages(files) {
  const threadId = state.selectedThreadId;
  const selectionVersion = state.selectionVersion;
  if (!threadId || !canAcceptDirectInput()) return;
  const candidates = [...files].filter((file) => file instanceof File);
  const accepted = [];
  for (const file of candidates) {
    if (!IMAGE_TYPES.has(file.type)) {
      toast(t("errors.unsupportedImageFormat", { name: file.name || t("common.image") }), "error");
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast(t("errors.imageTooLarge", { name: file.name || t("common.image") }), "error");
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      accepted.push({ id: crypto.randomUUID(), name: file.name, type: file.type, size: file.size, dataUrl, detail: "high" });
    } catch (error) {
      toast(error.message, "error");
    }
  }
  if (accepted.length) {
    const current = composerImages(threadId);
    let total = current.reduce((sum, image) => sum + image.size, 0);
    const additions = [];
    for (const image of accepted) {
      if (current.length + additions.length >= MAX_IMAGE_COUNT || total + image.size > MAX_TOTAL_IMAGE_BYTES) {
        toast(t("errors.imageLimits", { name: image.name || t("common.image") }), "error");
        continue;
      }
      additions.push(image);
      total += image.size;
    }
    if (additions.length) state.composerImages.set(threadId, [...current, ...additions]);
  }
  if (threadId === state.selectedThreadId && selectionVersion === state.selectionVersion) {
    renderComposerImages();
    updateComposer();
  }
}

function updateComposer() {
  const ready = isReady();
  const selected = Boolean(state.selectedThreadId);
  const runtime = runtimeFor(state.selectedThreadId);
  const active = isThreadActive(state.selectedSession, runtime);
  const writable = selected && !state.selectedArchived && canAcceptDirectInput();
  const visual = threadVisualState(state.selectedSession, runtime);
  const canActivate = selected && !state.selectedArchived && !isChildThread(state.selectedSession) && state.selectedSession?.canAcceptDirectInput == null;
  elements.composer.parentElement.hidden = !selected;
  elements.composer.hidden = !selected || !writable;
  elements.readonlyState.hidden = !selected || writable;
  elements.readonlyMessage.textContent = state.selectedArchived
    ? t("composer.archivedReadOnly")
    : isChildThread(state.selectedSession)
      ? t("composer.childThreadReadOnly")
      : canActivate ? t("composer.notLoaded") : t("composer.directInputUnavailable");
  elements.activateThread.hidden = !canActivate;
  elements.activateThread.disabled = !ready;
  elements.composerText.disabled = !ready || !writable || active || state.restartPending;
  elements.send.disabled = !ready || !writable || active || state.restartPending || (!elements.composerText.value.trim() && composerImages().length === 0 && annotationState.items.length === 0);
  elements.composerRestart.disabled = !ready || !writable || hasRestartBlocker();
  elements.composerRestart.classList.toggle("pending", state.restartPending);
  elements.composerCompact.disabled = !ready || !writable || active || state.restartPending;
  elements.composerModeToggle.disabled = !ready || !writable || active || state.restartPending;
  elements.composerModelToggle.disabled = !ready || !writable || active || state.restartPending;
  if (elements.composerModelToggle.disabled) closeComposerModelMenu();
  elements.interrupt.hidden = !isTurnActive(runtime) || !writable;
  elements.workingIndicator.hidden = !selected || !ready || visual.kind !== "busy";
  if (!ready) elements.composerStatus.textContent = t("status.appServerUnavailable");
  else if (!writable) elements.composerStatus.textContent = isChildThread(state.selectedSession) ? t("composer.childThreadReadOnlyShort") : t("composer.directInputUnavailable");
  else if (visual.kind === "busy") elements.composerStatus.textContent = visual.label;
  else elements.composerStatus.textContent = "";
  const showMessageEdits = canEditHistoricalMessages() && !state.editingUserMessage;
  for (const button of elements.timeline.querySelectorAll(".message-edit")) button.hidden = !showMessageEdits;
  renderComposerMode();
  renderComposerImages();
}

function setSendStatus(message = "") {
  elements.composerSendStatus.textContent = message;
  elements.sendStatus.classList.toggle("show", Boolean(message));
}

async function sendOutgoingMessage({ text, images, source, sourceItemId = null }) {
  const threadId = state.selectedThreadId;
  if ((!text && !images.length && !annotationState.items.length) || !threadId || !canAcceptDirectInput()) return;
  const collaborationMode = composerMode(threadId);
  const modelSetting = composerSetting(threadId, state.selectedSession);
  const selectionVersion = state.selectionVersion;
  const clientUserMessageId = crypto.randomUUID();
  const optimisticTurnId = `optimistic-turn:${clientUserMessageId}`;
  const optimisticItemId = `optimistic:${clientUserMessageId}`;
  const prefix = annotationsPrefix();
  const outgoingText = prefix ? (text ? `${prefix}${text}` : prefix.trimEnd()) : text;
  const optimisticImages = images.map(({ dataUrl, detail }) => ({ kind: "inline", src: dataUrl, detail }));
  const optimisticTurn = ensureTurn(optimisticTurnId, { status: "sending" });
  optimisticTurn.items.set(optimisticItemId, {
    id: optimisticItemId,
    threadId,
    type: "userMessage",
    text: outgoingText,
    images: optimisticImages,
    clientId: clientUserMessageId,
    optimistic: true,
  });
  optimisticTurn.itemOrder.push(optimisticItemId);
  renderTimeline();
  elements.timeline.scrollTop = elements.timeline.scrollHeight;
  elements.composerText.disabled = true;
  elements.send.disabled = true;
  elements.composerModeToggle.disabled = true;
  elements.composerModelToggle.disabled = true;
  closeComposerModelMenu();
  setSendStatus(t("status.sendingToCodex"));
  try {
    const payload = await api(`/api/sessions/${encodeURIComponent(threadId)}/turns`, {
      method: "POST",
      body: {
        text: outgoingText,
        images,
        clientUserMessageId,
        collaborationMode,
        historicalResend: source === "history",
        ...(modelSetting?.model && modelSetting?.reasoningEffort
          ? { model: modelSetting.model, reasoningEffort: modelSetting.reasoningEffort }
          : {}),
      },
    });
    const turnId = payload.turn?.id;
    const runtime = runtimeFor(threadId);
    const stillSelected = threadId === state.selectedThreadId && selectionVersion === state.selectionVersion;
    if (stillSelected) {
      state.turns.delete(optimisticTurnId);
      state.turnOrder = state.turnOrder.filter((id) => id !== optimisticTurnId);
    }
    if (turnId) {
      if (source === "composer") {
        state.composerDrafts.delete(threadId);
        state.composerImages.delete(threadId);
      } else if (state.editingUserMessage?.threadId === threadId && state.editingUserMessage?.itemId === sourceItemId) {
        markHistoricalMessageResent(threadId, sourceItemId);
        state.editingUserMessage = null;
      }
      state.uncertainTurnSources.delete(threadId);
      localStorage.removeItem(ANNOTATION_STORAGE_PREFIX + threadId);
      annotationState.items = [];
      annotationState.sequence = 0;
    }
    if (turnId && !runtime.terminalTurnIds.has(turnId)) {
      runtime.activeTurnId = turnId;
      runtime.phase = "running";
      runtime.terminalStatus = null;
      const session = state.sessions.get(threadId);
      if (session) session.status = "active";
    }
    if (turnId && stillSelected) {
      const turn = ensureTurn(turnId, payload.turn);
      const hasAuthoritativeUserItem = [...turn.items.values()].some((item) => item.clientId === clientUserMessageId);
      if (!hasAuthoritativeUserItem) {
        const optimistic = {
          id: optimisticItemId,
          threadId,
          type: "userMessage",
          text: outgoingText,
          images: optimisticImages,
          clientId: clientUserMessageId,
          optimistic: true,
        };
        turn.items.set(optimistic.id, optimistic);
        if (!turn.itemOrder.includes(optimistic.id)) turn.itemOrder.push(optimistic.id);
      }
      if (source === "composer") elements.composerText.value = "";
      renderComposerImages();
      renderHeader();
      renderTimeline();
      applyAllAnnotations();
      elements.timeline.scrollTop = elements.timeline.scrollHeight;
    }
    renderSidebar();
  } catch (error) {
    if (threadId === state.selectedThreadId && selectionVersion === state.selectionVersion) {
      const turn = state.turns.get(optimisticTurnId);
      const item = turn?.items.get(optimisticItemId);
      if (turn && item) {
        const uncertain = ["write_outcome_unknown", "app_server_timeout", "app_server_offline"].includes(error.code);
        if (uncertain) state.uncertainTurnSources.set(threadId, { source, itemId: sourceItemId });
        turn.status = uncertain ? "unknown" : "failed";
        turn.items.set(optimisticItemId, { ...item, optimistic: false, failed: !uncertain, uncertain });
      }
      if (source === "history" && state.editingUserMessage?.itemId === sourceItemId) state.editingUserMessage.sending = false;
      renderTimeline();
      applyAllAnnotations();
    }
    toast(error.message, "error");
  } finally {
    if (threadId === state.selectedThreadId && selectionVersion === state.selectionVersion) setSendStatus("");
    updateComposer();
  }
}

async function restartAppServer() {
  const threadId = state.selectedThreadId;
  if (!threadId || elements.composerRestart.disabled) return;
  if (composerImages().length) {
    toast(t("errors.removeImagesBeforeRestart"), "error");
    return;
  }
  const restoreLoadedSession = canAcceptDirectInput();
  state.restartPending = true;
  setSendStatus(t("status.restartingAppServer"));
  updateComposer();
  try {
    await api("/api/app-server/restart", { method: "POST", body: {} });
    sessionStorage.setItem(RESTART_STATE_KEY, JSON.stringify({
      threadId,
      draft: elements.composerText.value,
      resume: restoreLoadedSession,
    }));
    window.location.reload();
  } catch (error) {
    state.restartPending = false;
    setSendStatus("");
    updateComposer();
    toast(t("errors.restartFailed", { message: error.message }), "error");
  }
}

async function startCompaction({ fromSlashCommand = false } = {}) {
  const threadId = state.selectedThreadId;
  const runtime = runtimeFor(threadId);
  if (!threadId || !canAcceptDirectInput() || isThreadActive(state.selectedSession, runtime)) return;
  if (fromSlashCommand && (composerImages().length || annotationState.items.length)) {
    toast(t("errors.removeImagesAndAnnotationsBeforeCompact"), "error");
    return;
  }
  runtime.compactPending = true;
  runtime.phase = "compacting";
  setSendStatus(t("status.compactingContext"));
  updateComposer();
  try {
    await api(`/api/sessions/${encodeURIComponent(threadId)}/compact`, { method: "POST", body: {} });
    if (fromSlashCommand && threadId === state.selectedThreadId) {
      elements.composerText.value = "";
      state.composerDrafts.delete(threadId);
    }
  } catch (error) {
    runtime.compactPending = false;
    runtime.phase = "idle";
    toast(t("errors.compactFailed", { message: error.message }), "error");
  } finally {
    if (threadId === state.selectedThreadId) {
      setSendStatus("");
      renderHeader();
      updateComposer();
    }
  }
}

async function sendMessage() {
  const text = elements.composerText.value.trim();
  const images = composerImages().map(({ dataUrl, detail }) => ({ dataUrl, detail }));
  if (text === "/compact") {
    await startCompaction({ fromSlashCommand: true });
    return;
  }
  await sendOutgoingMessage({ text, images, source: "composer" });
}

async function sendEditedUserMessage() {
  const edit = state.editingUserMessage;
  if (!edit || edit.loading || edit.sending || edit.unavailableImages.length || !canEditHistoricalMessages()) return;
  const text = edit.text;
  const images = edit.images.map(({ src: dataUrl, detail }) => ({ dataUrl, detail }));
  if (!text.trim() && !images.length) return;
  edit.sending = true;
  renderTimeline();
  await sendOutgoingMessage({ text, images, source: "history", sourceItemId: edit.itemId });
}

async function activateThread() {
  const threadId = state.selectedThreadId;
  if (!threadId || isChildThread(state.selectedSession)) return;
  elements.activateThread.disabled = true;
  try {
    const payload = await api(`/api/sessions/${encodeURIComponent(threadId)}/resume`, { method: "POST", body: {} });
    const session = payload.session || payload;
    if (session?.id) {
      const known = state.sessions.get(session.id) || state.selectedSession;
      const merged = { ...known, ...session, tokenUsage: session.tokenUsage ?? known?.tokenUsage ?? null };
      state.sessions.set(session.id, merged);
      state.selectedSession = merged;
    }
    await loadProjects(false);
    renderSidebar();
    renderHeader();
    renderTimeline();
    updateComposer();
  } catch (error) {
    toast(t("errors.loadSessionFailed", { message: error.message }), "error");
  } finally {
    elements.activateThread.disabled = false;
  }
}

async function interruptTurn() {
  const threadId = state.selectedThreadId;
  const runtime = runtimeFor(threadId);
  if (!threadId || !isTurnActive(runtime)) return;
  const turnId = runtime.activeTurnId;
  elements.interrupt.disabled = true;
  try {
    await api(`/api/sessions/${encodeURIComponent(threadId)}/turns/${encodeURIComponent(turnId)}/interrupt`, { method: "POST", body: {} });
    const currentRuntime = runtimeFor(threadId);
    if (currentRuntime?.activeTurnId === turnId) currentRuntime.phase = "interrupting";
    if (threadId === state.selectedThreadId) {
      renderHeader();
      updateComposer();
    }
  } catch (error) {
    toast(error.message, "error");
  } finally {
    elements.interrupt.disabled = false;
  }
}

async function resolveRequest(requestId, body) {
  const request = state.pendingRequests.get(requestId);
  if (!request || request.status === "responding") return;
  try {
    const result = await api(`/api/requests/${encodeURIComponent(requestId)}/resolve`, { method: "POST", body });
    const current = state.pendingRequests.get(requestId);
    if (current && result.status === "responding") current.status = "responding";
    renderRequests();
  } catch (error) {
    toast(error.message, "error");
  }
}

  Object.assign(actions, {
    sessionTitle,
    canAcceptDirectInput,
    isChildThread,
    canEditHistoricalMessages,
    canStartEditingUserMessage,
    composerImages,
    composerMode,
    renderComposerMode,
    modelEntry,
    supportedEfforts,
    composerSetting,
    persistComposerSettings,
    setComposerSetting,
    closeComposerModelMenu,
    renderComposerModelMenu,
    loadModels,
    openComposerModelMenu,
    saveScrollPosition,
    threadPath,
    formatTime,
    tokenCount,
    formatInputTokens,
    formatOutputTokens,
    renderComposerTokenUsage,
    renderComposerImages,
    readFileAsDataUrl,
    addComposerImages,
    updateComposer,
    setSendStatus,
    sendOutgoingMessage,
    restartAppServer,
    startCompaction,
    sendMessage,
    sendEditedUserMessage,
    activateThread,
    interruptTurn,
    resolveRequest
  });
}
