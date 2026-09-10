import { createServer as createHttpServer } from 'node:http';
import { mkdir, open, readFile, rename, lstat, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolvePackageFile } from '../../src/dependency-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3461;
const DEFAULT_COLLECTIONS_FILE = process.env.COLLECTIONS_FILE || join(process.env.CODEX_HOME || join(process.env.HOME || '.', '.codex-cli'), 'collections.json');
const MAX_BODY_BYTES = 128 * 1024;
const MAX_QUOTE_BYTES = 64 * 1024;
const MAX_NOTE_BYTES = 32 * 1024;
const MAX_SOURCE_BYTES = 48 * 1024;
const MAX_ORIGIN_BYTES = 2 * 1024;

const API_MESSAGES_EN = Object.freeze({
  invalid_request: 'The request is invalid',
  payload_too_large: 'The request is too large',
  storage_corrupt: 'Collection storage is invalid; no changes were written',
  storage_busy: 'Collection storage is busy; try again shortly',
  duplicate_collection: 'This content is already collected',
  collection_not_found: 'Collection not found',
  not_archived: 'Only archived collections can be deleted',
  internal_error: 'Internal server error',
  invalid_content_type: 'Write requests must use application/json',
  invalid_json: 'The request body must be valid JSON',
  invalid_collection_id: 'The collection ID is invalid',
  invalid_origin: 'The request origin is not allowed',
  invalid_query: 'The query is invalid',
  not_found: 'Resource not found',
});

function normalizeLocale(value) {
  const locale = String(value || '').trim().toLowerCase();
  return /^zh(?:$|(?:[-_](?:hans|cn))(?:[._-]|$))/.test(locale) ? 'zh-CN' : 'en';
}

function requestLocale(request, url) {
  const explicit = url.searchParams.get('locale');
  const cookie = /(?:^|;\s*)codex_suite_locale=([^;]+)/.exec(request.headers.cookie || '');
  let cookieValue = '';
  try { cookieValue = cookie ? decodeURIComponent(cookie[1]) : ''; } catch {}
  const configured = process.env.CODEX_SUITE_LOCALE;
  const automatic = !configured || configured === 'auto' ? request.headers['accept-language'] : configured;
  return normalizeLocale(explicit || cookieValue || automatic || 'en');
}

function validLoopbackHost(value) {
  const host = String(value || '').toLowerCase();
  return /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host) || /^\[::1\](?::\d+)?$/.test(host);
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function validateString(value, field, { required = true, maxBytes = 500, allowEmpty = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string') throw new AppError(400, 'invalid_request', `${field} 必须是字符串`);
  if ((!allowEmpty && !value.trim()) || value.includes('\0')) {
    throw new AppError(400, 'invalid_request', `${field} 不能为空`);
  }
  if (byteLength(value) > maxBytes) throw new AppError(413, 'payload_too_large', `${field} 过长`);
  return value;
}

function validateSegments(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 200) {
    throw new AppError(400, 'invalid_request', 'source.segments 必须是非空数组');
  }
  for (const [index, segment] of value.entries()) {
    if (!isPlainObject(segment)) throw new AppError(400, 'invalid_request', `source.segments[${index}] 必须是对象`);
    const keys = Object.keys(segment);
    if (keys.length === 0 || keys.length > 12) throw new AppError(400, 'invalid_request', `source.segments[${index}] 字段无效`);
    for (const key of keys) {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
        throw new AppError(400, 'invalid_request', `source.segments[${index}] 字段名无效`);
      }
      const item = segment[key];
      if (!(typeof item === 'string' || (Number.isInteger(item) && item >= 0) || typeof item === 'boolean')) {
        throw new AppError(400, 'invalid_request', `source.segments[${index}].${key} 类型无效`);
      }
      if (typeof item === 'string' && (item.includes('\0') || byteLength(item) > 4096)) {
        throw new AppError(400, 'invalid_request', `source.segments[${index}].${key} 过长或无效`);
      }
    }
  }
  if (byteLength(JSON.stringify(value)) > 32 * 1024) {
    throw new AppError(413, 'payload_too_large', 'source.segments 过长');
  }
  return value;
}

function validateViewerOrigin(value) {
  if (value === undefined) return undefined;
  const origin = validateString(value, 'source.viewerOrigin', { maxBytes: 256 });
  let parsed;
  try { parsed = new URL(origin); } catch { throw new AppError(400, 'invalid_request', 'source.viewerOrigin 格式无效'); }
  if (parsed.origin !== origin || parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new AppError(400, 'invalid_request', 'source.viewerOrigin 必须是本机 Codex Viewer 地址');
  }
  return origin;
}

function validateSource(value) {
  if (!isPlainObject(value)) throw new AppError(400, 'invalid_request', 'source 必须是对象');
  const allowed = new Set(['threadId', 'turnId', 'itemId', 'role', 'projectPath', 'projectName', 'sessionTitle', 'segments', 'viewerOrigin']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new AppError(400, 'invalid_request', `source.${key} 不被允许`);
  }
  const source = {
    threadId: validateString(value.threadId, 'source.threadId', { maxBytes: 512 }),
    turnId: validateString(value.turnId, 'source.turnId', { maxBytes: 512 }),
    itemId: validateString(value.itemId, 'source.itemId', { maxBytes: 512 }),
    role: validateString(value.role, 'source.role', { maxBytes: 64 }),
    sessionTitle: validateString(value.sessionTitle, 'source.sessionTitle', { maxBytes: 2048 }),
    segments: validateSegments(value.segments),
  };
  const projectPath = validateString(value.projectPath, 'source.projectPath', { required: false, maxBytes: 4096 });
  const projectName = validateString(value.projectName, 'source.projectName', { required: false, maxBytes: 512 });
  const viewerOrigin = validateViewerOrigin(value.viewerOrigin);
  if (projectPath !== undefined) source.projectPath = projectPath;
  if (projectName !== undefined) source.projectName = projectName;
  if (viewerOrigin !== undefined) source.viewerOrigin = viewerOrigin;
  if (byteLength(JSON.stringify(source)) > MAX_SOURCE_BYTES) {
    throw new AppError(413, 'payload_too_large', 'source 过长');
  }
  return source;
}

function canonicalSegments(segments) {
  return JSON.stringify(segments.map((segment) => Object.fromEntries(Object.entries(segment).sort(([left], [right]) => left.localeCompare(right)))));
}

function validateCreatePayload(body) {
  if (!isPlainObject(body)) throw new AppError(400, 'invalid_request', '请求体必须是 JSON 对象');
  const allowed = new Set(['quote', 'note', 'source', 'origin']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw new AppError(400, 'invalid_request', `字段 ${key} 不被允许`);
  }
  if (body.source !== undefined && body.source !== null && body.origin !== undefined) {
    throw new AppError(400, 'invalid_request', 'source 与 origin 不能同时存在');
  }
  const quote = validateString(body.quote, 'quote', { maxBytes: MAX_QUOTE_BYTES });
  const note = validateString(body.note, 'note', { required: false, maxBytes: MAX_NOTE_BYTES, allowEmpty: true }) ?? '';
  // Manual collections store their source label in origin and are intentionally not deduplicated.
  if (body.source === undefined || body.source === null) {
    const origin = validateString(body.origin, 'origin', { required: false, maxBytes: MAX_ORIGIN_BYTES, allowEmpty: true }) ?? '';
    return { quote, note, origin, source: null };
  }
  return { quote, note, origin: '', source: validateSource(body.source) };
}

function validatePatchPayload(body) {
  if (!isPlainObject(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'note')) {
    throw new AppError(400, 'invalid_request', '仅允许更新 note');
  }
  return { note: validateString(body.note, 'note', { maxBytes: MAX_NOTE_BYTES, allowEmpty: true }) };
}

function validateStoredCollection(value) {
  if (!isPlainObject(value) || !ID_PATTERN.test(value.id || '') || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string' || !(typeof value.archivedAt === 'string' || value.archivedAt === null)) {
    throw new AppError(500, 'storage_corrupt', '收藏数据格式损坏，未写入任何更改');
  }
  validateCreatePayload(value.source === undefined || value.source === null
    ? { quote: value.quote, note: value.note, origin: value.origin }
    : { quote: value.quote, note: value.note, source: value.source });
  if (Number.isNaN(Date.parse(value.createdAt)) || Number.isNaN(Date.parse(value.updatedAt))
    || (value.archivedAt !== null && Number.isNaN(Date.parse(value.archivedAt)))) {
    throw new AppError(500, 'storage_corrupt', '收藏时间格式损坏，未写入任何更改');
  }
  return value;
}

export class CollectionStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeQueue = Promise.resolve();
  }

  async acquireFileLock() {
    const lockPath = `${this.filePath}.lock`;
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        const handle = await open(lockPath, 'wx', 0o600);
        await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, 'utf8');
        return async () => {
          await handle.close().catch(() => {});
          await unlink(lockPath).catch(() => {});
        };
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        try {
          const lockInfo = await stat(lockPath);
          if (Date.now() - lockInfo.mtimeMs > 30_000) {
            await unlink(lockPath);
            continue;
          }
        } catch (lockError) {
          if (lockError?.code === 'ENOENT') continue;
          throw lockError;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    throw new AppError(503, 'storage_busy', '收藏存储正忙，请稍后重试');
  }

  async readCollections() {
    let raw;
    try {
      const info = await lstat(this.filePath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new AppError(500, 'storage_corrupt', '收藏数据文件不是普通文件，未写入任何更改');
      }
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppError(500, 'storage_corrupt', '收藏数据文件损坏，未写入任何更改');
    }
    if (!isPlainObject(parsed) || !Array.isArray(parsed.collections)) {
      throw new AppError(500, 'storage_corrupt', '收藏数据格式损坏，未写入任何更改');
    }
    try {
      return parsed.collections.map(validateStoredCollection);
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError(500, 'storage_corrupt', '收藏数据格式损坏，未写入任何更改');
      }
      throw error;
    }
  }

  async writeCollections(collections) {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      const info = await lstat(this.filePath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new AppError(500, 'storage_corrupt', '收藏数据文件不是普通文件，未写入任何更改');
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const temporaryPath = join(directory, `.collections-${randomUUID()}.tmp`);
    let handle;
    try {
      handle = await open(temporaryPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ collections }, null, 2)}\n`, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
      const directoryHandle = await open(directory, 'r');
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  async list(archived) {
    const collections = await this.readCollections();
    return collections
      .filter((collection) => Boolean(collection.archivedAt) === archived)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  async find(id) {
    return (await this.readCollections()).find((collection) => collection.id === id) ?? null;
  }

  mutate(operation) {
    const run = this.writeQueue.catch(() => {}).then(async () => {
      const release = await this.acquireFileLock();
      try {
        const collections = await this.readCollections();
        const result = await operation(collections);
        if (result.changed) await this.writeCollections(collections);
        return result.value;
      } finally {
        await release();
      }
    });
    this.writeQueue = run.catch(() => {});
    return run;
  }

  create(payload) {
    return this.mutate((collections) => {
      // Manual collections are not deduplicated so one quote can carry distinct notes.
      if (payload.source) {
        const duplicate = collections.find((item) => item.source && item.source.threadId === payload.source.threadId
          && item.source.turnId === payload.source.turnId
          && item.source.itemId === payload.source.itemId
          && canonicalSegments(item.source.segments) === canonicalSegments(payload.source.segments));
        if (duplicate) throw new AppError(409, 'duplicate_collection', '该内容已经收藏');
      }
      const now = new Date().toISOString();
      const collection = { id: randomUUID(), ...payload, createdAt: now, updatedAt: now, archivedAt: null };
      collections.push(collection);
      return { changed: true, value: collection };
    });
  }

  updateNote(id, note) {
    return this.mutate((collections) => {
      const collection = collections.find((item) => item.id === id);
      if (!collection) throw new AppError(404, 'collection_not_found', '收藏不存在');
      if (collection.note === note) return { changed: false, value: collection };
      collection.note = note;
      collection.updatedAt = new Date().toISOString();
      return { changed: true, value: collection };
    });
  }

  setArchived(id, archived) {
    return this.mutate((collections) => {
      const collection = collections.find((item) => item.id === id);
      if (!collection) throw new AppError(404, 'collection_not_found', '收藏不存在');
      if (Boolean(collection.archivedAt) === archived) return { changed: false, value: collection };
      const now = new Date().toISOString();
      collection.archivedAt = archived ? now : null;
      collection.updatedAt = now;
      return { changed: true, value: collection };
    });
  }

  remove(id) {
    return this.mutate((collections) => {
      const index = collections.findIndex((item) => item.id === id);
      if (index === -1) throw new AppError(404, 'collection_not_found', '收藏不存在');
      // Permanent deletion is allowed only after a collection is archived.
      if (!collections[index].archivedAt) throw new AppError(400, 'not_archived', '仅已归档的收藏可以删除');
      collections.splice(index, 1);
      return { changed: true, value: { deleted: true } };
    });
  }
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

function sendError(response, error, headers = {}, locale = 'en') {
  if (error instanceof AppError) {
    const message = locale === 'zh-CN' ? error.message : API_MESSAGES_EN[error.code] || error.message;
    return sendJson(response, error.status, { error: { code: error.code, message } }, headers);
  }
  console.error(error);
  const message = locale === 'zh-CN' ? '服务器内部错误' : API_MESSAGES_EN.internal_error;
  return sendJson(response, 500, { error: { code: 'internal_error', message } }, headers);
}

function sameOrigin(request, origin) {
  const host = String(request.headers.host || '').toLowerCase();
  if (!/^(127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) return false;
  return origin === `http://${host}`;
}

function isAllowedOrigin(request, origin, allowedOrigins) {
  return sameOrigin(request, origin) || allowedOrigins.has(origin);
}

function corsHeaders(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin || !isAllowedOrigin(request, origin, allowedOrigins)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

async function readJson(request) {
  const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new AppError(415, 'invalid_content_type', '写入请求必须使用 application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new AppError(413, 'payload_too_large', '请求体过大');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AppError(400, 'invalid_json', '请求体必须是有效 JSON');
  }
}

function parseCollectionId(pathname) {
  const match = pathname.match(/^\/api\/collections\/([^/]+)$/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

function validId(id) {
  if (!ID_PATTERN.test(id)) throw new AppError(400, 'invalid_collection_id', '收藏 ID 无效');
}

function fileResponse(response, filePath, type) {
  readFile(filePath)
    .then((body) => {
      response.writeHead(200, {
        'Content-Type': type,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      });
      response.end(body);
    })
    .catch((error) => sendError(response, error));
}

function staticResponse(response, fileName, type) {
  return fileResponse(response, join(__dirname, 'public', fileName), type);
}

function vendorResponse(response, fileName) {
  return fileResponse(response, resolvePackageFile(fileName.split('/')[0] === '@highlightjs' ? '@highlightjs/cdn-assets' : fileName.split('/')[0], fileName.split('/').slice(fileName.startsWith('@') ? 2 : 1).join('/'), import.meta.url), 'text/javascript; charset=utf-8');
}

export function createApp({ dataFile = DEFAULT_COLLECTIONS_FILE, sessionOrigin = process.env.SESSION_VIEWER_ORIGIN || 'http://127.0.0.1:3460' } = {}) {
  const store = new CollectionStore(dataFile);
  const sessionUrl = new URL(sessionOrigin);
  if (sessionUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(sessionUrl.hostname)) throw new Error('SESSION_VIEWER_ORIGIN must be a loopback HTTP origin');
  const allowedOrigins = new Set([sessionUrl.origin, `http://localhost:${sessionUrl.port}`]);
  const handler = async (request, response) => {
    const origin = request.headers.origin;
    const cors = corsHeaders(request, allowedOrigins);
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    const locale = requestLocale(request, url);
    if (!validLoopbackHost(request.headers.host)) return sendError(response, new AppError(403, 'invalid_origin', '不允许的来源'), cors, locale);
    const { pathname, searchParams } = url;

    if (request.method === 'OPTIONS') {
      if (!origin || !isAllowedOrigin(request, origin, allowedOrigins)) {
        return sendError(response, new AppError(403, 'invalid_origin', '不允许的来源'), {}, locale);
      }
      response.writeHead(204, cors);
      return response.end();
    }

    try {
      if (request.method === 'GET' && pathname === '/health') {
        response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...cors });
        return response.end('ok');
      }
      if (request.method === 'GET' && pathname === '/api/collections') {
        const archivedParam = searchParams.get('archived');
        if (archivedParam !== null && archivedParam !== 'true' && archivedParam !== 'false') {
          throw new AppError(400, 'invalid_query', 'archived 必须是 true 或 false');
        }
        return sendJson(response, 200, { collections: await store.list(archivedParam === 'true') }, cors);
      }
      if (request.method === 'GET') {
        const id = parseCollectionId(pathname);
        if (id !== null) {
          validId(id);
          const collection = await store.find(id);
          if (!collection) throw new AppError(404, 'collection_not_found', '收藏不存在');
          return sendJson(response, 200, collection, cors);
        }
      }

      const writeRequest = request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE';
      if (writeRequest && pathname.startsWith('/api/')) {
        if (!origin || !isAllowedOrigin(request, origin, allowedOrigins)) {
          throw new AppError(403, 'invalid_origin', '不允许的来源');
        }
        if (request.method === 'POST' && pathname === '/api/collections') {
          return sendJson(response, 201, await store.create(validateCreatePayload(await readJson(request))), cors);
        }
        const actionMatch = pathname.match(/^\/api\/collections\/([^/]+)\/(archive|restore)$/);
        if (request.method === 'POST' && actionMatch) {
          const id = decodeURIComponent(actionMatch[1]);
          validId(id);
          const body = await readJson(request);
          if (!isPlainObject(body) || Object.keys(body).length !== 0) {
            throw new AppError(400, 'invalid_request', '归档请求体必须是空对象');
          }
          return sendJson(response, 200, await store.setArchived(id, actionMatch[2] === 'archive'), cors);
        }
        if (request.method === 'PATCH') {
          const id = parseCollectionId(pathname);
          if (id !== null) {
            validId(id);
            return sendJson(response, 200, await store.updateNote(id, validatePatchPayload(await readJson(request)).note), cors);
          }
        }
        if (request.method === 'DELETE') {
          const id = parseCollectionId(pathname);
          if (id !== null) {
            validId(id);
            await store.remove(id);
            return sendJson(response, 200, { deleted: true }, cors);
          }
        }
      }
      if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return staticResponse(response, 'index.html', 'text/html; charset=utf-8');
      if (request.method === 'GET' && pathname === '/styles.css') return staticResponse(response, 'styles.css', 'text/css; charset=utf-8');
      if (request.method === 'GET' && pathname === '/app.js') return staticResponse(response, 'app.js', 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && pathname === '/i18n.js') return staticResponse(response, 'i18n.js', 'text/javascript; charset=utf-8');
      if (request.method === 'GET' && pathname === '/runtime-config.js') {
        const runtime = `globalThis.__CODEX_SUITE_CONFIG__ = ${JSON.stringify({ locale: process.env.CODEX_SUITE_LOCALE || 'auto', viewerOrigins: { session: process.env.SESSION_VIEWER_ORIGIN || 'http://127.0.0.1:3460' } })};`;
        response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        response.end(runtime);
        return;
      }
      if (request.method === 'GET' && pathname === '/vendor/marked.js') return vendorResponse(response, 'marked/lib/marked.umd.js');
      if (request.method === 'GET' && pathname === '/vendor/purify.js') return vendorResponse(response, 'dompurify/dist/purify.min.js');
      throw new AppError(404, 'not_found', '未找到请求资源');
    } catch (error) {
      return sendError(response, error, cors, locale);
    }
  };
  return { handler, store };
}

export function createCollectServer(options = {}) {
  const app = createApp(options);
  const server = createHttpServer(app.handler);
  return { ...app, server };
}

export function startServer({ port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10), ...options } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1 至 65535 的整数');
  const { server } = createCollectServer(options);
  server.listen(port, '127.0.0.1', () => console.log(`Collect Viewer: http://127.0.0.1:${port}`));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) startServer();
