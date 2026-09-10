import assert from "node:assert/strict";
import test from "node:test";
import { difitArgsForMode, parseDifitLaunchOutput } from "../src/services/difit-launcher.js";
import { branchCreatedFrom, readGitContext } from "../src/services/git-context.js";

test("branchCreatedFrom returns the latest recorded creation source", () => {
  assert.equal(branchCreatedFrom("branch: Created from main\ncommit: work\nbranch: Created from release\n"), "release");
});

test("readGitContext reports staged and committed review ranges", async () => {
  const responses = new Map([
    ["rev-parse --is-inside-work-tree", "true\n"],
    ["rev-parse --show-toplevel", "/repo\n"],
    ["branch --show-current", "feature\n"],
    ["rev-parse --short HEAD", "abcdef\n"],
    ["diff --cached --name-only -z", "a.js\0b.js\0"],
    ["config --get branch.feature.session-view-base", "origin/main\n"],
    ["rev-parse --verify --quiet origin/main^{commit}", "deadbeef\n"],
    ["merge-base origin/main HEAD", "basehash\n"],
    ["rev-list --count basehash..HEAD", "3\n"],
    ["diff --name-only -z basehash HEAD", "a.js\0c.js\0"],
  ]);
  const context = await readGitContext("/repo", {
    runGit: async (args) => {
      const key = args.join(" ");
      if (!responses.has(key)) throw new Error(`unexpected ${key}`);
      return responses.get(key);
    },
  });
  assert.deepEqual(context, {
    available: true,
    root: "/repo",
    branch: "feature",
    detached: false,
    base: "origin/main",
    baseSource: "configured",
    mergeBase: "basehash",
    stagedFiles: 2,
    committedCommits: 3,
    committedFiles: 2,
  });
});

test("Difit arguments preserve staged and committed review ranges", () => {
  assert.deepEqual(difitArgsForMode("staged", {}), ["staged", "--background", "--no-open"]);
  assert.deepEqual(difitArgsForMode("committed", { base: "origin/main" }), ["HEAD", "origin/main", "--merge-base", "--background", "--no-open"]);
});

test("Difit output uses only its last JSON handshake", () => {
  assert.equal(parseDifitLaunchOutput('log\n{"url":"http://127.0.0.1:4567/"}\n').url, "http://127.0.0.1:4567/");
  assert.throws(
    () => parseDifitLaunchOutput('{"url":"http://127.0.0.1:4567/"}\n{"url":"http://localhost:70000/"}'),
    /未返回可用/
  );
});
