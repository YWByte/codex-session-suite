import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { chmod, cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForOutput(read, pattern, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pattern.test(read())) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for output: ${pattern}`);
}

async function waitForHealth(origin, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${origin}`);
}

test("installs the tarball and starts all four services with fake Codex", { timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-suite-pack-"));
  const packDirectory = path.join(directory, "pack");
  const installDirectory = path.join(directory, "install");
  await execFileAsync("mkdir", ["-p", packDirectory, installDirectory]);
  const { stdout } = await execFileAsync("npm", ["pack", "--json", "--pack-destination", packDirectory], { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  const report = JSON.parse(stdout)[0];
  assert.equal(report.files.some(({ path: file }) => file.includes("/test/")), false);
  const tarball = path.join(packDirectory, report.filename);
  await execFileAsync("npm", ["install", "--ignore-scripts", "--prefix", installDirectory, tarball], { cwd: directory, timeout: 60_000 });

  const fakeCodex = path.join(directory, "fake-codex.js");
  await cp(path.join(root, "apps/session/test/fixtures/fake-codex.js"), fakeCodex);
  await chmod(fakeCodex, 0o755);
  const ports = await Promise.all([availablePort(), availablePort(), availablePort(), availablePort()]);
  assert.equal(new Set(ports).size, 4);
  const configPath = path.join(directory, "config.toml");
  await writeFile(configPath, `[services]\nsession_port = ${ports[0]}\nplan_port = ${ports[1]}\narch_port = ${ports[2]}\ncollect_port = ${ports[3]}\n[codex]\nbin = ${JSON.stringify(fakeCodex)}\nhome = ${JSON.stringify(directory)}\n[ui]\nlocale = "en"\nopen_browser = false\n`);
  const executable = path.join(installDirectory, "node_modules", ".bin", "codex-session-suite");
  const child = spawn(executable, ["start", "--config", configPath, "--no-open"], { cwd: directory, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    await Promise.all(ports.map((port) => waitForHealth(`http://127.0.0.1:${port}`)));
    await waitForOutput(() => output, /Codex Session Suite is available/);
    const config = await (await fetch(`http://127.0.0.1:${ports[0]}/api/config`)).json();
    assert.equal(config.viewerOrigins.collect, `http://127.0.0.1:${ports[3]}`);
    for (const url of [
      `http://127.0.0.1:${ports[0]}/vendor/marked.js`,
      `http://127.0.0.1:${ports[1]}/vendor/katex.js`,
      `http://127.0.0.1:${ports[2]}/vendor/mermaid.js`,
      `http://127.0.0.1:${ports[3]}/vendor/purify.js`,
    ]) {
      const response = await fetch(url);
      assert.equal(response.status, 200, url);
      assert.ok((await response.arrayBuffer()).byteLength > 100, url);
    }
    const installedSuiteRoot = path.join(installDirectory, 'node_modules', 'codex-session-suite');
    const installedRequire = createRequire(path.join(installedSuiteRoot, 'src', 'suite.js'));
    assert.match(installedRequire.resolve('difit'), /difit[\/]dist[\/]cli[\/]index\.js$/);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  assert.match(output, /Codex Session Suite is available/);
});
