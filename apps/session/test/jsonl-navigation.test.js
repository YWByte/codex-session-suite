import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { JsonlDecoder } from "../src/app-server/jsonl-decoder.js";
import { AppError } from "../src/errors.js";
import { NavigationService, normalizeThread } from "../src/services/navigation.js";

function projectIdFor(cwd) {
  return `prj_${createHash("sha256").update(cwd || "unknown").digest("hex").slice(0, 20)}`;
}

test("JsonlDecoder handles UTF-8 split at every byte boundary, CRLF, and final EOF record", () => {
  const records = [{ id: 1, text: "你好" }, { method: "通知", params: { ok: true } }];
  const input = `${JSON.stringify(records[0])}\r\n${JSON.stringify(records[1])}`;
  const bytes = new TextEncoder().encode(input);

  for (let boundary = 1; boundary < bytes.length; boundary += 1) {
    const decoder = new JsonlDecoder();
    const received = [
      ...decoder.push(bytes.slice(0, boundary)),
      ...decoder.push(bytes.slice(boundary)),
      ...decoder.finish(),
    ];
    assert.deepEqual(received, records, `byte boundary ${boundary}`);
  }

  const byteByByte = new JsonlDecoder();
  const receivedByteByByte = [];
  for (const byte of bytes) receivedByteByByte.push(...byteByByte.push(Uint8Array.of(byte)));
  receivedByteByByte.push(...byteByByte.finish());
  assert.deepEqual(receivedByteByByte, records);
});

test("JsonlDecoder rejects malformed JSON, non-object messages, and malformed UTF-8", () => {
  assert.throws(() => new JsonlDecoder().push(new TextEncoder().encode('{"id":}\n')), SyntaxError);
  assert.throws(() => new JsonlDecoder().push(new TextEncoder().encode('[]\n')), /must be an object/);
  const invalidUtf8 = new JsonlDecoder();
  invalidUtf8.push(Uint8Array.of(0xc3));
  assert.throws(() => invalidUtf8.finish(), TypeError);
});

test("NavigationService retrieves all pages, groups normalized cwd values, and keeps project IDs stable", async () => {
  const calls = [];
  const client = {
    async request(method, params) {
      calls.push({ method, params });
      assert.equal(method, "thread/list");
      if (params.cursor === null) {
        return {
          threads: [
            {
              id: "alpha",
              cwd: "/workspace/demo/../demo",
              updated_at: "2026-09-01T00:00:00.000Z",
              sessionId: "session-alpha",
              parentThreadId: "parent-alpha",
              forkedFromId: "fork-alpha",
              agentNickname: "worker",
              agentRole: "reviewer",
              source: { subAgent: "other" },
              threadSource: "subagent",
              canAcceptDirectInput: false,
              ephemeral: true,
              historyMode: "paginated",
              modelProvider: "openai",
              projectId: "codex-project-alpha",
            },
            { id: "beta", cwd: "/workspace/other", updatedAt: "2026-09-03T00:00:00.000Z" },
          ],
          next_cursor: "second-page",
        };
      }
      assert.equal(params.cursor, "second-page");
      return {
        data: [
          { id: "gamma", cwd: "relative/path", updatedAt: "2026-09-04T00:00:00.000Z" },
          { id: "delta", cwd: "/workspace/demo", updatedAt: "2026-09-05T00:00:00.000Z" },
        ],
        nextCursor: null,
      };
    },
  };
  const navigation = new NavigationService(client, { maxThreadPages: 3 });

  const projects = await navigation.refresh();
  const demoProjectId = projectIdFor("/workspace/demo");
  const unknownProjectId = projectIdFor(null);

  assert.deepEqual(calls.map(({ params }) => params.cursor), [null, "second-page"]);
  assert.ok(calls.every(({ params }) => params.sourceKinds.includes("subAgent")));
  assert.deepEqual(navigation.sessions(demoProjectId).map(({ id }) => id), ["delta", "alpha"]);
  assert.equal(navigation.getThread("alpha").cwd, "/workspace/demo");
  assert.equal(navigation.getThread("alpha").projectId, demoProjectId);
  assert.equal(navigation.getThread("alpha").codexProjectId, "codex-project-alpha");
  assert.deepEqual(
    (({ sessionId, parentThreadId, forkedFromId, agentNickname, agentRole, source, threadSource, canAcceptDirectInput, ephemeral, historyMode, modelProvider }) => ({
      sessionId,
      parentThreadId,
      forkedFromId,
      agentNickname,
      agentRole,
      source,
      threadSource,
      canAcceptDirectInput,
      ephemeral,
      historyMode,
      modelProvider,
    }))(navigation.getThread("alpha")),
    {
      sessionId: "session-alpha",
      parentThreadId: "parent-alpha",
      forkedFromId: "fork-alpha",
      agentNickname: "worker",
      agentRole: "reviewer",
      source: { subAgent: "other" },
      threadSource: "subagent",
      canAcceptDirectInput: false,
      ephemeral: true,
      historyMode: "paginated",
      modelProvider: "openai",
    }
  );
  assert.equal(navigation.getThread("gamma").cwd, null);
  assert.equal(navigation.getThread("gamma").projectId, unknownProjectId);
  assert.equal(projects.find(({ id }) => id === demoProjectId).sessionCount, 2);
  assert.equal(navigation.sessions(unknownProjectId)[0].id, "gamma");
  assert.throws(() => navigation.requireWritableProject(unknownProjectId), (error) => error instanceof AppError && error.status === 409);

  const equivalent = normalizeThread({ id: "same", cwd: "/workspace/demo/./" });
  assert.equal(equivalent.projectId, demoProjectId);
});

test("NavigationService preserves active thread flags while keeping status string compatible", () => {
  const navigation = new NavigationService({ request: async () => ({ data: [] }) }, { maxThreadPages: 1 });
  navigation.upsert({
    id: "thread-active",
    cwd: "/workspace/project",
    status: { type: "active", activeFlags: ["waitingOnApproval", "unknown", "waitingOnUserInput"] },
  });

  const updated = navigation.updateStatus("thread-active", { type: "active", activeFlags: ["waitingOnUserInput"] });
  assert.equal(updated.status, "active");
  assert.deepEqual(updated.activeFlags, ["waitingOnUserInput"]);
  assert.deepEqual(navigation.getThread("thread-active").activeFlags, ["waitingOnUserInput"]);

  navigation.updateStatus("thread-active", { type: "idle" });
  assert.equal(navigation.getThread("thread-active").status, "idle");
  assert.deepEqual(navigation.getThread("thread-active").activeFlags, []);
});

test("normalizeThread preserves model reasoning effort from protocol fields", () => {
  assert.equal(normalizeThread({ id: "camel", reasoningEffort: "high" }).reasoningEffort, "high");
  assert.equal(normalizeThread({ id: "snake", reasoning_effort: "xhigh" }).reasoningEffort, "xhigh");
});

test("NavigationService preserves token usage when a later thread snapshot omits it", () => {
  const navigation = new NavigationService({ request: async () => ({ data: [] }) }, { maxThreadPages: 1 });
  const tokenUsage = {
    last: { inputTokens: 8_507, outputTokens: 139, totalTokens: 8_646 },
    total: { inputTokens: 14_421, outputTokens: 234, totalTokens: 14_655 },
  };
  navigation.upsert({ id: "thread-token", cwd: "/workspace/project", status: "notLoaded", tokenUsage });
  navigation.upsert({ id: "thread-token", cwd: "/workspace/project", status: "idle", canAcceptDirectInput: true });

  assert.deepEqual(navigation.getThread("thread-token").tokenUsage, tokenUsage);
});

test("NavigationService lists archived threads separately and restores them to normal navigation", async () => {
  const client = {
    async request(method, params) {
      assert.equal(method, "thread/list");
      return {
        data: params.archived
          ? [{ id: "archived", cwd: "/workspace/project", name: "Archived" }]
          : [{ id: "current", cwd: "/workspace/project", name: "Current" }],
        nextCursor: null,
      };
    },
  };
  const navigation = new NavigationService(client, { maxThreadPages: 2 });
  await navigation.refresh();
  const archived = await navigation.refreshArchived();

  assert.deepEqual(archived.map(({ id }) => id), ["archived"]);
  assert.equal(navigation.requireArchivedThread("archived").name, "Archived");
  assert.equal(navigation.getThread("archived"), null);

  navigation.remove("archived");
  assert.throws(() => navigation.requireArchivedThread("archived"), (error) => error.code === "thread_not_found");

  const restored = navigation.upsert({ id: "restored", cwd: "/workspace/project", name: "Restored" });
  navigation.markArchived(restored.id);
  navigation.upsert(restored);
  navigation.removeArchived(restored.id);
  assert.equal(navigation.getThread(restored.id)?.name, "Restored");
});

test("NavigationService stops pagination before an unbounded app-server listing", async () => {
  const client = { request: async () => ({ data: [], nextCursor: "again" }) };
  const navigation = new NavigationService(client, { maxThreadPages: 1 });

  await assert.rejects(navigation.refresh(), (error) => error instanceof AppError && error.code === "pagination_limit");
});
