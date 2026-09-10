import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors.js";

const CANCELLED = "__CODEX_FOLDER_PICKER_CANCELLED__";
const SCRIPT = `try
  return POSIX path of (choose folder with prompt "选择用于新的 Codex 会话的文件夹")
on error number -128
  return "${CANCELLED}"
end try`;

function runPicker(execFileImpl, timeout) {
  return new Promise((resolve, reject) => {
    execFileImpl(
      "/usr/bin/osascript",
      ["-e", SCRIPT],
      { timeout, killSignal: "SIGTERM", maxBuffer: 64 * 1024, shell: false },
      (error, stdout) => {
        if (error) {
          reject(new AppError(
            error.killed ? 504 : 502,
            error.killed ? "folder_picker_timeout" : "folder_picker_failed",
            error.killed ? "文件夹选择超时，请重试" : "无法打开 macOS 文件夹选择器"
          ));
          return;
        }
        resolve(String(stdout || "").replace(/\r?\n$/, ""));
      }
    );
  });
}

export class FolderPicker {
  #timeout;
  #execFile;
  #stat;
  #platform;
  #inFlight = false;

  constructor({ timeout = 120_000, execFileImpl = execFile, statImpl = stat, platform = process.platform } = {}) {
    this.#timeout = timeout;
    this.#execFile = execFileImpl;
    this.#stat = statImpl;
    this.#platform = platform;
  }

  async choose() {
    if (this.#platform !== "darwin") {
      throw new AppError(501, "folder_picker_unsupported", "文件夹选择器仅支持 macOS");
    }
    if (this.#inFlight) throw new AppError(409, "folder_picker_busy", "文件夹选择器已打开");

    this.#inFlight = true;
    try {
      const selected = await runPicker(this.#execFile, this.#timeout);
      if (selected === CANCELLED) return { cancelled: true };
      if (!selected || selected.includes("\0") || !path.isAbsolute(selected)) {
        throw new AppError(502, "folder_picker_invalid_result", "文件夹选择器未返回有效目录");
      }
      let metadata;
      try {
        metadata = await this.#stat(selected);
      } catch {
        throw new AppError(409, "invalid_workspace_directory", "所选文件夹不存在或不可访问");
      }
      if (!metadata.isDirectory()) {
        throw new AppError(409, "invalid_workspace_directory", "所选路径不是文件夹");
      }
      return { cancelled: false, cwd: selected };
    } finally {
      this.#inFlight = false;
    }
  }
}
