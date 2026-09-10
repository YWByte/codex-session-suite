import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLocale, resolveLocale, systemLocale, translator } from '../src/i18n.js';

test('normalizes supported locales and falls back to English', () => {
  assert.equal(normalizeLocale('zh'), 'zh-CN');
  assert.equal(normalizeLocale('zh-Hans'), 'zh-CN');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('fr'), 'en');
  assert.equal(normalizeLocale('auto'), 'en');
});

test('resolves CLI and suite locale before system locale', () => {
  const env = { LANG: 'zh_CN.UTF-8', LC_ALL: 'en_US.UTF-8' };
  assert.equal(systemLocale(env), 'en');
  assert.equal(resolveLocale('auto', { LANG: 'zh_CN.UTF-8', LC_ALL: '', LC_MESSAGES: '' }), 'zh-CN');
  assert.equal(resolveLocale('zh-CN', env), 'zh-CN');
  assert.equal(resolveLocale('fr', env), 'en');
  assert.equal(resolveLocale('auto', { CODEX_SUITE_LOCALE: 'zh-CN' }), 'zh-CN');
});

test('translates and interpolates with English fallback', () => {
  const translate = translator('zh-CN');
  assert.equal(translate('cli.started', { url: 'http://127.0.0.1:1' }), 'difgraph 已在 http://127.0.0.1:1 启动');
  assert.equal(translator('unsupported')('unknownKey'), 'unknownKey');
  assert.equal(translator('en')('unknownKey'), 'unknownKey');
});

test('localizes stable server error codes', async () => {
  const { default: http } = await import('node:http');
  const { createHttpApp } = await import('../src/http.js');
  const { createRepository, commit } = await import('./helpers.js');
  const root = await createRepository(); await commit(root, 'i18n');
  const server = http.createServer(createHttpApp({ repositoryRoot: root, difitManager: {}, locale: 'en' }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/repository?branch=missing`, {
      headers: { cookie: 'codex_suite_locale=zh-CN' },
    });
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.error.code, 'BRANCH_NOT_FOUND');
    assert.equal(body.error.message, '所选本地分支不存在');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await import('node:fs/promises').then(fs => fs.rm(root, { recursive: true, force: true }));
  }
});

test('resolves the difit CLI from the suite dependency', async () => {
  const { defaultDifitCli } = await import('../src/difit.js');
  const cli = defaultDifitCli();
  assert.ok(cli?.endsWith('/node_modules/difit/dist/cli/index.js'));
  await assert.doesNotReject(() => import('node:fs/promises').then(fs => fs.access(cli)));
});
