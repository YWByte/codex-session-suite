import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors.js";

const MAX_PATH_BYTES = 16 * 1024;

function validateAbsolutePath(value) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    throw new AppError(400, "invalid_path", "路径必须是非空的绝对路径");
  }
  if (value.includes("\0") || Buffer.byteLength(value, "utf8") > MAX_PATH_BYTES || !path.isAbsolute(value)) {
    throw new AppError(400, "invalid_path", "路径格式无效");
  }
  return value;
}

function openTarget(execFileImpl, target, timeout, failureMessage) {
  return new Promise((resolve, reject) => {
    execFileImpl(
      "/usr/bin/open",
      [target],
      { timeout, killSignal: "SIGTERM", maxBuffer: 64 * 1024, shell: false },
      (error) => {
        if (!error) {
          resolve();
          return;
        }
        reject(new AppError(
          error.killed ? 504 : 502,
          error.killed ? "path_open_timeout" : "path_open_failed",
          error.killed ? "打开路径超时，请重试" : failureMessage
        ));
      }
    );
  });
}

export class PathOpener {
  #execFile;
  #stat;
  #platform;
  #timeout;

  constructor({ execFileImpl = execFile, statImpl = stat, platform = process.platform, timeout = 15_000 } = {}) {
    this.#execFile = execFileImpl;
    this.#stat = statImpl;
    this.#platform = platform;
    this.#timeout = timeout;
  }

  async open(value, { application, line, column } = {}) {
    if (this.#platform !== "darwin") {
      throw new AppError(501, "path_open_unsupported", "本地路径打开功能仅支持 macOS");
    }
    const target = validateAbsolutePath(value);
    let metadata;
    try {
      metadata = await this.#stat(target);
    } catch {
      throw new AppError(404, "path_not_found", "路径不存在或不可访问");
    }
    const kind = metadata.isDirectory() ? "directory" : metadata.isFile() ? "file" : null;
    if (!kind) throw new AppError(409, "unsupported_path_type", "该路径不是普通文件或目录");

    if (application !== undefined && application !== "vscode") {
      throw new AppError(400, "invalid_application", "不支持指定的打开应用");
    }
    if (application === "vscode") {
      if (kind !== "file") throw new AppError(409, "unsupported_editor_path", "VS Code 定位仅支持普通文件");
      if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
        throw new AppError(400, "invalid_editor_position", "VS Code 行列位置格式无效");
      }
      const vscodeUrl = new URL("vscode://file");
      vscodeUrl.pathname = `${target}:${line}:${column}`;
      await openTarget(this.#execFile, vscodeUrl.href, this.#timeout, "无法使用 VS Code 打开该文件");
      return { kind, application };
    }

    await openTarget(this.#execFile, target, this.#timeout, "无法使用系统默认应用打开该路径");
    return { kind };
  }
}
