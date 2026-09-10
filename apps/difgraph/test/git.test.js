import test from 'node:test';
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { commit, createRepository, git, temporaryDirectory } from './helpers.js';
import { readCommitDetail, readRepository, resolveRepository } from '../src/git.js';

const cleanups = [];
test.afterEach(async () => Promise.all(cleanups.splice(0).map(root => rm(root, { recursive: true, force: true }))));

test('reads linear history, refs, unicode and multiline commit data', async () => {
  const root = await createRepository(); cleanups.push(root);
  const first = await commit(root, '第一条\n\n正文');
  const second = await commit(root, 'special | %x00 café', 'two');
  await git(root, ['tag', 'v1', first]);
  const result = await readRepository(root);
  assert.equal(result.repository.root, root);
  assert.equal(result.repository.detached, false);
  assert.deepEqual(result.commits.map(item => item.sha), [second, first]);
  assert.equal(result.commits[0].subject, 'special | %x00 café');
  assert.ok(result.commits[1].refs.some(ref => ref.type === 'tag' && ref.name === 'v1'));
  const detail = await readCommitDetail(root, first);
  assert.equal(detail.message, '第一条\n\n正文');
  assert.equal(detail.totals.files, 1);
});

test('keeps topo history and all merge parents, and supports detached HEAD', async () => {
  const root = await createRepository(); cleanups.push(root);
  const base = await commit(root, 'base');
  const mainBranch = await git(root, ['branch', '--show-current']);
  await git(root, ['checkout', '-q', '-b', 'side']);
  await writeFile(path.join(root, 'side.txt'), 'side'); await git(root, ['add', '.']); await git(root, ['commit', '-q', '-m', 'side']);
  await git(root, ['checkout', '-q', mainBranch]);
  await writeFile(path.join(root, 'main.txt'), 'main'); await git(root, ['add', '.']); await git(root, ['commit', '-q', '-m', 'main']);
  await git(root, ['merge', '-q', '--no-ff', 'side', '-m', 'merge']);
  let result = await readRepository(root);
  assert.equal(result.commits[0].parents.length, 2);
  assert.ok(result.commits.some(item => item.sha === base));
  await git(root, ['checkout', '-q', '--detach']);
  result = await readRepository(root);
  assert.equal(result.repository.detached, true);
  assert.equal(result.repository.branch, null);
});

test('lists local branches and reads only the selected branch without checkout', async () => {
  const root = await createRepository(); cleanups.push(root);
  const current = await commit(root, 'current');
  const currentBranch = await git(root, ['branch', '--show-current']);
  await git(root, ['checkout', '-q', '--orphan', 'other']);
  await git(root, ['rm', '-q', '-rf', '.']);
  const unrelated = await commit(root, 'unrelated');
  await git(root, ['checkout', '-q', currentBranch]);
  const currentResult = await readRepository(root);
  assert.deepEqual(currentResult.commits.map(item => item.sha), [current]);
  assert.deepEqual(currentResult.repository.branches.map(item => item.name).sort(), [currentBranch, 'other'].sort());
  const otherResult = await readRepository(root, 100, 'other');
  assert.deepEqual(otherResult.commits.map(item => item.sha), [unrelated]);
  assert.equal(otherResult.repository.selectedBranch, 'other');
  assert.equal(await git(root, ['branch', '--show-current']), currentBranch);
  await assert.rejects(readRepository(root, 100, 'missing'), error => error.code === 'BRANCH_NOT_FOUND');
});

test('limits history to 100 and leaves the boundary parent available as a truncated edge', async () => {
  const root = await createRepository(); cleanups.push(root);
  for (let index = 0; index < 103; index++) await commit(root, `commit ${index}`, String(index));
  const result = await readRepository(root);
  assert.equal(result.commits.length, 100);
  const loaded = new Set(result.commits.map(item => item.sha));
  assert.ok(result.commits.at(-1).parents.some(parent => !loaded.has(parent)));
});

test('reports missing paths, non repositories, and empty repositories', async () => {
  const folder = await temporaryDirectory(); cleanups.push(folder);
  await assert.rejects(resolveRepository(path.join(folder, 'missing')), error => error.code === 'PATH_NOT_FOUND');
  await assert.rejects(resolveRepository(folder), error => error.code === 'NOT_A_REPOSITORY');
  await git(folder, ['init', '-q']);
  await assert.rejects(resolveRepository(folder), error => error.code === 'EMPTY_REPOSITORY');
});

test('shows rename and binary statistics without inventing line counts', async () => {
  const root = await createRepository(); cleanups.push(root);
  await commit(root, 'base', 'rename me');
  await git(root, ['mv', 'file.txt', 'renamed.txt']);
  await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 1, 2, 0, 4]));
  await git(root, ['add', '.']); await git(root, ['commit', '-q', '-m', 'files']);
  const sha = await git(root, ['rev-parse', 'HEAD']);
  const detail = await readCommitDetail(root, sha);
  assert.ok(detail.files.some(file => file.path === 'renamed.txt' && file.oldPath === 'file.txt'));
  assert.ok(detail.files.some(file => file.path === 'binary.bin' && file.binary));
});
