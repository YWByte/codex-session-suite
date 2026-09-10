import assert from "node:assert/strict";
import test from "node:test";
import { EventBus } from "../src/http/event-bus.js";
import { AppError } from "../src/errors.js";
import { NavigationService } from "../src/services/navigation.js";
import { RequestRegistry } from "../src/services/request-registry.js";
import { SessionService } from "../src/services/session-service.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createNavigation() {
  const navigation = new NavigationService({ request: async () => ({ data: [] }) }, { maxThreadPages: 2 });
  const seed = navigation.upsert({ id: "thread_seed", cwd: "/workspace/project", name: "Seed", model: "test-model", canAcceptDirectInput: true });
  return { navigation, projectId: seed.projectId };
}

test("SessionService keeps a requested name local until the new thread is materialized", async () => {
  const { navigation, projectId } = createNavigation();
  const calls = [];
  const client = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: "thread_new" } };
      if (method === "thread/read") return { thread: { id: "thread_new", cwd: "/workspace/project", name: null } };
      throw new Error(`unexpected method ${method}`);
    },
  };
  const sessions = new SessionService(client, navigation);

  const result = await sessions.create(projectId, "Requested name");

  assert.deepEqual(calls.map(({ method }) => method), ["thread/start", "thread/read"]);
  assert.equal(result.session.id, "thread_new");
  assert.equal(result.session.name, "Requested name");
  assert.equal(result.warning, null);
  assert.equal(navigation.getThread("thread_new").cwd, "/workspace/project");
});

test("NavigationService preserves a new thread's requested name across updates and refreshes", async () => {
  const remote = { id: "thread_new", cwd: "/workspace/project", name: "未命名的会话", status: "idle", canAcceptDirectInput: true };
  const navigation = new NavigationService({ request: async () => ({ data: [remote], nextCursor: null }) }, { maxThreadPages: 2 });

  navigation.preserveThread(remote.id, { name: "Requested name" });
  assert.equal(navigation.upsert(remote).name, "Requested name");
  await navigation.refresh();
  assert.equal(navigation.getThread(remote.id).name, "Requested name");

  navigation.releasePreservedThread(remote.id);
  await navigation.refresh();
  assert.equal(navigation.getThread(remote.id).name, "未命名的会话");

  navigation.preserveThread("thread_automatic");
  assert.equal(navigation.upsert({ ...remote, id: "thread_automatic", name: "Automatic name" }).name, "Automatic name");
});

test("SessionService hydrates historical token usage without resuming the thread", async () => {
  const { navigation } = createNavigation();
  const calls = [];
  const tokenUsage = {
    last: { inputTokens: 8_507, outputTokens: 139, totalTokens: 8_646 },
    total: { inputTokens: 14_421, outputTokens: 234, totalTokens: 14_655 },
    modelContextWindow: null,
  };
  const sessions = new SessionService({
    async request(method, params) {
      calls.push({ method, params });
      return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "notLoaded" } };
    },
  }, navigation, {
    tokenUsageReader: {
      async readLatest(threadId, options) {
        assert.equal(threadId, "thread_seed");
        assert.deepEqual(options, { archived: false });
        return tokenUsage;
      },
    },
  });

  const session = await sessions.read("thread_seed");
  assert.deepEqual(session.tokenUsage, tokenUsage);
  assert.deepEqual(calls.map(({ method }) => method), ["thread/read"]);
  assert.equal(calls.some(({ method }) => method === "thread/resume"), false);
});

test("SessionService creates a thread for a new normalized workspace without a pre-existing project", async () => {
  const { navigation } = createNavigation();
  const calls = [];
  const sessions = new SessionService({
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: { id: "thread-folder", cwd: params.cwd, model: "test-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "thread/read") return { thread: { id: "thread-folder", cwd: "/workspace/new", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "thread/list") return { data: [], nextCursor: null };
      if (method === "turn/start") return { turn: { id: "turn-folder", status: "inProgress" } };
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  const result = await sessions.createForCwd("/workspace/new/../new");

  assert.deepEqual(calls.map(({ method }) => method), ["thread/start", "thread/read"]);
  assert.deepEqual(calls[0].params, {
    cwd: "/workspace/new",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
  assert.equal(result.session.cwd, "/workspace/new");
  assert.equal(navigation.projects().some((project) => project.cwd === "/workspace/new"), true);

  await navigation.refresh();
  assert.equal(navigation.getThread("thread-folder")?.id, "thread-folder", "refresh must preserve an unmaterialized thread");
  const turn = await sessions.startTurn("thread-folder", { text: "first message" });
  assert.equal(turn.turn.id, "turn-folder");
  sessions.completeActiveTurn("thread-folder", "turn-folder");
  await navigation.refresh();
  assert.equal(navigation.getThread("thread-folder"), null, "materialized threads must return to authoritative listing behavior");
});

test("SessionService sends the first turn of a new thread without resuming an unmaterialized rollout", async () => {
  const { navigation, projectId } = createNavigation();
  const calls = [];
  const created = { id: "thread_new", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true };
  const sessions = new SessionService({
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/start") return { thread: created };
      if (method === "thread/read") return { thread: created };
      if (method === "turn/start") return { turn: { id: "turn_new", status: "inProgress" } };
      if (method === "thread/name/set") return {};
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  const { session } = await sessions.create(projectId, "Fresh name");
  await sessions.startTurn(session.id, { text: "First message" });
  assert.equal(navigation.getThread(session.id).name, "Fresh name");
  sessions.completeActiveTurn(session.id, "turn_new");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(navigation.getThread(session.id).name, "Fresh name");
  assert.deepEqual(calls.map(({ method }) => method), ["thread/start", "thread/read", "thread/read", "turn/start", "thread/name/set"]);
  assert.equal(calls.some(({ method }) => method === "thread/resume"), false);
});

test("SessionService validates a requested name before creating a remote thread", async () => {
  const { navigation, projectId } = createNavigation();
  let calls = 0;
  const client = { request: async () => { calls += 1; return { thread: { id: "unexpected" } }; } };
  const sessions = new SessionService(client, navigation);

  await assert.rejects(
    sessions.create(projectId, "x".repeat(201)),
    (error) => error instanceof AppError && error.code === "invalid_name"
  );
  assert.equal(calls, 0, "invalid input must not create an orphaned remote thread");
});

test("SessionService reconciles an unknown thread creation outcome before retrying", async () => {
  const createdAt = Math.floor(Date.now() / 1_000);
  const navigationClient = {
    request: async () => ({ data: [{ id: "thread_seed", cwd: "/workspace/project" }, { id: "thread_recovered", cwd: "/workspace/project", createdAt }] }),
  };
  const navigation = new NavigationService(navigationClient, { maxThreadPages: 2 });
  const seed = navigation.upsert({ id: "thread_seed", cwd: "/workspace/project" });
  let starts = 0;
  const sessions = new SessionService({
    async request(method) {
      if (method === "thread/start") {
        starts += 1;
        throw Object.assign(new Error("timed out"), { code: "RPC_TIMEOUT" });
      }
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  await assert.rejects(sessions.create(seed.projectId, "Recovered"), (error) => error.code === "RPC_TIMEOUT");
  const recovered = await sessions.create(seed.projectId, "Recovered");
  assert.equal(recovered.session.id, "thread_recovered");
  assert.match(recovered.warning, /未重复创建/);
  assert.equal(starts, 1);
});

test("SessionService remains fail-closed while a thread creation outcome is unknown", async () => {
  const navigationClient = {
    request: async () => ({ data: [{ id: "thread_seed", cwd: "/workspace/project" }] }),
  };
  const navigation = new NavigationService(navigationClient, { maxThreadPages: 2 });
  const seed = navigation.upsert({ id: "thread_seed", cwd: "/workspace/project" });
  let starts = 0;
  const sessions = new SessionService({
    async request(method) {
      if (method === "thread/start") {
        starts += 1;
        throw Object.assign(new Error("offline"), { code: "APP_SERVER_OFFLINE" });
      }
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  await assert.rejects(sessions.create(seed.projectId), (error) => error.code === "APP_SERVER_OFFLINE");
  await assert.rejects(
    sessions.create(seed.projectId),
    (error) => error instanceof AppError && error.code === "write_outcome_unknown"
  );
  assert.equal(starts, 1);
});

test("SessionService blocks a duplicate turn after reconciling an unknown outcome", async () => {
  const { navigation } = createNavigation();
  let starts = 0;
  const sessions = new SessionService({
    async request(method) {
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "turn/start") {
        starts += 1;
        throw Object.assign(new Error("timed out"), { code: "RPC_TIMEOUT" });
      }
      if (method === "thread/items/list") {
        return { data: [{ turnId: "turn_recorded", item: { id: "user", type: "userMessage", clientId: "client-1" } }] };
      }
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "Hello", clientUserMessageId: "client-1" }),
    (error) => error.code === "RPC_TIMEOUT"
  );
  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "Retry", clientUserMessageId: "client-2" }),
    (error) => error instanceof AppError && error.code === "previous_turn_recorded"
  );
  assert.equal(starts, 1);
});

test("SessionService reconciles a timed-out turn without resending it", async () => {
  const { navigation } = createNavigation();
  let starts = 0;
  const sessions = new SessionService({
    async request(method) {
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "turn/start") {
        starts += 1;
        throw Object.assign(new Error("timed out"), { code: "RPC_TIMEOUT" });
      }
      if (method === "thread/items/list") {
        return { data: [{ turnId: "turn-recorded", item: { id: "user", type: "userMessage", clientId: "client-reconcile" } }] };
      }
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "Hello", clientUserMessageId: "client-reconcile" }),
    (error) => error.code === "RPC_TIMEOUT"
  );
  assert.deepEqual(await sessions.reconcileTurn("thread_seed"), {
    status: "recorded",
    clientUserMessageId: "client-reconcile",
    turnId: "turn-recorded",
  });
  assert.equal(starts, 1);
});

test("SessionService remains fail-closed while a turn outcome is unknown", async () => {
  const { navigation } = createNavigation();
  let starts = 0;
  const sessions = new SessionService({
    async request(method) {
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "turn/start") {
        starts += 1;
        throw Object.assign(new Error("timed out"), { code: "RPC_TIMEOUT" });
      }
      if (method === "thread/items/list") return { data: [] };
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "Hello", clientUserMessageId: "client-unknown" }),
    (error) => error.code === "RPC_TIMEOUT"
  );
  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "Do not duplicate" }),
    (error) => error instanceof AppError && error.code === "write_outcome_unknown"
  );
  assert.equal(starts, 1);
});

test("SessionService serializes resume and turn start, resumes once, and interrupts only the active turn", async () => {
  const { navigation } = createNavigation();
  const resume = deferred();
  const calls = [];
  const client = {
    request(method, params) {
      calls.push({ method, params });
      if (method === "thread/resume") return resume.promise;
      if (method === "thread/read") return Promise.resolve({ thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } });
      if (method === "turn/start") return Promise.resolve({ turn: { id: "turn_one", status: "inProgress" } });
      if (method === "turn/interrupt") return Promise.resolve({ interrupted: true });
      throw new Error(`unexpected method ${method}`);
    },
  };
  const sessions = new SessionService(client, navigation);

  const firstTurn = sessions.startTurn("thread_seed", { text: "Hello", clientUserMessageId: "client_message_1" });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "Competing write" }),
    (error) => error instanceof AppError && error.code === "thread_busy"
  );
  assert.deepEqual(calls.map(({ method }) => method), ["thread/resume"]);

  resume.resolve({ approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } });
  const firstResult = await firstTurn;
  assert.equal(firstResult.turn.id, "turn_one");
  assert.equal(firstResult.clientUserMessageId, "client_message_1");
  assert.equal(sessions.activeTurn("thread_seed"), "turn_one");
  assert.deepEqual(calls.map(({ method }) => method), ["thread/resume", "thread/read", "turn/start"]);
  assert.deepEqual(calls.find(({ method }) => method === "turn/start").params.collaborationMode, {
    mode: "default",
    settings: {
      model: "test-model",
      reasoning_effort: null,
      developer_instructions: null,
    },
  });

  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "Blocked by active turn" }),
    (error) => error instanceof AppError && error.code === "thread_busy"
  );
  await assert.rejects(
    sessions.interrupt("thread_seed", "another_turn"),
    (error) => error instanceof AppError && error.code === "turn_mismatch"
  );
  assert.equal(await sessions.interrupt("thread_seed", "turn_one").then((result) => result.interrupted), true);

  sessions.setActiveTurn("thread_seed", null);
  const secondResult = await sessions.startTurn("thread_seed", { text: "After completion" });
  assert.equal(secondResult.turn.id, "turn_one");
  assert.deepEqual(calls.map(({ method }) => method), [
    "thread/resume", "thread/read", "turn/start",
    "thread/read", "thread/read", "turn/interrupt",
    "thread/read", "turn/start",
  ]);
});

test("SessionService gives a historical resend precedence without changing its visible user text", async () => {
  const { navigation } = createNavigation();
  const calls = [];
  const sessions = new SessionService({
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "turn/start") return { turn: { id: "turn_resent", status: "inProgress" } };
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  await sessions.startTurn("thread_seed", {
    text: "显示最近 100 个 commit 的 graph 图",
    historicalResend: true,
    clientUserMessageId: "client_resent",
  });

  const params = calls.find(({ method }) => method === "turn/start").params;
  assert.deepEqual(params.input, [{ type: "text", text: "显示最近 100 个 commit 的 graph 图" }]);
  const contextEntries = Object.entries(params.additionalContext);
  assert.equal(contextEntries.length, 1);
  assert.match(contextEntries[0][0], /^codex_session_history_resend_[a-f0-9]{32}$/);
  assert.equal(contextEntries[0][1].kind, "application");
  assert.match(contextEntries[0][1].value, /最新且有效的要求/);
  assert.match(contextEntries[0][1].value, /保留不冲突的上下文/);

  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "invalid", historicalResend: "yes" }),
    (error) => error instanceof AppError && error.code === "invalid_historical_resend"
  );
});

test("SessionService reads an addressable thread that is not yet cached", async () => {
  const { navigation } = createNavigation();
  const sessions = new SessionService({
    async request(method, params) {
      if (method === "thread/read") return { thread: { id: params.threadId, cwd: "/workspace/project", name: "Discovered", status: "idle", canAcceptDirectInput: false } };
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  const session = await sessions.read("thread-discovered");
  assert.equal(session.name, "Discovered");
  assert.equal(navigation.getThread("thread-discovered").id, "thread-discovered");
});

test("SessionService explicitly resumes an unloaded root before enabling input", async () => {
  const { navigation } = createNavigation();
  const calls = [];
  const sessions = new SessionService({
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/resume") return {
        thread: { id: "thread_seed", cwd: "/workspace/project", canAcceptDirectInput: true },
        approvalPolicy: "never",
        sandbox: { type: "dangerFullAccess" },
      };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  const session = await sessions.resume("thread_seed");
  assert.equal(session.canAcceptDirectInput, true);
  assert.deepEqual(calls.map(({ method }) => method), ["thread/resume", "thread/read"]);
  assert.deepEqual(calls[0].params, {
    threadId: "thread_seed",
    excludeTurns: true,
    approvalPolicy: "never",
    sandbox: "danger-full-access",
  });
});

test("SessionService repairs ignored resume permissions before starting a turn", async () => {
  const { navigation } = createNavigation();
  const calls = [];
  let sessions;
  const client = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/resume") return {
        thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true },
        approvalPolicy: "never",
        sandbox: { type: "workspaceWrite", writableRoots: ["/workspace/project"] },
      };
      if (method === "thread/settings/update") {
        setImmediate(() => sessions.recordThreadSettings("thread_seed", {
          approvalPolicy: "never",
          sandboxPolicy: { type: "dangerFullAccess" },
        }));
        return {};
      }
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "turn/start") return { turn: { id: "turn-permission", status: "inProgress" } };
      throw new Error(`unexpected method ${method}`);
    },
  };
  sessions = new SessionService(client, navigation);

  const result = await sessions.startTurn("thread_seed", { text: "use git" });

  assert.equal(result.turn.id, "turn-permission");
  assert.deepEqual(calls.map(({ method }) => method), [
    "thread/resume", "thread/settings/update", "thread/read", "turn/start",
  ]);
  assert.deepEqual(calls[1].params, {
    threadId: "thread_seed",
    approvalPolicy: "never",
    sandboxPolicy: { type: "dangerFullAccess" },
  });
});

test("SessionService starts compaction only after restoring an idle root thread", async () => {
  const { navigation } = createNavigation();
  const calls = [];
  const sessions = new SessionService({
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "thread/compact/start") return {};
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  assert.doesNotThrow(() => sessions.assertRestartSafe());
  assert.deepEqual(await sessions.compact("thread_seed"), { status: "started" });
  assert.throws(
    () => sessions.assertRestartSafe(),
    (error) => error instanceof AppError && error.code === "restart_blocked"
  );
  assert.deepEqual(calls.map(({ method }) => method), ["thread/resume", "thread/read", "thread/compact/start"]);
  assert.deepEqual(calls.at(-1).params, { threadId: "thread_seed" });
  await assert.rejects(
    sessions.compact("thread_seed"),
    (error) => error instanceof AppError && error.code === "thread_busy"
  );
  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "must wait" }),
    (error) => error instanceof AppError && error.code === "thread_busy"
  );
});

test("SessionService sends text and validated images in order", async () => {
  const { navigation } = createNavigation();
  const calls = [];
  const sessions = new SessionService({
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "turn/start") return { turn: { id: "turn-image", status: "inProgress" } };
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  const image = "data:image/png;base64,iVBORw0KGgo=";
  const result = await sessions.startTurn("thread_seed", {
    text: " \n看图\n ",
    images: [{ dataUrl: image, detail: "high" }],
    clientUserMessageId: "image-client",
  });

  const started = calls.find(({ method }) => method === "turn/start");
  assert.deepEqual(started.params.input, [
    { type: "text", text: " \n看图\n " },
    { type: "image", url: image, detail: "high" },
  ]);
  assert.equal(result.clientUserMessageId, "image-client");
});

test("SessionService sends Plan and Default collaboration modes with the authoritative model", async () => {
  const { navigation } = createNavigation();
  const starts = [];
  const sessions = new SessionService({
    async request(method, params) {
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "authoritative-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "turn/start") {
        starts.push(params);
        return { turn: { id: `turn-${starts.length}`, status: "inProgress" } };
      }
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  await sessions.startTurn("thread_seed", { text: "Plan this", collaborationMode: "plan" });
  sessions.setActiveTurn("thread_seed", null);
  await sessions.startTurn("thread_seed", { text: "Implement this", collaborationMode: "default" });

  assert.deepEqual(starts.map(({ collaborationMode }) => collaborationMode), [
    {
      mode: "plan",
      settings: {
        model: "authoritative-model",
        reasoning_effort: "medium",
        developer_instructions: null,
      },
    },
    {
      mode: "default",
      settings: {
        model: "authoritative-model",
        reasoning_effort: null,
        developer_instructions: null,
      },
    },
  ]);
});

test("SessionService lists models and validates per-turn model reasoning selections", async () => {
  const { navigation } = createNavigation();
  const starts = [];
  const sessions = new SessionService({
    async request(method, params) {
      if (method === "model/list") {
        if (params.cursor === null) return {
          data: [{
            id: "model-a",
            model: "model-a",
            displayName: "Model A",
            supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "high" }],
            defaultReasoningEffort: "low",
            isDefault: true,
          }],
          nextCursor: "page-2",
        };
        return {
          data: [{
            id: "model-b",
            model: "model-b",
            displayName: "Model B",
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "xhigh" }],
            defaultReasoningEffort: "medium",
          }],
          nextCursor: null,
        };
      }
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "model-a", status: "idle", canAcceptDirectInput: true } };
      if (method === "turn/start") {
        starts.push(params);
        return { turn: { id: "turn-model", status: "inProgress" } };
      }
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  const models = await sessions.models();
  assert.deepEqual(models.map(({ model }) => model), ["model-a", "model-b"]);
  assert.deepEqual(models[1].supportedReasoningEfforts.map(({ reasoningEffort }) => reasoningEffort), ["medium", "xhigh"]);

  await sessions.startTurn("thread_seed", {
    text: "Use the selected settings",
    collaborationMode: "plan",
    model: "model-b",
    reasoningEffort: "xhigh",
  });
  assert.deepEqual(starts[0].collaborationMode, {
    mode: "plan",
    settings: {
      model: "model-b",
      reasoning_effort: "xhigh",
      developer_instructions: null,
    },
  });
  sessions.setActiveTurn("thread_seed", null);
  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "Unsupported", model: "model-b", reasoningEffort: "high" }),
    (error) => error instanceof AppError && error.code === "invalid_model_selection"
  );
  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "Incomplete", model: "model-a" }),
    (error) => error instanceof AppError && error.code === "invalid_model_selection"
  );
});

test("SessionService rejects invalid collaboration modes and missing authoritative models", async () => {
  const { navigation } = createNavigation();
  const sessions = new SessionService({
    async request(method) {
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", status: "idle", canAcceptDirectInput: true } };
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "Invalid", collaborationMode: { mode: "plan", settings: { model: "untrusted" } } }),
    (error) => error instanceof AppError && error.code === "invalid_collaboration_mode"
  );
  navigation.upsert({ id: "thread_seed", cwd: "/workspace/project", model: null, status: "idle", canAcceptDirectInput: true });
  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "No model", collaborationMode: "plan" }),
    (error) => error instanceof AppError && error.code === "thread_model_unavailable"
  );
});

test("SessionService revalidates an unknown root capability and still fails closed without confirmation", async () => {
  const { navigation } = createNavigation();
  navigation.upsert({ id: "thread-unknown", cwd: "/workspace/project", status: "idle", canAcceptDirectInput: null });
  const calls = [];
  const sessions = new SessionService({
    async request(method) {
      calls.push(method);
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread-unknown", cwd: "/workspace/project", status: "idle" } };
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  await assert.rejects(
    sessions.startTurn("thread-unknown", { text: "must not send" }),
    (error) => error instanceof AppError && error.code === "direct_input_unavailable"
  );
  assert.deepEqual(calls, ["thread/resume", "thread/read"]);
});

test("SessionService accepts authoritative direct input after a stale navigation result", async () => {
  const { navigation } = createNavigation();
  navigation.upsert({ id: "thread-stale", cwd: "/workspace/project", status: "idle", canAcceptDirectInput: null });
  const calls = [];
  const sessions = new SessionService({
    async request(method) {
      calls.push(method);
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") {
        return { thread: { id: "thread-stale", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      }
      if (method === "turn/start") return { turn: { id: "turn-stale", status: "inProgress" } };
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  const result = await sessions.startTurn("thread-stale", { text: "send after restart" });

  assert.equal(result.turn.id, "turn-stale");
  assert.deepEqual(calls, ["thread/resume", "thread/read", "turn/start"]);
});

test("SessionService stops when authoritative direct-input capability disappears", async () => {
  const { navigation } = createNavigation();
  const calls = [];
  const sessions = new SessionService({
    async request(method) {
      calls.push(method);
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", status: "idle" } };
      if (method === "turn/start") throw new Error("turn/start must not run");
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  await assert.rejects(
    sessions.startTurn("thread_seed", { text: "must not send" }),
    (error) => error instanceof AppError && error.code === "direct_input_unavailable"
  );
  assert.deepEqual(calls, ["thread/resume", "thread/read"]);
});

test("SessionService tracks sub-agents only for the current root runtime cycle", () => {
  const { navigation } = createNavigation();
  const child = navigation.upsert({
    id: "thread-child",
    cwd: "/workspace/project",
    parentThreadId: "thread_seed",
    canAcceptDirectInput: false,
  });
  const sessions = new SessionService({ request: async () => ({}) }, navigation);

  sessions.recordThreadStarted(navigation.getThread("thread_seed"));
  sessions.recordThreadStarted(child);
  assert.deepEqual(sessions.currentSubagentIds(), ["thread-child"]);
  sessions.closeThread("thread-child");
  assert.deepEqual(sessions.currentSubagentIds(), ["thread-child"]);

  sessions.closeThread("thread_seed");
  assert.deepEqual(sessions.currentSubagentIds(), []);
  sessions.recordThreadStarted(child);
  assert.deepEqual(sessions.currentSubagentIds(), []);

  sessions.recordThreadStarted(navigation.getThread("thread_seed"));
  assert.deepEqual(sessions.currentSubagentIds(), []);
});

test("SessionService blocks direct input to owned sub-agent threads", async () => {
  const { navigation } = createNavigation();
  navigation.upsert({
    id: "thread-child",
    cwd: "/workspace/project",
    parentThreadId: "thread_seed",
    canAcceptDirectInput: true,
    status: "idle",
  });
  let calls = 0;
  const sessions = new SessionService({ request: async () => { calls += 1; return {}; } }, navigation);

  await assert.rejects(
    sessions.startTurn("thread-child", { text: "take over" }),
    (error) => error instanceof AppError && error.code === "direct_input_not_allowed"
  );
  assert.equal(calls, 0);
});

test("SessionService does not reactivate a turn completed before turn/start responds", async () => {
  const { navigation } = createNavigation();
  const started = deferred();
  const sessions = new SessionService({
    async request(method) {
      if (method === "thread/resume") return { approvalPolicy: "never", sandbox: { type: "dangerFullAccess" } };
      if (method === "thread/read") return { thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } };
      if (method === "turn/start") return started.promise;
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  const pending = sessions.startTurn("thread_seed", { text: "Fast" });
  await new Promise((resolve) => setImmediate(resolve));
  sessions.completeActiveTurn("thread_seed", "turn-fast");
  started.resolve({ turn: { id: "turn-fast", status: "inProgress" } });
  await pending;

  assert.equal(sessions.activeTurn("thread_seed"), null);
});

test("SessionService uses stable lifecycle RPCs and clears local thread runtime state", async () => {
  const calls = [];
  let archived = false;
  let deleted = false;
  const client = {
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/list") {
        if (params.ancestorThreadId) return { data: [], nextCursor: null };
        const visible = !deleted && Boolean(params.archived) === archived;
        return { data: visible ? [{ id: "thread_seed", cwd: "/workspace/project", name: archived ? "Archived" : "Renamed", status: "idle" }] : [], nextCursor: null };
      }
      if (method === "thread/name/set") return {};
      if (method === "thread/read") return { thread: { id: params.threadId, cwd: "/workspace/project", name: "Renamed", status: "idle", canAcceptDirectInput: true } };
      if (method === "thread/unsubscribe") return { status: "notSubscribed" };
      if (method === "thread/archive") { archived = true; return {}; }
      if (method === "thread/delete") { deleted = true; return {}; }
      if (method === "thread/unarchive") {
        archived = false;
        return { thread: { id: params.threadId, cwd: "/workspace/project", name: "Restored", status: { type: "idle" } } };
      }
      throw new Error(`unexpected method ${method}`);
    },
  };
  const navigation = new NavigationService(client, { maxThreadPages: 2 });
  navigation.upsert({ id: "thread_seed", cwd: "/workspace/project", name: "Seed", canAcceptDirectInput: true });
  const sessions = new SessionService(client, navigation);

  sessions.setActiveTurn("thread_seed", "turn-old");
  sessions.setActiveTurn("thread_seed", "turn-new");
  assert.equal(sessions.completeActiveTurn("thread_seed", "turn-old"), false);
  assert.equal(sessions.activeTurn("thread_seed"), "turn-new");

  const renamed = await sessions.rename("thread_seed", "  Renamed  ");
  assert.equal(renamed.name, "Renamed");
  sessions.setActiveTurn("thread_seed", "turn-active");
  await assert.rejects(sessions.unsubscribe("thread_seed"), (error) => error.code === "thread_busy");
  sessions.completeActiveTurn("thread_seed", "turn-active");
  assert.deepEqual(await sessions.unsubscribe("thread_seed"), { status: "notSubscribed" });
  assert.equal(sessions.activeTurn("thread_seed"), null);
  assert.equal(navigation.getThread("thread_seed").status, "notLoaded");
  await navigation.refresh();
  assert.equal(navigation.getThread("thread_seed").status, "notLoaded");

  sessions.setActiveTurn("thread_seed", "turn-active");
  await assert.rejects(sessions.archive("thread_seed"), (error) => error.code === "thread_busy");
  sessions.completeActiveTurn("thread_seed", "turn-active");
  await sessions.archive("thread_seed");
  assert.equal(sessions.activeTurn("thread_seed"), null);
  const restored = await sessions.unarchive("thread_seed");
  assert.equal(restored.name, "Restored");
  await sessions.delete("thread_seed");
  assert.equal(navigation.getThread("thread_seed"), null);
  assert.deepEqual(calls.filter(({ method }) => method !== "thread/list").map(({ method }) => method), [
    "thread/name/set", "thread/read", "thread/unsubscribe", "thread/read", "thread/archive", "thread/unarchive", "thread/read", "thread/delete",
  ]);
  assert.ok(calls.filter(({ method }) => method !== "thread/list").every(({ params }) => params.threadId === "thread_seed"));
});

test("SessionService blocks lifecycle mutations while a descendant is active", async () => {
  let mutations = 0;
  const client = {
    async request(method, params) {
      if (method === "thread/read") return { thread: { id: "root", cwd: "/workspace/project", status: "idle" } };
      if (method === "thread/list" && params.ancestorThreadId) {
        return { data: params.archived ? [] : [{ id: "child", cwd: "/workspace/project", parentThreadId: "root", status: "active" }], nextCursor: null };
      }
      if (method === "thread/archive" || method === "thread/delete") { mutations += 1; return {}; }
      throw new Error(`unexpected method ${method}`);
    },
  };
  const navigation = new NavigationService(client, { maxThreadPages: 2 });
  navigation.upsert({ id: "root", cwd: "/workspace/project", status: "idle" });
  const sessions = new SessionService(client, navigation);

  await assert.rejects(sessions.archive("root"), (error) => error.code === "thread_subtree_busy");
  await assert.rejects(sessions.delete("root"), (error) => error.code === "thread_subtree_busy");
  assert.equal(mutations, 0);
});

test("SessionService serializes destructive lifecycle writes with turn starts", async () => {
  const { navigation } = createNavigation();
  const read = deferred();
  const calls = [];
  const sessions = new SessionService({
    async request(method, params) {
      calls.push({ method, params });
      if (method === "thread/read") return read.promise;
      if (method === "thread/archive") return {};
      throw new Error(`unexpected method ${method}`);
    },
  }, navigation);

  const archiving = sessions.archive("thread_seed");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(sessions.startTurn("thread_seed", { text: "Race" }), (error) => error.code === "thread_busy");
  read.resolve({ thread: { id: "thread_seed", cwd: "/workspace/project", model: "test-model", status: "idle", canAcceptDirectInput: true } });
  await archiving;
  assert.deepEqual(calls.map(({ method }) => method), ["thread/read", "thread/archive"]);
});

test("SessionService does not report a timed-out subtree mutation as reconciled while descendants remain", async () => {
  for (const operation of ["archive", "delete"]) {
    let mutated = false;
    const client = {
      async request(method, params) {
        if (method === "thread/read") return { thread: { id: "root", cwd: "/workspace/project", status: "idle" } };
        if (method === "thread/list" && params.ancestorThreadId) {
          return { data: params.archived ? [] : [{ id: "child", cwd: "/workspace/project", parentThreadId: "root", status: "idle" }], nextCursor: null };
        }
        if (method === "thread/list") {
          if (params.archived) {
            return { data: mutated && operation === "archive" ? [{ id: "root", cwd: "/workspace/project", status: "idle" }] : [], nextCursor: null };
          }
          return { data: mutated ? [{ id: "child", cwd: "/workspace/project", parentThreadId: "root", status: "idle" }] : [
            { id: "root", cwd: "/workspace/project", status: "idle" },
            { id: "child", cwd: "/workspace/project", parentThreadId: "root", status: "idle" },
          ], nextCursor: null };
        }
        if (method === `thread/${operation}`) {
          mutated = true;
          throw Object.assign(new Error("timed out"), { code: "RPC_TIMEOUT" });
        }
        throw new Error(`unexpected method ${method}`);
      },
    };
    const navigation = new NavigationService(client, { maxThreadPages: 2 });
    navigation.upsert({ id: "root", cwd: "/workspace/project", status: "idle" });
    const sessions = new SessionService(client, navigation);

    await assert.rejects(
      sessions[operation]("root"),
      (error) => error instanceof AppError
        && error.code === "write_outcome_unknown"
        && error.details.remainingThreadIds.includes("child")
    );
  }
});

test("SessionService serializes unarchive with other tree lifecycle mutations", async () => {
  const unarchive = deferred();
  const client = {
    async request(method, params) {
      if (method === "thread/list") {
        return { data: params.archived ? [{ id: "archived", cwd: "/workspace/project", status: "idle" }] : [{ id: "root", cwd: "/workspace/project", status: "idle" }], nextCursor: null };
      }
      if (method === "thread/unarchive") return unarchive.promise;
      throw new Error(`unexpected method ${method}`);
    },
  };
  const navigation = new NavigationService(client, { maxThreadPages: 2 });
  navigation.upsert({ id: "root", cwd: "/workspace/project", status: "idle" });
  await navigation.refreshArchived();
  const sessions = new SessionService(client, navigation);

  const restoring = sessions.unarchive("archived");
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(sessions.archive("root"), (error) => error.code === "thread_busy");
  unarchive.resolve({ thread: { id: "archived", cwd: "/workspace/project", status: "idle" } });
  await restoring;
});

test("SessionService validates rename input and verifies lifecycle threads before RPC", async () => {
  const { navigation } = createNavigation();
  let calls = 0;
  const sessions = new SessionService({ request: async () => { calls += 1; return {}; } }, navigation);

  for (const name of ["", "   ", "x".repeat(201)]) {
    await assert.rejects(sessions.rename("thread_seed", name), (error) => error instanceof AppError && error.code === "invalid_name");
  }
  await assert.rejects(sessions.archive("missing-thread"), (error) => error instanceof AppError && error.code === "thread_not_found");
  assert.equal(calls, 0);
});

test("RequestRegistry rejects unsupported and invalid responses without forwarding them, then prevents duplicate replies", () => {
  const sent = [];
  const events = [];
  const client = {
    respond(id, result) { sent.push({ type: "result", id, result }); },
    respondError(id, code, message) { sent.push({ type: "error", id, code, message }); },
  };
  const eventBus = new EventBus();
  eventBus.on("event", (event) => events.push(event));
  const registry = new RequestRegistry(client, eventBus);

  assert.equal(registry.add({ id: 1, method: "dangerous/unknown", params: {} }), null);
  assert.deepEqual(sent, [{ type: "error", id: 1, code: -32601, message: "Unsupported client request: dangerous/unknown" }]);

  const pending = registry.add({
    id: 2,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread_seed", turnId: "turn_one" },
  });
  assert.equal(pending.status, "pending");
  assert.throws(
    () => registry.resolve(pending.requestId, { decision: "acceptEverything" }),
    (error) => error instanceof AppError && error.code === "invalid_decision"
  );
  assert.equal(registry.pending().length, 1);
  assert.equal(sent.length, 1, "invalid approval must not be forwarded to Codex");

  assert.deepEqual(registry.resolve(pending.requestId, { decision: "acceptForSession" }), {
    requestId: pending.requestId,
    status: "responding",
  });
  assert.deepEqual(sent.at(-1), { type: "result", id: 2, result: { decision: "acceptForSession" } });
  assert.equal(registry.pending()[0].status, "responding");
  assert.throws(
    () => registry.resolve(pending.requestId, { decision: "accept" }),
    (error) => error instanceof AppError && error.code === "request_resolved"
  );
  assert.equal(sent.filter(({ type }) => type === "result").length, 1);
  registry.markResolvedByRpcId(2);
  assert.equal(registry.pending().length, 0);
  assert.deepEqual(events.map(({ type }) => type), ["request.unsupported", "request.pending", "request.responding", "request.resolved"]);
});

test("RequestRegistry honors available command decisions", () => {
  const sent = [];
  const registry = new RequestRegistry({
    respond(id, result) { sent.push({ id, result }); },
    respondError() {},
  }, new EventBus());
  const pending = registry.add({
    id: 8,
    method: "item/commandExecution/requestApproval",
    params: { availableDecisions: ["accept", "decline"] },
  });
  assert.throws(
    () => registry.resolve(pending.requestId, { decision: "acceptForSession" }),
    (error) => error instanceof AppError && error.code === "invalid_decision"
  );
  registry.resolve(pending.requestId, { decision: "accept" });
  assert.deepEqual(sent, [{ id: 8, result: { decision: "accept" } }]);
});

test("RequestRegistry validates permission subsets and MCP decline responses", () => {
  const sent = [];
  const client = {
    respond(id, result) { sent.push({ id, result }); },
    respondError() {},
  };
  const registry = new RequestRegistry(client, new EventBus());
  const permission = registry.add({
    id: 4,
    method: "item/permissions/requestApproval",
    params: {
      permissions: {
        fileSystem: { write: ["/workspace"], entries: [{ path: "/workspace", access: "write" }] },
        network: null,
      },
    },
  });
  assert.throws(
    () => registry.resolve(permission.requestId, { scope: "session", permissions: { fileSystem: { write: ["/other"] } } }),
    (error) => error instanceof AppError && error.code === "invalid_permissions"
  );
  const granted = { fileSystem: { entries: [{ access: "write", path: "/workspace" }] } };
  registry.resolve(permission.requestId, { scope: "session", permissions: granted });
  assert.deepEqual(sent.at(-1).result, { scope: "session", permissions: granted });

  const elicitation = registry.add({ id: 5, method: "mcpServer/elicitation/request", params: { mode: "form" } });
  registry.resolve(elicitation.requestId, { action: "decline" });
  assert.deepEqual(sent.at(-1).result, { action: "decline", content: null, _meta: null });
});

test("RequestRegistry validates user answers and MCP form schemas", () => {
  const sent = [];
  const registry = new RequestRegistry({
    respond(id, result) { sent.push({ id, result }); },
    respondError() {},
  }, new EventBus());
  const userInput = registry.add({
    id: 9,
    method: "item/tool/requestUserInput",
    params: { questions: [{ id: "target", isOther: false, options: [{ label: "Staging" }, { label: "Production" }] }] },
  });
  assert.throws(
    () => registry.resolve(userInput.requestId, { answers: { target: { answers: ["Other"] } } }),
    (error) => error instanceof AppError && error.code === "invalid_answers"
  );
  assert.throws(
    () => registry.resolve(userInput.requestId, { answers: { target: { answers: ["Staging", "Production"] } } }),
    (error) => error instanceof AppError && error.code === "invalid_answers"
  );
  registry.resolve(userInput.requestId, { answers: { target: { answers: ["Staging"] } } });

  const multiInput = registry.add({
    id: 11,
    method: "item/tool/requestUserInput",
    params: { questions: [{ id: "targets", multiSelect: true, options: [{ label: "Staging" }, { label: "Production" }] }] },
  });
  registry.resolve(multiInput.requestId, { answers: { targets: { answers: ["Staging", "Production"] } } });

  const form = registry.add({
    id: 10,
    method: "mcpServer/elicitation/request",
    params: {
      mode: "form",
      requestedSchema: {
        type: "object",
        required: ["repo"],
        properties: { repo: { type: "string", minLength: 1 }, private: { type: "boolean" } },
      },
    },
  });
  assert.throws(
    () => registry.resolve(form.requestId, { action: "accept", content: { repo: "", unexpected: true } }),
    (error) => error instanceof AppError && error.code === "invalid_content"
  );
  registry.resolve(form.requestId, { action: "accept", content: { repo: "openai/codex", private: false } });
  assert.deepEqual(sent.at(-1).result, {
    action: "accept",
    content: { repo: "openai/codex", private: false },
    _meta: null,
  });
});

test("RequestRegistry expires an unconfirmed response when app-server disconnects", () => {
  const events = [];
  const eventBus = new EventBus();
  eventBus.on("event", (event) => events.push(event));
  const registry = new RequestRegistry({
    respond() {},
    respondError() {},
  }, eventBus);
  const pending = registry.add({
    id: 12,
    method: "item/commandExecution/requestApproval",
    params: { threadId: "thread_seed" },
  });

  registry.resolve(pending.requestId, { decision: "accept" });
  assert.equal(registry.pending()[0].status, "responding");
  registry.expireAll();
  assert.equal(registry.pending().length, 0);
  assert.deepEqual(events.map(({ type }) => type), ["request.pending", "request.responding", "request.expired"]);
});

test("RequestRegistry leaves a request pending when its response cannot be delivered", () => {
  const registry = new RequestRegistry({
    respond() { throw new Error("app-server offline"); },
    respondError() {},
  }, new EventBus());
  const pending = registry.add({
    id: 3,
    method: "item/tool/requestUserInput",
    params: { questions: [{ id: "choice", options: null, isOther: true }] },
  });

  assert.throws(() => registry.resolve(pending.requestId, { answers: { choice: { answers: ["yes"] } } }), /app-server offline/);
  assert.deepEqual(registry.pending().map(({ requestId }) => requestId), [pending.requestId]);
});
