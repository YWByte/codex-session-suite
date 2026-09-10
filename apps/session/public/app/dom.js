export function installDom(context) {
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

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function bindImmediateMouseAction(button, action) {
  let pointerActionAt = -Infinity;
  button.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    pointerActionAt = performance.now();
    action(event);
  });
  button.addEventListener("click", (event) => {
    if (event.detail > 0 && performance.now() - pointerActionAt < 1_000) return;
    action(event);
  });
}

function listFrom(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.[key])) return payload[key];
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}
function toast(message, kind = "info") {
  const node = el("div", `toast ${kind}`, message);
  elements.toastRegion.append(node);
  setTimeout(() => node.remove(), 4_500);
}

function statusName(status) {
  const normalized = normalizeSessionStatus(status);
  const labels = {
    active: t("status.running"),
    idle: t("status.idle"),
    notloaded: t("status.notLoaded"),
    not_loaded: t("status.notLoaded"),
    inprogress: t("status.running"),
    completed: t("status.completed"),
    interrupted: t("status.interrupted"),
    failed: t("status.failed"),
    systemerror: t("status.systemError"),
    declined: t("status.declined"),
    cancelled: t("status.cancelled"),
    canceled: t("status.cancelled"),
    offline: t("status.offline"),
    stopped: t("status.stopped"),
    incompatible: t("status.incompatible"),
  };
  return labels[normalized] || status || t("common.unknown");
}

function statusClass(status) {
  return normalizeSessionStatus(status).replace(/[^a-z0-9_-]/gi, "");
}

  Object.assign(actions, {
    el,
    bindImmediateMouseAction,
    listFrom,
    toast,
    statusName,
    statusClass
  });
}
