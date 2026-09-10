import assert from "node:assert/strict";
import test from "node:test";
import { PathOpener } from "../src/services/path-opener.js";

function metadata(kind) {
  return {
    isDirectory: () => kind === "directory",
    isFile: () => kind === "file",
  };
}

test("PathOpener opens directories in Finder and files with the default application without a shell", async () => {
  const invocations = [];
  let kind = "directory";
  const opener = new PathOpener({
    platform: "darwin",
    timeout: 4321,
    statImpl: async () => metadata(kind),
    execFileImpl(command, args, options, callback) {
      invocations.push({ command, args, options });
      callback(null, "", "");
    },
  });

  assert.deepEqual(await opener.open("/Users/example/Work/project"), { kind: "directory" });
  kind = "file";
  assert.deepEqual(await opener.open("/Users/example/Work/project/app.js"), { kind: "file" });
  assert.deepEqual(invocations.map(({ command, args }) => ({ command, args })), [
    { command: "/usr/bin/open", args: ["/Users/example/Work/project"] },
    { command: "/usr/bin/open", args: ["/Users/example/Work/project/app.js"] },
  ]);
  assert.equal(invocations[0].options.shell, false);
  assert.equal(invocations[0].options.timeout, 4321);
});

test("PathOpener opens VS Code file positions through the registered vscode URL handler", async () => {
  const invocations = [];
  const opener = new PathOpener({
    platform: "darwin",
    statImpl: async () => metadata("file"),
    execFileImpl(command, args, options, callback) {
      invocations.push({ command, args, options });
      callback(null, "", "");
    },
  });

  assert.deepEqual(
    await opener.open("/Users/example/Work/my project/app.js", { application: "vscode", line: 110, column: 1 }),
    { kind: "file", application: "vscode" }
  );
  assert.deepEqual(invocations.map(({ command, args }) => ({ command, args })), [
    { command: "/usr/bin/open", args: ["vscode://file/Users/example/Work/my%20project/app.js:110:1"] },
  ]);
  assert.equal(invocations[0].options.shell, false);
});

test("PathOpener rejects invalid VS Code targets and positions", async () => {
  const fileOpener = new PathOpener({ platform: "darwin", statImpl: async () => metadata("file") });
  await assert.rejects(
    fileOpener.open("/workspace/app.js", { application: "other", line: 1, column: 1 }),
    (error) => error.code === "invalid_application" && error.status === 400
  );
  for (const options of [
    { application: "vscode" },
    { application: "vscode", line: 0, column: 1 },
    { application: "vscode", line: 1, column: "1" },
  ]) {
    await assert.rejects(
      fileOpener.open("/workspace/app.js", options),
      (error) => error.code === "invalid_editor_position" && error.status === 400
    );
  }
  const directoryOpener = new PathOpener({ platform: "darwin", statImpl: async () => metadata("directory") });
  await assert.rejects(
    directoryOpener.open("/workspace/project", { application: "vscode", line: 1, column: 1 }),
    (error) => error.code === "unsupported_editor_path" && error.status === 409
  );
});

test("PathOpener rejects invalid, missing, and unsupported paths", async () => {
  const opener = new PathOpener({
    platform: "darwin",
    statImpl: async (target) => {
      if (target === "/missing") throw new Error("private filesystem detail");
      return metadata("other");
    },
  });

  for (const value of [undefined, "", " relative", "relative/file", "/tmp/bad\0path", `/${"x".repeat(17_000)}`]) {
    await assert.rejects(opener.open(value), (error) => error.code === "invalid_path" && error.status === 400);
  }
  await assert.rejects(opener.open("/missing"), (error) => error.code === "path_not_found" && error.status === 404 && !error.message.includes("private"));
  await assert.rejects(opener.open("/device"), (error) => error.code === "unsupported_path_type" && error.status === 409);
  await assert.rejects(new PathOpener({ platform: "linux" }).open("/tmp/file"), (error) => error.code === "path_open_unsupported" && error.status === 501);
});

test("PathOpener maps process failures without exposing command output", async () => {
  const failed = new PathOpener({
    platform: "darwin",
    statImpl: async () => metadata("file"),
    execFileImpl(_command, _args, _options, callback) {
      callback(Object.assign(new Error("secret stderr"), { code: 1 }), "", "private output");
    },
  });
  await assert.rejects(
    failed.open("/Users/example/private.txt"),
    (error) => error.code === "path_open_failed" && error.status === 502 && !error.message.includes("secret") && !error.message.includes("private.txt")
  );

  const timedOut = new PathOpener({
    platform: "darwin",
    statImpl: async () => metadata("directory"),
    execFileImpl(_command, _args, _options, callback) {
      callback(Object.assign(new Error("timeout"), { killed: true, signal: "SIGTERM" }), "", "");
    },
  });
  await assert.rejects(timedOut.open("/Users/example/Work"), (error) => error.code === "path_open_timeout" && error.status === 504);
});
