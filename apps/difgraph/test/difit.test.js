import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmod, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DifitManager, findOnPath, parseHandshake } from '../src/difit.js';
import { temporaryDirectory } from './helpers.js';

const roots = [];
test.afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));
function childWith({ stdout = '', stderr = '', code = 0, close = true } = {}) {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), killCalled: false, kill() { this.killCalled = true; } });
  queueMicrotask(() => {
    if (stdout) child.stdout.write(stdout);
    if (stderr) child.stderr.write(stderr);
    if (close) child.emit('close', code);
  });
  return child;
}
async function fakeExecutable() {
  const root = await temporaryDirectory('difit-path-'); roots.push(root);
  const file = path.join(root, 'difit'); await writeFile(file, '#!/bin/sh\n'); await chmod(file, 0o755);
  return { root, file };
}

test('accepts only complete loopback handshakes', () => {
  assert.deepEqual(parseHandshake('{"port":4000,"url":"http://127.0.0.1:4000","pid":12}\n'), { port: 4000, url: 'http://127.0.0.1:4000', pid: 12 });
  assert.equal(parseHandshake('{"port":4000,"url":"https://example.com","pid":12}'), null);
  assert.equal(parseHandshake('noise'), null);
});
test('finds executable difit in PATH and starts it with argument arrays', async () => {
  const { root, file } = await fakeExecutable();
  let invocation;
  const manager = new DifitManager({ repositoryRoot: root, env: { PATH: root }, spawnProcess(command, args, options) { invocation = { command, args, options }; return childWith({ stdout: '{"port":4001,"url":"http://localhost:4001","pid":111}\n' }); } });
  const result = await manager.start('a'.repeat(40));
  assert.equal(await findOnPath('difit', root), file);
  assert.equal(result.pid, 111);
  assert.equal(invocation.command, file);
  assert.deepEqual(invocation.args, ['a'.repeat(40), '--background', '--host', '127.0.0.1', '--no-open']);
  assert.equal(invocation.options.cwd, root);
});
test("compares a root commit with Git's empty tree", async () => {
  const { root } = await fakeExecutable();
  let args;
  const manager = new DifitManager({ repositoryRoot: root, env: { PATH: root }, spawnProcess(_command, value) { args = value; return childWith({ stdout: '{"port":4003,"url":"http://127.0.0.1:4003","pid":113}\n' }); } });
  const sha = 'c'.repeat(40);
  await manager.start(sha, { rootCommit: true });
  assert.deepEqual(args.slice(0, 2), [sha, '4b825dc642cb6eb9a060e54bf8d69288fbee4904']);
});
test('uses node fallback when PATH has no difit', async () => {
  const root = await temporaryDirectory('difit-fallback-'); roots.push(root);
  const fallback = path.join(root, 'index.js'); await writeFile(fallback, '');
  let args;
  const manager = new DifitManager({ repositoryRoot: root, env: { PATH: '' }, fallback, spawnProcess(_command, value) { args = value; return childWith({ stdout: '{"port":4002,"url":"http://[::1]:4002","pid":112}\n' }); } });
  await manager.start('b'.repeat(40));
  assert.equal(args[0], fallback);
});
test('reports missing executable, invalid handshake, and startup timeout', async () => {
  const root = await temporaryDirectory('difit-errors-'); roots.push(root);
  const manager = new DifitManager({ repositoryRoot: root, env: { PATH: '' }, fallback: path.join(root, 'missing') });
  await assert.rejects(manager.start('a'.repeat(40)), error => error.code === 'DIFIT_NOT_FOUND');
  const executable = path.join(root, 'index.js'); await writeFile(executable, '');
  manager.fallback = executable; manager.spawnProcess = () => childWith({ stdout: '{"url":"http://example.com"}' });
  await assert.rejects(manager.start('a'.repeat(40)), error => error.code === 'DIFIT_START_FAILED');
  let timedOutChild;
  manager.timeout = 10; manager.spawnProcess = () => (timedOutChild = childWith({ close: false }));
  await assert.rejects(manager.start('a'.repeat(40)), error => error.code === 'DIFIT_START_TIMEOUT');
  assert.equal(timedOutChild.killCalled, true);
});
test('stops the previous PID before switching commits and on explicit cleanup', async t => {
  const { root } = await fakeExecutable();
  const killed = [];
  t.mock.method(process, 'kill', pid => { killed.push(pid); return true; });
  let pid = 200;
  const manager = new DifitManager({ repositoryRoot: root, env: { PATH: root }, spawnProcess: () => childWith({ stdout: JSON.stringify({ port: 4000 + pid, url: `http://127.0.0.1:${4000 + pid}`, pid: pid++ }) + '\n' }) });
  await manager.start('a'.repeat(40));
  await manager.start('b'.repeat(40));
  await manager.stop();
  assert.deepEqual(killed, [200, 201]);
});
