import { execFile } from "node:child_process";
import { AppError } from "../errors.js";

export class DifitLaunchError extends AppError {
  constructor(status, code, message, details) {
    super(status, code, message, details);
    this.name = "DifitLaunchError";
  }
}

export function difitArgsForMode(mode, context) {
  if (mode === "staged") return ["staged", "--background", "--no-open"];
  if (mode === "committed") {
    if (!context?.base) throw new DifitLaunchError(409, "difit_missing_base", "无法确定当前分支的远程基线");
    return ["HEAD", context.base, "--merge-base", "--background", "--no-open"];
  }
  throw new DifitLaunchError(400, "invalid_difit_mode", "不支持的 Difit 查看模式");
}

function validDifitUrl(value) {
  if (typeof value !== "string" || /\s/.test(value)) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "http:" || url.username || url.password || url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    return null;
  }
  if (url.pathname !== "/" || url.search || url.hash) return null;
  const match = value.match(/^http:\/\/(?:localhost|127\.0\.0\.1):([1-9]\d{0,4})\/?$/i);
  if (!match) return null;
  const port = Number(match[1]);
  if (!Number.isSafeInteger(port) || port > 65_535) return null;
  return value.endsWith("/") ? value : `${value}/`;
}

export function parseDifitLaunchOutput(output) {
  let handshake = null;
  for (const line of String(output || "").split("\n")) {
    const candidate = line.trim();
    if (!candidate) continue;
    try { handshake = JSON.parse(candidate); } catch {}
  }
  const url = validDifitUrl(handshake?.url);
  if (!url) throw new DifitLaunchError(502, "difit_invalid_handshake", "Difit 未返回可用的本地访问地址");
  return { ...handshake, url };
}

function processFailure(error) {
  return new DifitLaunchError(502, "difit_launch_failed", "Difit 启动失败", {
    exitCode: Number.isInteger(error?.code) ? error.code : null,
    signal: typeof error?.signal === "string" ? error.signal : null,
    timedOut: Boolean(error?.killed),
  });
}

export function launchDifit({ cliPath, cwd, mode, context, timeout = 30_000, execFileImpl = execFile }) {
  const argv = [cliPath, ...difitArgsForMode(mode, context)];
  return new Promise((resolve, reject) => {
    execFileImpl(process.execPath, argv, { cwd, timeout, maxBuffer: 1024 * 1024, shell: false }, (error, stdout) => {
      if (error) {
        reject(processFailure(error));
        return;
      }
      try { resolve(parseDifitLaunchOutput(stdout)); }
      catch (parseError) { reject(parseError); }
    });
  });
}
