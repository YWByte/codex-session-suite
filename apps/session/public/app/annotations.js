export function installAnnotations(context) {
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
  const el = (...args) => actions.el(...args);
  const api = (...args) => actions.api(...args);
  const toast = (...args) => actions.toast(...args);
  const sessionTitle = (...args) => actions.sessionTitle(...args);
  const isChildThread = (...args) => actions.isChildThread(...args);
  const updateComposer = (...args) => actions.updateComposer(...args);

function annStorageKey() {
  return state.selectedThreadId ? ANNOTATION_STORAGE_PREFIX + state.selectedThreadId : null;
}

function loadAnnotations() {
  const key = annStorageKey();
  try {
    annotationState.items = key ? storedArray(localStorage, key) : [];
  } catch {
    annotationState.items = [];
  }
  annotationState.sequence = annotationState.items.reduce((max, ann) => Math.max(max, Number(ann.id) || 0), 0);
}

function saveAnnotations() {
  const key = annStorageKey();
  if (key) localStorage.setItem(key, JSON.stringify(annotationState.items));
}

// Send numbered quote/note pairs before the composer text.
function annotationsPrefix() {
  if (!annotationState.items.length) return "";
  const sorted = [...annotationState.items].sort((a, b) => a.id - b.id);
  const lines = [];
  sorted.forEach((ann, index) => {
    lines.push(`${index + 1}. "${ann.quote}"`);
    lines.push("");
    for (const line of String(ann.note || "").split("\n")) lines.push(`   ${line}`);
    if (index < sorted.length - 1) lines.push("");
  });
  return `${lines.join("\n")}\n\n`;
}
function annotationContext() {
  // Sub-agent and archived views are read-only; collection is still available.
  const readonly = state.selectedArchived || isChildThread(state.selectedSession);
  return { readonly, enabled: Boolean(state.selectedThreadId) && !readonly };
}

function selectionMessage(selection) {
  const elementFor = (node) => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const start = elementFor(selection?.anchorNode)?.closest?.(".msg.user, .msg.assistant");
  const end = elementFor(selection?.focusNode)?.closest?.(".msg.user, .msg.assistant");
  if (!start || start !== end || start.classList.contains("tool_use") || !start.dataset.itemId) return null;
  return start;
}

function collectionSource(info, message) {
  const session = state.selectedSession || {};
  const source = {
    threadId: state.selectedThreadId,
    turnId: message.closest("[data-turn-id]")?.dataset.turnId,
    itemId: message.dataset.itemId,
    role: message.classList.contains("user") ? "user" : "assistant",
    sessionTitle: sessionTitle(session),
    viewerOrigin: window.location.origin,
    segments: info.segments,
  };
  if (session.cwd) source.projectPath = session.cwd;
  const projectName = state.projects.find((project) => project.id === session.projectId)?.name;
  if (projectName) source.projectName = projectName;
  return source;
}

async function collectApi(path, options = {}) {
  const init = { ...options, headers: { ...(options.headers || {}) }, mode: "cors" };
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  let response;
  try {
    response = await fetch(`${COLLECT_VIEWER_ORIGIN}${path}`, init);
  } catch {
    throw new Error(t("errors.collectUnavailable"));
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(t(`error.${payload?.error?.code || "collection_failed"}`, { status: response.status, message: payload?.error?.message }));
    error.code = payload?.error?.code || "collection_request_failed";
    throw error;
  }
  return payload;
}

async function saveCollection(info, message, note = "") {
  try {
    await collectApi("/api/collections", {
      method: "POST",
      body: { quote: info.quote, note, source: collectionSource(info, message) },
    });
    closeAnnotationPopup();
    toast(t("messages.collected"));
  } catch (error) {
    if (error.code === "duplicate_collection") {
      toast(t("messages.duplicateCollection"), "info");
    } else {
      toast(error.message, "error");
    }
  }
}

function openCollectionPopup(info, message, anchorRect) {
  removeAnnotationBubble();
  closeAnnotationPopup();
  window.getSelection().removeAllRanges();
  const popup = el("div", "ann-popup collection-popup");
  const quote = el("div", "ann-quote", info.quote);
  const textarea = el("textarea");
  textarea.placeholder = t("annotations.collectionNotePlaceholder");
  const actions = el("div", "ann-actions");
  const direct = el("button", "", t("actions.collectDirectly"));
  direct.type = "button";
  const save = el("button", "primary", t("actions.collectWithNote"));
  save.type = "button";
  save.disabled = true;
  textarea.addEventListener("input", () => { save.disabled = !textarea.value.trim(); });
  direct.addEventListener("click", () => void saveCollection(info, message));
  save.addEventListener("click", () => void saveCollection(info, message, textarea.value.trim()));
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAnnotationPopup();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !save.disabled) {
      event.preventDefault();
      save.click();
    }
  });
  actions.append(direct, save);
  popup.append(quote, textarea, actions);
  elements.timeline.append(popup);
  positionAnnotationPopup(popup, anchorRect);
  annotationState.popup = popup;
  textarea.focus();
}

function annotationBlockPath(block) {
  const turnEl = block.closest("[data-turn-id]");
  const turnId = turnEl?.dataset.turnId || "";
  const root = turnEl || elements.timeline;
  const path = [];
  let current = block;
  while (current && current !== root) {
    const parent = current.parentNode;
    if (!parent) break;
    const siblings = [...parent.children].filter((child) => child.tagName === current.tagName);
    path.unshift(`${current.tagName.toLowerCase()}:${siblings.indexOf(current)}`);
    current = parent;
  }
  const relative = path.join("/");
  return turnId ? `@${turnId}/${relative}` : relative;
}

function findAnnotationBlock(path) {
  if (!path) return null;
  let root = elements.timeline;
  let relative = path;
  if (path.startsWith("@")) {
    const slash = path.indexOf("/");
    const turnId = slash === -1 ? path.slice(1) : path.slice(1, slash);
    relative = slash === -1 ? "" : path.slice(slash + 1);
    root = elements.timeline.querySelector(`[data-turn-id="${CSS.escape(turnId)}"]`);
    if (!root) return null;
  }
  if (!relative) return null;
  let current = root;
  for (const part of relative.split("/")) {
    const [tag, index] = part.split(":");
    const siblings = [...current.children].filter((child) => child.tagName.toLowerCase() === tag);
    current = siblings[Number(index)];
    if (!current) return null;
  }
  return current;
}

function annotationOffsetIn(block, node, offset) {
  // The container is the block itself: offset zero is its start, other offsets are treated as its end.
  if (node === block) return offset === 0 ? 0 : block.textContent.length;
  let cumulative = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let current;
  while ((current = walker.nextNode())) {
    if (current === node) return cumulative + offset;
    cumulative += current.nodeValue.length;
  }
  return null;
}

function annotationTextNodeAt(block, target, isEnd = false) {
  let cumulative = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let current;
  while ((current = walker.nextNode())) {
    const length = current.nodeValue.length;
    if (isEnd ? cumulative + length >= target : cumulative + length > target) {
      return { node: current, offset: target - cumulative };
    }
    cumulative += length;
  }
  if (isEnd) {
    const lastWalker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let last = null;
    while ((current = lastWalker.nextNode())) last = current;
    if (last) return { node: last, offset: last.nodeValue.length };
  }
  return null;
}

// Locate selections across blocks, recording blockPath/start/end for each segment.
function annotationRangeInfo(selection) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const segments = [];
  for (const block of elements.timeline.querySelectorAll(ANNOTATION_BLOCK_SELECTOR)) {
    if (!range.intersectsNode(block)) continue;
    let startContainer = range.startContainer;
    let startOffset = range.startOffset;
    let endContainer = range.endContainer;
    let endOffset = range.endOffset;

    if (startContainer.tagName === "UL" || startContainer.tagName === "OL") {
      const li = startContainer.children[Math.min(startOffset, startContainer.children.length - 1)];
      if (li) {
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
        startContainer = walker.nextNode() || li;
        startOffset = 0;
      }
    }
    if (endContainer.tagName === "UL" || endContainer.tagName === "OL") {
      const index = Math.max(0, Math.min(endOffset - 1, endContainer.children.length - 1));
      const li = endContainer.children[index];
      if (li) {
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
        let last = null;
        let current;
        while ((current = walker.nextNode())) last = current;
        if (last) {
          endContainer = last;
          endOffset = last.nodeValue.length;
        } else {
          endContainer = li;
          endOffset = li.childNodes.length;
        }
      }
    }

    let start = 0;
    let end = block.textContent.length;
    const startInside = block.contains(startContainer) || block === startContainer;
    const endInside = block.contains(endContainer) || block === endContainer;
    if (startInside && endInside) {
      start = annotationOffsetIn(block, startContainer, startOffset);
      end = annotationOffsetIn(block, endContainer, endOffset);
    } else if (startInside) {
      start = annotationOffsetIn(block, startContainer, startOffset);
      end = block.textContent.length;
    } else if (endInside) {
      start = 0;
      end = annotationOffsetIn(block, endContainer, endOffset);
    } else {
      const blockRange = document.createRange();
      blockRange.selectNodeContents(block);
      if (!(blockRange.compareBoundaryPoints(Range.START_TO_START, range) >= 0
        && blockRange.compareBoundaryPoints(Range.END_TO_END, range) <= 0)) continue;
    }
    if (start == null || end == null || start >= end) continue;
    segments.push({ blockPath: annotationBlockPath(block), start, end });
  }
  if (!segments.length) return null;
  return { quote: selection.toString(), segments };
}

function applyAnnotationToBlock(block) {
  const blockPath = annotationBlockPath(block);
  const textLength = block.textContent.length;
  const pending = [];
  for (const ann of annotationState.items) {
    for (const seg of ann.segments || []) {
      if (seg.blockPath === blockPath) pending.push({ ann, seg });
    }
  }
  if (!pending.length) return;
  pending.sort((left, right) => right.seg.start - left.seg.start);
  for (const { ann, seg } of pending) {
    if (seg.end > textLength) continue;
    try {
      const startNode = annotationTextNodeAt(block, seg.start);
      const endNode = annotationTextNodeAt(block, seg.end, true);
      if (!startNode || !endNode) continue;
      const range = document.createRange();
      range.setStart(startNode.node, startNode.offset);
      range.setEnd(endNode.node, endNode.offset);
      const fragment = range.extractContents();
      const mark = el("mark", "ann-mark");
      mark.dataset.annId = String(ann.id);
      mark.append(fragment);
      range.insertNode(mark);
      if (seg === (ann.segments || [])[0]) {
        const badge = el("span", "ann-badge", circledNumber(ann.id));
        badge.dataset.annId = String(ann.id);
        badge.addEventListener("click", (event) => {
          event.stopPropagation();
          openAnnotationPopupForView(ann, mark);
        });
        mark.after(badge);
      }
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        openAnnotationPopupForView(ann, mark);
      });
    } catch { /* The block changed; skip segments that can no longer be wrapped. */ }
  }
}

function circledNumber(n) {
  const map = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
  return map[n - 1] || `(${n})`;
}

function unwrapAnnotationMarks(root = elements.timeline) {
  for (const badge of root.querySelectorAll(".ann-badge")) badge.remove();
  for (const mark of root.querySelectorAll("mark.ann-mark")) {
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function applyAllAnnotations() {
  unwrapAnnotationMarks();
  for (const block of elements.timeline.querySelectorAll(ANNOTATION_BLOCK_SELECTOR)) applyAnnotationToBlock(block);
  renderAnnotationList();
}

function applyAnnotationsToTurns(turnElements) {
  for (const turn of turnElements) {
    if (!turn) continue;
    unwrapAnnotationMarks(turn);
    for (const block of turn.querySelectorAll(ANNOTATION_BLOCK_SELECTOR)) applyAnnotationToBlock(block);
  }
  renderAnnotationList();
}

function removeAnnotationBubble() {
  if (annotationState.bubble) {
    annotationState.bubble.remove();
    annotationState.bubble = null;
  }
}

function handleAnnotationSelection() {
  removeAnnotationBubble();
  if (!state.selectedThreadId) return;
  const selection = window.getSelection();
  const message = selectionMessage(selection);
  if (!message) return;
  const info = annotationRangeInfo(selection);
  if (!info?.quote?.trim()) return;
  const selectionInsideAnnotation = Boolean(selection.anchorNode?.parentElement?.closest(".ann-mark"));
  const canAnnotate = annotationContext().enabled && !selectionInsideAnnotation;
  const canCollect = !message.matches(".optimistic, .failed, .uncertain");
  if (!canAnnotate && !canCollect) return;
  const range = selection.getRangeAt(0);
  const rects = range.getClientRects();
  if (!rects.length) return;
  const firstRect = rects[0];
  const timelineRect = elements.timeline.getBoundingClientRect();
  const bubble = el("div", "ann-bubble selection-actions");
  bubble.style.left = `${firstRect.left - timelineRect.left + elements.timeline.scrollLeft - 62}px`;
  bubble.style.top = `${firstRect.top - timelineRect.top + elements.timeline.scrollTop - 14}px`;
  if (canAnnotate) {
    const annotate = el("button", "selection-action", "✎");
    annotate.type = "button";
    annotate.title = t("actions.annotateSelection");
    annotate.setAttribute("aria-label", t("actions.annotateSelection"));
    annotate.addEventListener("click", (event) => {
      event.stopPropagation();
      openAnnotationPopupForCreate(info, firstRect);
    });
    bubble.append(annotate);
  }
  if (canCollect) {
    const collect = el("button", "selection-action collect-action", "☆");
    collect.type = "button";
    collect.title = t("actions.collectSelection");
    collect.setAttribute("aria-label", t("actions.collectSelection"));
    collect.addEventListener("click", (event) => {
      event.stopPropagation();
      openCollectionPopup(info, message, firstRect);
    });
    bubble.append(collect);
  }
  bubble.addEventListener("pointerdown", (event) => event.stopPropagation());
  elements.timeline.append(bubble);
  annotationState.bubble = bubble;
}

function positionAnnotationPopup(popup, rect) {
  if (!rect) {
    popup.style.left = "50%";
    popup.style.top = "100px";
    popup.style.transform = "translateX(-50%)";
    return;
  }
  const timelineRect = elements.timeline.getBoundingClientRect();
  let left = rect.left - timelineRect.left + elements.timeline.scrollLeft;
  let top = rect.bottom - timelineRect.top + elements.timeline.scrollTop + 6;
  const width = popup.offsetWidth || 280;
  const height = popup.offsetHeight || 160;
  const viewWidth = elements.timeline.clientWidth;
  const viewHeight = elements.timeline.clientHeight;
  if (left + width > elements.timeline.scrollLeft + viewWidth - 8) {
    left = Math.max(elements.timeline.scrollLeft + 8, elements.timeline.scrollLeft + viewWidth - width - 8);
  }
  if (top + height > elements.timeline.scrollTop + viewHeight - 8) {
    top = rect.top - timelineRect.top + elements.timeline.scrollTop - height - 6;
  }
  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;
}

function closeAnnotationPopup() {
  if (annotationState.popup) {
    annotationState.popup.remove();
    annotationState.popup = null;
  }
}

function openAnnotationPopupForCreate(info, anchorRect) {
  removeAnnotationBubble();
  closeAnnotationPopup();
  window.getSelection().removeAllRanges();
  const popup = el("div", "ann-popup");
  const quote = el("div", "ann-quote");
  quote.textContent = info.quote;
  const textarea = el("textarea");
  textarea.placeholder = t("annotations.notePlaceholder");
  const actions = el("div", "ann-actions");
  const approve = el("button", "approve", "✓");
  approve.type = "button";
  approve.title = t("actions.approve");
  const save = el("button", "primary", t("actions.save"));
  save.type = "button";
  actions.append(approve, save);
  popup.append(quote, textarea, actions);
  elements.timeline.append(popup);
  positionAnnotationPopup(popup, anchorRect);
  annotationState.popup = popup;
  textarea.focus();
  const saveWith = (note) => {
    annotationState.sequence++;
    annotationState.items.push({ id: annotationState.sequence, quote: info.quote, note, segments: info.segments });
    saveAnnotations();
    closeAnnotationPopup();
    applyAllAnnotations();
    updateComposer();
  };
  approve.addEventListener("click", () => saveWith(t("actions.approve")));
  save.addEventListener("click", () => {
    const note = textarea.value.trim();
    if (!note) {
      closeAnnotationPopup();
      return;
    }
    saveWith(note);
  });
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save.click();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAnnotationPopup();
    }
  });
}

function openAnnotationPopupForView(ann, anchorEl) {
  closeAnnotationPopup();
  const popup = el("div", "ann-popup");
  const quote = el("div", "ann-quote");
  quote.textContent = ann.quote;
  const textarea = el("textarea");
  textarea.value = ann.note;
  const meta = el("div", "ann-meta", t("annotations.meta", { id: ann.id }));
  const actions = el("div", "ann-actions");
  const approve = el("button", "approve", "✓");
  approve.type = "button";
  approve.title = t("actions.approve");
  const del = el("button", "danger", t("actions.delete"));
  del.type = "button";
  const save = el("button", "primary", t("actions.save"));
  save.type = "button";
  actions.append(approve, del, save);
  popup.append(quote, textarea, meta, actions);
  elements.timeline.append(popup);
  positionAnnotationPopup(popup, anchorEl?.getBoundingClientRect());
  annotationState.popup = popup;
  textarea.focus();
  textarea.select();
  approve.addEventListener("click", () => {
    const index = annotationState.items.findIndex((entry) => entry.id === ann.id);
    if (index >= 0) {
      annotationState.items[index].note = t("actions.approve");
      saveAnnotations();
      applyAllAnnotations();
      updateComposer();
    }
    closeAnnotationPopup();
  });
  save.addEventListener("click", () => {
    const note = textarea.value.trim();
    const index = annotationState.items.findIndex((entry) => entry.id === ann.id);
    if (index >= 0) {
      if (note) annotationState.items[index].note = note;
      else annotationState.items.splice(index, 1);
      saveAnnotations();
      applyAllAnnotations();
      updateComposer();
    }
    closeAnnotationPopup();
  });
  del.addEventListener("click", () => {
    const index = annotationState.items.findIndex((entry) => entry.id === ann.id);
    if (index >= 0) {
      annotationState.items.splice(index, 1);
      saveAnnotations();
      applyAllAnnotations();
      updateComposer();
    }
    closeAnnotationPopup();
  });
}

function renderAnnotationList() {
  if (!elements.annotationList) return;
  const sorted = [...annotationState.items].sort((a, b) => a.id - b.id);
  elements.annotationList.hidden = sorted.length === 0;
  elements.annotationTitle.textContent = t("annotations.title", { count: sorted.length });
  elements.annotationBody.replaceChildren();
  for (const [index, ann] of sorted.entries()) {
    const item = el("div", "ann-item");
    const quote = el("div", "ann-item-quote");
    quote.textContent = ann.quote;
    const note = el("div", "ann-item-note");
    const num = el("span", "ann-item-num", String(index + 1));
    note.append(num, document.createTextNode(String(ann.note || "")));
    item.append(quote, note);
    elements.annotationBody.append(item);
  }
}

function clearAnnotations() {
  annotationState.items = [];
  saveAnnotations();
  applyAllAnnotations();
  updateComposer();
}

  Object.assign(actions, {
    annStorageKey,
    loadAnnotations,
    saveAnnotations,
    annotationsPrefix,
    annotationContext,
    selectionMessage,
    collectionSource,
    collectApi,
    saveCollection,
    openCollectionPopup,
    annotationBlockPath,
    findAnnotationBlock,
    annotationOffsetIn,
    annotationTextNodeAt,
    annotationRangeInfo,
    applyAnnotationToBlock,
    circledNumber,
    unwrapAnnotationMarks,
    applyAllAnnotations,
    applyAnnotationsToTurns,
    removeAnnotationBubble,
    handleAnnotationSelection,
    positionAnnotationPopup,
    closeAnnotationPopup,
    openAnnotationPopupForCreate,
    openAnnotationPopupForView,
    renderAnnotationList,
    clearAnnotations
  });
}
