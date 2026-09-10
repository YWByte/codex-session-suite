import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "../errors.js";

const childEntry = fileURLToPath(new URL("./difgraph-child.js", import.meta.url));

function validLoopbackUrl(value) {
  if (typeof value !== "string" || /\s/.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "http:" || url.username || url.password || !["127.0.0.1", "localhost"].includes(url.hostname)) return null;
  if (url.pathname !== "/" || url.search || url.hash || !url.port) return null;
  const port = Number(url.port);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return null;
  return url.href;
}

function launchError(code, message, details) {
  return new AppError(502, code, message, details);
}

function terminateChild(child, graceMs = 1_000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = null;
    const finish = () => {
      if (timer) clearTimeout(timer);
      resolve();
    };
    child.once("exit", finish);
    try { child.kill("SIGTERM"); } catch { finish(); return; }
    timer = setTimeout(() => {
      if (child.exitCode === null) {
        try { child.kill("SIGKILL"); } catch { finish(); }
      }
    }, graceMs);
  });
}

export function launchDifgraph({ appModulePath, repositoryPath, timeout = 30_000, spawnProcess = spawn, onSpawn }) {
  const normalizedPath = path.resolve(repositoryPath);
  return new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, [childEntry, appModulePath, normalizedPath], {
      cwd: normalizedPath,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    onSpawn?.(child);
    let stdout = "";
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const fail = (code, message, details) => finish(() => {
      void terminateChild(child);
      reject(launchError(code, message, details));
    });
    const consume = () => {
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() || "";
      for (const line of lines) {
        let handshake;
        try { handshake = JSON.parse(line); } catch { continue; }
        const url = validLoopbackUrl(handshake?.url);
        if (!url || handshake?.pid !== child.pid) continue;
        finish(() => resolve({ child, url }));
        return;
      }
    };
    const timer = setTimeout(() => fail("difgraph_launch_timeout", "Difgraph 启动超时", { timedOut: true }), timeout);
    timer.unref?.();
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; consume(); });
    child.once("error", (error) => fail("difgraph_launch_failed", "Difgraph 启动失败", { code: error?.code || null }));
    child.once("exit", (exitCode, signal) => {
      if (!settled) fail("difgraph_launch_failed", "Difgraph 启动失败", { exitCode, signal });
    });
  });
}

function running(instance) {
  return instance?.child?.exitCode === null && instance.child.signalCode === null;
}

export class DifgraphService {
  #launch;
  #instances = new Map();
  #inFlight = new Map();
  #children = new Set();
  #stopping = false;

  constructor({ launch = launchDifgraph } = {}) {
    this.#launch = launch;
  }

  launch(request) {
    if (this.#stopping) return Promise.reject(new AppError(503, "difgraph_stopping", "Difgraph 服务正在关闭"));
    const key = path.resolve(request.repositoryPath);
    const current = this.#instances.get(key);
    if (running(current)) return Promise.resolve({ url: current.url, reused: true });
    if (current) this.#instances.delete(key);
    const pending = this.#inFlight.get(key);
    if (pending) return pending;

    let spawnedChild = null;
    const trackChild = (child) => {
      if (!child || this.#children.has(child)) return;
      spawnedChild = child;
      this.#children.add(child);
      child.once("exit", () => {
        this.#children.delete(child);
        const instance = this.#instances.get(key);
        if (instance?.child === child) this.#instances.delete(key);
      });
    };
    const operation = Promise.resolve()
      .then(() => {
        if (this.#stopping) throw new AppError(503, "difgraph_stopping", "Difgraph 服务正在关闭");
        return this.#launch({ ...request, repositoryPath: key, onSpawn: trackChild });
      })
      .then(({ child, url }) => {
        trackChild(child);
        if (this.#stopping) {
          if (running({ child })) child.kill("SIGTERM");
          throw new AppError(503, "difgraph_stopping", "Difgraph 服务正在关闭");
        }
        const instance = { child: child || spawnedChild, url };
        this.#instances.set(key, instance);
        return { url, reused: false };
      });
    this.#inFlight.set(key, operation);
    operation.then(
      () => { if (this.#inFlight.get(key) === operation) this.#inFlight.delete(key); },
      () => { if (this.#inFlight.get(key) === operation) this.#inFlight.delete(key); },
    );
    return operation;
  }

  async stopAll() {
    this.#stopping = true;
    const children = [...this.#children];
    this.#instances.clear();
    this.#children.clear();
    await Promise.allSettled(children.map((child) => terminateChild(child)));
  }
}
