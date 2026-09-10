import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RolloutTokenUsageReader } from "../src/services/rollout-token-usage.js";

function record(type, payload) {
  return JSON.stringify({ timestamp: "2026-09-08T00:00:00.000Z", type, payload });
}

function tokenRecord(threadId, input, output, totalInput = input, totalOutput = output) {
  return record("token_usage_record", {
    thread_id: threadId,
    usage: { input_tokens: input, cached_input_tokens: 100, output_tokens: output, reasoning_output_tokens: 20, total_tokens: input + output },
    turn_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
    thread_token_usage: { input_tokens: totalInput, output_tokens: totalOutput, total_tokens: totalInput + totalOutput },
  });
}

async function withHome(callback) {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-token-reader-"));
  try { await callback(codexHome); }
  finally { await rm(codexHome, { recursive: true, force: true }); }
}

async function writeRollout(codexHome, threadId, lines, { archived = false, timestamp = "2026-09-08T12-00-00" } = {}) {
  const directory = archived
    ? path.join(codexHome, "archived_sessions")
    : path.join(codexHome, "sessions", "2026", "09", "08");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `rollout-${timestamp}-${threadId}.jsonl`);
  await writeFile(file, `${[record("session_meta", { id: threadId }), ...lines].join("\n")}\n`);
  return file;
}

test("RolloutTokenUsageReader returns the latest response and cumulative thread usage", async () => {
  await withHome(async (codexHome) => {
    const threadId = "01a07f9f-dc29-7c13-a8d8-f69866e14fd3";
    await writeRollout(codexHome, threadId, [
      tokenRecord(threadId, 5_914, 95),
      record("response_item", { text: "answer" }),
      tokenRecord(threadId, 8_507, 139, 14_421, 234),
      record("event_msg", { type: "task_complete" }),
      "{truncated",
    ]);
    const reader = new RolloutTokenUsageReader({ codexHome });

    assert.deepEqual(await reader.readLatest(threadId), {
      last: {
        inputTokens: 8_507,
        cachedInputTokens: 100,
        cacheWriteInputTokens: 0,
        outputTokens: 139,
        reasoningOutputTokens: 20,
        totalTokens: 8_646,
      },
      total: {
        inputTokens: 14_421,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 234,
        reasoningOutputTokens: 0,
        totalTokens: 14_655,
      },
      modelContextWindow: null,
    });
  });
});

test("RolloutTokenUsageReader separates archived sessions and verifies thread ownership", async () => {
  await withHome(async (codexHome) => {
    const threadId = "thread_archived";
    await writeRollout(codexHome, threadId, [tokenRecord(threadId, 1, 2)], { archived: true });
    const currentDirectory = path.join(codexHome, "sessions", "2026", "09", "08");
    await mkdir(currentDirectory, { recursive: true });
    await writeFile(
      path.join(currentDirectory, `rollout-2026-09-09T12-00-00-${threadId}.jsonl`),
      `${record("session_meta", { id: "different_thread" })}\n${tokenRecord(threadId, 9, 9)}\n`
    );
    const reader = new RolloutTokenUsageReader({ codexHome });

    assert.equal(await reader.readLatest(threadId), null);
    assert.equal((await reader.readLatest(threadId, { archived: true })).last.inputTokens, 1);
    assert.equal(await reader.readLatest("../auth.json"), null);
  });
});
