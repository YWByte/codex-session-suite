const LOADED_SESSION_STATUSES = new Set(["active", "idle"]);

export function normalizeSessionStatus(status) {
  const value = typeof status === "object" && status !== null
    ? status.type
    : status;
  return String(value || "unknown").toLowerCase();
}

export function isLoadedSessionStatus(status) {
  return LOADED_SESSION_STATUSES.has(normalizeSessionStatus(status));
}
