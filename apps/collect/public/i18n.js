(() => {
  const resources = {
    en: {
      active: 'Collections', archived: 'Archived', activeEyebrow: 'Current collections', archivedEyebrow: 'Archived content',
      refresh: 'Refresh', create: 'New collection', createTitle: 'New collection', quote: 'Quote', required: 'Required', note: 'Note', origin: 'Source',
      quoteLabel: 'Collection quote', noteOptional: 'Collection note (optional)', originOptional: 'Source (optional)', originPlaceholder: 'For example: Chapter 3 of a book',
      cancel: 'Cancel', saveCollection: 'Save collection', copyMarkdown: 'Copy quote Markdown source', expand: 'Expand quote', collapse: 'Collapse quote',
      noteLabel: 'Collection note', role: 'Role', project: 'Project', session: 'Session / Source', created: 'Collected at', viewSource: 'View source',
      editNote: 'Edit collection note', save: 'Save', delete: 'Delete', restore: 'Restore', archive: 'Archive', noNote: 'No note', noProject: 'No linked project',
      manual: 'Manual', manualCreated: 'Created manually', emptyActive: 'No collections yet', emptyArchived: 'No archived collections', loading: 'Loading…',
      loadFailed: 'Failed to load: {message}', saveFailed: 'Failed to save: {message}', requestFailed: 'Request failed', copied: 'Copied', copyFailed: 'Copy failed',
      markdownTable: 'Markdown table, horizontally scrollable', deleteConfirm: 'Permanently delete this archived collection? This cannot be undone.', language: 'Language',
      'error.invalid_request': 'The request is invalid.', 'error.payload_too_large': 'The request is too large.', 'error.storage_corrupt': 'Collection storage is invalid.',
      'error.storage_busy': 'Collection storage is busy. Try again shortly.', 'error.duplicate_collection': 'This content is already collected.',
      'error.collection_not_found': 'Collection not found.', 'error.not_archived': 'Archive the collection before deleting it.',
      'error.internal_error': 'Internal server error.', 'error.invalid_content_type': 'Write requests must use application/json.',
      'error.invalid_json': 'The request body must be valid JSON.', 'error.invalid_collection_id': 'The collection ID is invalid.',
      'error.invalid_origin': 'The request origin is not allowed.', 'error.invalid_query': 'The query is invalid.', 'error.not_found': 'Resource not found.',
    },
    'zh-CN': {
      active: '收藏', archived: '已归档', activeEyebrow: '当前收藏', archivedEyebrow: '归档内容',
      refresh: '刷新', create: '新建收藏', createTitle: '新建收藏', quote: '引用', required: '必填', note: '批注', origin: '来源',
      quoteLabel: '收藏引用', noteOptional: '收藏批注（可选）', originOptional: '来源（可选）', originPlaceholder: '例如：《某书》第 3 章',
      cancel: '取消', saveCollection: '保存收藏', copyMarkdown: '复制引用 Markdown 源码', expand: '展开引用', collapse: '收起引用',
      noteLabel: '收藏批注', role: '角色', project: '项目', session: '会话 / 来源', created: '收藏时间', viewSource: '查看来源',
      editNote: '编辑收藏批注', save: '保存', delete: '删除', restore: '恢复', archive: '归档', noNote: '暂无批注', noProject: '未关联项目',
      manual: '手动', manualCreated: '手动创建', emptyActive: '暂无收藏内容', emptyArchived: '暂无已归档收藏', loading: '正在加载…',
      loadFailed: '加载失败：{message}', saveFailed: '保存失败：{message}', requestFailed: '请求失败', copied: '已复制', copyFailed: '复制失败',
      markdownTable: 'Markdown 表格，可横向滚动', deleteConfirm: '永久删除这条已归档的收藏？删除后无法恢复。', language: '语言',
      'error.invalid_request': '请求无效。', 'error.payload_too_large': '请求内容过大。', 'error.storage_corrupt': '收藏存储数据无效。',
      'error.storage_busy': '收藏存储正忙，请稍后重试。', 'error.duplicate_collection': '该内容已经收藏。',
      'error.collection_not_found': '收藏不存在。', 'error.not_archived': '请先归档收藏再删除。',
      'error.internal_error': '服务器内部错误。', 'error.invalid_content_type': '写入请求必须使用 application/json。',
      'error.invalid_json': '请求体必须是有效 JSON。', 'error.invalid_collection_id': '收藏 ID 无效。',
      'error.invalid_origin': '不允许的请求来源。', 'error.invalid_query': '查询参数无效。', 'error.not_found': '未找到请求资源。',
    },
  };
  function normalize(value) {
    const locale = String(value || '').toLowerCase();
    return /^zh(?:$|(?:[-_](?:hans|cn))(?:[._-]|$))/.test(locale) ? 'zh-CN' : 'en';
  }
  function cookieLocale() {
    const match = document.cookie.match(/(?:^|;\s*)codex_suite_locale=([^;]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch { return ''; }
  }
  const queryLocale = new URLSearchParams(location.search).get('locale');
  const configuredLocale = globalThis.__CODEX_SUITE_CONFIG__?.locale;
  const automaticLocale = !configuredLocale || configuredLocale === 'auto' ? navigator.language : configuredLocale;
  let locale = normalize(queryLocale || cookieLocale() || automaticLocale);
  function t(key, values = {}) {
    const template = resources[locale][key] ?? resources.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
  }
  function apply() {
    document.documentElement.lang = locale;
    for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
    for (const element of document.querySelectorAll('[data-i18n-label]')) element.setAttribute('aria-label', t(element.dataset.i18nLabel));
    for (const element of document.querySelectorAll('[data-i18n-title]')) element.title = t(element.dataset.i18nTitle);
    for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder);
    const selector = document.querySelector('#locale-select');
    if (selector) selector.value = locale;
  }
  function setLocale(value) {
    locale = normalize(value);
    document.cookie = `codex_suite_locale=${encodeURIComponent(locale)}; Path=/; SameSite=Lax; Max-Age=31536000`;
    apply();
    window.dispatchEvent(new CustomEvent('suite-locale-change', { detail: { locale } }));
  }
  globalThis.collectI18n = { t, apply, setLocale, get locale() { return locale; } };
})();
