import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createCollectServer } from '../server.js';

async function startFixture({ sessionOrigin = 'http://127.0.0.1:3460' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'collect-viewer-'));
  const dataFile = join(directory, 'collections', 'collections.json');
  const { server } = createCollectServer({ dataFile, sessionOrigin });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    directory, dataFile, base: `http://127.0.0.1:${port}`,
    async close() { await new Promise((resolve) => server.close(resolve)); await rm(directory, { recursive: true, force: true }); },
  };
}

function payload(overrides = {}) {
  return {
    quote: '一段值得保留的话',
    note: '初始批注',
    source: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1', role: 'assistant',
      projectPath: '/Users/example/project', projectName: '示例项目', sessionTitle: '示例会话',
      viewerOrigin: 'http://127.0.0.1:3462',
      segments: [{ blockPath: 'p:0', start: 0, end: 8 }],
    },
    ...overrides,
  };
}

async function api(fixture, path, options = {}) {
  return fetch(`${fixture.base}${path}`, {
    ...options,
    headers: { Origin: 'http://127.0.0.1:3460', ...(options.headers || {}) },
  });
}

test('health 与空列表可访问', async () => {
  const fixture = await startFixture();
  try {
    const health = await fetch(`${fixture.base}/health`);
    assert.equal(health.status, 200); assert.equal(await health.text(), 'ok');
    const response = await api(fixture, '/api/collections?archived=false');
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { collections: [] });
  } finally { await fixture.close(); }
});

test('创建、持久化、重复检测与串行写入', async () => {
  const fixture = await startFixture();
  try {
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) };
    const [first, duplicate] = await Promise.all([api(fixture, '/api/collections', options), api(fixture, '/api/collections', options)]);
    const statuses = [first.status, duplicate.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const duplicateData = first.status === 409 ? await first.json() : await duplicate.json();
    assert.equal(duplicateData.error.code, 'duplicate_collection');
    const createdResponse = first.status === 201 ? first : duplicate;
    const created = await createdResponse.json();
    assert.match(created.id, /^[0-9a-f-]{36}$/);
    assert.equal(created.archivedAt, null);
    const stored = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
    assert.equal(stored.collections.length, 1);
  } finally { await fixture.close(); }
});

test('跨实例写入不丢失，且等价选区字段顺序仍会去重', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'collect-viewer-shared-'));
  const dataFile = join(directory, 'collections.json');
  const first = createCollectServer({ dataFile, sessionOrigin: 'http://127.0.0.1:3462' });
  const second = createCollectServer({ dataFile, sessionOrigin: 'http://127.0.0.1:3462' });
  await Promise.all([
    new Promise((resolve) => first.server.listen(0, '127.0.0.1', resolve)),
    new Promise((resolve) => second.server.listen(0, '127.0.0.1', resolve)),
  ]);
  const fixtures = [first, second].map(({ server }) => ({ base: `http://127.0.0.1:${server.address().port}` }));
  try {
    const requestOptions = (body) => ({
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:3462', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const [left, right] = await Promise.all([
      fetch(`${fixtures[0].base}/api/collections`, requestOptions(payload())),
      fetch(`${fixtures[1].base}/api/collections`, requestOptions(payload({
        quote: '另一条收藏',
        source: { ...payload().source, itemId: 'item-2' },
      }))),
    ]);
    assert.equal(left.status, 201);
    assert.equal(right.status, 201);
    const stored = JSON.parse(await readFile(dataFile, 'utf8'));
    assert.equal(stored.collections.length, 2);

    const reordered = payload({
      source: {
        ...payload().source,
        segments: [{ end: 8, start: 0, blockPath: 'p:0' }],
      },
    });
    const duplicate = await fetch(`${fixtures[1].base}/api/collections`, requestOptions(reordered));
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).error.code, 'duplicate_collection');
  } finally {
    await Promise.all(fixtures.map((_fixture, index) => new Promise((resolve) => [first, second][index].server.close(resolve))));
    await rm(directory, { recursive: true, force: true });
  }
});

test('只允许更新批注，并支持归档和恢复', async () => {
  const fixture = await startFixture();
  try {
    const created = await (await api(fixture, '/api/collections', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload()) })).json();
    const invalid = await api(fixture, `/api/collections/${created.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ quote:'不能改' }) });
    assert.equal(invalid.status, 400);
    const updated = await (await api(fixture, `/api/collections/${created.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ note:'已更新' }) })).json();
    assert.equal(updated.note, '已更新');
    const archived = await (await api(fixture, `/api/collections/${created.id}/archive`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })).json();
    assert.ok(archived.archivedAt);
    assert.equal((await (await api(fixture, '/api/collections?archived=false')).json()).collections.length, 0);
    const restored = await (await api(fixture, `/api/collections/${created.id}/restore`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })).json();
    assert.equal(restored.archivedAt, null);
  } finally { await fixture.close(); }
});

test('手动创建收藏：无 source、origin 校验、不查重、可归档与改批注', async () => {
  const fixture = await startFixture();
  try {
    const options = (body) => ({ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    const created = await api(fixture, '/api/collections', options({ quote:'手动记录的句子', note:'一条批注', origin:'《重构》第 3 章' }));
    assert.equal(created.status, 201);
    const data = await created.json();
    assert.equal(data.source, null);
    assert.equal(data.origin, '《重构》第 3 章');
    assert.ok(data.createdAt);
    const duplicateQuote = await api(fixture, '/api/collections', options({ quote:'手动记录的句子', origin:'《重构》第 3 章' }));
    assert.equal(duplicateQuote.status, 201);
    const both = await api(fixture, '/api/collections', options({ quote:'混用字段', source:payload().source, origin:'某来源' }));
    assert.equal(both.status, 400);
    const invalidOrigin = await api(fixture, '/api/collections', options({ quote:'超长来源', origin:'长'.repeat(2048) }));
    assert.equal(invalidOrigin.status, 413);
    const emptyOrigin = await api(fixture, '/api/collections', options({ quote:'未填来源' }));
    assert.equal(emptyOrigin.status, 201);
    assert.equal((await emptyOrigin.json()).origin, '');

    const updated = await (await api(fixture, `/api/collections/${data.id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ note:'手动批注更新' }) })).json();
    assert.equal(updated.note, '手动批注更新');
    const archived = await (await api(fixture, `/api/collections/${data.id}/archive`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' })).json();
    assert.ok(archived.archivedAt);
    const stored = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
    assert.equal(stored.collections.length, 3);
    assert.ok(stored.collections.every((item) => typeof item.origin === 'string'));
  } finally { await fixture.close(); }
});

test('存储校验兼容手动收藏与损坏的混合记录', async () => {
  const fixture = await startFixture();
  try {
    const options = (body) => ({ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    await api(fixture, '/api/collections', options(payload()));
    await api(fixture, '/api/collections', options({ quote:'手动记录', origin:'' }));

    const listing = await api(fixture, '/api/collections?archived=false');
    assert.equal((await listing.json()).collections.length, 2);

    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(fixture.directory, 'collections'), { recursive:true });
    const stored = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
    stored.collections[1].source = null;
    stored.collections[1].origin = 42;
    await writeFile(fixture.dataFile, JSON.stringify(stored), 'utf8');
    const response = await api(fixture, '/api/collections?archived=false');
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error.code, 'storage_corrupt');
  } finally { await fixture.close(); }
});

test('已归档收藏可删除，未归档删除被拒绝', async () => {
  const fixture = await startFixture();
  try {
    const options = { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload()) };
    const created = await (await api(fixture, '/api/collections', options)).json();
    const activeDelete = await api(fixture, `/api/collections/${created.id}`, { method:'DELETE' });
    assert.equal(activeDelete.status, 400);
    assert.equal((await activeDelete.json()).error.code, 'not_archived');
    await api(fixture, `/api/collections/${created.id}/archive`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    const deleted = await api(fixture, `/api/collections/${created.id}`, { method:'DELETE' });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { deleted: true });
    assert.equal((await (await api(fixture, '/api/collections?archived=false')).json()).collections.length, 0);
    assert.equal((await (await api(fixture, '/api/collections?archived=true')).json()).collections.length, 0);
    const missing = await api(fixture, `/api/collections/${created.id}`, { method:'DELETE' });
    assert.equal(missing.status, 404);
    const stored = JSON.parse(await readFile(fixture.dataFile, 'utf8'));
    assert.equal(stored.collections.length, 0);
  } finally { await fixture.close(); }
});

test('写接口拒绝未知来源和非法 JSON，并返回 CORS 预检', async () => {
  const fixture = await startFixture();
  try {
    const forbidden = await fetch(`${fixture.base}/api/collections`, { method:'POST', headers:{ Origin:'http://evil.example', 'Content-Type':'application/json' }, body:'{}' });
    assert.equal(forbidden.status, 403);
    const malformed = await api(fixture, '/api/collections', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{' });
    assert.equal(malformed.status, 400); assert.equal((await malformed.json()).error.code, 'invalid_json');
    const preflight = await fetch(`${fixture.base}/api/collections`, { method:'OPTIONS', headers:{ Origin:'http://localhost:3460', 'Access-Control-Request-Method':'POST' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:3460');
  } finally { await fixture.close(); }
});

test('损坏的数据文件安全报错且不会被覆盖', async () => {
  const fixture = await startFixture();
  try {
    await writeFile(fixture.dataFile, '{broken', 'utf8').catch(async (error) => {
      if (error.code === 'ENOENT') { const { mkdir } = await import('node:fs/promises'); await mkdir(join(fixture.directory, 'collections'), { recursive:true }); await writeFile(fixture.dataFile, '{broken', 'utf8'); }
      else throw error;
    });
    const response = await api(fixture, '/api/collections', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload()) });
    assert.equal(response.status, 500); assert.equal((await response.json()).error.code, 'storage_corrupt');
    assert.equal(await readFile(fixture.dataFile, 'utf8'), '{broken');
  } finally { await fixture.close(); }
});

test('rejects non-loopback hosts and localizes API errors', async () => {
  const fixture = await startFixture();
  try {
    const reboundStatus = await new Promise((resolve, reject) => {
      const target = new URL('/api/collections?archived=false', fixture.base);
      const request = http.request(target, { headers: { Host: 'attacker.example' } }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      });
      request.once('error', reject);
      request.end();
    });
    assert.equal(reboundStatus, 403);
    const english = await fetch(`${fixture.base}/api/collections?archived=invalid&locale=en`, { headers: { Host: new URL(fixture.base).host } });
    assert.equal((await english.json()).error.message, 'The query is invalid');
    const chinese = await fetch(`${fixture.base}/api/collections?archived=invalid&locale=zh-CN`, { headers: { Host: new URL(fixture.base).host } });
    assert.match((await chinese.json()).error.message, /必须/);
  } finally {
    await fixture.close();
  }
});
