import path from 'node:path';
import { access } from 'node:fs/promises';
import { AppError } from './errors.js';
import { run } from './process.js';

const git = (cwd, args, options) => run('git', ['-c', 'core.quotepath=false', ...args], { cwd, ...options });

export async function resolveRepository(inputPath) {
  const candidate = path.resolve(inputPath);
  try { await access(candidate); }
  catch { throw new AppError('PATH_NOT_FOUND', `Path does not exist: ${candidate}`, 400, { path: candidate }); }
  let root;
  try { root = (await git(candidate, ['rev-parse', '--show-toplevel'])).toString().trim(); }
  catch { throw new AppError('NOT_A_REPOSITORY', `Not a Git repository: ${candidate}`, 400, { path: candidate }); }
  try { await git(root, ['rev-parse', '--verify', 'HEAD^{commit}']); }
  catch { throw new AppError('EMPTY_REPOSITORY', `Repository has no commits: ${root}`, 400, { root }); }
  return root;
}

function parseIdentity(value) {
  const match = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(value);
  if (!match) return { name: value, email: '', timestamp: null, timezone: '' };
  return { name: match[1], email: match[2], timestamp: Number(match[3]), timezone: match[4] };
}

export function parseCommitObject(sha, buffer) {
  const separator = buffer.indexOf(Buffer.from('\n\n'));
  const headerText = buffer.subarray(0, separator < 0 ? buffer.length : separator).toString('utf8');
  const message = separator < 0 ? '' : buffer.subarray(separator + 2).toString('utf8').replace(/\n$/, '');
  const headers = new Map();
  let current = '';
  for (const line of headerText.split('\n')) {
    if (line.startsWith(' ')) headers.set(current, `${headers.get(current)}\n${line.slice(1)}`);
    else {
      const space = line.indexOf(' ');
      if (space > 0) { current = line.slice(0, space); const value = line.slice(space + 1); headers.set(current, headers.has(current) ? `${headers.get(current)}\n${value}` : value); }
    }
  }
  const author = parseIdentity(headers.get('author') ?? '');
  const committer = parseIdentity(headers.get('committer') ?? '');
  return {
    sha,
    parents: (headers.get('parent') ?? '').split('\n').filter(Boolean),
    subject: message.split('\n')[0] ?? '',
    message,
    author,
    committer,
  };
}

async function readCommitObjects(root, shas) {
  const input = `${shas.join('\n')}\n`;
  const output = await git(root, ['cat-file', '--batch'], { input });
  const commits = [];
  let offset = 0;
  for (const expectedSha of shas) {
    const lineEnd = output.indexOf(10, offset);
    if (lineEnd < 0) throw new Error('Invalid git cat-file response');
    const [sha, type, sizeText] = output.subarray(offset, lineEnd).toString().split(' ');
    const size = Number(sizeText);
    if (type !== 'commit' || !Number.isInteger(size)) throw new Error(`Unable to read commit ${expectedSha}`);
    const start = lineEnd + 1;
    commits.push(parseCommitObject(sha, output.subarray(start, start + size)));
    offset = start + size + 1;
  }
  return commits;
}

function simplifyRef(ref) {
  if (ref.startsWith('refs/heads/')) return { type: 'branch', name: ref.slice(11) };
  if (ref.startsWith('refs/remotes/')) return { type: 'remote', name: ref.slice(13) };
  if (ref.startsWith('refs/tags/')) return { type: 'tag', name: ref.slice(10) };
  return null;
}

async function readRefs(root) {
  const output = await git(root, ['for-each-ref', '--format=%(objectname)%00%(refname)%00%(*objectname)']);
  const map = new Map();
  for (const line of output.toString().split('\n').filter(Boolean)) {
    const [objectSha, ref, peeled] = line.split('\0');
    const label = simplifyRef(ref);
    const sha = peeled || objectSha;
    if (label && sha) map.set(sha, [...(map.get(sha) ?? []), label]);
  }
  return map;
}

export async function readLocalBranches(root) {
  const output = await git(root, ['for-each-ref', '--sort=refname', '--format=%(refname:short)%00%(objectname)', 'refs/heads']);
  return output.toString().split('\n').filter(Boolean).map(line => {
    const [name, sha] = line.split('\0');
    return { name, sha };
  });
}

export async function readRepository(root, limit = 100, requestedBranch = null) {
  const [branches, refs, branch, head] = await Promise.all([
    readLocalBranches(root), readRefs(root),
    git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']).then(v => v.toString().trim()).catch(() => null),
    git(root, ['rev-parse', 'HEAD']).then(v => v.toString().trim()),
  ]);
  const selectedBranch = requestedBranch ?? branch;
  let revision = 'HEAD';
  let selectedHead = head;
  if (selectedBranch !== null) {
    const selected = branches.find(item => item.name === selectedBranch);
    if (!selected) throw new AppError('BRANCH_NOT_FOUND', `Local branch does not exist: ${selectedBranch}`, 404, { branch: selectedBranch });
    revision = `refs/heads/${selected.name}`;
    selectedHead = selected.sha;
  }
  let shas;
  try {
    shas = (await git(root, ['rev-list', '--topo-order', '--date-order', `--max-count=${limit}`, revision])).toString().trim().split('\n').filter(Boolean);
  } catch { throw new AppError('GIT_READ_FAILED', 'Unable to read Git history', 500); }
  const commits = await readCommitObjects(root, shas);
  return {
    repository: {
      root,
      name: path.basename(root),
      branch,
      head,
      detached: branch === null,
      selectedBranch,
      selectedHead,
      branches,
    },
    commits: commits.map(commit => ({ ...commit, message: undefined, committedAt: commit.committer.timestamp, committer: undefined, refs: refs.get(commit.sha) ?? [] })),
  };
}

function parseNumstat(buffer) {
  const fields = buffer.toString('utf8').split('\0');
  const files = [];
  for (let i = 0; i < fields.length - 1; i++) {
    const field = fields[i];
    const first = field.indexOf('\t');
    const second = first < 0 ? -1 : field.indexOf('\t', first + 1);
    if (first < 0 || second < 0) continue;
    const additionsText = field.slice(0, first);
    const deletionsText = field.slice(first + 1, second);
    let filePath = field.slice(second + 1);
    let oldPath = null;
    if (!filePath) { oldPath = fields[++i] ?? ''; filePath = fields[++i] ?? ''; }
    files.push({
      path: filePath,
      oldPath,
      additions: additionsText === '-' ? null : Number(additionsText),
      deletions: deletionsText === '-' ? null : Number(deletionsText),
      binary: additionsText === '-' || deletionsText === '-',
    });
  }
  return files;
}

export async function readCommitDetail(root, sha) {
  const [commit] = await readCommitObjects(root, [sha]);
  const stats = parseNumstat(await git(root, ['diff-tree', '--root', '--no-commit-id', '--numstat', '-z', '-r', '-M', sha]));
  return {
    ...commit,
    files: stats,
    totals: stats.reduce((total, file) => ({
      files: total.files + 1,
      additions: total.additions + (file.additions ?? 0),
      deletions: total.deletions + (file.deletions ?? 0),
      binary: total.binary + Number(file.binary),
    }), { files: 0, additions: 0, deletions: 0, binary: 0 }),
  };
}
