import assert from "node:assert/strict";
import test from "node:test";
import { installRuntime } from "../public/app/runtime.js";
import { storedArray, storedObject } from "../public/app/storage.js";
import { normalizeSessionStatus } from "../public/session-status.js";

function storage(value) {
  return { getItem: () => value };
}

test("browser storage helpers tolerate missing, malformed, and mismatched values", () => {
  assert.deepEqual(storedArray(storage(null), "key"), []);
  assert.deepEqual(storedArray(storage("not-json"), "key"), []);
  assert.deepEqual(storedArray(storage('{"value":1}'), "key"), []);
  assert.deepEqual(storedArray(storage('["thread-a"]'), "key"), ["thread-a"]);

  assert.deepEqual(storedObject(storage(null), "key"), {});
  assert.deepEqual(storedObject(storage("not-json"), "key"), {});
  assert.deepEqual(storedObject(storage("[]"), "key"), {});
  assert.deepEqual(storedObject(storage('{"thread-a":12}'), "key"), { "thread-a": 12 });
});

test("runtime module owns thread activity and visual-state decisions", () => {
  const state = {
    health: { appServer: { ready: true } },
    connectionState: "ready",
    connectionGeneration: 1,
    runtime: new Map(),
    pendingRequests: new Map(),
    sessions: new Map(),
    restartPending: false,
  };
  const actions = {};
  installRuntime({
    state,
    actions,
    unreadThreadIds: new Set(),
    resentMessageKeys: new Set(),
    normalizeSessionStatus,
    TERMINAL_TURN_STATUSES: new Set(["completed", "failed", "interrupted", "declined", "cancelled", "canceled"]),
    t: (key) => ({ running: "Running", waitingForApproval: "Waiting for approval" })[key.split(".").at(-1)] ?? key,
  });

  const session = { id: "thread-a", status: "active", activeFlags: [] };
  state.sessions.set(session.id, session);
  const runtime = actions.syncRuntimeFromSession(session);
  assert.equal(runtime.syncState, "unknown");
  assert.equal(actions.isThreadActive(session, runtime), false);

  runtime.syncState = "authoritative";
  runtime.activeTurnId = "turn-a";
  assert.equal(actions.isThreadActive(session, runtime), true);
  assert.deepEqual(actions.threadVisualState(session, runtime), { kind: "busy", label: "Running" });

  runtime.activeTurnId = null;
  runtime.protocolFlags.add("approval");
  assert.deepEqual(actions.threadVisualState(session, runtime), { kind: "busy", label: "Waiting for approval" });
});

test("document viewer actions open fixed local viewer ports in new tabs", async () => {
  const opened = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    open(url, target, features) {
      opened.push({ url, target, features });
    },
  };
  try {
    const actions = {};
    const { installViewers } = await import("../public/app/viewers.js");
    installViewers({
      actions,
      ARCH_VIEWER_ORIGIN: "http://127.0.0.1:3459",
      PLAN_VIEWER_ORIGIN: "http://127.0.0.1:3458",
    });
    actions.openArchViewer();
    actions.openPlanViewer();
    assert.deepEqual(opened, [
      { url: "http://127.0.0.1:3459", target: "_blank", features: "noopener" },
      { url: "http://127.0.0.1:3458", target: "_blank", features: "noopener" },
    ]);
  } finally {
    globalThis.window = previousWindow;
  }
});
