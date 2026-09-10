const TRUTH_ICON = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="22" fill="#1B1B18"/><circle cx="32" cy="32" r="6" fill="#FFFFFF"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const EDIT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>';
const ARCHIVE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16v13H4zM3 3h18v4H3zM9 11h6"/></svg>';
const DELETE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v6M14 10v6"/></svg>';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 6 12 12M18 6 6 18"/></svg>';
const UNREAD_STORAGE_KEY = "codex-session.unreadThreads";
const RESENT_MESSAGES_STORAGE_KEY = "codex-session.resentMessages";
const RESTART_STATE_KEY = "codex-session.restartState";
const ANNOTATION_STORAGE_PREFIX = "codex-session.annotations:";
const VIEWER_ORIGINS = globalThis.__CODEX_SUITE_CONFIG__?.viewerOrigins || {};
const ARCH_VIEWER_ORIGIN = VIEWER_ORIGINS.arch || `${window.location.protocol}//${window.location.hostname}:3459`;
const PLAN_VIEWER_ORIGIN = VIEWER_ORIGINS.plan || `${window.location.protocol}//${window.location.hostname}:3458`;
const COLLECT_VIEWER_ORIGIN = VIEWER_ORIGINS.collect || `${window.location.protocol}//${window.location.hostname}:3461`;
const ANNOTATION_BLOCK_SELECTOR = ".msg-body p, .msg-body li, .msg-body td, .msg-body th, .msg-body h1, .msg-body h2, .msg-body h3, .msg-body h4, .msg-body blockquote, .msg-body pre, .msg.user .msg-body:not(:has(p, li, td, th, h1, h2, h3, h4, blockquote, pre))";
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_IMAGE_COUNT = 4;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 16 * 1024 * 1024;
const TOOL_OUTPUT_HEAD_LIMIT = 1500;
const TOOL_OUTPUT_TAIL_LIMIT = 1000;
const TOOL_TRUNCATION_NOTICE = "\n\n… [middle of tool output truncated; kept the first 1500 and last 1000 characters] …\n\n";
const REASONING_EFFORTS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
];
const TERMINAL_TURN_STATUSES = new Set(["completed", "failed", "interrupted", "declined", "cancelled", "canceled"]);

export {
  TRUTH_ICON,
  COPY_ICON,
  EDIT_ICON,
  ARCHIVE_ICON,
  DELETE_ICON,
  CLOSE_ICON,
  UNREAD_STORAGE_KEY,
  RESENT_MESSAGES_STORAGE_KEY,
  RESTART_STATE_KEY,
  ANNOTATION_STORAGE_PREFIX,
  ARCH_VIEWER_ORIGIN,
  PLAN_VIEWER_ORIGIN,
  COLLECT_VIEWER_ORIGIN,
  ANNOTATION_BLOCK_SELECTOR,
  IMAGE_TYPES,
  MAX_IMAGE_COUNT,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_IMAGE_BYTES,
  TOOL_OUTPUT_HEAD_LIMIT,
  TOOL_OUTPUT_TAIL_LIMIT,
  TOOL_TRUNCATION_NOTICE,
  REASONING_EFFORTS,
  TERMINAL_TURN_STATUSES
};
