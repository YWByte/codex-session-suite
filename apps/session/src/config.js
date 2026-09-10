import path from "node:path";

const DEFAULT_CODEX_BIN = "codex";
const DEFAULT_CODEX_HOME = path.join(process.env.HOME || process.cwd(), ".codex-cli");
const DEFAULT_DIFIT_CLI = path.resolve("node_modules/difit/dist/cli/index.js");
const DEFAULT_DIFGRAPH_APP = path.resolve("apps/difgraph/src/app.js");

function positiveInteger(value, fallback, name) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  const host = "127.0.0.1";
  const port = positiveInteger(env.PORT, 3460, "PORT");
  if (port > 65_535) throw new Error("PORT must be at most 65535");

  return Object.freeze({
    host,
    port,
    origin: `http://${host}:${port}`,
    codexBin: path.resolve(env.CODEX_BIN || DEFAULT_CODEX_BIN),
    codexHome: path.resolve(env.CODEX_HOME || DEFAULT_CODEX_HOME),
    difitCli: path.resolve(env.DIFIT_CLI || DEFAULT_DIFIT_CLI),
    difgraphApp: path.resolve(env.DIFGRAPH_APP || DEFAULT_DIFGRAPH_APP),
    expectedCodexVersion: env.CODEX_EXPECTED_VERSION || "0.153.2",
    locale: env.CODEX_SUITE_LOCALE || "auto",
    viewerOrigins: Object.freeze({
      session: env.SESSION_VIEWER_ORIGIN || `http://${host}:${port}`,
      plan: env.PLAN_VIEWER_ORIGIN || "http://127.0.0.1:3458",
      arch: env.ARCH_VIEWER_ORIGIN || "http://127.0.0.1:3459",
      collect: env.COLLECT_VIEWER_ORIGIN || "http://127.0.0.1:3461",
    }),
    rpcTimeoutMs: positiveInteger(env.CODEX_RPC_TIMEOUT_MS, 15_000, "CODEX_RPC_TIMEOUT_MS"),
    initializeTimeoutMs: positiveInteger(env.CODEX_INITIALIZE_TIMEOUT_MS, 20_000, "CODEX_INITIALIZE_TIMEOUT_MS"),
    folderPickerTimeoutMs: positiveInteger(env.CODEX_FOLDER_PICKER_TIMEOUT_MS, 120_000, "CODEX_FOLDER_PICKER_TIMEOUT_MS"),
    maxRequestBytes: "24mb",
    maxThreadPages: positiveInteger(env.CODEX_MAX_THREAD_PAGES, 1_000, "CODEX_MAX_THREAD_PAGES"),
  });
}
