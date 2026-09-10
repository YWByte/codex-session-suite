import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveRepository } from './git.js';
import { DifitManager } from './difit.js';
import { createHttpApp } from './http.js';
import { FolderPicker } from './folder-picker.js';
import { resolveLocale, translator } from './i18n.js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function openBrowser(url) {
  const command = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { stdio: 'ignore', detached: true });
  child.on('error', () => {});
  child.unref();
}

export async function startApplication({
  repositoryPath,
  host = '127.0.0.1',
  port = 4173,
  open = true,
  locale = 'auto',
  env = process.env,
  difitOptions = {},
  folderPicker = new FolderPicker(),
}) {
  if (!LOCAL_HOSTS.has(host)) {
    const error = new Error('--host must be a loopback address (127.0.0.1, localhost, or ::1)');
    error.code = 'INVALID_HOST';
    throw error;
  }
  const selectedLocale = resolveLocale(locale, env);
  const repositoryDirectory = path.resolve(repositoryPath);
  const repositoryRoot = await resolveRepository(repositoryDirectory);
  const difitManager = new DifitManager({ repositoryRoot, ...difitOptions });
  const server = http.createServer(createHttpApp({
    repositoryRoot,
    repositoryDirectory,
    difitManager,
    folderPicker,
    locale: selectedLocale,
  }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  }).catch(error => {
    if (error.code === 'EADDRINUSE') {
      const localized = new Error(`Port ${port} is already in use on ${host}`);
      localized.code = 'PORT_IN_USE';
      localized.values = { port, host };
      throw localized;
    }
    throw error;
  });
  const address = server.address();
  const displayHost = host === '::1' ? '[::1]' : host;
  const url = `http://${displayHost}:${address.port}`;
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await difitManager.stop();
    await new Promise(resolve => server.close(resolve));
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().finally(() => process.exit(0)));
  process.once('exit', () => { if (difitManager.instance) { try { process.kill(difitManager.instance.pid, 'SIGTERM'); } catch {} } });
  if (open) openBrowser(url);
  return { server, url, repositoryRoot, difitManager, close, locale: selectedLocale };
}

export function startupMessage(url, locale = 'en') {
  return translator(locale)('cli.started', { url });
}
