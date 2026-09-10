import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';
import { translator } from './i18n.js';

const CANCELLED = '__DIFGRAPH_FOLDER_PICKER_CANCELLED__';

function pickerScript(locale) {
  const prompt = translator(locale)('folderPicker.prompt');
  return `try
  return POSIX path of (choose folder with prompt "${prompt}")
on error number -128
  return "${CANCELLED}"
end try`;
}

function runPicker(execFileImpl, timeout, locale) {
  return new Promise((resolve, reject) => {
    execFileImpl('/usr/bin/osascript', ['-e', pickerScript(locale)], {
      timeout,
      killSignal: 'SIGTERM',
      maxBuffer: 64 * 1024,
      shell: false,
    }, (error, stdout) => {
      if (error) {
        reject(new AppError(
          error.killed ? 'FOLDER_PICKER_TIMEOUT' : 'FOLDER_PICKER_FAILED',
          'Unable to open the macOS folder picker',
          error.killed ? 504 : 502,
        ));
        return;
      }
      resolve(String(stdout || '').replace(/\r?\n$/, ''));
    });
  });
}

export class FolderPicker {
  constructor({ timeout = 120_000, execFileImpl = execFile, statImpl = stat, platform = process.platform } = {}) {
    this.timeout = timeout;
    this.execFile = execFileImpl;
    this.stat = statImpl;
    this.platform = platform;
    this.inFlight = false;
  }

  async choose(locale = 'en') {
    if (this.platform !== 'darwin') throw new AppError('FOLDER_PICKER_UNSUPPORTED', 'The folder picker is only supported on macOS', 501);
    if (this.inFlight) throw new AppError('FOLDER_PICKER_BUSY', 'The folder picker is already open', 409);

    this.inFlight = true;
    try {
      const selected = await runPicker(this.execFile, this.timeout, locale);
      if (selected === CANCELLED) return { cancelled: true };
      if (!selected || selected.includes('\0') || !path.isAbsolute(selected)) {
        throw new AppError('FOLDER_PICKER_INVALID_RESULT', 'The folder picker did not return a valid directory', 502);
      }
      let metadata;
      try { metadata = await this.stat(selected); }
      catch { throw new AppError('INVALID_DIRECTORY', 'The selected path is not an accessible directory', 409); }
      if (!metadata.isDirectory()) throw new AppError('INVALID_DIRECTORY', 'The selected path is not a directory', 409);
      return { cancelled: false, directory: path.resolve(selected) };
    } finally {
      this.inFlight = false;
    }
  }
}
