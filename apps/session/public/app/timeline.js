export function installTimeline(context) {
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
  const isHistoricalMessageResent = (...args) => actions.isHistoricalMessageResent(...args);
  const markHistoricalMessageResent = (...args) => actions.markHistoricalMessageResent(...args);
  const el = (...args) => actions.el(...args);
  const listFrom = (...args) => actions.listFrom(...args);
  const api = (...args) => actions.api(...args);
  const toast = (...args) => actions.toast(...args);
  const applyAllAnnotations = (...args) => actions.applyAllAnnotations(...args);
  const applyAnnotationsToTurns = (...args) => actions.applyAnnotationsToTurns(...args);
  const removeAnnotationBubble = (...args) => actions.removeAnnotationBubble(...args);
  const closeAnnotationPopup = (...args) => actions.closeAnnotationPopup(...args);
  const canEditHistoricalMessages = (...args) => actions.canEditHistoricalMessages(...args);
  const canStartEditingUserMessage = (...args) => actions.canStartEditingUserMessage(...args);
  const composerImages = (...args) => actions.composerImages(...args);
  const loadProjects = (...args) => actions.loadProjects(...args);
  const selectThread = (...args) => actions.selectThread(...args);
  const loadOlderTurns = (...args) => actions.loadOlderTurns(...args);
  const updateComposer = (...args) => actions.updateComposer(...args);
  const sendEditedUserMessage = (...args) => actions.sendEditedUserMessage(...args);

function ensureTurn(turnId, initial = {}) {
  if (!turnId) return null;
  let turn = state.turns.get(turnId);
  if (!turn) {
    turn = { id: turnId, status: initial.status || "inProgress", items: new Map(), itemOrder: [], ...initial };
    if (!(turn.items instanceof Map)) {
      const items = Array.isArray(turn.items) ? turn.items : [];
      turn.items = new Map(items.map((item) => [item.id, item]));
      turn.itemOrder = items.map((item) => item.id);
    }
    state.turns.set(turnId, turn);
    state.turnOrder.push(turnId);
  }
  return turn;
}

function mergeItem(turnId, item) {
  if (!item?.id || !turnId) return;
  const turn = ensureTurn(turnId);
  let optimistic = null;
  if (item.clientId) {
    const optimisticId = `optimistic:${item.clientId}`;
    optimistic = turn.items.get(optimisticId) || null;
    turn.items.delete(optimisticId);
    turn.itemOrder = turn.itemOrder.filter((id) => id !== optimisticId);
  }
  const existing = turn.items.get(item.id);
  if (existing?.lifecycleStatus === "completed" && item.lifecycleStatus === "started") return;
  const fallbackMedia = optimistic && (!Array.isArray(item.images) || item.images.length === 0)
    ? { images: optimistic.images || [], unavailableImages: optimistic.unavailableImages || [] }
    : {};
  turn.items.set(item.id, { ...(existing || {}), ...item, ...fallbackMedia, turnId });
  if (!turn.itemOrder.includes(item.id)) turn.itemOrder.push(item.id);
}

function reconcileItemOrder(turnId, authoritativeItems) {
  const turn = state.turns.get(turnId);
  if (!turn || !authoritativeItems.length) return;
  for (const item of authoritativeItems) mergeItem(turnId, item);
  const authoritativeIds = [...new Set(authoritativeItems.map((item) => item.id).filter(Boolean))];
  const authoritativeSet = new Set(authoritativeIds);
  const localOnlyIds = turn.itemOrder.filter((id) => !authoritativeSet.has(id));
  const optimisticUserIds = localOnlyIds.filter((id) => id.startsWith("optimistic:") && turn.items.get(id)?.type === "userMessage");
  turn.itemOrder = [
    ...optimisticUserIds,
    ...authoritativeIds,
    ...localOnlyIds.filter((id) => !optimisticUserIds.includes(id)),
  ];
}

function installTurns(turns, prepend = false) {
  const ids = [];
  for (const rawTurn of turns) {
    const turn = {
      ...rawTurn,
      items: new Map((rawTurn.items || []).map((item) => [item.id, item])),
      itemOrder: (rawTurn.items || []).map((item) => item.id),
    };
    const existing = state.turns.get(turn.id);
    if (existing) {
      for (const id of existing.itemOrder) if (!turn.items.has(id)) {
        turn.items.set(id, existing.items.get(id));
        turn.itemOrder.push(id);
      }
    }
    state.turns.set(turn.id, turn);
    ids.push(turn.id);
  }
  const without = state.turnOrder.filter((id) => !ids.includes(id));
  state.turnOrder = prepend ? [...ids, ...without] : [...without, ...ids];
}

async function hydrateItems(turns, version, signal = state.selectionController?.signal) {
  const threadId = state.selectedThreadId;
  const workers = turns.map(async (turn) => {
    let cursor = null;
    let pages = 0;
    const items = [];
    do {
      const query = new URLSearchParams({ direction: "asc", limit: "200", turnId: turn.id });
      if (cursor) query.set("cursor", cursor);
      const payload = await api(`/api/sessions/${encodeURIComponent(threadId)}/items?${query}`, { signal });
      items.push(...listFrom(payload, "items"));
      cursor = payload.nextCursor || null;
      pages++;
    } while (cursor && pages < 20);
    return { turnId: turn.id, items, nextCursor: cursor };
  });

  const results = await Promise.allSettled(workers);
  if (version !== state.selectionVersion || threadId !== state.selectedThreadId) return;
  results.forEach((result, index) => {
    const turn = state.turns.get(turns[index]?.id);
    if (!turn) return;
    if (result.status !== "fulfilled") {
      turn.itemsLoadError = result.reason?.message || t("errors.itemHistoryLoadFailed");
      return;
    }
    turn.itemsLoadError = null;
    turn.itemsNextCursor = result.value.nextCursor;
    reconcileItemOrder(turn.id, result.value.items);
  });
}

const turnItemRefreshes = new Map();
async function refreshTurnItems(threadId, turnId) {
  if (!threadId || !turnId || threadId !== state.selectedThreadId) return;
  const key = JSON.stringify([threadId, turnId, state.selectionVersion]);
  if (turnItemRefreshes.has(key)) return turnItemRefreshes.get(key);
  const refresh = performTurnItemsRefresh(threadId, turnId);
  turnItemRefreshes.set(key, refresh);
  try {
    return await refresh;
  } finally {
    turnItemRefreshes.delete(key);
  }
}

async function performTurnItemsRefresh(threadId, turnId) {
  const version = state.selectionVersion;
  const signal = state.selectionController?.signal;
  try {
    let cursor = null;
    let pages = 0;
    const items = [];
    do {
      const query = new URLSearchParams({ direction: "asc", limit: "200", turnId });
      if (cursor) query.set("cursor", cursor);
      const payload = await api(`/api/sessions/${encodeURIComponent(threadId)}/items?${query}`, { signal });
      if (version !== state.selectionVersion || threadId !== state.selectedThreadId) return;
      items.push(...listFrom(payload, "items"));
      cursor = payload.nextCursor || null;
      pages++;
    } while (cursor && pages < 20);
    const before = JSON.stringify((state.turns.get(turnId)?.itemOrder || []).map((id) => state.turns.get(turnId)?.items.get(id)));
    reconcileItemOrder(turnId, items);
    const after = JSON.stringify((state.turns.get(turnId)?.itemOrder || []).map((id) => state.turns.get(turnId)?.items.get(id)));
    if (before !== after) scheduleTurnRender(turnId);
  } catch (error) {
    if (error.name !== "AbortError" && version === state.selectionVersion) toast(t("errors.turnCorrectionFailed", { message: error.message }), "error");
  }
}

async function loadUserMessageForEditing(threadId, turnId, itemId, signal) {
  let cursor = null;
  let pages = 0;
  do {
    const query = new URLSearchParams({ direction: "asc", limit: "200", turnId });
    if (cursor) query.set("cursor", cursor);
    const payload = await api(`/api/sessions/${encodeURIComponent(threadId)}/items?${query}`, { signal });
    const item = listFrom(payload, "items").find((entry) => entry.id === itemId && entry.type === "userMessage");
    if (item) return item;
    cursor = payload.nextCursor || null;
    pages++;
  } while (cursor && pages < 20);
  throw new Error(t("errors.historyMessageUnavailable"));
}

async function loadMoreItems(turnId) {
  const threadId = state.selectedThreadId;
  const signal = state.selectionController?.signal;
  const turn = state.turns.get(turnId);
  if (!threadId || !turn || (!turn.itemsNextCursor && !turn.itemsLoadError) || turn.loadingMoreItems) return;
  turn.loadingMoreItems = true;
  renderTimeline();
  try {
    const query = new URLSearchParams({ direction: "asc", limit: "200", turnId });
    if (turn.itemsNextCursor) query.set("cursor", turn.itemsNextCursor);
    const payload = await api(`/api/sessions/${encodeURIComponent(threadId)}/items?${query}`, { signal });
    if (threadId !== state.selectedThreadId) return;
    for (const item of listFrom(payload, "items")) mergeItem(turnId, item);
    turn.itemsNextCursor = payload.nextCursor || null;
    turn.itemsLoadError = null;
  } catch (error) {
    turn.itemsLoadError = error.message;
  } finally {
    turn.loadingMoreItems = false;
    if (threadId === state.selectedThreadId) renderTimeline();
  }
}
function itemLabel(item) {
  const labels = {
    userMessage: t("timeline.you"),
    agentMessage: "Codex",
    plan: t("common.plan"),
    commandExecution: t("timeline.commandExecution"),
    fileChange: t("timeline.fileChange"),
    mcpToolCall: t("timeline.mcpTool"),
    collabAgentToolCall: t("timeline.subagentCall"),
    collabToolCall: t("timeline.subagentCall"),
    subAgentActivity: t("timeline.subagentActivity"),
    contextCompaction: t("timeline.contextCompaction"),
  };
  return labels[item.type] || item.type || t("common.unknownItem");
}

function pretty(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

let diagramSequence = 0;
if (window.mermaid) {
  window.mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    htmlLabels: false,
    suppressErrorRendering: true,
  });
}

const ABSOLUTE_PATH_PATTERN = /\/[^\s<>"'“”‘’`:|?*()\[\]{},;!，。；！？、]+/g;
const VSCODE_URI_PATTERN = /vscode:\/\/file\/[^\s<>"'“”‘’`]+/gi;
const PATH_TRAILING_PUNCTUATION = /[.,;!，。；！、]+$/;

function detectedAbsolutePaths(text) {
  const paths = [];
  for (const match of text.matchAll(ABSOLUTE_PATH_PATTERN)) {
    const before = match.index === 0 ? "" : text[match.index - 1];
    if (before && !/[\s(\[{"'“‘（【]/.test(before)) continue;
    const path = match[0].replace(PATH_TRAILING_PUNCTUATION, "");
    if (path.length > 1 && !path.startsWith("//")) {
      paths.push({ start: match.index, end: match.index + path.length, path });
    }
  }
  return paths;
}

function parseVscodeFileUri(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "vscode:" || url.hostname !== "file" || url.username || url.password || url.port || url.search || url.hash) return null;
    const decodedPath = decodeURIComponent(url.pathname);
    const position = decodedPath.match(/^(.*):([1-9]\d*):([1-9]\d*)$/);
    if (!position || !position[1].startsWith("/")) return null;
    return { path: position[1], line: Number(position[2]), column: Number(position[3]) };
  } catch {
    return null;
  }
}

function bindVscodeLink(link, uri) {
  const target = parseVscodeFileUri(uri);
  if (!target) return false;
  link.classList.add("local-path-link", "vscode-path-link");
  link.href = "#";
  link.title = t("actions.openInVSCode");
  link.dataset.localPath = target.path;
  link.dataset.vscodeLine = String(target.line);
  link.dataset.vscodeColumn = String(target.column);
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    if (link.getAttribute("aria-busy") === "true") return;
    link.setAttribute("aria-busy", "true");
    try {
      await api("/api/open-path", {
        method: "POST",
        body: { ...target, application: "vscode" },
      });
      toast(t("messages.openedVSCodeLine", { line: target.line }), "success");
    } catch (error) {
      toast(error.message || t("errors.vscodeOpenFailed"), "error");
    } finally {
      link.removeAttribute("aria-busy");
    }
  });
  return true;
}

function linkVscodeUris(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const textNode of textNodes) {
    if (textNode.parentElement?.closest("a, pre")) continue;
    const text = textNode.textContent || "";
    const matches = [...text.matchAll(VSCODE_URI_PATTERN)];
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      const uri = match[0].replace(PATH_TRAILING_PUNCTUATION, "");
      const parsed = parseVscodeFileUri(uri);
      if (!parsed) continue;
      fragment.append(document.createTextNode(text.slice(offset, match.index)));
      const link = el("a", "", uri);
      bindVscodeLink(link, uri);
      fragment.append(link);
      offset = match.index + uri.length;
    }
    if (!offset) continue;
    fragment.append(document.createTextNode(text.slice(offset)));
    textNode.replaceWith(fragment);
  }
}

function localPathLink(path) {
  const link = el("a", "local-path-link", path);
  link.href = "#";
  link.title = t("actions.openLocally");
  link.dataset.localPath = path;
  link.addEventListener("click", async (event) => {
    event.preventDefault();
    if (link.getAttribute("aria-busy") === "true") return;
    link.setAttribute("aria-busy", "true");
    try {
      const result = await api("/api/open-path", { method: "POST", body: { path } });
      toast(result.kind === "directory" ? t("messages.openedFinderDirectory") : t("messages.openedDefaultApplication"), "success");
    } catch (error) {
      toast(error.message || t("errors.pathOpenFailed"), "error");
    } finally {
      link.removeAttribute("aria-busy");
    }
  });
  return link;
}

function linkAbsolutePaths(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const textNode of textNodes) {
    if (textNode.parentElement?.closest("a, pre")) continue;
    const matches = detectedAbsolutePaths(textNode.textContent || "");
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of matches) {
      fragment.append(document.createTextNode(textNode.textContent.slice(offset, match.start)));
      fragment.append(localPathLink(match.path));
      offset = match.end;
    }
    fragment.append(document.createTextNode(textNode.textContent.slice(offset)));
    textNode.replaceWith(fragment);
  }
}

function renderMarkdown(text) {
  const container = el("div", "msg-body markdown");
  if (!window.marked || !window.DOMPurify) {
    container.textContent = text || "";
    return container;
  }
  const html = window.marked.parse(text || "", { async: false, breaks: true, gfm: true });
  container.innerHTML = window.DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "iframe", "object", "embed", "form", "input", "button", "svg", "math"],
    FORBID_ATTR: ["style"],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|vscode):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
  for (const link of container.querySelectorAll("a")) {
    if (link.href.startsWith("vscode://")) {
      if (!bindVscodeLink(link, link.getAttribute("href"))) link.removeAttribute("href");
      continue;
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  linkVscodeUris(container);
  linkAbsolutePaths(container);
  for (const code of container.querySelectorAll("pre code")) {
    if (code.classList.contains("language-mermaid")) {
      const source = code.textContent;
      const host = el("div", "mermaid-diagram");
      code.parentElement.replaceWith(host);
      if (window.mermaid && source.length <= 50_000) {
        const diagramId = `codex-mermaid-${++diagramSequence}`;
        void window.mermaid.render(diagramId, source).then(({ svg }) => {
          host.innerHTML = window.DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ["foreignObject", "script"],
            FORBID_ATTR: ["onload", "onclick", "onerror"],
          });
        }).catch(() => { host.textContent = source; });
      } else {
        host.textContent = source;
      }
      continue;
    }
    try { window.hljs?.highlightElement(code); } catch {}
  }
  return container;
}

function toolText(item) {
  switch (item.type) {
    case "commandExecution": {
      const command = commandPresentation(item.command);
      return [command.env && `env: ${command.env}`, command.command && `$ ${command.command}`, item.cwd && `cwd: ${item.cwd}`, item.output, item.exitCode != null && `exit: ${item.exitCode}`, item.durationMs != null && `duration: ${item.durationMs}ms`].filter(Boolean).join("\n");
    }
    case "fileChange":
      return [item.diff, pretty(item.changes)].filter(Boolean).join("\n");
    case "mcpToolCall":
      return [`${item.server || "mcp"}.${item.tool || "tool"}`, `arguments:\n${pretty(item.arguments)}`, item.progress && `progress:\n${item.progress}`, item.result != null && `result:\n${pretty(item.result)}`, item.error != null && `error:\n${pretty(item.error)}`].filter(Boolean).join("\n\n");
    case "collabAgentToolCall":
    case "collabToolCall":
      return [
        item.tool,
        item.prompt,
        item.senderThreadId && `sender: ${item.senderThreadId}`,
        item.receiverThreadIds?.length && `receivers: ${item.receiverThreadIds.join(", ")}`,
        item.model && `model: ${item.model}`,
        item.reasoningEffort && `reasoning: ${item.reasoningEffort}`,
        pretty(item.agentsStates),
      ].filter(Boolean).join("\n\n");
    case "subAgentActivity": {
      const path = Array.isArray(item.agentPath) ? item.agentPath.join(" / ") : item.agentPath;
      return [item.agentThreadId && `thread: ${item.agentThreadId}`, path && `path: ${path}`].filter(Boolean).join("\n");
    }
    case "plan":
      return [item.text, pretty(item.entries)].filter(Boolean).join("\n");
    default:
      return [item.summary, pretty(item.metadata)].filter(Boolean).join("\n");
  }
}

function toolValue(value) {
  if (value == null || value === "") return "";
  return typeof value === "string" ? value : pretty(value);
}

function labeledToolOutput(entries) {
  return entries.flatMap(([label, value]) => {
    const text = toolValue(value);
    if (!text) return [];
    return [label ? `${label}\n${text}` : text];
  }).join("\n\n");
}

function normalizeToolOutput(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function truncateToolOutput(value) {
  const text = normalizeToolOutput(value);
  const characters = Array.from(text);
  if (characters.length <= TOOL_OUTPUT_HEAD_LIMIT + TOOL_OUTPUT_TAIL_LIMIT) return text;
  return `${characters.slice(0, TOOL_OUTPUT_HEAD_LIMIT).join("")}${TOOL_TRUNCATION_NOTICE}${characters.slice(-TOOL_OUTPUT_TAIL_LIMIT).join("")}`;
}

function normalizedDisplayPath(value) {
  if (typeof value !== "string" || !value.startsWith("/")) return value || "";
  return value === "/" ? value : value.replace(/\/+$/, "");
}

function toolCwdField(cwd) {
  if (!cwd) return null;
  const fullPath = normalizedDisplayPath(cwd);
  const sessionPath = normalizedDisplayPath(state.selectedSession?.cwd);
  if (!sessionPath || fullPath !== sessionPath) return { label: "CWD", value: fullPath, kind: "code" };
  return {
    label: "CWD",
    value: fullPath === "/" ? "/" : fullPath.split("/").filter(Boolean).at(-1) || fullPath,
    kind: "code",
    title: fullPath,
  };
}

function fileChangeTargets(changes) {
  if (!Array.isArray(changes)) return "";
  return [...new Set(changes.flatMap((change) => {
    if (typeof change === "string") return [change];
    const target = change?.path || change?.filePath || change?.file_path;
    return typeof target === "string" && target ? [target] : [];
  }))].join("\n");
}

function toolDetailSections(item, statusLabel) {
  const result = [{ label: "Status", value: statusLabel }];
  switch (item.type) {
    case "commandExecution": {
      const cwd = toolCwdField(item.cwd);
      const command = commandPresentation(item.command);
      return {
        input: [
          command.env && { label: "Env", value: command.env, kind: "code" },
          command.command && { label: "Command", value: command.command, kind: "block" },
          cwd,
        ].filter(Boolean),
        output: toolValue(item.output),
        result: [
          ...result,
          item.exitCode != null && { label: "Exit", value: String(item.exitCode) },
          item.durationMs != null && { label: "Duration", value: `${item.durationMs}ms` },
        ].filter(Boolean),
      };
    }
    case "mcpToolCall":
      return {
        input: [
          { label: "Server", value: item.server || "mcp", kind: "code" },
          { label: "Tool", value: item.tool || "tool", kind: "code" },
          toolValue(item.arguments) && { label: "Arguments", value: toolValue(item.arguments), kind: "block" },
        ].filter(Boolean),
        output: labeledToolOutput([
          ["PROGRESS", item.progress],
          ["RESULT", item.result],
          ["ERROR", item.error],
        ]),
        result,
      };
    case "fileChange": {
      const targets = fileChangeTargets(item.changes);
      return {
        input: targets ? [{ label: "Targets", value: targets, kind: "block" }] : [],
        output: labeledToolOutput([
          ["CHANGES", item.changes],
          ["DIFF", item.diff],
        ]),
        result,
      };
    }
    case "collabAgentToolCall":
    case "collabToolCall":
      return {
        input: [
          item.tool && { label: "Tool", value: item.tool, kind: "code" },
          item.prompt && { label: "Prompt", value: item.prompt, kind: "block" },
          item.senderThreadId && { label: "Sender", value: item.senderThreadId, kind: "code" },
          item.receiverThreadIds?.length && { label: "Receivers", value: item.receiverThreadIds.join(", "), kind: "code" },
          item.model && { label: "Model", value: item.model, kind: "code" },
          item.reasoningEffort && { label: "Reasoning", value: item.reasoningEffort },
        ].filter(Boolean),
        output: labeledToolOutput([["AGENT STATES", item.agentsStates]]),
        result,
      };
    case "subAgentActivity": {
      const path = Array.isArray(item.agentPath) ? item.agentPath.join(" / ") : item.agentPath;
      return {
        input: [
          item.agentThreadId && { label: "Thread", value: item.agentThreadId, kind: "code" },
          path && { label: "Path", value: path },
        ].filter(Boolean),
        output: "",
        result,
      };
    }
    case "plan":
      return {
        input: [],
        output: labeledToolOutput([
          ["PLAN", item.text],
          ["ENTRIES", item.entries],
        ]),
        result,
      };
    default:
      return {
        input: [],
        output: labeledToolOutput([
          ["SUMMARY", item.summary],
          ["METADATA", item.metadata],
        ]),
        result,
      };
  }
}

function renderToolFields(fields, compact = false) {
  const list = el("div", compact ? "tool-detail-fields compact" : "tool-detail-fields");
  for (const field of fields) {
    const row = el("div", "tool-detail-field");
    row.append(el("span", "tool-detail-field-label", field.label));
    const value = field.kind === "block"
      ? el("pre", "tool-detail-value block", field.value)
      : el(field.kind === "code" ? "code" : "span", "tool-detail-value", field.value);
    if (field.title) value.title = field.title;
    row.append(value);
    list.append(row);
  }
  return list;
}

function renderToolDetails(item, statusLabel) {
  const details = el("div", "tool-details");
  const sections = toolDetailSections(item, statusLabel);
  if (sections.input.length) {
    const section = el("section", "tool-detail-section tool-detail-input");
    section.append(el("div", "tool-detail-title", "INPUT"), renderToolFields(sections.input));
    details.append(section);
  }
  if (sections.output) {
    const section = el("section", "tool-detail-section tool-detail-output");
    section.append(
      el("div", "tool-detail-title", "OUTPUT"),
      el("pre", "tool-detail-output-text", truncateToolOutput(sections.output)),
    );
    details.append(section);
  }
  if (sections.result.length) {
    const section = el("section", "tool-detail-section tool-detail-result");
    section.append(el("div", "tool-detail-title", "RESULT"), renderToolFields(sections.result, true));
    details.append(section);
  }
  return details;
}

function normalizedItemStatus(item) {
  if (!item?.status && item?.lifecycleStatus === "started") return "inprogress";
  return String(item?.status || "completed").toLowerCase();
}

async function reconcilePendingTurn(threadId) {
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(threadId)}/turns/reconcile`, { method: "POST", body: {} });
    if (result.status === "recorded") {
      const uncertainSource = state.uncertainTurnSources.get(threadId);
      const currentEdit = state.editingUserMessage;
      const preserveEdit = currentEdit?.threadId === threadId
        && !(uncertainSource?.source === "history" && currentEdit.itemId === uncertainSource.itemId)
        ? { ...currentEdit, loading: false, sending: false }
        : null;
      if (uncertainSource?.source !== "history") {
        state.composerDrafts.delete(threadId);
        state.composerImages.delete(threadId);
      } else {
        markHistoricalMessageResent(threadId, uncertainSource.itemId);
      }
      state.uncertainTurnSources.delete(threadId);
      toast(t("messages.messageConfirmed"));
      if (preserveEdit) {
        for (const turnId of [...state.turnOrder]) {
          const turn = state.turns.get(turnId);
          if (![...(turn?.items?.values() || [])].some((item) => item.uncertain)) continue;
          state.turns.delete(turnId);
          state.turnOrder = state.turnOrder.filter((id) => id !== turnId);
        }
        state.editingUserMessage = preserveEdit;
        renderTimeline();
        updateComposer();
        if (result.turnId) void refreshTurnItems(threadId, result.turnId);
      } else {
        await selectThread(threadId, { force: true });
      }
      return;
    }
    toast(result.status === "clear" ? t("messages.noPendingSend") : t("errors.sendStillUncertain"), result.status === "clear" ? "info" : "error");
  } catch (error) {
    toast(t("errors.reconcileFailed", { message: error.message }), "error");
  }
}

function showImagePreview(src) {
  const dialog = el("dialog", "image-preview-dialog");
  const close = el("button", "image-preview-close", t("actions.close"));
  close.type = "button";
  close.addEventListener("click", () => dialog.close());
  const image = document.createElement("img");
  image.src = src;
  image.alt = t("timeline.userImagePreview");
  dialog.append(close, image);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

function renderMessageImages(item) {
  const images = Array.isArray(item.images) ? item.images : [];
  const unavailable = Array.isArray(item.unavailableImages) ? item.unavailableImages : [];
  if (!images.length && !unavailable.length) return null;
  const gallery = el("div", "msg-images");
  for (const image of images) {
    if (image?.kind !== "inline" || typeof image.src !== "string" || !image.src.startsWith("data:image/")) continue;
    const button = el("button", "msg-image-button");
    button.type = "button";
    button.setAttribute("aria-label", t("actions.viewLargeImage"));
    const preview = document.createElement("img");
    preview.src = image.src;
    preview.alt = t("timeline.userImage");
    button.append(preview);
    button.addEventListener("click", () => showImagePreview(image.src));
    gallery.append(button);
  }
  for (const image of unavailable) gallery.append(el("span", "msg-image-unavailable", image?.label || t("timeline.imageUnavailable")));
  return gallery.childNodes.length ? gallery : null;
}

function inlineMessageImages(item) {
  return (Array.isArray(item?.images) ? item.images : [])
    .filter((image) => image?.kind === "inline" && typeof image.src === "string" && image.src.startsWith("data:image/"));
}

function cancelEditingUserMessage() {
  if (!state.editingUserMessage) return;
  state.editingUserMessage = null;
  renderTimeline();
}

async function beginEditingUserMessage(item, turnId) {
  if (!canStartEditingUserMessage(item, turnId)) return;
  const threadId = state.selectedThreadId;
  const version = state.selectionVersion;
  state.editingUserMessage = {
    threadId,
    turnId,
    itemId: item.id,
    text: item.text || "",
    images: inlineMessageImages(item),
    unavailableImages: Array.isArray(item.unavailableImages) ? item.unavailableImages : [],
    loading: true,
    sending: false,
  };
  removeAnnotationBubble();
  closeAnnotationPopup();
  renderTimeline();
  try {
    const fullItem = await loadUserMessageForEditing(threadId, turnId, item.id, state.selectionController?.signal);
    if (version !== state.selectionVersion || threadId !== state.selectedThreadId || state.editingUserMessage?.itemId !== item.id) return;
    mergeItem(turnId, fullItem);
    state.editingUserMessage = {
      ...state.editingUserMessage,
      text: fullItem.text || "",
      images: inlineMessageImages(fullItem),
      unavailableImages: Array.isArray(fullItem.unavailableImages) ? fullItem.unavailableImages : [],
      loading: false,
    };
    renderTimeline();
    requestAnimationFrame(() => elements.timeline.querySelector(`[data-item-id="${CSS.escape(item.id)}"] .history-message-editor`)?.focus());
  } catch (error) {
    if (error.name === "AbortError" || version !== state.selectionVersion || threadId !== state.selectedThreadId) return;
    state.editingUserMessage = null;
    renderTimeline();
    toast(t("errors.editHistoryFailed", { message: error.message }), "error");
  }
}

function renderUserMessageEditor(edit) {
  const editor = el("div", "user-bubble history-message-editing");
  const textarea = el("textarea", "history-message-editor");
  textarea.value = edit.text;
  textarea.disabled = edit.loading || edit.sending;
  textarea.setAttribute("aria-label", t("actions.editHistoryMessage"));
  textarea.addEventListener("input", () => {
    if (state.editingUserMessage?.itemId === edit.itemId) state.editingUserMessage.text = textarea.value;
    send.disabled = Boolean(edit.loading || edit.sending || edit.unavailableImages.length || (!textarea.value.trim() && !edit.images.length));
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !edit.sending) {
      event.preventDefault();
      cancelEditingUserMessage();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.isComposing && !send.disabled) {
      event.preventDefault();
      void sendEditedUserMessage();
    }
  });
  editor.append(textarea);
  const gallery = renderMessageImages({ images: edit.images, unavailableImages: edit.unavailableImages });
  if (gallery) editor.append(gallery);
  if (edit.loading) editor.append(el("p", "history-message-edit-note", t("status.loadingFullHistory")));
  else if (edit.unavailableImages.length) editor.append(el("p", "history-message-edit-note error", t("errors.missingImagesCannotResend")));
  const actions = el("div", "history-message-edit-actions");
  const cancel = el("button", "history-message-edit-cancel", t("actions.cancel"));
  cancel.type = "button";
  cancel.disabled = edit.sending;
  cancel.addEventListener("click", cancelEditingUserMessage);
  const send = el("button", "history-message-edit-send", edit.sending ? t("status.sending") : t("actions.sendAsNewMessage"));
  send.type = "button";
  send.disabled = Boolean(edit.loading || edit.sending || edit.unavailableImages.length || (!edit.text.trim() && !edit.images.length));
  send.addEventListener("click", () => void sendEditedUserMessage());
  actions.append(cancel, send);
  editor.append(actions);
  return editor;
}

function toolExpansionKey(kind, turnId, itemId) {
  if (!state.selectedThreadId || !turnId || !itemId) return null;
  return JSON.stringify([state.selectedThreadId, kind, turnId, itemId]);
}

function renderItem(item, turnId = item.turnId) {
  const isUser = item.type === "userMessage";
  const isAssistant = item.type === "agentMessage";
  if (isUser || isAssistant) {
    const message = el("div", `msg ${isUser ? "user" : "assistant"}${item.optimistic ? " optimistic" : ""}${item.failed ? " failed" : ""}${item.uncertain ? " uncertain" : ""}`);
    message.dataset.itemId = item.id || "";
    const inner = el("div", "msg-inner");
    const text = item.text || (item.failed ? t("status.sendFailed") : "");
    const roleLine = el("div", "msg-role");
    if (isAssistant) {
      const icon = el("span", "role-icon");
      icon.innerHTML = TRUTH_ICON;
      roleLine.append(icon, document.createTextNode("Codex"));
    } else {
      roleLine.append(document.createTextNode("Question · You"));
      if (isHistoricalMessageResent(state.selectedThreadId, item.id)) {
        roleLine.append(el("span", "message-resent-state", t("timeline.editedResent")));
      }
    }
    if (item.uncertain) {
      roleLine.append(el("span", "message-delivery-state", t("timeline.deliveryUncertain")));
      const reconcile = el("button", "message-reconcile", t("actions.refreshReconcile"));
      reconcile.type = "button";
      reconcile.addEventListener("click", () => void reconcilePendingTurn(item.threadId || state.selectedThreadId));
      roleLine.append(reconcile);
    }
    if (isAssistant && text) {
      const copy = el("button", "turn-copy-btn message-copy");
      copy.type = "button";
      copy.title = t("actions.copyMarkdown");
      copy.innerHTML = COPY_ICON;
      copy.addEventListener("click", () => void navigator.clipboard.writeText(text).then(() => toast(t("messages.replyCopied"))));
      roleLine.append(copy);
    }
    const editing = isUser && state.editingUserMessage?.threadId === state.selectedThreadId && state.editingUserMessage?.itemId === item.id
      ? state.editingUserMessage
      : null;
    if (isUser && !editing && canStartEditingUserMessage(item, turnId)) {
      const edit = el("button", "message-edit");
      edit.type = "button";
      edit.title = t("actions.editHistoryMessage");
      edit.setAttribute("aria-label", t("actions.editHistoryMessage"));
      edit.textContent = "⌁";
      edit.addEventListener("click", () => void beginEditingUserMessage(item, turnId));
      roleLine.append(edit);
    }
    if (isUser) {
      const card = el("div", "user-question-card");
      card.append(roleLine);
      if (editing) {
        card.append(renderUserMessageEditor(editing));
      } else {
        const bubble = el("div", "user-bubble");
        if (text) bubble.append(el("div", "msg-body", text));
        const gallery = renderMessageImages(item);
        if (gallery) bubble.append(gallery);
        card.append(bubble);
      }
      inner.append(card);
    } else {
      inner.append(roleLine, renderMarkdown(text));
    }
    message.append(inner);
    return message;
  }

  if (item.type === "contextCompaction") {
    const message = el("div", "msg assistant context-compaction");
    message.dataset.itemId = item.id || "";
    const inner = el("div", "msg-inner");
    const body = el("div", "msg-body");
    const status = normalizedItemStatus(item);
    const label = status === "inprogress"
      ? t("status.compacting")
      : ["failed", "error"].includes(status)
        ? t("errors.compactionFailed")
        : ["interrupted", "cancelled", "canceled"].includes(status)
          ? t("status.compactionInterrupted")
          : item.message || t("status.contextCompacted");
    body.append(el("div", "context-marker", label));
    inner.append(body);
    message.append(inner);
    return message;
  }

  const itemStatus = normalizedItemStatus(item);
  const stateName = itemStatus === "inprogress"
    ? "running"
    : ["failed", "error"].includes(itemStatus)
      ? "error"
      : itemStatus === "declined"
        ? "declined"
        : ["interrupted", "cancelled", "canceled"].includes(itemStatus)
          ? "interrupted"
          : "done";
  const stateLabels = { running: t("status.running"), error: t("status.failed"), declined: t("status.declined"), interrupted: t("status.interrupted"), done: t("status.completed") };
  const expansionKey = toolExpansionKey("item", turnId, item.id);
  const open = expansionKey && state.toolExpansion.has(expansionKey)
    ? state.toolExpansion.get(expansionKey)
    : stateName === "running";
  const block = el("div", `tool-block tool-${stateName}`);
  block.dataset.itemId = item.id || "";
  if (open) block.classList.add("open");
  const summary = el("button", "tool-summary");
  summary.type = "button";
  summary.setAttribute("aria-expanded", String(open));
  summary.append(el("span", "chevron", "▶"), el("span", "tool-state-dot"), el("span", "tool-name-inline", itemLabel(item)));
  const stateLabel = el("span", "tool-state-label", stateLabels[stateName]);
  summary.append(stateLabel);
  const preview = item.type === "commandExecution" ? commandPresentation(item.command).command : item.type === "mcpToolCall" ? `${item.server || "mcp"}.${item.tool || "tool"}` : "";
  summary.append(el("span", "tool-preview", preview || toolText(item).replace(/\s+/g, " ").slice(0, 100)));
  const body = el("div", "tool-content");
  body.append(renderToolDetails(item, stateLabels[stateName]));
  const relatedThreadIds = [item.agentThreadId, ...(Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : [])].filter(Boolean);
  if (relatedThreadIds.length) {
    const links = el("div", "related-thread-links");
    for (const threadId of [...new Set(relatedThreadIds)]) {
      const button = el("button", "related-thread-link", t("timeline.openChildThread", { id: threadId.slice(0, 8) }));
      button.type = "button";
      button.addEventListener("click", async (event) => {
        event.stopPropagation();
        try {
          if (!state.sessions.has(threadId)) {
            const detail = await api(`/api/sessions/${encodeURIComponent(threadId)}`);
            const session = detail.session || detail;
            if (session?.id) state.sessions.set(session.id, session);
          }
          await loadProjects(false);
          await selectThread(threadId);
        } catch (error) {
          toast(t("errors.targetThreadUnavailable", { message: error.message }), "error");
        }
      });
      links.append(button);
    }
    body.append(links);
  }
  summary.addEventListener("click", () => {
    const open = block.classList.toggle("open");
    if (expansionKey) state.toolExpansion.set(expansionKey, open);
    summary.setAttribute("aria-expanded", String(open));
  });
  block.append(summary, body);
  return block;
}

const TOOL_ITEM_TYPES = new Set(["commandExecution", "fileChange", "mcpToolCall", "collabAgentToolCall", "collabToolCall", "subAgentActivity", "imageView", "plan"]);

function renderToolGroup(items, turnId) {
  const expansionKey = toolExpansionKey("group", turnId, items[0]?.id);
  const open = expansionKey ? state.toolExpansion.get(expansionKey) === true : false;
  const group = el("div", "tool-group");
  if (expansionKey) group.dataset.toolGroupKey = expansionKey;
  if (open) group.classList.add("open");
  const statusOf = normalizedItemStatus;
  const running = items.filter((item) => statusOf(item) === "inprogress").length;
  const failed = items.filter((item) => ["failed", "error"].includes(statusOf(item))).length;
  const declined = items.filter((item) => statusOf(item) === "declined").length;
  const interrupted = items.filter((item) => ["interrupted", "cancelled", "canceled"].includes(statusOf(item))).length;
  const done = items.length - running - failed - declined - interrupted;
  group.classList.add(running ? "tool-group-running" : failed || declined || interrupted ? "tool-group-error" : "tool-group-done");
  const summary = el("button", "tool-group-summary");
  summary.type = "button";
  summary.setAttribute("aria-expanded", String(open));
  const icon = el("span", "tool-group-icon");
  icon.innerHTML = "<i></i><i></i><i></i>";
  const counts = el("span", "tool-group-counts");
  if (done) counts.append(el("span", "tool-group-count done", t("timeline.successCount", { count: done })));
  if (failed) counts.append(el("span", "tool-group-count error", t("timeline.failedCount", { count: failed })));
  if (declined) counts.append(el("span", "tool-group-count declined", t("timeline.declinedCount", { count: declined })));
  if (interrupted) counts.append(el("span", "tool-group-count interrupted", t("timeline.interruptedCount", { count: interrupted })));
  if (running) counts.append(el("span", "tool-group-count running", t("timeline.runningCount", { count: running })));
  summary.append(
    el("span", "chevron", "▶"),
    icon,
    el("span", "tool-group-title", t("timeline.toolCalls", { count: items.length })),
    counts,
    el("span", "tool-group-types", [...new Set(items.map(itemLabel))].join(" / ")),
  );
  const content = el("div", "tool-group-content");
  for (const item of items) content.append(renderItem(item, turnId));
  summary.addEventListener("click", () => {
    const open = group.classList.toggle("open");
    if (expansionKey) state.toolExpansion.set(expansionKey, open);
    summary.setAttribute("aria-expanded", String(open));
  });
  group.append(summary, content);
  return group;
}

function userMessageSummary(item) {
  const text = String(item?.text || "").replace(/\s+/g, " ").trim();
  if (text) return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  if (item?.images?.length || item?.unavailableImages?.length) return t("timeline.imageMessage");
  return t("timeline.emptyMessage");
}

function loadedUserMessages() {
  const entries = [];
  for (const turnId of state.turnOrder) {
    const turn = state.turns.get(turnId);
    if (!turn) continue;
    for (const itemId of turn.itemOrder || []) {
      const item = turn.items.get(itemId);
      if (item?.type === "userMessage" && item.id) entries.push({ turnId, item });
    }
  }
  return entries;
}

function setConversationRailActive(itemId) {
  for (const marker of elements.conversationRailList.querySelectorAll(".conversation-rail-marker")) {
    const active = marker.dataset.itemId === itemId;
    marker.classList.toggle("active", active);
    if (active) marker.setAttribute("aria-current", "true");
    else marker.removeAttribute("aria-current");
  }
}

function currentConversationRailItemId() {
  const messages = [...elements.timeline.querySelectorAll(".msg.user[data-item-id]")];
  if (!messages.length) return null;
  const anchor = elements.timeline.getBoundingClientRect().top + 32;
  let current = messages[0];
  for (const message of messages) {
    if (message.getBoundingClientRect().top > anchor) break;
    current = message;
  }
  return current.dataset.itemId || null;
}

function syncConversationRailActive() {
  if (elements.conversationRail.hidden) return;
  setConversationRailActive(currentConversationRailItemId());
}

let conversationRailSignature = "";
function renderConversationRail() {
  const entries = loadedUserMessages().map(({ turnId, item }) => {
    const summary = userMessageSummary(item);
    return {
      turnId,
      item,
      summary,
      size: summary.length > 80 ? "long" : summary.length > 28 ? "medium" : "short",
    };
  });
  elements.conversationRail.hidden = !state.selectedThreadId || entries.length === 0;
  if (elements.conversationRail.hidden) {
    conversationRailSignature = "";
    elements.conversationRailList.replaceChildren();
    return;
  }

  const signature = JSON.stringify([
    state.selectedThreadId,
    entries.map(({ item, summary, size }) => [item.id, summary, size]),
  ]);
  if (signature === conversationRailSignature) return;

  conversationRailSignature = signature;
  const activeItemId = currentConversationRailItemId();
  const markers = entries.map(({ item, summary, size }, index) => {
    const marker = el("button", "conversation-rail-marker");
    marker.type = "button";
    marker.dataset.itemId = item.id;
    marker.dataset.size = size;
    marker.setAttribute("aria-label", t("timeline.jumpToUserMessage", { index: index + 1, summary }));
    if (item.id === activeItemId) {
      marker.classList.add("active");
      marker.setAttribute("aria-current", "true");
    }
    const preview = el("span", "conversation-rail-preview");
    preview.setAttribute("role", "tooltip");
    preview.append(
      el("strong", "", t("timeline.userMessage", { index: index + 1 })),
      el("span", "conversation-rail-preview-text", summary),
    );
    marker.append(preview);
    marker.addEventListener("click", () => {
      const target = elements.timeline.querySelector(`.msg.user[data-item-id="${CSS.escape(item.id)}"]`);
      if (!target) return;
      const top = target.getBoundingClientRect().top - elements.timeline.getBoundingClientRect().top + elements.timeline.scrollTop - 24;
      setConversationRailActive(item.id);
      elements.timeline.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    });
    return marker;
  });
  elements.conversationRailList.replaceChildren(...markers);
  syncConversationRailActive();
}

function turnErrorText(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || error.additionalDetails || error.code || pretty(error);
}

function renderTurnSection(turnId) {
  const turn = state.turns.get(turnId);
  if (!turn) return null;
  const section = el("section", "turn");
  section.dataset.turnId = turnId;
  const orderedItems = (turn.itemOrder || [])
    .map((itemId) => turn.items.get(itemId))
    .filter((item) => item && item.type !== "reasoning");
  for (let index = 0; index < orderedItems.length;) {
    if (!TOOL_ITEM_TYPES.has(orderedItems[index].type)) {
      section.append(renderItem(orderedItems[index++], turnId));
      continue;
    }
    const items = [];
    while (index < orderedItems.length && TOOL_ITEM_TYPES.has(orderedItems[index].type)) items.push(orderedItems[index++]);
    const message = el("div", "msg assistant tool_use");
    const inner = el("div", "msg-inner");
    const body = el("div", "msg-body");
    body.append(items.length === 1 ? renderItem(items[0], turnId) : renderToolGroup(items, turnId));
    inner.append(body);
    message.append(inner);
    section.append(message);
  }
  if (turn.itemsLoadError) {
    const itemFailure = el("div", "turn-error item-load-error");
    itemFailure.append(el("strong", "", t("timeline.partialContentNotLoaded")), el("pre", "", turn.itemsLoadError));
    const retry = el("button", "history-button", t("actions.retryLoad"));
    retry.type = "button";
    retry.addEventListener("click", () => void loadMoreItems(turnId));
    itemFailure.append(retry);
    section.append(itemFailure);
  } else if (turn.itemsNextCursor) {
    const moreItems = el("button", "chat-history-loader history-button", turn.loadingMoreItems ? t("status.loading") : t("actions.loadMoreTurnContent"));
    moreItems.type = "button";
    moreItems.disabled = Boolean(turn.loadingMoreItems);
    moreItems.addEventListener("click", () => void loadMoreItems(turnId));
    section.append(moreItems);
  }
  const errorText = turnErrorText(turn.error);
  if (errorText) {
    const failure = el("div", "turn-error");
    failure.append(el("strong", "", t("timeline.turnFailed")), el("pre", "", errorText));
    section.append(failure);
  }
  return section;
}

function timelineNearBottom() {
  return elements.timeline.scrollHeight - elements.timeline.scrollTop - elements.timeline.clientHeight < 160;
}

function timelineAnchor() {
  const viewportTop = elements.timeline.getBoundingClientRect().top;
  const turn = [...elements.timeline.querySelectorAll(":scope > .turn")]
    .find((node) => node.getBoundingClientRect().bottom > viewportTop);
  return turn ? { turnId: turn.dataset.turnId, offset: turn.getBoundingClientRect().top - viewportTop } : null;
}

function restoreTimelineAnchor(anchor) {
  if (!anchor) return;
  const turn = elements.timeline.querySelector(`:scope > .turn[data-turn-id="${CSS.escape(anchor.turnId)}"]`);
  if (!turn) return;
  const viewportTop = elements.timeline.getBoundingClientRect().top;
  elements.timeline.scrollTop += turn.getBoundingClientRect().top - viewportTop - anchor.offset;
}

function renderTurn(turnId, { follow = false, refreshRail = false } = {}) {
  if (!turnId || !state.turns.has(turnId)) return false;
  const anchor = follow ? null : timelineAnchor();
  const section = renderTurnSection(turnId);
  elements.timeline.querySelector(":scope > .empty-chat")?.remove();
  const current = elements.timeline.querySelector(`:scope > .turn[data-turn-id="${CSS.escape(turnId)}"]`);
  if (current) current.replaceWith(section);
  else {
    const index = state.turnOrder.indexOf(turnId);
    const next = state.turnOrder.slice(index + 1)
      .map((id) => elements.timeline.querySelector(`:scope > .turn[data-turn-id="${CSS.escape(id)}"]`))
      .find(Boolean);
    if (next) elements.timeline.insertBefore(section, next);
    else elements.timeline.append(section);
  }
  if (annotationState.items.length) applyAnnotationsToTurns([section]);
  if (refreshRail) renderConversationRail();
  if (follow) elements.timeline.scrollTop = elements.timeline.scrollHeight;
  else restoreTimelineAnchor(anchor);
  return true;
}

const pendingItemRenders = new Map();
let itemRenderFrame = null;
function renderTimelineItem(turnId, itemId, { follow = false } = {}) {
  const turn = state.turns.get(turnId);
  const item = turn?.items.get(itemId);
  if (!item) return renderTurn(turnId, { follow });
  const current = elements.timeline.querySelector(`[data-turn-id="${CSS.escape(turnId)}"] [data-item-id="${CSS.escape(itemId)}"]`);
  if (!current) return renderTurn(turnId, { follow });
  const anchor = follow ? null : timelineAnchor();
  const replacement = renderItem(item, turnId);
  current.className = replacement.className;
  current.replaceChildren(...replacement.childNodes);
  if (annotationState.items.length) {
    const section = elements.timeline.querySelector(`:scope > .turn[data-turn-id="${CSS.escape(turnId)}"]`);
    if (section) applyAnnotationsToTurns([section]);
  }
  if (follow) elements.timeline.scrollTop = elements.timeline.scrollHeight;
  else restoreTimelineAnchor(anchor);
  return true;
}

function scheduleItemRender(turnId, itemId, { follow = false } = {}) {
  if (!turnId || !itemId) return;
  const key = JSON.stringify([turnId, itemId]);
  const pending = pendingItemRenders.get(key) || { turnId, itemId, follow: false, selectionVersion: state.selectionVersion };
  pending.follow ||= follow;
  pending.selectionVersion = state.selectionVersion;
  pendingItemRenders.set(key, pending);
  if (itemRenderFrame) return;
  itemRenderFrame = requestAnimationFrame(() => {
    itemRenderFrame = null;
    const work = [...pendingItemRenders.values()];
    pendingItemRenders.clear();
    for (const options of work) {
      if (options.selectionVersion !== state.selectionVersion) continue;
      renderTimelineItem(options.turnId, options.itemId, options);
    }
  });
}

const pendingTurnRenders = new Map();
let turnRenderFrame = null;
function scheduleTurnRender(turnId, { follow = false, refreshRail = false } = {}) {
  if (!turnId) return;
  for (const [key, pendingItem] of pendingItemRenders) {
    if (pendingItem.turnId === turnId) pendingItemRenders.delete(key);
  }
  const pending = pendingTurnRenders.get(turnId) || { follow: false, refreshRail: false, selectionVersion: state.selectionVersion };
  pending.follow ||= follow;
  pending.refreshRail ||= refreshRail;
  pending.selectionVersion = state.selectionVersion;
  pendingTurnRenders.set(turnId, pending);
  if (turnRenderFrame) return;
  turnRenderFrame = requestAnimationFrame(() => {
    turnRenderFrame = null;
    const work = [...pendingTurnRenders];
    pendingTurnRenders.clear();
    for (const [pendingTurnId, options] of work) {
      if (options.selectionVersion !== state.selectionVersion) continue;
      renderTurn(pendingTurnId, options);
    }
  });
}

function renderTimeline(message) {
  if (itemRenderFrame) cancelAnimationFrame(itemRenderFrame);
  if (turnRenderFrame) cancelAnimationFrame(turnRenderFrame);
  itemRenderFrame = null;
  turnRenderFrame = null;
  pendingItemRenders.clear();
  pendingTurnRenders.clear();
  removeAnnotationBubble();
  closeAnnotationPopup();
  if (state.editingUserMessage && (
    state.editingUserMessage.threadId !== state.selectedThreadId
    || (!state.editingUserMessage.sending && !canEditHistoricalMessages())
  )) state.editingUserMessage = null;
  elements.timeline.replaceChildren();
  if (!state.selectedThreadId || message || state.loadError) {
    const empty = el("div", "empty-chat empty-state");
    empty.append(el("p", state.loadError ? "nav-message error" : "", state.loadError ? t("errors.sessionLoadFailed", { message: state.loadError }) : message || t("navigation.selectSessionForConversation")));
    elements.timeline.append(empty);
    renderConversationRail();
    return;
  }
  if (state.olderCursor) {
    const load = el("button", "chat-history-loader history-button", t("actions.loadMoreHistory"));
    load.type = "button";
    load.addEventListener("click", () => void loadOlderTurns());
    elements.timeline.append(load);
  }
  if (!state.turnOrder.length) {
    const empty = el("div", "empty-chat empty-state");
    empty.append(el("p", "", t("timeline.newSessionEmpty")));
    elements.timeline.append(empty);
    renderConversationRail();
    return;
  }
  for (const turnId of state.turnOrder) {
    const section = renderTurnSection(turnId);
    if (section) elements.timeline.append(section);
  }
  renderConversationRail();
  applyAllAnnotations();
}

  Object.assign(actions, {
    ensureTurn,
    mergeItem,
    reconcileItemOrder,
    installTurns,
    hydrateItems,
    refreshTurnItems,
    performTurnItemsRefresh,
    loadUserMessageForEditing,
    loadMoreItems,
    itemLabel,
    pretty,
    detectedAbsolutePaths,
    localPathLink,
    linkAbsolutePaths,
    renderMarkdown,
    toolText,
    toolValue,
    labeledToolOutput,
    normalizeToolOutput,
    truncateToolOutput,
    normalizedDisplayPath,
    toolCwdField,
    fileChangeTargets,
    toolDetailSections,
    renderToolFields,
    renderToolDetails,
    normalizedItemStatus,
    reconcilePendingTurn,
    showImagePreview,
    renderMessageImages,
    inlineMessageImages,
    cancelEditingUserMessage,
    beginEditingUserMessage,
    renderUserMessageEditor,
    toolExpansionKey,
    renderItem,
    renderToolGroup,
    userMessageSummary,
    loadedUserMessages,
    setConversationRailActive,
    currentConversationRailItemId,
    syncConversationRailActive,
    renderConversationRail,
    turnErrorText,
    renderTurnSection,
    timelineNearBottom,
    timelineAnchor,
    restoreTimelineAnchor,
    renderTurn,
    renderTimelineItem,
    scheduleItemRender,
    scheduleTurnRender,
    renderTimeline
  });
}
