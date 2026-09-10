import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { SuiteError } from "./errors.js";

const require = createRequire(import.meta.url);
const suiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function serviceDefinitions(config) {
  const shared = {
    CODEX_HOME: config.codexHome,
    CODEX_BIN: config.codexBin,
    CODEX_EXPECTED_VERSION: config.expectedCodexVersion,
    CODEX_SUITE_LOCALE: config.locale,
    SESSION_VIEWER_ORIGIN: config.origins.session,
    PLAN_VIEWER_ORIGIN: config.origins.plan,
    ARCH_VIEWER_ORIGIN: config.origins.arch,
    COLLECT_VIEWER_ORIGIN: config.origins.collect,
  };
  return [
    {
      name: "plan",
      entry: path.join(suiteRoot, "apps/plan/server.js"),
      env: { ...shared, PORT: String(config.ports.plan), PLANS_DIR: config.data.plansDir },
    },
    {
      name: "arch",
      entry: path.join(suiteRoot, "apps/arch/server.js"),
      env: { ...shared, PORT: String(config.ports.arch), ARCH_DIR: config.data.archDir },
    },
    {
      name: "collect",
      entry: path.join(suiteRoot, "apps/collect/server.js"),
      env: { ...shared, PORT: String(config.ports.collect), COLLECTIONS_FILE: config.data.collectFile },
    },
    {
      name: "session",
      entry: path.join(suiteRoot, "apps/session/server.js"),
      env: {
        ...shared,
        PORT: String(config.ports.session),
        DIFIT_CLI: require.resolve("difit"),
        DIFGRAPH_APP: path.join(suiteRoot, "apps/difgraph/src/app.js"),
        CODEX_RPC_TIMEOUT_MS: String(config.timeouts.rpcMs),
        CODEX_INITIALIZE_TIMEOUT_MS: String(config.timeouts.initializeMs),
        CODEX_FOLDER_PICKER_TIMEOUT_MS: String(config.timeouts.folderPickerMs),
        CODEX_MAX_THREAD_PAGES: String(config.maxThreadPages),
      },
    },
  ];
}

async function waitUntilHealthy(origin, child, timeoutMs = 15_000) {
  let spawnError = null;
  child.once("error", (error) => { spawnError = error; });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null || child.signalCode !== null) throw new SuiteError("service_exited", `Service exited before becoming ready: ${origin}`, { origin });
    try {
      const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(750) });
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new SuiteError("service_timeout", `Service did not become ready: ${origin}`, { origin });
}

async function terminate(child, graceMs = 3_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
    child.once("exit", finish);
    try { child.kill("SIGTERM"); } catch { finish(); return; }
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      finish();
    }, graceMs);
    timer.unref?.();
  });
}

export async function startSuite(config, { registerStop } = {}) {
  await Promise.all([
    mkdir(config.data.plansDir, { recursive: true, mode: 0o700 }),
    mkdir(config.data.archDir, { recursive: true, mode: 0o700 }),
    mkdir(path.dirname(config.data.collectFile), { recursive: true, mode: 0o700 }),
  ]);
  const children = [];
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await Promise.allSettled(children.map((child) => terminate(child)));
  };
  registerStop?.(stop);

  let startupComplete = false;
  let rejectFailure;
  const done = new Promise((_resolve, reject) => { rejectFailure = reject; });
  try {
    for (const definition of serviceDefinitions(config)) {
      if (stopping) throw new SuiteError("startup_interrupted", "Suite startup was interrupted");
      const child = spawn(process.execPath, [definition.entry], {
        cwd: suiteRoot,
        env: { ...process.env, ...definition.env },
        stdio: "inherit",
        windowsHide: true,
      });
      children.push(child);
      child.once("exit", (code, signal) => {
        if (stopping || !startupComplete) return;
        const error = new SuiteError("service_stopped", `A required service exited unexpectedly (${signal || code})`, { reason: signal || code });
        void stop().then(() => rejectFailure(error));
      });
      await waitUntilHealthy(config.origins[definition.name], child);
    }
    startupComplete = true;
  } catch (error) {
    await stop();
    throw error;
  }
  return { children, stop, done, url: config.origins.session };
}

export function openBrowser(url) {
  const command = process.platform === "darwin"
    ? ["open", [url]]
    : process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : ["xdg-open", [url]];
  const child = spawn(command[0], command[1], { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
