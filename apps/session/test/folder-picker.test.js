import assert from "node:assert/strict";
import test from "node:test";
import { FolderPicker } from "../src/services/folder-picker.js";

function directory() {
  return { isDirectory: () => true };
}

test("FolderPicker opens the macOS chooser without a shell and validates the selected directory", async () => {
  let invocation;
  const picker = new FolderPicker({
    platform: "darwin",
    timeout: 3210,
    execFileImpl(command, args, options, callback) {
      invocation = { command, args, options };
      callback(null, "/workspace/new project/\n", "");
    },
    statImpl: async (cwd) => {
      assert.equal(cwd, "/workspace/new project/");
      return directory();
    },
  });

  assert.deepEqual(await picker.choose(), { cancelled: false, cwd: "/workspace/new project/" });
  assert.equal(invocation.command, "/usr/bin/osascript");
  assert.equal(invocation.args[0], "-e");
  assert.match(invocation.args[1], /choose folder/);
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.timeout, 3210);
});

test("FolderPicker treats Finder cancellation as a no-op", async () => {
  let statCalls = 0;
  const picker = new FolderPicker({
    platform: "darwin",
    execFileImpl(_command, _args, _options, callback) {
      callback(null, "__CODEX_FOLDER_PICKER_CANCELLED__\n", "");
    },
    statImpl: async () => { statCalls += 1; return directory(); },
  });

  assert.deepEqual(await picker.choose(), { cancelled: true });
  assert.equal(statCalls, 0);
});

test("FolderPicker rejects concurrent dialogs and releases the lock afterward", async () => {
  let complete;
  const picker = new FolderPicker({
    platform: "darwin",
    execFileImpl(_command, _args, _options, callback) { complete = callback; },
    statImpl: async () => directory(),
  });

  const first = picker.choose();
  await assert.rejects(picker.choose(), (error) => error.code === "folder_picker_busy" && error.status === 409);
  complete(null, "/workspace/one\n", "");
  assert.deepEqual(await first, { cancelled: false, cwd: "/workspace/one" });
});

test("FolderPicker maps timeout and invalid selections without exposing process details", async () => {
  const timedOut = new FolderPicker({
    platform: "darwin",
    execFileImpl(_command, _args, _options, callback) {
      callback(Object.assign(new Error("secret stderr"), { killed: true, signal: "SIGTERM" }), "", "private output");
    },
  });
  await assert.rejects(
    timedOut.choose(),
    (error) => error.code === "folder_picker_timeout" && error.status === 504 && !error.message.includes("secret")
  );

  const file = new FolderPicker({
    platform: "darwin",
    execFileImpl(_command, _args, _options, callback) { callback(null, "/workspace/file\n", ""); },
    statImpl: async () => ({ isDirectory: () => false }),
  });
  await assert.rejects(file.choose(), (error) => error.code === "invalid_workspace_directory");

  const unsupported = new FolderPicker({ platform: "linux" });
  await assert.rejects(unsupported.choose(), (error) => error.code === "folder_picker_unsupported" && error.status === 501);
});
