const resources = {
  en: {
    language: 'Language', directory: 'Directory', branch: 'Branch', refresh: 'Refresh',
    chooseDirectory: 'Choose a Git directory', loadingRepository: 'Reading repository…',
    loadingHistory: 'Loading commit history…', commitHistory: 'Commit history',
    selectCommit: 'Select a commit to view details', unknownTime: 'Unknown time', unknown: 'unknown',
    justNow: 'just now', noSubject: '(no subject)', unknownAuthor: 'Unknown author',
    requestFailed: 'Request failed ({status})', loadingDetail: 'Reading commit details…',
    author: 'Author', committer: 'Committer', parents: 'Parents', noParents: 'none',
    viewInDifit: 'View in difit', noCommitMessage: '(no commit message)', filesChanged: '{count} files',
    binaryFiles: '{count} binary', binaryFile: 'binary', noFileChanges: 'No file changes',
    startingDifit: 'Starting difit…', retryDifit: 'Retry difit', closeDifit: 'Back to commit details',
    difitReview: 'difit commit review', detachedAt: 'detached at {sha}', years: 'years', months: 'months',
    days: 'days', hours: 'hours', minutes: 'minutes', ago: 'ago',
  },
  'zh-CN': {
    language: '语言', directory: '目录', branch: '分支', refresh: '刷新',
    chooseDirectory: '选择 Git 目录', loadingRepository: '正在读取仓库…',
    loadingHistory: '正在加载提交历史…', commitHistory: '提交历史',
    selectCommit: '选择一个提交以查看详情', unknownTime: '未知时间', unknown: '未知',
    justNow: '刚刚', noSubject: '(无标题)', unknownAuthor: '未知作者',
    requestFailed: '请求失败（{status}）', loadingDetail: '正在读取提交详情…',
    author: '作者', committer: '提交者', parents: '父提交', noParents: '无',
    viewInDifit: '在 difit 中查看', noCommitMessage: '(无提交消息)', filesChanged: '{count} 个文件',
    binaryFiles: '{count} 个二进制文件', binaryFile: 'binary', noFileChanges: '无文件变更',
    startingDifit: '正在启动 difit…', retryDifit: '重试启动 difit', closeDifit: '返回提交详情',
    difitReview: 'difit 提交审查', detachedAt: 'detached @ {sha}', years: '年', months: '个月',
    days: '天', hours: '小时', minutes: '分钟', ago: '前',
  },
};

function normalize(value) {
  const locale = String(value || '').toLowerCase();
  return ['zh', 'zh-cn', 'zh-hans'].includes(locale) ? 'zh-CN' : 'en';
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
  const selector = document.querySelector('#locale-select');
  if (selector) selector.value = locale;
}

function setLocale(value) {
  locale = normalize(value);
  document.cookie = `codex_suite_locale=${encodeURIComponent(locale)}; Path=/; SameSite=Lax; Max-Age=31536000`;
  apply();
  renderGraph();
  if (selectedSha) selectCommit(selectedSha, { retranslateOnly: true });
  window.dispatchEvent(new CustomEvent('suite-locale-change', { detail: { locale } }));
}

globalThis.difgraphI18n = { t, apply, setLocale, get locale() { return locale; } };
