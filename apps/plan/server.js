import express from 'express';
import { createServer } from 'http';
import { readFile, readdir, stat, lstat, realpath, rename, unlink, writeFile, chmod, watch } from 'fs/promises';
import { join, dirname, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { platform } from 'os';
import { createHash, randomUUID } from 'crypto';
import { resolvePackageDirectory, resolvePackageFile } from '../../src/dependency-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3458', 10);
const CODEX_HOME = process.env.CODEX_HOME || join(process.env.HOME, '.codex-cli');
let PLANS_DIR = process.env.PLANS_DIR || join(CODEX_HOME, 'plans');

const app = express();
const server = createServer(app);
const trashSupported = platform() === 'darwin';

function normalizeLocale(value) {
  if (!value || value === 'auto') return null;
  const normalized = value.trim().toLowerCase();
  if (['zh', 'zh-cn', 'zh-hans'].includes(normalized)) return 'zh-CN';
  return normalized === 'en' || normalized.startsWith('en-') ? 'en' : null;
}

app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'");
  res.locals.codexSuiteLocale = normalizeLocale(process.env.CODEX_SUITE_LOCALE);
  next();
});
app.get('/locale.js', (_req, res) => {
  res.type('text/javascript').send(`globalThis.CODEX_SUITE_LOCALE = ${JSON.stringify(res.locals.codexSuiteLocale)};`);
});
app.get('/vendor/katex.css', (_req, res) => res.sendFile(resolvePackageFile('katex', 'dist/katex.min.css', import.meta.url)));
app.get('/vendor/katex.js', (_req, res) => res.sendFile(resolvePackageFile('katex', 'dist/katex.min.js', import.meta.url)));
app.get('/vendor/highlight.css', (_req, res) => res.sendFile(resolvePackageFile('@highlightjs/cdn-assets', 'styles/github.min.css', import.meta.url)));
app.get('/vendor/highlight.js', (_req, res) => res.sendFile(resolvePackageFile('@highlightjs/cdn-assets', 'highlight.min.js', import.meta.url)));
app.get('/vendor/marked.js', (_req, res) => res.sendFile(resolvePackageFile('marked', 'lib/marked.umd.js', import.meta.url)));
app.get('/vendor/mermaid.js', (_req, res) => res.sendFile(resolvePackageFile('mermaid', 'dist/mermaid.min.js', import.meta.url)));
app.use('/vendor/fonts', express.static(resolvePackageDirectory('katex', import.meta.url) + '/dist/fonts'));
app.use(express.static(join(__dirname, 'public')));
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => res.json({ ok: true, trashSupported }));

const eventClients = new Set();

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  eventClients.add(res);
  req.on('close', () => eventClients.delete(res));
});

function broadcastChange() {
  for (const client of eventClients) client.write('event: changed\ndata: {}\n\n');
}

async function watchPlans() {
  try {
    for await (const _event of watch(PLANS_DIR, { recursive: true })) broadcastChange();
  } catch (err) {
    console.error('Plan directory watcher stopped:', err.message);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) watchPlans();

// Decode an encoded project path such as -Users-name-Work to ~/Work.
function decodeProjectName(encoded) {
  const raw = '/' + encoded.replace(/^-/, '').replaceAll('-', '/');
  return raw.replace(process.env.HOME, '~');
}

// Keep target paths inside the plans directory and prevent ../ escapes.
function safeJoin(...parts) {
  const target = resolve(...parts);
  if (target !== PLANS_DIR && !target.startsWith(PLANS_DIR + sep)) return null;
  return target;
}

const DOCUMENT_EXTENSIONS = new Set(['.md', '.html']);
function documentExtension(fileName) {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  return DOCUMENT_EXTENSIONS.has(extension) ? extension : '';
}
function isDocumentFile(fileName) {
  return !!documentExtension(fileName);
}
function documentName(fileName) {
  return fileName.slice(0, -documentExtension(fileName).length);
}
function documentPath(projectId, date, fileName) {
  if (!isDocumentFile(fileName) || /[\\/]/.test(fileName)) return null;
  return safeJoin(PLANS_DIR, projectId, date, fileName);
}

const MAX_MARKDOWN_BODY_BYTES = 1024 * 1024;
function revisionFor(content) {
  return createHash('sha256').update(content).digest('hex');
}
function splitFrontmatter(content) {
  const opening = content.match(/^(?:﻿)?---[\t ]*\r?\n/);
  if (!opening) return { frontmatter: '', body: content };
  const remainder = content.slice(opening[0].length);
  const closing = remainder.match(/^(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/m);
  if (!closing) return { frontmatter: '', body: content };
  const yaml = remainder.slice(0, closing.index);
  if (!/^(?![\t #\-])[^:\r\n]+:[\t ]*/m.test(yaml)) return { frontmatter: '', body: content };
  const end = opening[0].length + closing.index + closing[0].length;
  return { frontmatter: content.slice(0, end), body: content.slice(end) };
}

const pendingWrites = new Map();
function serializeWrite(filePath, action) {
  const previous = pendingWrites.get(filePath) || Promise.resolve();
  const task = previous.catch(() => {}).then(action);
  const tracked = task.finally(() => {
    if (pendingWrites.get(filePath) === tracked) pendingWrites.delete(filePath);
  });
  pendingWrites.set(filePath, tracked);
  return tracked;
}

async function resolveDocumentFile(filePath) {
  const [rootPath, fileInfo, resolvedPath] = await Promise.all([
    realpath(PLANS_DIR),
    lstat(filePath),
    realpath(filePath),
  ]);
  const relativePath = filePath.slice(PLANS_DIR.length + 1);
  const expectedPath = resolve(rootPath, relativePath);
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink() || resolvedPath !== expectedPath || !resolvedPath.startsWith(rootPath + sep)) {
    const error = new Error('invalid document path');
    error.code = 'INVALID_DOCUMENT_PATH';
    throw error;
  }
  return { filePath: resolvedPath, fileInfo };
}

async function writeAtomically(filePath, content, mode) {
  const tempPath = join(dirname(filePath), `.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, content, { encoding: 'utf8', flag: 'wx', mode: mode & 0o777 });
    await chmod(tempPath, mode & 0o777);
    await rename(tempPath, filePath);
  } finally {
    try { await unlink(tempPath); } catch { }
  }
}

const IMAGE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
function imageTypeFor(filePath) {
  return IMAGE_TYPES[filePath.slice(filePath.lastIndexOf('.')).toLowerCase()];
}

// Read images stored next to the selected plan.
app.get('/api/assets/:projectId/:date/*assetPath', async (req, res) => {
  try {
    const assetPath = Array.isArray(req.params.assetPath) ? req.params.assetPath.join('/') : req.params.assetPath;
    const filePath = safeJoin(PLANS_DIR, req.params.projectId, req.params.date, assetPath);
    const imageType = filePath && imageTypeFor(filePath);
    if (!filePath || !imageType) return res.status(400).json({ error: 'invalid image path' });
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return res.status(404).json({ error: 'image not found' });
    res.set('Cache-Control', 'no-cache');
    res.type(imageType).send(await readFile(filePath));
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'image not found' });
    res.status(500).json({ error: err.message });
  }
});

// List projects that contain documents.
app.get('/api/projects', async (_req, res) => {
  try {
    const projects = await readdir(PLANS_DIR);
    const result = [];

    for (const project of projects) {
      const projDir = join(PLANS_DIR, project);
      let st;
      try { st = await stat(projDir); } catch { continue; }
      if (!st.isDirectory()) continue;

      // Count all plan files across the project's date directories.
      let planCount = 0;
      let lastActive = 0;
      let dates;
      try { dates = await readdir(projDir); } catch { continue; }

      for (const d of dates) {
        const dateDir = join(projDir, d);
        let dst;
        try { dst = await stat(dateDir); } catch { continue; }
        if (!dst.isDirectory()) continue;
        let files;
        try { files = await readdir(dateDir); } catch { continue; }
        for (const f of files) {
          if (!isDocumentFile(f)) continue;
          planCount++;
          try {
            const fst = await stat(join(dateDir, f));
            if (fst.mtimeMs > lastActive) lastActive = fst.mtimeMs;
          } catch { }
        }
      }

      if (planCount === 0) continue; // Skip empty projects.
      result.push({ id: project, name: decodeProjectName(project), planCount, lastActive });
    }

    result.sort((a, b) => b.lastActive - a.lastActive);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List date groups within a project.
app.get('/api/projects/:projectId/dates', async (req, res) => {
  try {
    const projDir = safeJoin(PLANS_DIR, req.params.projectId);
    if (!projDir) return res.status(400).json({ error: 'invalid project' });

    const entries = await readdir(projDir);
    const dates = [];

    for (const d of entries) {
      const dateDir = join(projDir, d);
      let st;
      try { st = await stat(dateDir); } catch { continue; }
      if (!st.isDirectory()) continue;

      // Only include YYYY-MM-DD directories.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;

      let files;
      try { files = await readdir(dateDir); } catch { continue; }
      const documentFiles = files.filter(isDocumentFile);
      if (documentFiles.length === 0) continue;

      // Find the most recent activity time for the date group.
      let lastActive = 0;
      for (const f of documentFiles) {
        try {
          const fst = await stat(join(dateDir, f));
          if (fst.mtimeMs > lastActive) lastActive = fst.mtimeMs;
        } catch { }
      }

      dates.push({ date: d, planCount: documentFiles.length, lastActive });
    }

    dates.sort((a, b) => b.date.localeCompare(a.date)); // Most recent date first.
    res.json(dates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List plans within a date group.
app.get('/api/projects/:projectId/dates/:date/plans', async (req, res) => {
  try {
    const dateDir = safeJoin(PLANS_DIR, req.params.projectId, req.params.date);
    if (!dateDir) return res.status(400).json({ error: 'invalid path' });

    const files = await readdir(dateDir);
    const plans = [];

    for (const f of files) {
      if (!isDocumentFile(f)) continue;
      const fullPath = join(dateDir, f);
      const st = await stat(fullPath);
      plans.push({
        id: f,
        name: documentName(f),
        extension: documentExtension(f),
        mtime: st.mtimeMs,
        size: st.size,
        path: fullPath,
      });
    }

    plans.sort((a, b) => b.mtime - a.mtime);
    res.json(plans);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read a plan document.
app.get('/api/plans/:projectId/:date/:planId', async (req, res) => {
  try {
    const requestedPath = documentPath(req.params.projectId, req.params.date, req.params.planId);
    if (!requestedPath) return res.status(400).json({ error: 'invalid path' });

    const { filePath } = await resolveDocumentFile(requestedPath);
    const content = await readFile(filePath, 'utf8');
    const extension = documentExtension(req.params.planId);
    const markdown = extension === '.md' ? splitFrontmatter(content) : null;
    res.json({
      content: markdown ? markdown.body : content,
      name: documentName(req.params.planId),
      extension,
      editable: extension === '.md',
      revision: revisionFor(content),
    });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'plan not found' });
    if (err.code === 'INVALID_DOCUMENT_PATH') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Save the Markdown body of a plan.
app.put('/api/plans/:projectId/:date/:planId/content', async (req, res) => {
  try {
    const { projectId, date, planId } = req.params;
    if (documentExtension(planId) !== '.md') return res.status(400).json({ error: 'only Markdown documents are editable' });
    const requestedPath = documentPath(projectId, date, planId);
    if (!requestedPath) return res.status(400).json({ error: 'invalid path' });

    const content = req.body?.content;
    const revision = req.body?.revision;
    if (typeof content !== 'string' || content.includes('\0') || typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
      return res.status(400).json({ error: 'invalid content or revision' });
    }
    if (Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BODY_BYTES) {
      return res.status(413).json({ error: 'content too large' });
    }

    await serializeWrite(requestedPath, async () => {
      const { filePath, fileInfo } = await resolveDocumentFile(requestedPath);
      const original = await readFile(filePath, 'utf8');
      if (revisionFor(original) !== revision) {
        return res.status(409).json({ error: 'document changed externally' });
      }

      const { frontmatter } = splitFrontmatter(original);
      const updated = frontmatter + content;
      if (updated !== original) {
        const currentBeforeWrite = await readFile(filePath, 'utf8');
        if (revisionFor(currentBeforeWrite) !== revision) {
          return res.status(409).json({ error: 'document changed externally' });
        }
        await writeAtomically(filePath, updated, fileInfo.mode);
      }
      res.json({ content, revision: revisionFor(updated) });
    });
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'plan not found' });
    if (err.code === 'INVALID_DOCUMENT_PATH') return res.status(400).json({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Rename a plan file.
app.patch('/api/plans/:projectId/:date/:planId', async (req, res) => {
  try {
    const oldPath = documentPath(req.params.projectId, req.params.date, req.params.planId);
    if (!oldPath) return res.status(400).json({ error: 'invalid path' });

    let st;
    try { st = await stat(oldPath); } catch { return res.status(404).json({ error: 'plan not found' }); }
    if (!st.isFile()) return res.status(400).json({ error: 'not a file' });

    const newName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!newName) return res.status(400).json({ error: 'name required' });
    if (newName.length > 200) return res.status(400).json({ error: 'name too long' });
    // File names must not contain path separators.
    if (/[\/\\]/.test(newName)) return res.status(400).json({ error: 'invalid name' });

    const extension = documentExtension(req.params.planId);
    const newPath = join(dirname(oldPath), newName + extension);
    if (!newPath.startsWith(PLANS_DIR)) return res.status(400).json({ error: 'invalid path' });
    if (newPath === oldPath) return res.json({ ok: true, name: newName, id: req.params.planId });

    try { await stat(newPath); return res.status(409).json({ error: 'name already exists' }); } catch { /* Continue when the path does not exist. */ }

    await rename(oldPath, newPath);
    res.json({ ok: true, name: newName, id: newName + extension });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Move a plan to the operating system trash.
app.delete('/api/plans/:projectId/:date/:planId', async (req, res) => {
  if (!trashSupported) {
    return res.status(501).json({ error: 'moving to trash is unavailable on this platform' });
  }

  try {
    const filePath = documentPath(req.params.projectId, req.params.date, req.params.planId);
    if (!filePath) return res.status(400).json({ error: 'invalid path' });

    let st;
    try { st = await stat(filePath); } catch { return res.status(404).json({ error: 'plan not found' }); }
    if (!st.isFile()) return res.status(400).json({ error: 'not a file' });

    await trashFile(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Use Finder on macOS so deleted files remain recoverable in Trash.
function trashFile(filePath) {
  return new Promise((resolve, reject) => {
    const script = `tell application "Finder" to delete POSIX file "${filePath.replace(/"/g, '\\"')}"`;
    execFile('osascript', ['-e', script], (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });
}

export function createApp(options = {}) {
  const directory = typeof options === 'string' ? options : options.plansDir;
  if (directory) PLANS_DIR = directory;
  return app;
}

export function createPlanServer(options = {}) {
  const application = createApp(options);
  const httpServer = createServer(application);
  return { app: application, server: httpServer };
}

// Start the server only when this module is invoked directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Plan Viewer: http://127.0.0.1:${PORT}`);
  });
}
