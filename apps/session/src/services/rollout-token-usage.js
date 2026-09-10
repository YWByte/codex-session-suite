import { open, readdir, realpath } from "node:fs/promises";
import path from "node:path";

const MAX_HEAD_BYTES = 256 * 1024;
const MAX_TAIL_BYTES = 4 * 1024 * 1024;
const MAX_RECORD_BYTES = 256 * 1024;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usageBreakdown(value) {
  if (!value || typeof value !== "object") return null;
  const number = (key) => {
    const parsed = Number(value[key]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  return {
    inputTokens: number("input_tokens"),
    cachedInputTokens: number("cached_input_tokens"),
    cacheWriteInputTokens: number("cache_write_input_tokens"),
    outputTokens: number("output_tokens"),
    reasoningOutputTokens: number("reasoning_output_tokens"),
    totalTokens: number("total_tokens"),
  };
}

async function collectCandidates(directory, basenamePattern, output, depth = 0) {
  if (depth > 6) return;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectCandidates(candidate, basenamePattern, output, depth + 1);
    } else if (entry.isFile() && basenamePattern.test(entry.name)) {
      output.push(candidate);
    }
  }
}

async function readRange(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead).toString("utf8");
}

async function belongsToThread(handle, threadId, size) {
  const head = await readRange(handle, 0, Math.min(size, MAX_HEAD_BYTES));
  const firstLine = head.split(/\r?\n/, 1)[0];
  if (!firstLine || Buffer.byteLength(firstLine, "utf8") >= MAX_HEAD_BYTES) return false;
  try {
    const record = JSON.parse(firstLine);
    return record?.type === "session_meta" && record?.payload?.id === threadId;
  } catch {
    return false;
  }
}

async function latestUsageFromFile(filePath, root, threadId) {
  const canonicalRoot = await realpath(root);
  const canonicalFile = await realpath(filePath);
  if (canonicalFile !== canonicalRoot && !canonicalFile.startsWith(`${canonicalRoot}${path.sep}`)) return null;

  const handle = await open(canonicalFile, "r");
  try {
    const { size } = await handle.stat();
    if (!size || !(await belongsToThread(handle, threadId, size))) return null;
    const start = Math.max(0, size - MAX_TAIL_BYTES);
    const tail = await readRange(handle, start, size - start);
    const lines = tail.split(/\r?\n/);
    if (start > 0) lines.shift();
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (!line || line.length > MAX_RECORD_BYTES || !line.includes('"token_usage_record"')) continue;
      try {
        const record = JSON.parse(line);
        if (record?.type !== "token_usage_record" || record?.payload?.thread_id !== threadId) continue;
        const last = usageBreakdown(record.payload.usage);
        const total = usageBreakdown(record.payload.thread_token_usage);
        if (last && total) return { last, total, modelContextWindow: null };
      } catch {}
    }
    return null;
  } finally {
    await handle.close();
  }
}

export class RolloutTokenUsageReader {
  #codexHome;

  constructor({ codexHome }) {
    this.#codexHome = path.resolve(codexHome);
  }

  async readLatest(threadId, { archived = false } = {}) {
    if (typeof threadId !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/.test(threadId)) return null;
    const root = path.join(this.#codexHome, archived ? "archived_sessions" : "sessions");
    const pattern = new RegExp(`^rollout-.+-${escapeRegExp(threadId)}(?:_[A-Za-z0-9-]+)?\\.jsonl$`);
    const candidates = [];
    await collectCandidates(root, pattern, candidates);
    candidates.sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
    for (const candidate of candidates) {
      try {
        const usage = await latestUsageFromFile(candidate, root, threadId);
        if (usage) return usage;
      } catch {}
    }
    return null;
  }
}
