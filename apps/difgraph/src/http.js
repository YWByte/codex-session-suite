import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { AppError, errorPayload } from './errors.js';
import { readCommitDetail, readRepository, resolveRepository } from './git.js';
import { normalizeLocale } from './i18n.js';

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const LOCALE_COOKIE = /(?:^|;\s*)codex_suite_locale=([^;]+)/;

export function createHttpApp({ repositoryRoot, repositoryDirectory = repositoryRoot, difitManager, folderPicker, locale = 'en' }) {
  const app = express();
  let currentRoot = repositoryRoot;
  let currentDirectory = path.resolve(repositoryDirectory);
  let snapshot = null;
  let allowedShas = new Set();

  async function refresh(requestedBranch = null) {
    snapshot = await readRepository(currentRoot, 100, requestedBranch);
    snapshot.repository.directory = currentDirectory;
    allowedShas = new Set(snapshot.commits.map(commit => commit.sha));
    return snapshot;
  }
  function requireLoadedSha(value) {
    if (!SHA_PATTERN.test(value) || !allowedShas.has(value)) throw new AppError('COMMIT_NOT_LOADED', 'Commit is not in the currently loaded history', 404);
    return value;
  }
  function requestLocale(request) {
    const queryValue = typeof request.query.locale === 'string' ? request.query.locale : '';
    const cookieValue = request.headers.cookie ? decodeURIComponent(LOCALE_COOKIE.exec(request.headers.cookie)?.[1] ?? '') : '';
    return normalizeLocale(queryValue || cookieValue || locale, locale);
  }

  app.disable('x-powered-by');
  app.use(express.json({ limit: '8kb' }));
  app.get('/health', (_request, response) => response.json({ ok: true }));
  app.get('/runtime-config.js', (_request, response) => {
    response.type('text/javascript').send(`globalThis.__CODEX_SUITE_CONFIG__ = ${JSON.stringify({ locale })};`);
  });
  app.get('/api/repository', async (request, response, next) => {
    try {
      const branch = typeof request.query.branch === 'string' ? request.query.branch : null;
      response.json(await refresh(branch));
    } catch (error) { next(error); }
  });
  app.post('/api/repository/select', async (request, response, next) => {
    try {
      if (!folderPicker) throw new AppError('FOLDER_PICKER_UNAVAILABLE', 'The folder picker is unavailable', 503);
      const selected = await folderPicker.choose(requestLocale(request));
      if (selected.cancelled) { response.json({ cancelled: true }); return; }
      const nextRoot = await resolveRepository(selected.directory);
      await difitManager.stop();
      difitManager.repositoryRoot = nextRoot;
      currentDirectory = selected.directory;
      currentRoot = nextRoot;
      snapshot = null;
      allowedShas = new Set();
      response.json({ cancelled: false, directory: currentDirectory, root: currentRoot });
    } catch (error) { next(error); }
  });
  app.get('/api/commits/:sha', async (request, response, next) => {
    try {
      if (!snapshot) await refresh();
      response.json(await readCommitDetail(currentRoot, requireLoadedSha(request.params.sha)));
    } catch (error) { next(error); }
  });
  app.post('/api/difit', async (request, response, next) => {
    try {
      await refresh(snapshot?.repository.selectedBranch ?? null);
      const sha = requireLoadedSha(request.body?.sha);
      const commit = snapshot.commits.find(item => item.sha === sha);
      const instance = await difitManager.start(sha, { rootCommit: commit.parents.length === 0 });
      response.json({ url: instance.url, sha });
    } catch (error) { next(error); }
  });
  app.delete('/api/difit', async (_request, response, next) => {
    try { response.json({ stopped: await difitManager.stop() }); } catch (error) { next(error); }
  });
  app.use(express.static(publicDirectory, { index: 'index.html', fallthrough: false }));
  app.use((error, request, response, _next) => {
    response.status(error.status ?? 500).json(errorPayload(error, requestLocale(request)));
  });
  return app;
}
