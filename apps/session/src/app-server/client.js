import { EventEmitter } from "node:events";
import { execFile, spawn } from "node:child_process";
import { JsonlDecoder } from "./jsonl-decoder.js";

function offlineError(message = "Codex app-server is offline") {
  return Object.assign(new Error(message), { code: "APP_SERVER_OFFLINE" });
}

function rpcError(method, payload) {
  const error = new Error(payload?.message || `RPC ${method} failed`);
  error.name = "RpcError";
  error.code = payload?.code ?? "RPC_ERROR";
  error.data = payload?.data;
  return error;
}

const PERMISSION_RPC_METHODS = new Set(["thread/start", "thread/resume", "thread/settings/update"]);

function permissionSnapshot(value) {
  const settings = value?.threadSettings || value?.thread_settings || value?.settings || value || {};
  const sandbox = settings.sandboxPolicy ?? settings.sandbox_policy ?? settings.sandbox;
  const permissionProfile = settings.permissionProfile ?? settings.permission_profile;
  return {
    threadId: settings.threadId ?? settings.thread_id ?? settings.thread?.id ?? null,
    approvalPolicy: settings.approvalPolicy ?? settings.approval_policy ?? null,
    sandbox: typeof sandbox === "string" ? sandbox : sandbox?.type ?? null,
    permissionProfile: typeof permissionProfile === "string" ? permissionProfile : permissionProfile?.type ?? null,
  };
}

export function parseCodexVersion(output) {
  const match = String(output).match(/(?:codex(?:-cli)?\s+)?(\d+\.\d+\.\d+)/i);
  return match?.[1] || null;
}

export function probeCodexVersion(codexBin, exec = execFile) {
  return new Promise((resolve) => {
    exec(codexBin, ["--version"], { timeout: 10_000 }, (error, stdout, stderr) => {
      const output = `${stdout || ""}\n${stderr || ""}`.trim();
      resolve({
        ok: !error,
        version: parseCodexVersion(output),
        output: output.slice(0, 500),
        error: error ? error.message : null,
      });
    });
  });
}

export class AppServerClient extends EventEmitter {
  #config;
  #spawn;
  #child = null;
  #decoder = null;
  #pending = new Map();
  #nextId = 1;
  #state = "stopped";
  #lastError = null;
  #actualVersion = null;
  #restartPromise = null;

  constructor(config, options = {}) {
    super();
    this.#config = config;
    this.#spawn = options.spawn || spawn;
  }

  get state() {
    return this.#state;
  }

  get isReady() {
    return this.#state === "ready";
  }

  health() {
    return {
      state: this.#state,
      ready: this.isReady,
      expectedVersion: this.#config.expectedCodexVersion,
      actualVersion: this.#actualVersion,
      compatible: this.#actualVersion === this.#config.expectedCodexVersion,
      capabilities: {
        experimentalApi: this.isReady,
        elicitationForm: this.isReady,
      },
      error: this.#lastError,
    };
  }

  async start() {
    if (!["stopped", "offline", "incompatible"].includes(this.#state)) return this.health();
    this.#setState("probing");
    const probe = await probeCodexVersion(this.#config.codexBin);
    this.#actualVersion = probe.version;
    if (!probe.ok || !probe.version) {
      this.#lastError = probe.error || `无法识别 Codex 版本：${probe.output}`;
      this.#setState("offline");
      return this.health();
    }
    if (probe.version !== this.#config.expectedCodexVersion) {
      this.#lastError = `仅支持 Codex ${this.#config.expectedCodexVersion}，当前为 ${probe.version}`;
      this.#setState("incompatible");
      return this.health();
    }

    this.#setState("starting");
    this.#decoder = new JsonlDecoder();
    const child = this.#spawn(this.#config.codexBin, ["app-server", "--listen", "stdio://"], {
      env: { ...process.env, CODEX_HOME: this.#config.codexHome },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.#child = child;

    child.stdout.on("data", (chunk) => this.#consume(chunk));
    child.stderr.on("data", (chunk) => this.emit("diagnostic", String(chunk).slice(0, 2_000)));
    child.on("error", (error) => this.#goOffline(error));
    child.on("exit", (code, signal) => {
      if (this.#child !== child) return;
      try {
        for (const message of this.#decoder.finish()) this.#handleMessage(message);
      } catch (error) {
        this.#lastError = `协议流结尾无效：${error.message}`;
      }
      this.#goOffline(new Error(`app-server exited (code=${code}, signal=${signal})`));
    });

    try {
      this.#setState("initializing");
      await this.request("initialize", {
        clientInfo: { name: "codex-session-viewer", title: "Codex Session", version: "0.5.0" },
        capabilities: {
          experimentalApi: true,
          extensions: { "openai/elicitation": { form: {} } },
        },
      }, this.#config.initializeTimeoutMs, { allowBeforeReady: true });
      this.notify("initialized");
      this.#lastError = null;
      this.#setState("ready");
    } catch (error) {
      this.#lastError = `初始化失败：${error.message}`;
      this.#child?.kill();
      this.#goOffline(error);
    }
    return this.health();
  }

  stop() {
    const child = this.#child;
    this.#child = null;
    if (child && !child.killed) child.kill("SIGTERM");
    this.#rejectPending(offlineError("Codex app-server stopped"));
    this.#setState("stopped");
  }

  async restart() {
    if (this.#restartPromise) return this.#restartPromise;
    const operation = (async () => {
      this.stop();
      return this.start();
    })();
    this.#restartPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.#restartPromise === operation) this.#restartPromise = null;
    }
  }

  request(method, params = {}, timeoutMs = this.#config.rpcTimeoutMs, options = {}) {
    if (this.#state === "incompatible") {
      return Promise.reject(Object.assign(new Error(this.#lastError || "Incompatible Codex version"), { code: "CODEX_INCOMPATIBLE" }));
    }
    if (!this.#child || (!this.isReady && !options.allowBeforeReady)) {
      return Promise.reject(offlineError());
    }
    const id = this.#nextId++;
    if (PERMISSION_RPC_METHODS.has(method)) {
      this.emit("permissionAudit", {
        direction: "viewer-request",
        requestId: id,
        method,
        ...permissionSnapshot(params),
      });
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(Object.assign(new Error(`RPC ${method} timed out after ${timeoutMs}ms`), { code: "RPC_TIMEOUT" }));
      }, timeoutMs);
      timer.unref?.();
      this.#pending.set(id, { method, resolve, reject, timer });
      try {
        this.#send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    if (!this.#child) throw offlineError();
    this.#send(params === undefined ? { method } : { method, params });
  }

  respond(id, result) {
    if (!this.#child) throw offlineError();
    this.#send({ id, result });
  }

  respondError(id, code, message, data) {
    if (!this.#child) throw offlineError();
    this.#send({ id, error: { code, message, ...(data === undefined ? {} : { data }) } });
  }

  #send(message) {
    if (!this.#child?.stdin?.writable) throw offlineError();
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #consume(chunk) {
    try {
      for (const message of this.#decoder.push(chunk)) this.#handleMessage(message);
    } catch (error) {
      this.#lastError = `app-server 协议流无效：${error.message}`;
      this.emit("protocolError", error);
      this.#child?.kill();
    }
  }

  #handleMessage(message) {
    if (Object.hasOwn(message, "id") && typeof message.method === "string") {
      this.emit("serverRequest", { id: message.id, method: message.method, params: message.params || {} });
      return;
    }
    if (Object.hasOwn(message, "id")) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(rpcError(pending.method, message.error));
      else {
        if (PERMISSION_RPC_METHODS.has(pending.method)) {
          this.emit("permissionAudit", {
            direction: "app-server-response",
            requestId: message.id,
            method: pending.method,
            ...permissionSnapshot(message.result),
          });
        }
        pending.resolve(message.result);
      }
      return;
    }
    if (typeof message.method === "string") {
      if (message.method === "thread/settings/updated") {
        this.emit("permissionAudit", {
          direction: "app-server-notification",
          method: message.method,
          ...permissionSnapshot(message.params),
        });
      }
      this.emit("notification", { method: message.method, params: message.params || {} });
    }
  }

  #goOffline(error) {
    if (this.#state === "stopped") return;
    this.#child = null;
    this.#lastError = this.#lastError || error.message;
    this.#rejectPending(offlineError(error.message));
    this.#setState("offline");
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  #setState(state) {
    if (this.#state === state) return;
    this.#state = state;
    this.emit("state", this.health());
  }
}
