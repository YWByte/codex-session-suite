import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from '../src/process.js';

export async function temporaryDirectory(prefix = 'difgraph-') { return mkdtemp(path.join(tmpdir(), prefix)); }
export async function git(cwd, args) { return (await run('git', args, { cwd })).toString().trim(); }
export async function createRepository() {
  const root = await temporaryDirectory();
  await git(root, ['init', '-q']);
  await git(root, ['config', 'user.name', 'Test User']);
  await git(root, ['config', 'user.email', 'test@example.com']);
  return root;
}
export async function commit(root, message, content = message) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'file.txt'), content);
  await git(root, ['add', 'file.txt']);
  await git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}
