import test from "node:test";
import assert from "node:assert/strict";
import {
  isLoadedSessionStatus,
  normalizeSessionStatus,
} from "../public/session-status.js";

test("normalizes Codex thread status values", () => {
  assert.equal(normalizeSessionStatus("active"), "active");
  assert.equal(normalizeSessionStatus("notLoaded"), "notloaded");
  assert.equal(normalizeSessionStatus({ type: "idle" }), "idle");
  assert.equal(normalizeSessionStatus({ type: "active", activeFlags: [] }), "active");
  assert.equal(normalizeSessionStatus(null), "unknown");
});

test("recognizes active and idle threads as loaded sessions", () => {
  assert.equal(isLoadedSessionStatus("active"), true);
  assert.equal(isLoadedSessionStatus("idle"), true);
  assert.equal(isLoadedSessionStatus({ type: "active", activeFlags: [] }), true);
  assert.equal(isLoadedSessionStatus({ type: "idle" }), true);
  assert.equal(isLoadedSessionStatus("notLoaded"), false);
  assert.equal(isLoadedSessionStatus({ type: "notLoaded" }), false);
  assert.equal(isLoadedSessionStatus("systemError"), false);
});
