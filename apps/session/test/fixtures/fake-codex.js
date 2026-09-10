#!/usr/bin/env node
import readline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 0.153.2\n");
  process.exit(0);
}

if (process.argv[2] !== "app-server") process.exit(2);

const lines = readline.createInterface({ input: process.stdin });
let initialized = false;
let initializeParams = null;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    initializeParams = message.params;
    send({ id: message.id, result: { userAgent: "fixture", codexHome: "/tmp/fake", platformFamily: "unix", platformOs: "macos" } });
    return;
  }
  if (message.method === "initialized") {
    initialized = true;
    send({ method: "fixture/initialized", params: { ok: true, initializeParams } });
    send({ id: "server-request-1", method: "item/commandExecution/requestApproval", params: { threadId: "thread-1", command: "true" } });
    return;
  }
  if (!initialized) {
    send({ id: message.id, error: { code: -32002, message: "Not initialized" } });
    return;
  }
  if (message.id === "server-request-1" && message.result) {
    send({ method: "fixture/responded", params: message.result });
    return;
  }
  if (message.method === "thread/list") {
    send({ id: message.id, result: { data: [{ id: "thread-1", cwd: "/tmp/fake" }], nextCursor: null } });
    return;
  }
  if (message.method === "thread/resume") {
    send({ id: message.id, result: { thread: { id: message.params.threadId }, approvalPolicy: message.params.approvalPolicy, sandbox: { type: "dangerFullAccess" } } });
    return;
  }
  if (message.method === "fixture/hang") return;
  send({ id: message.id, error: { code: -32601, message: "Method not found" } });
});
