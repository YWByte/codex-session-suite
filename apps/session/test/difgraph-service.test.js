import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { DifgraphService, launchDifgraph } from "../src/services/difgraph-service.js";

class FakeChild extends EventEmitter {
  constructor(pid = 4321) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.signalCode = null;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.kills = [];
  }

  kill(signal = "SIGTERM") {
    this.kills.push(signal);
    this.signalCode = signal;
    queueMicrotask(() => this.emit("exit", null, signal));
    return true;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("launchDifgraph starts the fixed child bridge without a shell and accepts a loopback handshake", async () => {
  const child = new FakeChild();
  let invocation;
  const launched = launchDifgraph({
    appModulePath: "/tools/difgraph/src/app.js",
    repositoryPath: "/workspace/repository",
    spawnProcess(command, args, options) {
      invocation = { command, args, options };
      queueMicrotask(() => child.stdout.write(`${JSON.stringify({ url: "http://127.0.0.1:4173", pid: child.pid })}\n`));
      return child;
    },
  });

  const result = await launched;
  assert.equal(result.url, "http://127.0.0.1:4173/");
  assert.equal(result.child, child);
  assert.equal(invocation.command, process.execPath);
  assert.equal(invocation.args[1], "/tools/difgraph/src/app.js");
  assert.equal(invocation.args[2], "/workspace/repository");
  assert.equal(invocation.options.cwd, "/workspace/repository");
  assert.equal(invocation.options.shell, false);
  child.kill();
});

test("launchDifgraph rejects non-loopback and mismatched-process handshakes", async () => {
  for (const handshake of [
    { url: "http://example.com:4173/", pid: 4321 },
    { url: "http://127.0.0.1:4173/path", pid: 4321 },
    { url: "http://127.0.0.1:4173/", pid: 99 },
  ]) {
    const child = new FakeChild();
    const launched = launchDifgraph({
      appModulePath: "/tools/difgraph/src/app.js",
      repositoryPath: "/workspace/repository",
      spawnProcess() {
        queueMicrotask(() => {
          child.stdout.write(`${JSON.stringify(handshake)}\n`);
          child.exitCode = 1;
          child.emit("exit", 1, null);
        });
        return child;
      },
    });
    await assert.rejects(launched, (error) => error?.code === "difgraph_launch_failed");
  }
});

test("DifgraphService coalesces launches, reuses a repository instance, and invalidates it on exit", async () => {
  const launches = [];
  const service = new DifgraphService({
    launch(request) {
      const pending = deferred();
      const child = new FakeChild(5000 + launches.length);
      request.onSpawn(child);
      launches.push({ request, pending, child });
      return pending.promise;
    },
  });
  const request = { appModulePath: "/tools/difgraph/src/app.js", repositoryPath: "/repo" };
  const first = service.launch(request);
  const duplicate = service.launch({ ...request });
  assert.equal(first, duplicate);
  await Promise.resolve();
  assert.equal(launches.length, 1);

  launches[0].pending.resolve({ child: launches[0].child, url: "http://127.0.0.1:4100/" });
  assert.deepEqual(await first, { url: "http://127.0.0.1:4100/", reused: false });
  assert.deepEqual(await service.launch(request), { url: "http://127.0.0.1:4100/", reused: true });
  assert.equal(launches.length, 1);

  launches[0].child.exitCode = 1;
  launches[0].child.emit("exit", 1, null);
  const restarted = service.launch(request);
  await Promise.resolve();
  assert.equal(launches.length, 2);
  launches[1].pending.resolve({ child: launches[1].child, url: "http://127.0.0.1:4200/" });
  assert.deepEqual(await restarted, { url: "http://127.0.0.1:4200/", reused: false });
  await service.stopAll();
  assert.deepEqual(launches[1].child.kills, ["SIGTERM"]);
});

test("DifgraphService stops a child that is still starting", async () => {
  const pending = deferred();
  const child = new FakeChild();
  const service = new DifgraphService({
    launch(request) {
      request.onSpawn(child);
      return pending.promise;
    },
  });
  const launching = service.launch({ appModulePath: "/tools/difgraph/src/app.js", repositoryPath: "/repo" });
  await Promise.resolve();
  await service.stopAll();
  assert.deepEqual(child.kills, ["SIGTERM"]);
  pending.reject(new Error("stopped"));
  await assert.rejects(launching, /stopped/);
});
