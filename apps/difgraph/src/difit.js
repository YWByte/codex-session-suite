import { constants } from 'node:fs';
import { access, constants as fsConstants } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { AppError } from './errors.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

async function executable(file) {
  try { await access(file, constants.X_OK); return true; } catch { return false; }
}

export function defaultDifitCli() {
  try {
    const packagePath = createRequire(import.meta.url).resolve('difit/package.json');
    return path.resolve(path.dirname(packagePath), 'dist/cli/index.js');
  } catch {
    return null;
  }
}

export async function findOnPath(name, envPath = process.env.PATH ?? '') {
  for (const directory of envPath.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, name);
    if (await executable(candidate)) return candidate;
  }
  return null;
}

export function parseHandshake(text) {
  for (const line of text.split(/\r?\n/)) {
    try {
      const value = JSON.parse(line);
      if (!Number.isInteger(value.port) || !Number.isInteger(value.pid) || typeof value.url !== 'string') continue;
      const url = new URL(value.url);
      if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) continue;
      return { port: value.port, pid: value.pid, url: url.href.replace(/\/$/, '') };
    } catch {}
  }
  return null;
}

export class DifitManager {
  constructor({ repositoryRoot, env = process.env, fallback = defaultDifitCli(), timeout = 10_000, spawnProcess = spawn } = {}) {
    this.repositoryRoot = repositoryRoot;
    this.env = env;
    this.fallback = fallback;
    this.timeout = timeout;
    this.spawnProcess = spawnProcess;
    this.instance = null;
    this.pending = Promise.resolve();
  }

  async command() {
    const inPath = await findOnPath('difit', this.env.PATH);
    if (inPath) return { command: inPath, prefix: [] };
    if (this.fallback) {
      try { await access(this.fallback, fsConstants.F_OK); return { command: process.execPath, prefix: [this.fallback] }; }
      catch {}
    }
    throw new AppError('DIFIT_NOT_FOUND', 'difit was not found in PATH or the suite dependency', 503);
  }

  start(sha, options = {}) {
    const operation = this.pending.catch(() => {}).then(() => this.startNow(sha, options));
    this.pending = operation;
    return operation;
  }

  async startNow(sha, { rootCommit = false } = {}) {
    await this.stopNow();
    const launch = await this.command();
    return new Promise((resolve, reject) => {
      const revisions = rootCommit ? [sha, EMPTY_TREE_SHA] : [sha];
      const child = this.spawnProcess(launch.command, [...launch.prefix, ...revisions, '--background', '--host', '127.0.0.1', '--no-open'], {
        cwd: this.repositoryRoot,
        env: this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = callback => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(() => finish(() => {
        child.kill();
        reject(new AppError('DIFIT_START_TIMEOUT', 'Timed out while starting difit', 504));
      }), this.timeout);
      child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
      child.once('error', error => finish(() => reject(new AppError('DIFIT_START_FAILED', error.message, 502))));
      child.once('close', code => finish(() => {
        const handshake = parseHandshake(stdout);
        if (code !== 0 || !handshake) {
          reject(new AppError('DIFIT_START_FAILED', 'difit did not return a valid loopback handshake', 502));
          return;
        }
        this.instance = handshake;
        resolve(handshake);
      }));
    });
  }

  stop() {
    const operation = this.pending.catch(() => {}).then(() => this.stopNow());
    this.pending = operation;
    return operation;
  }

  async stopNow() {
    const current = this.instance;
    this.instance = null;
    if (!current) return false;
    try { process.kill(current.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    return true;
  }
}
