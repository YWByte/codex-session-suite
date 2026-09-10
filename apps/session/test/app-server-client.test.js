import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AppServerClient, parseCodexVersion } from "../src/app-server/client.js";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-codex.js");

function config(overrides = {}) {
  return {
    codexBin: fixture,
    codexHome: "/tmp/fake-codex-home",
    expectedCodexVersion: "0.153.2",
    rpcTimeoutMs: 1_000,
    initializeTimeoutMs: 1_000,
    ...overrides,
  };
}

function waitFor(emitter, event, predicate = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, listener);
      reject(new Error(`timed out waiting for ${event}`));
    }, 1_000);
    const listener = (value) => {
      if (!predicate(value)) return;
      clearTimeout(timer);
      emitter.off(event, listener);
      resolve(value);
    };
    emitter.on(event, listener);
  });
}

test("parseCodexVersion accepts the CLI version output", () => {
  assert.equal(parseCodexVersion("codex-cli 0.153.2"), "0.153.2");
  assert.equal(parseCodexVersion("unknown"), null);
});

test("AppServerClient performs initialize handshake and routes all message kinds", async () => {
  const client = new AppServerClient(config());
  const initialized = waitFor(client, "notification", ({ method }) => method === "fixture/initialized");
  const serverRequest = waitFor(client, "serverRequest");
  const health = await client.start();
  assert.equal(health.ready, true);
  assert.equal(health.capabilities.experimentalApi, true);
  const initializedEvent = await initialized;
  assert.equal(initializedEvent.params.ok, true);
  assert.equal(initializedEvent.params.initializeParams.capabilities.experimentalApi, true);
  assert.deepEqual(initializedEvent.params.initializeParams.capabilities.extensions, { "openai/elicitation": { form: {} } });

  const listed = await client.request("thread/list", {});
  assert.equal(listed.data[0].id, "thread-1");

  const permissionEvents = [];
  client.on("permissionAudit", (event) => permissionEvents.push(event));
  await client.request("thread/resume", {
    threadId: "thread-1",
    excludeTurns: true,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  assert.deepEqual(permissionEvents.map(({ direction, method, threadId, approvalPolicy, sandbox }) => ({
    direction, method, threadId, approvalPolicy, sandbox,
  })), [
    { direction: "viewer-request", method: "thread/resume", threadId: "thread-1", approvalPolicy: "never", sandbox: "danger-full-access" },
    { direction: "app-server-response", method: "thread/resume", threadId: "thread-1", approvalPolicy: "never", sandbox: "dangerFullAccess" },
  ]);

  const request = await serverRequest;
  assert.equal(request.id, "server-request-1");
  const responded = waitFor(client, "notification", ({ method }) => method === "fixture/responded");
  client.respond(request.id, { decision: "decline" });
  assert.equal((await responded).params.decision, "decline");

  const hanging = client.request("fixture/hang", {}, 10_000);
  client.stop();
  await assert.rejects(hanging, (error) => error.code === "APP_SERVER_OFFLINE");
  assert.equal(client.state, "stopped");
});

test("AppServerClient restarts its managed app-server and accepts RPCs afterward", async () => {
  const client = new AppServerClient(config());
  await client.start();
  const states = [];
  client.on("state", (health) => states.push(health.state));

  const [first, second] = await Promise.all([client.restart(), client.restart()]);

  assert.equal(first.ready, true);
  assert.equal(second.ready, true);
  assert.deepEqual(states, ["stopped", "probing", "starting", "initializing", "ready"]);
  assert.equal((await client.request("thread/list", {})).data[0].id, "thread-1");
  client.stop();
});

test("AppServerClient refuses an incompatible Codex version without spawning app-server", async () => {
  const client = new AppServerClient(config({ expectedCodexVersion: "9.9.9" }));
  const health = await client.start();
  assert.equal(health.state, "incompatible");
  assert.equal(health.actualVersion, "0.153.2");
  assert.equal(health.ready, false);
  await assert.rejects(client.request("thread/list", {}), (error) => error.code === "CODEX_INCOMPATIBLE");
});
