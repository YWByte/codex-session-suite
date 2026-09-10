import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createCollectServer } from '../server.js';

async function startFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'collect-viewer-browser-'));
  const { server } = createCollectServer({ dataFile: join(directory, 'collections.json') });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

const collectionPayload = {
  quote: '值得收藏的原文',
  note: '初始收藏批注',
  source: {
    threadId: 'thread-1',
    turnId: 'turn-1',
    itemId: 'item-1',
    role: 'assistant',
    projectPath: '/workspace/project',
    projectName: 'Project',
    sessionTitle: 'Session',
    viewerOrigin: 'http://localhost:3462',
    segments: [{ blockPath: '@turn-1/div:0/p:0', start: 0, end: 8 }],
  },
};

test('Collect Viewer 手动新建收藏并展示', async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.base}/?locale=zh-CN`, { waitUntil: 'networkidle' });
    await page.locator('#create').click();
    const saveButton = page.locator('#create-save');
    assert.ok(await saveButton.isDisabled());
    await page.locator('#create-quote').fill('手写收藏：把重要的事情放进收藏夹');
    await page.locator('#create-note').fill('这条是手动创建的');
    await page.locator('#create-origin').fill('《卡片笔记写作法》第 2 章');
    assert.ok(await saveButton.isEnabled());
    await saveButton.click();
    await page.waitForFunction(() => document.querySelector('#active-count')?.textContent === '1');
    assert.equal((await page.locator('.card .quote').textContent()).trim(), '手写收藏：把重要的事情放进收藏夹');
    assert.equal(await page.locator('.card .note').textContent(), '这条是手动创建的');
    assert.equal(await page.locator('.card .role').textContent(), '手动');
    assert.equal(await page.locator('.card .session').textContent(), '《卡片笔记写作法》第 2 章');
    assert.equal(await page.locator('.card .source').count(), 0);
    assert.ok((await page.locator('.card .created').textContent()).length > 0);

    await page.locator('#create').click();
    const createDialogSize = await page.evaluate(() => {
      const dialog = document.querySelector('#create-dialog').getBoundingClientRect();
      const card = document.querySelector('.card').getBoundingClientRect();
      const quote = document.querySelector('#create-quote').getBoundingClientRect();
      return { dialogWidth: dialog.width, cardWidth: card.width, quoteHeight: quote.height, viewportHeight: window.innerHeight };
    });
    assert.ok(Math.abs(createDialogSize.dialogWidth - createDialogSize.cardWidth) <= 1, `create dialog should match card width, difference was ${Math.abs(createDialogSize.dialogWidth - createDialogSize.cardWidth)}px`);
    assert.ok(Math.abs(createDialogSize.quoteHeight / createDialogSize.viewportHeight - .25) <= .01, `quote editor should be about one quarter of the viewport, ratio was ${createDialogSize.quoteHeight / createDialogSize.viewportHeight}`);
    await page.locator('#create-quote').fill('未填来源的手动收藏');
    await page.locator('#create-save').click();
    await page.waitForFunction(() => document.querySelector('#active-count')?.textContent === '2');
    const sessions = await page.locator('.card .session').allTextContents();
    assert.ok(sessions.includes('手动创建'));

    await page.locator('.card .archive').first().click();
    await page.waitForFunction(() => document.querySelector('#active-count')?.textContent === '1');
    await page.locator('[data-view="archived"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 1 && document.querySelector('.card .archive')?.textContent === '恢复');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('.card .delete').click();
    await page.waitForFunction(() => document.querySelector('#archived-count')?.textContent === '0' && document.querySelectorAll('.card').length === 0);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test('Collect Viewer 渲染 Markdown 并按 220 个字符折叠引用', async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const create = async (quote) => {
      const response = await fetch(`${fixture.base}/api/collections`, {
        method: 'POST',
        headers: { Origin: fixture.base, 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote, note: '' }),
      });
      assert.equal(response.status, 201);
    };
    const prefix220 = '边界二百二十：';
    const quote220 = prefix220 + '字'.repeat(220 - Array.from(prefix220).length);
    const prefix221 = '边界二百二十一：';
    const quote221 = prefix221 + '字'.repeat(221 - Array.from(prefix221).length);
    const markdownQuote = [
      '## Memory 的核心问题',
      '',
      '当前重点是 **治理 Memory**，并验证 `Markdown` 渲染。',
      '',
      '- 谁决定写入',
      '- 谁判断重要性',
      '',
      '[安全链接](https://example.com/docs)',
      '[危险链接](javascript:window.collectXss=true)',
      '<img src=x onerror="window.collectXss=true">',
      '',
      '| 文献 | 研究对象 | 核心问题 | 组织结构 | 比较对象 | 结构条件 | 任务结构 | Agent 能力 | 主要方法 | 主要贡献 | 与当前问题的差距 |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| GPTSwarm | LLM Agent | 协作结构能否优化 | 图结构 | 节点与信息流 | 较弱 | 较弱 | 较弱 | 自动结构优化 | 搜索协作架构 | 未解释任务与结构的对应关系 |',
      '',
      '| 状态 | 说明 |',
      '| --- | --- |',
      '| 已验证 | 短表格保持正常宽度 |',
      '',
      '补充说明。'.repeat(70),
    ].join('\n');
    await create(quote220);
    await create(quote221);
    await create(markdownQuote);

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: fixture.base });
    await page.goto(`${fixture.base}/?locale=zh-CN`, { waitUntil: 'networkidle' });
    const markdownCard = page.locator('.card').filter({ hasText: 'Memory 的核心问题' });
    assert.equal(await markdownCard.locator('.quote h2').textContent(), 'Memory 的核心问题');
    assert.equal(await markdownCard.locator('.quote strong').textContent(), '治理 Memory');
    assert.equal(await markdownCard.locator('.quote code').textContent(), 'Markdown');
    assert.deepEqual(await markdownCard.locator('.quote li').allTextContents(), ['谁决定写入', '谁判断重要性']);
    assert.equal(await markdownCard.locator('.quote a').filter({ hasText: '安全链接' }).getAttribute('href'), 'https://example.com/docs');
    assert.equal(await markdownCard.locator('.quote a').filter({ hasText: '安全链接' }).getAttribute('target'), '_blank');
    assert.equal(await markdownCard.locator('.quote a').filter({ hasText: '危险链接' }).getAttribute('href'), null);
    assert.equal(await markdownCard.locator('.quote img, .quote script').count(), 0);
    assert.equal(await page.evaluate(() => window.collectXss), undefined);
    const tableScrollContainers = markdownCard.locator('.quote-table-scroll');
    assert.equal(await tableScrollContainers.count(), 2);
    assert.equal(await tableScrollContainers.first().getAttribute('role'), 'region');
    assert.equal(await tableScrollContainers.first().getAttribute('aria-label'), 'Markdown 表格，可横向滚动');
    const tableLayout = await markdownCard.evaluate((card) => {
      const containers = card.querySelectorAll('.quote-table-scroll');
      const wide = containers[0];
      const narrow = containers[1];
      return {
        wideScrollWidth: wide.scrollWidth,
        wideClientWidth: wide.clientWidth,
        narrowScrollWidth: narrow.scrollWidth,
        narrowClientWidth: narrow.clientWidth,
        cardRight: card.getBoundingClientRect().right,
        viewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(tableLayout.wideScrollWidth > tableLayout.wideClientWidth, `wide table should scroll inside its own container: ${JSON.stringify(tableLayout)}`);
    assert.ok(Math.abs(tableLayout.narrowScrollWidth - tableLayout.narrowClientWidth) <= 1, 'narrow table should fill the container without horizontal scrolling');
    assert.ok(tableLayout.cardRight <= tableLayout.viewportWidth, 'wide table should not expand the card beyond the viewport');
    assert.equal(tableLayout.documentScrollWidth, tableLayout.viewportWidth);

    await page.setViewportSize({ width: 390, height: 844 });
    const mobileTableLayout = await markdownCard.evaluate((card) => {
      const wide = card.querySelector('.quote-table-scroll');
      return {
        scrollWidth: wide.scrollWidth,
        clientWidth: wide.clientWidth,
        cardRight: card.getBoundingClientRect().right,
        viewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
      };
    });
    assert.ok(mobileTableLayout.scrollWidth > mobileTableLayout.clientWidth, 'wide table should remain locally scrollable on mobile');
    assert.ok(mobileTableLayout.cardRight <= mobileTableLayout.viewportWidth, 'wide table should not expand the mobile card');
    assert.equal(mobileTableLayout.documentScrollWidth, mobileTableLayout.viewportWidth);
    await page.setViewportSize({ width: 1280, height: 900 });

    const markdownCopy = markdownCard.locator('.quote-copy');
    await markdownCopy.click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), markdownQuote);
    assert.equal(await markdownCopy.getAttribute('aria-label'), '已复制');
    assert.equal(await markdownCopy.getAttribute('data-feedback'), '已复制');
    assert.equal(await markdownCard.locator('.quote-container').evaluate((node) => node.classList.contains('collapsed')), true);

    const exactCard = page.locator('.card').filter({ hasText: prefix220 });
    assert.equal(await exactCard.locator('.quote-toggle').isVisible(), false);
    assert.equal(await exactCard.locator('.quote-container').evaluate((node) => node.classList.contains('collapsed')), false);

    const longCard = page.locator('.card').filter({ hasText: prefix221 });
    const toggle = longCard.locator('.quote-toggle');
    const container = longCard.locator('.quote-container');
    assert.equal(await toggle.isVisible(), true);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await toggle.getAttribute('aria-label'), '展开引用');
    assert.equal(await container.evaluate((node) => node.classList.contains('collapsed')), true);
    const placement = await longCard.evaluate((card) => {
      const quoteContainer = card.querySelector('.quote-container').getBoundingClientRect();
      const quoteCopy = card.querySelector('.quote-copy').getBoundingClientRect();
      const quoteToggle = card.querySelector('.quote-toggle').getBoundingClientRect();
      return {
        rightGap: Math.abs(quoteContainer.right - quoteToggle.right),
        topGap: quoteToggle.top - quoteContainer.top,
        toolGap: quoteToggle.left - quoteCopy.right,
        sameTop: Math.abs(quoteToggle.top - quoteCopy.top),
      };
    });
    assert.ok(placement.rightGap <= 1, `toggle should align with quote right edge, gap was ${placement.rightGap}px`);
    assert.ok(placement.topGap >= -4 && placement.topGap <= 4, `toggle should stay at quote top, gap was ${placement.topGap}px`);
    assert.equal(placement.toolGap, 6);
    assert.ok(placement.sameTop <= 1, `copy and toggle buttons should share a top edge, offset was ${placement.sameTop}px`);

    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await toggle.getAttribute('aria-label'), '收起引用');
    assert.equal(await container.evaluate((node) => node.classList.contains('collapsed')), false);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(await container.evaluate((node) => node.classList.contains('collapsed')), true);

    await markdownCard.locator('.quote-toggle').click();
    assert.equal(await markdownCard.locator('.quote-toggle').getAttribute('aria-expanded'), 'true');
    await page.locator('#refresh').click();
    await page.waitForFunction(() => document.querySelector('.card .quote h2')?.textContent === 'Memory 的核心问题' && document.querySelector('.card .quote-toggle')?.getAttribute('aria-expanded') === 'false');
    const refreshedMarkdownCard = page.locator('.card').filter({ hasText: 'Memory 的核心问题' });
    assert.equal(await refreshedMarkdownCard.locator('.quote-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(await refreshedMarkdownCard.locator('.quote-container').evaluate((node) => node.classList.contains('collapsed')), true);
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test('Collect Viewer 展示、编辑、归档并恢复收藏', async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const createdResponse = await fetch(`${fixture.base}/api/collections`, {
      method: 'POST',
      headers: { Origin: fixture.base, 'Content-Type': 'application/json' },
      body: JSON.stringify(collectionPayload),
    });
    assert.equal(createdResponse.status, 201);

    const page = await browser.newPage();
    await page.goto(`${fixture.base}/?locale=zh-CN`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#active-count').textContent(), '1');
    assert.equal((await page.locator('.card .quote').textContent()).trim(), collectionPayload.quote);
    assert.equal(await page.locator('.card .note').textContent(), collectionPayload.note);
    assert.match(await page.locator('.card .source').getAttribute('href'), /^http:\/\/localhost:3462\/\?collection=/);

    await page.locator('.card .edit').click();
    await page.locator('.card textarea').fill('更新后的收藏批注');
    await page.locator('.card .save').click();
    await page.waitForFunction(() => document.querySelector('.card .note')?.textContent === '更新后的收藏批注');

    await page.locator('.card .archive').click();
    await page.waitForFunction(() => document.querySelector('#active-count')?.textContent === '0');
    await page.locator('[data-view="archived"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
    assert.equal(await page.locator('.card .archive').textContent(), '恢复');

    await page.locator('.card .archive').click();
    await page.waitForFunction(() => document.querySelector('#archived-count')?.textContent === '0');
  } finally {
    await browser.close();
    await fixture.close();
  }
});

test('Collect Viewer switches between English and Simplified Chinese and persists the choice', async () => {
  const fixture = await startFixture();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${fixture.base}/?locale=en`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('#create').textContent(), 'New collection');
    await page.locator('#locale-select').selectOption('zh-CN');
    assert.equal(await page.locator('#create').textContent(), '新建收藏');
    assert.match((await page.context().cookies()).find(({ name }) => name === 'codex_suite_locale')?.value || '', /zh-CN/);
  } finally {
    await browser.close();
    await fixture.close();
  }
});
