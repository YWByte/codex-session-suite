import assert from "node:assert/strict";
import test from "node:test";
import { DifitLaunchError, launchDifit, parseDifitLaunchOutput } from "../src/services/difit-launcher.js";

test("launchDifit starts the independent Difit CLI through node without a shell", async () => {
  let invocation;
  const result = await launchDifit({
    cliPath: "/tools/difit/dist/cli/index.js",
    cwd: "/workspace/repository",
    mode: "staged",
    context: {},
    execFileImpl(command, args, options, callback) {
      invocation = { command, args, options };
      callback(null, 'starting\n{"url":"http://localhost:4567/","pid":99}\n', "");
    },
  });

  assert.deepEqual(result, { url: "http://localhost:4567/", pid: 99 });
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, ["/tools/difit/dist/cli/index.js", "staged", "--background", "--no-open"]);
  assert.equal(invocation.options.cwd, "/workspace/repository");
  assert.equal(invocation.options.shell, false);
});

test("launchDifit maps process failures without exposing stderr", async () => {
  await assert.rejects(
    launchDifit({
      cliPath: "/tools/difit/dist/cli/index.js",
      cwd: "/workspace/repository",
      mode: "staged",
      context: {},
      execFileImpl(_command, _args, _options, callback) {
        callback(Object.assign(new Error("command failed"), { code: 23, signal: "SIGTERM", killed: true }), "", "secret internal stderr");
      },
    }),
    (error) => {
      assert.ok(error instanceof DifitLaunchError);
      assert.equal(error.code, "difit_launch_failed");
      assert.equal(error.status, 502);
      assert.equal(error.message, "Difit 启动失败");
      assert.deepEqual(error.details, { exitCode: 23, signal: "SIGTERM", timedOut: true });
      assert.equal("stderr" in error, false);
      assert.doesNotMatch(error.message, /secret internal stderr/);
      return true;
    }
  );
});

test("Difit rejects missing, malformed, credentialed, and non-loopback handshakes", () => {
  for (const output of [
    "not json",
    '{"url":"http://localhost:0/"}',
    '{"url":"http://localhost:4567/?token=secret"}',
    '{"url":"http://user:secret@localhost:4567/"}',
    '{"url":"http://127.0.0.1:4567/path"}',
    '{"url":"http://example.com:4567/"}',
    '{"url":"https://127.0.0.1:4567/"}',
  ]) {
    assert.throws(() => parseDifitLaunchOutput(output), (error) => error?.code === "difit_invalid_handshake");
  }
});
