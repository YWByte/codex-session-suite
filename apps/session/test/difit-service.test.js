import assert from "node:assert/strict";
import test from "node:test";
import { DifitService } from "../src/services/difit-service.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("DifitService coalesces an in-flight launch only for the same thread and mode", async () => {
  const launches = [];
  const service = new DifitService({
    launch(request) {
      const pending = deferred();
      launches.push({ request, pending });
      return pending.promise;
    },
  });
  const stagedRequest = { threadId: "thread_one", mode: "staged", cwd: "/repo" };
  const sameStaged = service.launch(stagedRequest);
  const duplicateStaged = service.launch({ ...stagedRequest });
  const committed = service.launch({ ...stagedRequest, mode: "committed" });
  const otherThread = service.launch({ ...stagedRequest, threadId: "thread_two" });

  assert.equal(sameStaged, duplicateStaged);
  await Promise.resolve();
  assert.equal(launches.length, 3);

  launches[0].pending.resolve({ url: "http://localhost:4001/" });
  launches[1].pending.resolve({ url: "http://localhost:4002/" });
  launches[2].pending.resolve({ url: "http://localhost:4003/" });
  assert.deepEqual(await Promise.all([sameStaged, duplicateStaged, committed, otherThread]), [
    { url: "http://localhost:4001/" },
    { url: "http://localhost:4001/" },
    { url: "http://localhost:4002/" },
    { url: "http://localhost:4003/" },
  ]);
});

test("DifitService releases a failed key and does not retry it automatically", async () => {
  let attempts = 0;
  const service = new DifitService({
    launch() {
      attempts += 1;
      if (attempts === 1) throw new Error("launch failed");
      return { url: "http://127.0.0.1:4567/" };
    },
  });
  const request = { threadId: "thread_one", mode: "staged" };

  await assert.rejects(service.launch(request), /launch failed/);
  assert.equal(attempts, 1);
  assert.deepEqual(await service.launch(request), { url: "http://127.0.0.1:4567/" });
  assert.equal(attempts, 2);
});
