import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import net from "node:net";
import { promisify } from "node:util";
import { SuiteError } from "./errors.js";

const execFileAsync = promisify(execFile);

async function assertPortAvailable(host, port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", (error) => reject(new SuiteError("port_unavailable", `Port ${port} is unavailable on ${host}: ${error.message}`, { port, host, reason: error.message })));
    server.listen(port, host, () => server.close(resolve));
  });
}

export async function inspectCodex(config) {
  if (!config.codexBin) throw new SuiteError("codex_not_found", "Codex CLI was not found on PATH; configure codex.bin or CODEX_BIN");
  await access(config.codexBin, constants.X_OK);
  const { stdout, stderr } = await execFileAsync(config.codexBin, ["--version"], { timeout: 10_000 });
  const output = `${stdout}\n${stderr}`.trim();
  const match = output.match(/(?:codex(?:-cli)?\s+)?(\d+\.\d+\.\d+)/i);
  if (!match) throw new SuiteError("codex_version_parse", `Unable to parse Codex CLI version from: ${output}`);
  if (match[1] !== config.expectedCodexVersion) {
    throw new SuiteError("codex_version_mismatch", `Codex CLI ${config.expectedCodexVersion} is required, but ${match[1]} was found at ${config.codexBin}`, { expected: config.expectedCodexVersion, actual: match[1], path: config.codexBin });
  }
  return { path: config.codexBin, version: match[1] };
}

export async function runDoctor(config, { checkPorts = true } = {}) {
  await stat(config.codexHome).catch((error) => {
    if (error.code === "ENOENT") throw new SuiteError("codex_home_missing", `Codex home does not exist: ${config.codexHome}`, { path: config.codexHome });
    throw error;
  });
  const codex = await inspectCodex(config);
  if (checkPorts) await Promise.all(Object.values(config.ports).map((port) => assertPortAvailable(config.host, port)));
  return { codex, ports: config.ports };
}
