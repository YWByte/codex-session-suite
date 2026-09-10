import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "../src/errors.js";
import { NavigationService } from "../src/services/navigation.js";

const relationshipSourceKinds = [
  "cli",
  "vscode",
  "exec",
  "appServer",
  "subAgent",
  "subAgentReview",
  "subAgentCompact",
  "subAgentThreadSpawn",
  "subAgentOther",
  "unknown",
];

test("NavigationService lists paginated direct children including subagents", async () => {
  const calls = [];
  const client = {
    async request(method, params) {
      calls.push({ method, params });
      assert.equal(method, "thread/list");
      assert.equal(params.parentThreadId, "parent");
      assert.equal(params.ancestorThreadId, undefined);
      assert.deepEqual(params.sourceKinds, relationshipSourceKinds);
      if (params.cursor === null) {
        return {
          data: [
            { id: "child-new", cwd: "/workspace/project", parentThreadId: "parent", source: { subAgent: "other" } },
            { id: "parent", cwd: "/workspace/project", parentThreadId: "parent" },
          ],
          nextCursor: "next",
        };
      }
      assert.equal(params.cursor, "next");
      return {
        threads: [
          { id: "child-old", cwd: "/workspace/project", parent_thread_id: "parent", source: { subAgent: "review" } },
          { id: "unrelated", cwd: "/workspace/project", parentThreadId: "other" },
          { id: "child-new", cwd: "/workspace/project", parentThreadId: "parent" },
        ],
        next_cursor: null,
      };
    },
  };
  const navigation = new NavigationService(client, { maxThreadPages: 3 });

  const children = await navigation.listChildren(" parent ");

  assert.deepEqual(children.map(({ id }) => id), ["child-new", "child-old"]);
  assert.deepEqual(calls.map(({ params }) => params.cursor), [null, null, "next", "next"]);
  assert.deepEqual(calls.map(({ params }) => Boolean(params.archived)).sort(), [false, false, true, true]);
});

test("NavigationService includes archived descendants in lifecycle previews", async () => {
  const client = {
    async request(method, params) {
      assert.equal(method, "thread/list");
      return {
        data: params.archived
          ? [{ id: "archived-child", cwd: "/workspace/project", parentThreadId: "root", status: "idle" }]
          : [{ id: "active-child", cwd: "/workspace/project", parentThreadId: "root", status: "idle" }],
        nextCursor: null,
      };
    },
  };
  const navigation = new NavigationService(client, { maxThreadPages: 2 });

  assert.deepEqual((await navigation.listDescendants("root")).map(({ id }) => id), ["active-child", "archived-child"]);
});

test("NavigationService lists descendants, excludes malformed relations, and deduplicates IDs", async () => {
  const client = {
    async request(method, params) {
      assert.equal(method, "thread/list");
      assert.equal(params.parentThreadId, undefined);
      assert.equal(params.ancestorThreadId, "root");
      return {
        data: [
          { id: "child", cwd: "/workspace/project", parentThreadId: "root" },
          { id: "grandchild", cwd: "/workspace/project", parentThreadId: "child" },
          { id: "cycle-a", cwd: "/workspace/project", parentThreadId: "cycle-b" },
          { id: "cycle-b", cwd: "/workspace/project", parentThreadId: "cycle-a" },
          { id: "self", cwd: "/workspace/project", parentThreadId: "self" },
          { id: "root", cwd: "/workspace/project", parentThreadId: "root" },
          { id: "child", cwd: "/workspace/project", parentThreadId: "root", preview: "duplicate" },
        ],
        nextCursor: null,
      };
    },
  };
  const navigation = new NavigationService(client, { maxThreadPages: 1 });

  const descendants = await navigation.listDescendants("root");

  assert.deepEqual(descendants.map(({ id }) => id), ["child", "grandchild"]);
});

test("NavigationService rejects invalid relationship IDs and repeated pagination cursors", async () => {
  const navigation = new NavigationService({ request: async () => ({ data: [] }) }, { maxThreadPages: 1 });
  await assert.rejects(navigation.listChildren(""), (error) => error instanceof AppError && error.code === "invalid_thread_id");
  await assert.rejects(navigation.listDescendants(null), (error) => error instanceof AppError && error.code === "invalid_thread_id");

  const cycling = new NavigationService(
    { request: async () => ({ data: [{ id: "child", parentThreadId: "root" }], nextCursor: "same" }) },
    { maxThreadPages: 3 }
  );
  await assert.rejects(cycling.listChildren("root"), (error) => error instanceof AppError && error.code === "pagination_cursor_cycle");
});
