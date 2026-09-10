import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { rm } from 'node:fs/promises';
import { createRepository, commit } from './helpers.js';
import { createHttpApp } from '../src/http.js';

let root; let server;
test.afterEach(async () => { if (server) await new Promise(resolve => server.close(resolve)); server = null; if (root) await rm(root, { recursive: true, force: true }); root = null; });
async function start(manager = { start: async () => ({ url: 'http://127.0.0.1:9999', pid: 1 }), stop: async () => true }, options = {}) {
  server = http.createServer(createHttpApp({ repositoryRoot: root, repositoryDirectory: options.repositoryDirectory ?? root, difitManager: manager, folderPicker: options.folderPicker }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
test('serves health, repository, detail and only allows loaded full SHAs', async () => {
  root = await createRepository(); const sha = await commit(root, 'hello'); const base = await start();
  assert.equal((await (await fetch(`${base}/health`)).json()).ok, true);
  const repository = await (await fetch(`${base}/api/repository`)).json();
  assert.equal(repository.commits[0].sha, sha);
  assert.equal(repository.repository.branches.length, 1);
  assert.equal(repository.repository.directory, root);
  assert.equal(repository.repository.selectedBranch, repository.repository.branch);
  assert.equal((await fetch(`${base}/api/repository?branch=missing`)).status, 404);
  assert.equal((await fetch(`${base}/api/commits/${sha}`)).status, 200);
  assert.equal((await fetch(`${base}/api/commits/${sha.slice(0, 8)}`)).status, 404);
  assert.equal((await fetch(`${base}/api/commits/${'a'.repeat(40)}`)).status, 404);
});
test('starts and stops difit through fixed endpoints', async () => {
  root = await createRepository(); const sha = await commit(root, 'hello');
  const calls = [];
  const base = await start({ start: async (value, options) => { calls.push(['start', value, options]); return { url: 'http://127.0.0.1:9999', pid: 4 }; }, stop: async () => { calls.push(['stop']); return true; } });
  await fetch(`${base}/api/repository`);
  const started = await fetch(`${base}/api/difit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sha }) });
  assert.equal(started.status, 200);
  assert.equal((await started.json()).url, 'http://127.0.0.1:9999');
  assert.equal((await fetch(`${base}/api/difit`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(calls, [['start', sha, { rootCommit: true }], ['stop']]);
});


test('selects another Git directory and updates difit context', async () => {
  root = await createRepository(); await commit(root, 'first');
  const nextRoot = await createRepository(); await commit(nextRoot, 'second');
  const calls = [];
  const manager = {
    repositoryRoot: root,
    start: async () => ({ url: 'http://127.0.0.1:9999', pid: 1 }),
    stop: async () => { calls.push('stop'); return true; },
  };
  try {
    const base = await start(manager, { folderPicker: { choose: async () => ({ cancelled: false, directory: nextRoot }) } });
    const selected = await fetch(`${base}/api/repository/select`, { method: 'POST' });
    assert.equal(selected.status, 200);
    const selectedBody = await selected.json();
    assert.equal(selectedBody.cancelled, false);
    assert.equal(selectedBody.directory, nextRoot);
    const repository = await (await fetch(`${base}/api/repository`)).json();
    assert.equal(repository.repository.directory, nextRoot);
    assert.equal(repository.repository.root, selectedBody.root);
    assert.equal(repository.commits[0].subject, 'second');
    assert.equal(manager.repositoryRoot, selectedBody.root);
    assert.deepEqual(calls, ['stop']);
  } finally {
    await rm(nextRoot, { recursive: true, force: true });
  }
});

test('keeps the current repository when directory selection is cancelled', async () => {
  root = await createRepository(); await commit(root, 'current');
  const base = await start(undefined, { folderPicker: { choose: async () => ({ cancelled: true }) } });
  const selected = await fetch(`${base}/api/repository/select`, { method: 'POST' });
  assert.deepEqual(await selected.json(), { cancelled: true });
  const repository = await (await fetch(`${base}/api/repository`)).json();
  assert.equal(repository.repository.root, root);
});
