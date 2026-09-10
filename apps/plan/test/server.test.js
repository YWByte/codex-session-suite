import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

async function startFixture() {
  const root = await mkdtemp(join(tmpdir(), 'viewer-test-'));
  const dataDir = join(root, 'data');
  await mkdir(join(dataDir, 'project', '2026-01-01'), { recursive: true });
  await writeFile(join(dataDir, 'project', '2026-01-01', 'Document.md'), '# Document\n', 'utf8');
  const app = createApp(dataDir);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return { root, server, base: `http://127.0.0.1:${server.address().port}` };
}

test('health reports trash capability', async () => {
  const fixture = await startFixture();
  try {
    const response = await fetch(`${fixture.base}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.trashSupported, 'boolean');
  } finally {
    fixture.server.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('locale endpoint exposes the configured locale', async () => {
  const previous = process.env.CODEX_SUITE_LOCALE;
  process.env.CODEX_SUITE_LOCALE = 'zh-CN';
  const fixture = await startFixture();
  try {
    const response = await fetch(`${fixture.base}/locale.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /zh-CN/);
  } finally {
    fixture.server.close();
    await rm(fixture.root, { recursive: true, force: true });
    if (previous === undefined) delete process.env.CODEX_SUITE_LOCALE;
    else process.env.CODEX_SUITE_LOCALE = previous;
  }
});

test('the page includes bilingual UI and a language switch', async () => {
  const fixture = await startFixture();
  try {
    const response = await fetch(`${fixture.base}/`);
    const html = await response.text();
    assert.match(html, /data-i18n="appName"/);
    assert.match(html, /id="language-select"/);
    assert.match(html, /zh-CN/);
    assert.match(html, /English/);
  } finally {
    fixture.server.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});


test('reads, updates, rejects stale writes, renames, and blocks unsafe paths', async () => {
  const fixture = await startFixture();
  try {
    const loadedResponse = await fetch(`${fixture.base}/api/plans/project/2026-01-01/Document.md`);
    assert.equal(loadedResponse.status, 200);
    const loaded = await loadedResponse.json();
    assert.equal(loaded.content, '# Document\n');
    assert.match(loaded.revision, /^[a-f0-9]{64}$/);

    const updatedResponse = await fetch(`${fixture.base}/api/plans/project/2026-01-01/Document.md/content`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '# Updated\n', revision: loaded.revision }),
    });
    assert.equal(updatedResponse.status, 200);
    const staleResponse = await fetch(`${fixture.base}/api/plans/project/2026-01-01/Document.md/content`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '# Stale\n', revision: loaded.revision }),
    });
    assert.equal(staleResponse.status, 409);

    const renameResponse = await fetch(`${fixture.base}/api/plans/project/2026-01-01/Document.md`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Renamed' }),
    });
    assert.equal(renameResponse.status, 200);
    assert.equal(await readFile(join(fixture.root, 'data', 'project', '2026-01-01', 'Renamed.md'), 'utf8'), '# Updated\n');

    const traversal = await fetch(`${fixture.base}/api/plans/project/2026-01-01/${encodeURIComponent('../outside.md')}`);
    assert.equal(traversal.status, 400);
    const outside = join(fixture.root, 'outside.md');
    await writeFile(outside, '# Outside\n');
    await symlink(outside, join(fixture.root, 'data', 'project', '2026-01-01', 'Linked.md'));
    const linked = await fetch(`${fixture.base}/api/plans/project/2026-01-01/Linked.md`);
    assert.equal(linked.status, 400);
  } finally {
    fixture.server.close();
    await rm(fixture.root, { recursive: true, force: true });
  }
});
