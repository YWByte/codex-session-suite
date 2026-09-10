const LOCALE_COOKIE = 'codex_suite_locale';
const localeMessages = Object.freeze({
  en: Object.freeze({
    appName: 'Plan Viewer',
    selectDocument: 'Select a plan to view',
    noDocuments: 'No plans',
    navigationTitle: 'Plans',
    collapseAll: 'Collapse all',
    loading: 'Loading...',
    loadFailed: 'Failed to load',
    none: 'None',
    noDocumentsInDate: 'No plans',
    rename: 'Rename',
    copyPath: 'Copy path',
    moveToTrash: 'Move to Trash',
    documentActions: 'Document actions',
    edit: 'Edit',
    editMarkdownBody: 'Edit Markdown body',
    cancel: 'Cancel',
    save: 'Save',
    markdownBody: 'Markdown body',
    discardChanges: 'Discard unsaved changes?',
    externallyChanged: 'The file changed externally and was not overwritten. Cancel editing, reload it, and try again.',
    saveFailed: 'Save failed',
    saveFailedWith: 'Save failed: ',
    renameFirst: 'Save or cancel editing before renaming',
    renameFailed: 'Rename failed',
    renameFailedWith: 'Rename failed: ',
    copied: 'Copied',
    copyFailedWith: 'Copy failed: ',
    deleteFirst: 'Save or cancel editing before deleting',
    confirmTrash: 'Move to Trash?\n',
    deleteFailed: 'Delete failed',
    deleteFailedWith: 'Delete failed: ',
    unavailableWhileEditing: 'Unavailable while editing',
    annotateSelection: 'Annotate selection',
    writeNote: 'Write a note…',
    approve: 'Approve',
    noteNumber: 'Note #',
    delete: 'Delete',
    notesCount: 'Notes ({count})',
    copyAllNotes: 'Copy all notes',
    clearAllNotes: 'Clear all notes',
    clearAllNotesConfirm: 'Clear all notes in this document?',
    openInVscode: 'Open in Visual Studio Code',
    language: 'Language',
    trashUnavailable: 'Moving to Trash is unavailable on this platform',
  }),
  'zh-CN': Object.freeze({
    appName: '方案查看器',
    selectDocument: '选择一个方案查看',
    noDocuments: '暂无方案',
    navigationTitle: '方案目录',
    collapseAll: '折叠全部目录',
    loading: 'Loading...',
    loadFailed: '加载失败',
    none: '无',
    noDocumentsInDate: '无方案',
    rename: '重命名',
    copyPath: '复制路径',
    moveToTrash: '移到废纸篓',
    documentActions: '文档操作',
    edit: '编辑',
    editMarkdownBody: '编辑 Markdown 正文',
    cancel: '取消',
    save: '保存',
    markdownBody: 'Markdown 正文',
    discardChanges: '有未保存的修改，确认放弃吗？',
    externallyChanged: '文件已在外部修改，本次内容未覆盖。请取消编辑并重新加载后再修改。',
    saveFailed: '保存失败',
    saveFailedWith: '保存失败：',
    renameFirst: '请先保存或取消编辑，再重命名文档',
    renameFailed: '重命名失败',
    renameFailedWith: '重命名失败：',
    copied: '已复制',
    copyFailedWith: '复制失败：',
    deleteFirst: '请先保存或取消编辑，再删除文档',
    confirmTrash: '确认移到废纸篓？\n',
    deleteFailed: '删除失败',
    deleteFailedWith: '删除失败：',
    unavailableWhileEditing: '编辑时不可操作',
    annotateSelection: '批注选中文字',
    writeNote: '写批注…',
    approve: '同意',
    noteNumber: '批注 #',
    delete: '删除',
    notesCount: '批注（{count}）',
    copyAllNotes: '复制全部批注',
    clearAllNotes: '清空全部批注',
    clearAllNotesConfirm: '清空当前文档的全部批注？',
    openInVscode: '在 Visual Studio Code 中打开',
    language: '语言',
    trashUnavailable: '当前平台不支持移到废纸篓',
  }),
});
function normalizeLocale(value) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (/^zh(?:$|(?:[-_](?:hans|cn))(?:[._-]|$))/.test(normalized)) return 'zh-CN';
  return normalized === 'en' || normalized.startsWith('en-') ? 'en' : null;
}
function cookieLocale() {
  const match = document.cookie.match(/(?:^|;\s*)codex_suite_locale=([^;]+)/);
  if (!match) return null;
  try { return normalizeLocale(decodeURIComponent(match[1])); } catch { return null; }
}
function environmentLocale() {
  return normalizeLocale(globalThis.CODEX_SUITE_LOCALE);
}
function browserLocale() {
  return normalizeLocale(navigator.language || navigator.languages?.[0]);
}
let currentLocale = normalizeLocale(new URLSearchParams(location.search).get('locale'))
  || cookieLocale()
  || environmentLocale()
  || browserLocale()
  || 'en';
function t(key, values = {}) {
  const template = localeMessages[currentLocale]?.[key] ?? localeMessages.en[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}
function applyTranslations() {
  document.documentElement.lang = currentLocale;
  document.title = t('appName');
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelector('#language-select').value = currentLocale;
}
function persistLocale(locale) {
  const nextLocale = normalizeLocale(locale) || 'en';
  currentLocale = nextLocale;
  document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(currentLocale)}; path=/; max-age=31536000; samesite=lax`;
  applyTranslations();
  loadProjects({ restore: true });
}
async function loadTrashCapability() {
  try {
    const response = await fetch('/health');
    const data = await response.json();
    if (!data.trashSupported) document.body.classList.add('trash-unavailable');
  } catch {
    // Keep delete buttons enabled when capability cannot be determined.
  }
}
// ── Markdown / LaTeX rendering ──
const PH = '\x00LTX';
let store = [];
function protectLatex(text) {
  store = [];
  let i = 0;
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => { store.push({d:true,t:t.trim()}); return PH+i+++'\x00'; });
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => { store.push({d:true,t:t.trim()}); return PH+i+++'\x00'; });
  text = text.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (_, t) => { store.push({d:false,t:t.trim()}); return PH+i+++'\x00'; });
  text = text.replace(/\\\((.+?)\\\)/g, (_, t) => { store.push({d:false,t:t.trim()}); return PH+i+++'\x00'; });
  return text;
}
function restoreLatex(html) {
  return html.replace(new RegExp(PH+'(\\d+)\x00','g'), (_, idx) => {
    const e = store[parseInt(idx)];
    if (!e) return '';
    try { return katex.renderToString(e.t, {displayMode:e.d, throwOnError:false, trust:true}); }
    catch { return '<code>'+e.t+'</code>'; }
  });
}
marked.setOptions({ breaks: false, gfm: true });
function renderMarkdown(text) {
  const p = protectLatex(text);
  return restoreLatex(marked.parse(p));
}

function rewriteRelativeImageUrls(root, projectId, date) {
  root.querySelectorAll('img[src]').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src) return;
    // External image hosts often block Referer headers.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) {
      img.referrerPolicy = 'no-referrer';
      return;
    }
    if (src.startsWith('/') || src.startsWith('#')) return;
    // Decode once before re-encoding to avoid double-encoding non-ASCII image paths.
    let decoded = src;
    try { decoded = decodeURIComponent(src); } catch (e) { /* Keep non-encoded values unchanged. */ }
    const assetPath = decoded.split('/').map(encodeURIComponent).join('/');
    img.src = `/api/assets/${encodeURIComponent(projectId)}/${encodeURIComponent(date)}/${assetPath}`;
  });
}

function parseCodeLocation(text) {
  const match = text.trim().match(/^(\/(?:[^\n/:]+\/)*[^\n/:]+\.[A-Za-z0-9]+):(\d+)(?::(\d+))?(?:-\d+)?$/);
  return match && { path: match[1], line: match[2], column: match[3] };
}

function vscodeFileUrl(location) {
  const path = encodeURI(location.path).replace(/#/g, '%23').replace(/\?/g, '%3F');
  return `vscode://file${path}:${location.line}${location.column ? `:${location.column}` : ''}`;
}

function enhanceVscodeLinks(root) {
  root.querySelectorAll('code').forEach((code) => {
    if (code.closest('pre, a')) return;
    const location = parseCodeLocation(code.textContent);
    if (!location) return;
    const link = document.createElement('a');
    link.href = vscodeFileUrl(location);
    link.title = t('openInVscode');
    code.replaceWith(link);
    link.appendChild(code);
  });
  root.querySelectorAll('a[href^="vscode://file/"]').forEach((link) => {
    link.title ||= t('openInVscode');
  });
}
// marked v15 removed the highlight option; highlight code blocks after rendering.
function highlightCodeIn(root) {
  root.querySelectorAll('pre code').forEach(el => {
    if (el.classList.contains('language-mermaid')) return; // Mermaid blocks are rendered separately.
    try { hljs.highlightElement(el); } catch {}
  });
  renderMermaidIn(root);
}

// Render Mermaid blocks to SVG and keep the source on failure.
if (window.mermaid) {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'default' });
}
async function renderMermaidIn(root) {
  if (!window.mermaid) return;
  const blocks = root.querySelectorAll('pre code.language-mermaid');
  for (const el of blocks) {
    if (el.dataset.mermaidDone) continue;
    el.dataset.mermaidDone = '1';
    const src = el.textContent;
    const pre = el.closest('pre');
    if (!pre) continue;
    const holder = document.createElement('div');
    holder.className = 'mermaid-container';
    try {
      const { svg } = await mermaid.render('mmd-' + Math.random().toString(36).slice(2), src);
      holder.innerHTML = svg;
    } catch (e) {
      holder.innerHTML = '';
      holder.appendChild(pre.cloneNode(true));
      holder.classList.add('mermaid-error');
    }
    pre.replaceWith(holder);
  }
}
function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

// ── State ──
let currentProjectId = null;
let currentDate = null;
let currentPlanId = null;
let currentPath = null;
let isRenaming = false;
let isRestoring = false;
let editorState = null;
let documentLoadGeneration = 0;
const expandedProjects = new Set();
const expandedDates = new Set();
const VIEW_STATE_KEY = 'planViewerState';

// Resizable sidebar and screen-centering synchronization.
const SIDEBAR_MIN = 180, SIDEBAR_MAX = 600;
const sidebarEl = document.getElementById('sidebar');
const resizerEl = document.getElementById('resizer');
// Sync the sidebar width to CSS and decide whether screen centering is possible.
function updateCenter() {
  const sw = sidebarEl.offsetWidth;
  document.documentElement.style.setProperty('--sidebar-w', sw + 'px');
  // Center against the viewport only when the remaining space can contain the content column.
  const enable = window.innerWidth >= 1350 && (window.innerWidth - sw) >= 1350;
  document.body.classList.toggle('screen-center', enable);
}
(function initSidebarWidth() {
  const saved = parseInt(localStorage.getItem('planSidebarWidth') || '', 10);
  if (saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) sidebarEl.style.width = saved + 'px';
  updateCenter();
})();
window.addEventListener('resize', updateCenter);
resizerEl.addEventListener('mousedown', (e) => {
  e.preventDefault();
  resizerEl.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  const onMove = (ev) => {
    const w = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, ev.clientX));
    sidebarEl.style.width = w + 'px';
    updateCenter();
  };
  const onUp = () => {
    resizerEl.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    localStorage.setItem('planSidebarWidth', sidebarEl.offsetWidth);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

function dateKey(projectId, date) {
  return `${projectId}::${date}`;
}

function collapseAll() {
  document.querySelectorAll('.project-item, .date-item').forEach(el => el.classList.add('collapsed'));
  expandedProjects.clear();
  expandedDates.clear();
  saveViewState();
}

function saveViewState() {
  localStorage.setItem(VIEW_STATE_KEY, JSON.stringify({
    projectId: currentProjectId,
    date: currentDate,
    planId: currentPlanId,
    scrollTop: document.getElementById('content').scrollTop,
    expandedProjects: [...expandedProjects],
    expandedDates: [...expandedDates],
  }));
}

function loadViewState() {
  try { return JSON.parse(localStorage.getItem(VIEW_STATE_KEY) || 'null'); }
  catch { return null; }
}

const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>';
const RENAME_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';

// ── Load projects ──
async function loadProjects({ restore = false } = {}) {
  const res = await fetch('/api/projects');
  const projects = await res.json();
  renderSidebar(projects);
  if (restore) await restoreViewState();
}

function renderSidebar(projects) {
  const body = document.getElementById('sidebar-body');
  if (projects.length === 0) {
    body.innerHTML = '<div style="padding:2rem 1rem;text-align:center;color:var(--fg-secondary);font-size:.85rem;">' + t('noDocuments') + '</div>';
    return;
  }
  let html = '<div class="nav-header"><span>' + t('navigationTitle') + '</span><button class="collapse-all-btn" title="' + t('collapseAll') + '" onclick="collapseAll()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15l5-5 5 5"/><path d="M7 9l5-5 5 5"/></svg></button></div>';
  for (const p of projects) {
    html += `<div class="project-item collapsed" data-id="${escapeHtml(p.id)}">`;
    html += `<div class="project-header" onclick="toggleProject('${escapeHtml(p.id)}', this)">`;
    html += `<span class="chevron">▼</span>`;
    html += `<span class="name">${escapeHtml(p.name)}</span>`;
    html += `<span class="badge">${p.planCount}</span>`;
    html += `</div>`;
    html += `<ul class="date-list" id="dates-${escapeHtml(p.id)}"></ul>`;
    html += `</div>`;
  }
  body.innerHTML = html;
}

async function toggleProject(projectId, headerEl) {
  const item = headerEl.parentElement;
  const wasCollapsed = item.classList.contains('collapsed');
  item.classList.toggle('collapsed');
  if (wasCollapsed) expandedProjects.add(projectId);
  else expandedProjects.delete(projectId);
  if (!isRestoring) saveViewState();

  if (wasCollapsed) {
    // Load dates on the first expansion.
    const list = document.getElementById('dates-' + projectId);
    if (!list.dataset.loaded) {
      list.innerHTML = '<li style="padding:.4rem 1.4rem;font-size:.75rem;color:var(--cloud-medium)">' + t('loading') + '</li>';
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/dates`);
        const dates = await res.json();
        let html = '';
        for (const d of dates) {
          html += `<li class="date-item collapsed" data-date="${d.date}">`;
          html += `<div class="date-header" onclick="toggleDate('${escapeHtml(projectId)}','${d.date}', this)">`;
          html += `<span class="chevron">▼</span>`;
          html += `<span class="name">${d.date}</span>`;
          html += `<span class="badge">${d.planCount}</span>`;
          html += `</div>`;
          html += `<ul class="plan-list" id="plans-${escapeHtml(projectId)}-${d.date}"></ul>`;
          html += `</li>`;
        }
        list.innerHTML = html || '<li style="padding:.4rem 1.4rem;font-size:.75rem;color:var(--cloud-medium)">' + t('none') + '</li>';
        list.dataset.loaded = '1';
      } catch (e) {
        list.innerHTML = '<li style="padding:.4rem 1.4rem;font-size:.75rem;color:#c0392b">' + t('loadFailed') + '</li>';
      }
    }
  }
}

async function toggleDate(projectId, date, headerEl) {
  const item = headerEl.parentElement;
  const wasCollapsed = item.classList.contains('collapsed');
  item.classList.toggle('collapsed');
  const key = dateKey(projectId, date);
  if (wasCollapsed) expandedDates.add(key);
  else expandedDates.delete(key);
  if (!isRestoring) saveViewState();

  if (wasCollapsed) {
    const list = document.getElementById(`plans-${projectId}-${date}`);
    if (!list.dataset.loaded) {
      list.innerHTML = '<li style="padding:.4rem 2.2rem;font-size:.75rem;color:var(--cloud-medium)">' + t('loading') + '</li>';
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/dates/${date}/plans`);
        const plans = await res.json();
        let html = '';
        for (const p of plans) {
          const pid = escapeHtml(p.id);
          const pathAttr = escapeHtml(p.path || '');
          html += `<li class="plan-item" data-id="${pid}" data-path="${pathAttr}" onclick="selectPlan('${escapeHtml(projectId)}','${date}','${pid}', this)">`;
          html += `<span class="plan-title">${escapeHtml(p.name)}</span>`;
          html += `<button class="rename-btn" title="${t('rename')}" onclick="renamePlan(event,'${escapeHtml(projectId)}','${date}','${pid}', this)">`;
          html += RENAME_SVG;
          html += `</button>`;
          html += `<button class="copy-btn" title="${t('copyPath')}" onclick="copyPath(event, this)">`;
          html += COPY_SVG;
          html += `</button>`;
          html += `<button class="trash-btn" title="${t('moveToTrash')}" onclick="deletePlan(event,'${escapeHtml(projectId)}','${date}','${pid}')">`;
          html += TRASH_SVG;
          html += `</button>`;
          html += `</li>`;
        }
        list.innerHTML = html || '<li style="padding:.4rem 2.2rem;font-size:.75rem;color:var(--cloud-medium)">' + t('noDocumentsInDate') + '</li>';
        list.dataset.loaded = '1';
      } catch (e) {
        list.innerHTML = '<li style="padding:.4rem 2.2rem;font-size:.75rem;color:#c0392b">' + t('loadFailed') + '</li>';
      }
    }
  }
}

function isEditing() {
  return !!editorState;
}

function hasUnsavedChanges() {
  return !!editorState && editorState.textarea.value !== editorState.originalContent;
}

function updateEditorLineNumbers() {
  if (!editorState) return;
  const count = editorState.textarea.value.split('\n').length;
  editorState.lineNumbers.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
}

function setCurrentDocumentControlsDisabled(disabled) {
  document.querySelectorAll('.plan-item.active .rename-btn, .plan-item.active .trash-btn').forEach((button) => {
    button.disabled = disabled;
    button.title = disabled ? t('unavailableWhileEditing') : button.classList.contains('rename-btn') ? t('rename') : t('moveToTrash');
  });
}

function renderMarkdownDocument(data) {
  const content = document.getElementById('content');
  const html = renderMarkdown(data.content || '');
  content.innerHTML = `<div class="plan-shell"><div class="document-actions"><button type="button" data-i18n="edit">Edit</button></div><div class="plan-body">${html}</div></div>`;
  const bodyEl = content.querySelector('.plan-body');
  const actions = content.querySelector('.document-actions');
  if (!bodyEl || !actions) return;
  const firstH1 = bodyEl.querySelector('h1');
  if (firstH1) {
    firstH1.classList.add('with-edit');
  } else {
    actions.classList.add('no-heading');
    actions.innerHTML = '<span class="label">Document actions</span><button type="button" data-i18n="edit">Edit</button>';
  }
  actions.querySelector('button').addEventListener('click', () => openEditor(data));
  rewriteRelativeImageUrls(bodyEl, currentProjectId, currentDate);
  enhanceVscodeLinks(bodyEl);
  highlightCodeIn(bodyEl);
  resetAnnotationsForCurrentDoc();
}

function renderEditor() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="markdown-editor"><div class="editor-toolbar"><span class="editor-title" data-i18n="editMarkdownBody">Edit Markdown body</span><button type="button" class="cancel-btn" data-i18n="cancel">Cancel</button><button type="button" class="save-btn" data-i18n="save">Save</button></div><div class="editor-pane"><div class="editor-line-numbers" aria-hidden="true"></div><textarea class="editor-textarea" wrap="off" aria-label="' + t('markdownBody') + '" spellcheck="false"></textarea></div></div>`;
  const textarea = content.querySelector('.editor-textarea');
  const lineNumbers = content.querySelector('.editor-line-numbers');
  editorState.textarea = textarea;
  editorState.lineNumbers = lineNumbers;
  textarea.value = editorState.originalContent;
  updateEditorLineNumbers();
  textarea.addEventListener('input', updateEditorLineNumbers);
  textarea.addEventListener('scroll', () => { lineNumbers.scrollTop = textarea.scrollTop; });
  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveEditor();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditor();
    }
  });
  content.querySelector('.cancel-btn').addEventListener('click', cancelEditor);
  content.querySelector('.save-btn').addEventListener('click', saveEditor);
  setCurrentDocumentControlsDisabled(true);
  textarea.focus();
}

function openEditor(data) {
  if (!data.editable || isEditing()) return;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
    refreshPending = true;
  }
  editorState = {
    projectId: currentProjectId,
    date: currentDate,
    planId: currentPlanId,
    path: currentPath,
    originalContent: data.content || '',
    revision: data.revision,
    data,
    textarea: null,
    lineNumbers: null,
    saving: false,
  };
  removeAnnBubble();
  closeAnnPopup();
  renderEditor();
}

function discardEditor() {
  if (!editorState) return;
  const data = editorState.data;
  editorState = null;
  setCurrentDocumentControlsDisabled(false);
  renderMarkdownDocument(data);
  saveViewState();
  resumePendingRefresh();
}

function confirmDiscardEdits() {
  return !hasUnsavedChanges() || confirm(t('discardChanges'));
}

function resumePendingRefresh() {
  if (!refreshPending) return;
  refreshPending = false;
  scheduleRefresh();
}

function cancelEditor() {
  if (!confirmDiscardEdits()) return;
  discardEditor();
}

async function saveEditor() {
  if (!editorState || editorState.saving) return;
  if (!hasUnsavedChanges()) {
    discardEditor();
    return;
  }
  const state = editorState;
  const submittedContent = state.textarea.value;
  state.saving = true;
  const saveButton = document.querySelector('.editor-toolbar .save-btn');
  const cancelButton = document.querySelector('.editor-toolbar .cancel-btn');
  if (saveButton) saveButton.disabled = true;
  if (cancelButton) cancelButton.disabled = true;
  state.textarea.disabled = true;
  try {
    const res = await fetch(`/api/plans/${encodeURIComponent(state.projectId)}/${state.date}/${encodeURIComponent(state.planId)}/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: submittedContent, revision: state.revision }),
    });
    const data = await res.json();
    if (editorState !== state) return;
    if (!res.ok) {
      alert(res.status === 409
        ? t('externallyChanged')
        : data.error || t('saveFailed'));
      return;
    }
    if (state.path) localStorage.removeItem(ANN_KEY_PREFIX + state.path);
    annotations = [];
    const documentData = { ...state.data, content: data.content, revision: data.revision };
    editorState = null;
    setCurrentDocumentControlsDisabled(false);
    renderMarkdownDocument(documentData);
    saveViewState();
    resumePendingRefresh();
  } catch (error) {
    if (editorState === state) alert(t('saveFailedWith') + error.message);
  } finally {
    if (editorState === state) {
      state.saving = false;
      state.textarea.disabled = false;
      if (saveButton) saveButton.disabled = false;
      if (cancelButton) cancelButton.disabled = false;
      state.textarea.focus();
    }
  }
}

async function selectPlan(projectId, date, planId, el, { scrollTop = 0, persist = true } = {}) {
  if (editorState?.saving) return;
  if (isEditing()) {
    if (currentProjectId === projectId && currentDate === date && currentPlanId === planId) return;
    if (!confirmDiscardEdits()) return;
    editorState = null;
    setCurrentDocumentControlsDisabled(false);
    resumePendingRefresh();
  }
  const loadGeneration = ++documentLoadGeneration;
  document.querySelectorAll('.plan-item.active').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  currentProjectId = projectId;
  currentDate = date;
  currentPlanId = planId;
  currentPath = el?.dataset?.path || null;

  const content = document.getElementById('content');
  content.innerHTML = '<div class="empty"><p>Loading...</p></div>';

  try {
    const res = await fetch(`/api/plans/${encodeURIComponent(projectId)}/${date}/${encodeURIComponent(planId)}`);
    if (!res.ok) throw new Error('plan not found');
    const data = await res.json();
    if (loadGeneration !== documentLoadGeneration || currentProjectId !== projectId || currentDate !== date || currentPlanId !== planId) return;
    if (data.extension === '.html') {
      const preview = document.createElement('iframe');
      preview.className = 'html-preview';
      preview.sandbox = '';
      preview.srcdoc = data.content || '';
      content.replaceChildren(preview);
      annotations = [];
    } else {
      renderMarkdownDocument(data);
    }
    content.scrollTop = scrollTop;
    if (persist && !isRestoring) saveViewState();
  } catch (e) {
    if (loadGeneration !== documentLoadGeneration) return;
    content.innerHTML = '<div class="empty"><p>Failed to load</p></div>';
    annotations = [];
  }
}

async function renamePlan(event, projectId, date, planId, btn) {
  event.stopPropagation();
  if (isEditing() && currentProjectId === projectId && currentDate === date && currentPlanId === planId) {
    alert(t('renameFirst'));
    return;
  }
  isRenaming = true;
  const li = btn.closest('.plan-item');
  const titleSpan = li.querySelector('.plan-title');
  const oldName = titleSpan.textContent;

  const input = document.createElement('input');
  input.className = 'rename-input';
  input.value = oldName;
  titleSpan.replaceWith(input);
  li.querySelectorAll('.rename-btn,.copy-btn,.trash-btn').forEach(b => b.style.display = 'none');
  input.focus();
  input.select();

  let done = false;
  let finish = async (commit) => {
    if (done) return;
    done = true;
    const newName = input.value.trim();
    if (!commit || !newName || newName === oldName) {
      // Handle cancel or an unchanged name.
      const span = document.createElement('span');
      span.className = 'plan-title';
      span.textContent = oldName;
      input.replaceWith(span);
      li.querySelectorAll('.rename-btn,.copy-btn,.trash-btn').forEach(b => b.style.display = '');
      li.onclick = () => selectPlan(projectId, date, planId, li);
      return;
    }
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(projectId)}/${date}/${encodeURIComponent(planId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const data = await res.json();
      if (data.ok) {
        // Migrate the annotation storage key from the old path to the new path.
        const oldPath = li.dataset.path;
        if (oldPath) {
          const oldKey = ANN_KEY_PREFIX + oldPath;
          const oldData = localStorage.getItem(oldKey);
          if (oldData) {
            const extension = planId.slice(planId.lastIndexOf('.'));
            const newPath = oldPath.replace(/\/[^/]+$/, '/' + newName + extension);
            localStorage.setItem(ANN_KEY_PREFIX + newPath, oldData);
            localStorage.removeItem(oldKey);
          }
        }
        // After a successful rename, refresh the date group and item metadata.
        await refreshDateGroup(projectId, date);
        // Select the renamed item again.
        const renamedId = data.id || newName + planId.slice(planId.lastIndexOf('.'));
        const newLi = document.querySelector(`#plans-${projectId}-${date} .plan-item[data-id="${CSS.escape(renamedId)}"]`);
        if (newLi) selectPlan(projectId, date, renamedId, newLi);
      } else {
        alert(data.error || t('renameFailed'));
        const span = document.createElement('span');
        span.className = 'plan-title';
        span.textContent = oldName;
        input.replaceWith(span);
        li.querySelectorAll('.rename-btn,.copy-btn,.trash-btn').forEach(b => b.style.display = '');
      }
    } catch (e) {
      alert(t('renameFailedWith') + e.message);
    }
  };

  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  input.onblur = () => finish(true);
  const originalFinish = finish;
  finish = async (commit) => {
    await originalFinish(commit);
    isRenaming = false;
    if (refreshPending) {
      refreshPending = false;
      scheduleRefresh();
    }
  };
}

async function restoreViewState() {
  const state = loadViewState();
  if (!state) return;

  isRestoring = true;
  expandedProjects.clear();
  expandedDates.clear();
  for (const projectId of state.expandedProjects || []) expandedProjects.add(projectId);
  for (const key of state.expandedDates || []) expandedDates.add(key);
  if (state.projectId) expandedProjects.add(state.projectId);
  if (state.projectId && state.date) expandedDates.add(dateKey(state.projectId, state.date));

  for (const projectId of expandedProjects) {
    const header = document.querySelector(`.project-item[data-id="${CSS.escape(projectId)}"] > .project-header`);
    if (header?.parentElement.classList.contains('collapsed')) await toggleProject(projectId, header);
  }

  for (const key of expandedDates) {
    const [projectId, date] = key.split('::');
    const header = document.querySelector(`#dates-${CSS.escape(projectId)} .date-item[data-date="${CSS.escape(date)}"] > .date-header`);
    if (header?.parentElement.classList.contains('collapsed')) await toggleDate(projectId, date, header);
  }

  if (state.projectId && state.date && state.planId) {
    const item = document.querySelector(`#plans-${CSS.escape(state.projectId)}-${CSS.escape(state.date)} .plan-item[data-id="${CSS.escape(state.planId)}"]`);
    if (item) await selectPlan(state.projectId, state.date, state.planId, item, { scrollTop: state.scrollTop || 0, persist: false });
    else {
      currentProjectId = null;
      currentDate = null;
      currentPlanId = null;
      document.getElementById('content').innerHTML = '<div class="empty"><p data-i18n="selectDocument">Select a plan to view</p></div>';
    }
  }

  isRestoring = false;
  saveViewState();
}

let refreshTimer = null;
let refreshPending = false;

function scheduleRefresh() {
  if (isRenaming || isEditing()) {
    refreshPending = true;
    return;
  }
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (isRenaming || isEditing()) {
      refreshPending = true;
      return;
    }
    loadProjects({ restore: true });
  }, 300);
}

async function refreshDateGroup(projectId, date) {
  const list = document.getElementById(`plans-${projectId}-${date}`);
  if (!list) return;
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/dates/${date}/plans`);
  const plans = await res.json();
  let html = '';
  for (const p of plans) {
    const pid = escapeHtml(p.id);
    const pathAttr = escapeHtml(p.path || '');
    html += `<li class="plan-item" data-id="${pid}" data-path="${pathAttr}" onclick="selectPlan('${escapeHtml(projectId)}','${date}','${pid}', this)">`;
    html += `<span class="plan-title">${escapeHtml(p.name)}</span>`;
    html += `<button class="rename-btn" title="${t('rename')}" onclick="renamePlan(event,'${escapeHtml(projectId)}','${date}','${pid}', this)">${RENAME_SVG}</button>`;
    html += `<button class="copy-btn" title="${t('copyPath')}" onclick="copyPath(event, this)">${COPY_SVG}</button>`;
    html += `<button class="trash-btn" title="${t('moveToTrash')}" onclick="deletePlan(event,'${escapeHtml(projectId)}','${date}','${pid}')">${TRASH_SVG}</button>`;
    html += `</li>`;
  }
  list.innerHTML = html || '<li style="padding:.4rem 2.2rem;font-size:.75rem;color:var(--cloud-medium)">' + t('noDocumentsInDate') + '</li>';
}

async function copyPath(event, btn) {
  event.stopPropagation();
  const li = btn.closest('.plan-item');
  const path = li?.dataset.path;
  if (!path) return;
  try {
    await navigator.clipboard.writeText(path);
    const orig = t('copyPath');
    btn.title = t('copied');
    btn.style.color = 'var(--accent)';
    setTimeout(() => { btn.title = orig; btn.style.color = ''; }, 1200);
  } catch (e) {
    alert(t('copyFailedWith') + e.message);
  }
}

async function deletePlan(event, projectId, date, planId) {
  if (document.body.classList.contains('trash-unavailable')) {
    alert(t('trashUnavailable'));
    return;
  }
  event.stopPropagation();
  if (isEditing() && currentProjectId === projectId && currentDate === date && currentPlanId === planId) {
    alert(t('deleteFirst'));
    return;
  }
  if (!confirm(t('confirmTrash') + planId)) return;
  // Read the item path so its annotations can be removed.
  const li = event.currentTarget?.closest?.('.plan-item');
  const filePath = li?.dataset?.path;
  try {
    const res = await fetch(`/api/plans/${encodeURIComponent(projectId)}/${date}/${encodeURIComponent(planId)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      // Remove annotations for the deleted file.
      if (filePath) localStorage.removeItem(ANN_KEY_PREFIX + filePath);
      // Clear the content area if the deleted file was selected.
      if (currentProjectId === projectId && currentDate === date && currentPlanId === planId) {
        document.getElementById('content').innerHTML = '<div class="empty"><p data-i18n="selectDocument">Select a plan to view</p></div>';
        currentPlanId = null;
        currentPath = null;
        annotations = [];
      }
      await refreshDateGroup(projectId, date);
      // Refresh projects when a date group becomes empty.
      const plans = await (await fetch(`/api/projects/${encodeURIComponent(projectId)}/dates/${date}/plans`)).json();
      if (plans.length === 0) {
        await refreshProject(projectId);
      }
    } else {
      alert(data.error || t('deleteFailed'));
    }
  } catch (e) {
    alert(t('deleteFailedWith') + e.message);
  }
}

async function refreshProject(projectId) {
  // Reloading the sidebar is the simplest reliable refresh strategy.
  await loadProjects();
  // Expand the project again after the refresh.
  const header = document.querySelector(`.project-item[data-id="${CSS.escape(projectId)}"] > .project-header`);
  if (header) {
    await toggleProject(projectId, header);
  }
}

document.getElementById('content').addEventListener('scroll', () => {
  if (currentPlanId) saveViewState();
});

const events = new EventSource('/api/events');
events.addEventListener('changed', scheduleRefresh);
window.addEventListener('beforeunload', (event) => {
  if (!hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = '';
});

// Annotation support.
const ANN_KEY_PREFIX = 'planAnnotations:';
let annotations = [];        // [{id, quote, note, blockPath, start, end}]
let annSeq = 0;

const contentEl = document.getElementById('content');
let annBubble = null;
let annPopupEl = null;

function annStorageKey() {
  // Use the absolute file path as the key so annotations survive renames.
  if (!currentPath) return null;
  return ANN_KEY_PREFIX + currentPath;
}

function loadAnnotations() {
  const key = annStorageKey();
  try { annotations = key ? (JSON.parse(localStorage.getItem(key) || '[]')) : []; }
  catch { annotations = []; }
  // Migrate the old single-segment format to the current segments array.
  for (const a of annotations) {
    if (!a.segments && a.blockPath) {
      a.segments = [{ blockPath: a.blockPath, start: a.start, end: a.end }];
      delete a.blockPath;
      delete a.start;
      delete a.end;
    }
  }
  annSeq = annotations.reduce((m, a) => Math.max(m, a.id || 0), 0);
}

function saveAnnotations() {
  const key = annStorageKey();
  if (key) localStorage.setItem(key, JSON.stringify(annotations));
  renderAnnPreview();
}

// Selection positioning across block elements.
// Return { quote, segments: [{ blockPath, start, end }, ...] }.
function getRangeInBlock(sel) {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const BLOCK_TAGS = ['P','LI','TD','TH','H1','H2','H3','H4','BLOCKQUOTE','PRE'];
  const root = contentEl.querySelector('.plan-body') || contentEl.querySelector('.doc-body');
  if (!root) return null;

  // Collect every block element intersecting the selection.
  const allBlocks = Array.from(root.querySelectorAll('p, li, td, th, h1, h2, h3, h4, blockquote, pre'));
  const segments = [];
  for (const block of allBlocks) {
    if (!range.intersectsNode(block)) continue;
    // Compute selection offsets inside the block.
    let startContainer = range.startContainer, startOff = range.startOffset;
    let endContainer = range.endContainer, endOff = range.endOffset;

    // Normalize list starts to the first text node in the first covered list item.
    if ((startContainer.tagName === 'UL' || startContainer.tagName === 'OL')) {
      const li = startContainer.children[Math.min(startOff, startContainer.children.length - 1)];
      if (li) {
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, null);
        const firstText = walker.nextNode();
        startContainer = firstText || li;
        startOff = 0;
      }
    }
    // Normalize list ends to the last text node in the last covered list item.
    if ((endContainer.tagName === 'UL' || endContainer.tagName === 'OL')) {
      const idx = Math.max(0, Math.min(endOff - 1, endContainer.children.length - 1));
      const li = endContainer.children[idx];
      if (li) {
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, null);
        let lastText = null, n;
        while ((n = walker.nextNode())) lastText = n;
        if (lastText) {
          endContainer = lastText;
          endOff = lastText.nodeValue.length;
        } else {
          endContainer = li;
          endOff = li.childNodes.length;
        }
      }
    }

    // Compute start and end offsets within the block.
    let s = 0, e = block.textContent.length;
    const startInside = block.contains(startContainer) || block === startContainer;
    const endInside = block.contains(endContainer) || block === endContainer;

    if (startInside && endInside) {
      // The selection is entirely within the block.
      s = offsetInBlock(block, startContainer, startOff);
      e = offsetInBlock(block, endContainer, endOff);
    } else if (startInside) {
      // Start in the block and end outside it.
      s = offsetInBlock(block, startContainer, startOff);
      e = block.textContent.length;
    } else if (endInside) {
      // Start outside the block and end inside it.
      s = 0;
      e = offsetInBlock(block, endContainer, endOff);
    } else {
      // The whole block is covered by the selection.
      // Check whether the block is inside the selection range.
      const blockRange = document.createRange();
      blockRange.selectNodeContents(block);
      const startsAfterSelectionStart = blockRange.compareBoundaryPoints(Range.START_TO_START, range) >= 0;
      const endsBeforeSelectionEnd = blockRange.compareBoundaryPoints(Range.END_TO_END, range) <= 0;
      if (!(startsAfterSelectionStart && endsBeforeSelectionEnd)) continue;
      s = 0;
      e = block.textContent.length;
    }

    if (s === null || e === null || s >= e) continue;
    segments.push({ blockPath: blockPathOf(block), start: s, end: e });
  }

  if (segments.length === 0) return null;
  const quote = sel.toString();
  return { quote, segments };
}

// Convert node plus offset into an offset in block.textContent.
function offsetInBlock(block, node, offset) {
  let cum = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    if (n === node) return cum + offset;
    cum += n.nodeValue.length;
  }
  return null;
}

// Build an indexed block path for restoring annotations after a reload.
function blockPathOf(block) {
  const root = contentEl.querySelector('.plan-body') || contentEl.querySelector('.doc-body');
  if (!root) return null;
  const path = [];
  let cur = block;
  while (cur && cur !== root) {
    const parent = cur.parentNode;
    if (!parent) break;
    const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
    const idx = sibs.indexOf(cur);
    path.unshift(cur.tagName.toLowerCase() + ':' + idx);
    cur = parent;
  }
  return path.join('/');
}

function findBlockByPath(path) {
  const root = contentEl.querySelector('.plan-body') || contentEl.querySelector('.doc-body');
  if (!root || !path) return null;
  const parts = path.split('/');
  let cur = root;
  for (const part of parts) {
    const [tag, idx] = part.split(':');
    const sibs = Array.from(cur.children).filter(c => c.tagName.toLowerCase() === tag);
    cur = sibs[parseInt(idx, 10)];
    if (!cur) return null;
  }
  return cur;
}

// Find the text node containing the target offset without landing on an earlier node end.
function findTextNodeAt(block, target, isEnd = false) {
  let cum = 0;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    const len = n.nodeValue.length;
    if (isEnd ? (cum + len >= target) : (cum + len > target)) {
      return { node: n, offset: target - cum };
    }
    cum += len;
  }
  // Return the end of the last node when target equals the total length.
  if (isEnd) {
    const walker2 = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    let last = null;
    while ((n = walker2.nextNode())) last = n;
    if (last) return { node: last, offset: last.nodeValue.length };
  }
  return null;
}

// Apply annotation highlighting safely across child nodes.
// Each annotation can span multiple blocks; apply only its segments in each block.
function applyAnnotationsToBlock(block) {
  if (!block) return;
  const blockPath = blockPathOf(block);
  const blockTextLen = block.textContent.length;
  // Collect annotation and segment pairs for this block.
  const toApply = [];
  for (const a of annotations) {
    const segs = a.segments || [];
    for (const seg of segs) {
      if (seg.blockPath === blockPath) toApply.push({ ann: a, seg });
    }
  }
  if (toApply.length === 0) return;
  // Wrap from the end backward to avoid changing offsets prematurely.
  toApply.sort((x, y) => y.seg.start - x.seg.start);
  for (const { ann, seg } of toApply) {
    if (seg.end > blockTextLen) continue;
    try {
      const s = findTextNodeAt(block, seg.start, false);
      const e = findTextNodeAt(block, seg.end, true);
      if (!s || !e) continue;
      const range = document.createRange();
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, e.offset);
      const frag = range.extractContents();
      const mark = document.createElement('mark');
      mark.className = 'ann-mark';
      mark.dataset.annId = ann.id;
      mark.appendChild(frag);
      range.insertNode(mark);
      // Insert the badge only on the first segment of each annotation.
      const firstSeg = ann.segments[0];
      if (seg === firstSeg) {
        const badge = document.createElement('span');
        badge.className = 'ann-badge';
        badge.textContent = circledNum(ann.id);
        badge.dataset.annId = ann.id;
        mark.after(badge);
        badge.addEventListener('click', (ev) => { ev.stopPropagation(); openAnnPopupForView(ann, mark); });
      }
      mark.addEventListener('click', (ev) => { ev.stopPropagation(); openAnnPopupForView(ann, mark); });
    } catch (e) { /* Ignore segments that cannot be wrapped. */ }
  }
}

function circledNum(n) {
  const map = ['①','②','③','④','⑤','⑥','⑦','⑧','⑨','⑩','⑪','⑫','⑬','⑭','⑮','⑯','⑰','⑱','⑲','⑳'];
  return map[n - 1] || ('(' + n + ')');
}

function applyAllAnnotations() {
  const root = contentEl.querySelector('.plan-body') || contentEl.querySelector('.doc-body');
  if (!root) return;
  // Remove existing marks and badges before reapplying.
  root.querySelectorAll('.ann-badge').forEach(b => b.remove());
  root.querySelectorAll('mark.ann-mark').forEach(m => {
    const parent = m.parentNode;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
  const blocks = root.querySelectorAll('p, li, td, th, h1, h2, h3, h4, blockquote, pre');
  blocks.forEach(applyAnnotationsToBlock);
  renderAnnPreview();
}

// Show the selection bubble after mouseup.
contentEl.addEventListener('mouseup', () => {
  setTimeout(handleSelection, 10);
});
contentEl.addEventListener('touchend', () => {
  setTimeout(handleSelection, 10);
});

function handleSelection() {
  removeAnnBubble();
  const sel = window.getSelection();
  const info = getRangeInBlock(sel);
  if (!info || !info.quote || !info.quote.trim()) return;
  // Skip the bubble for selections inside an existing annotation.
  if (sel.anchorNode && sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('.ann-mark')) return;

  // Position the bubble using the last client rectangle of the selection.
  const range = sel.getRangeAt(0);
  const rects = range.getClientRects();
  if (rects.length === 0) return;
  const firstRect = rects[0];
  const contentRect = contentEl.getBoundingClientRect();
  annBubble = document.createElement('div');
  annBubble.className = 'ann-bubble';
  annBubble.textContent = '✎';
  annBubble.title = t('annotateSelection');
  // Position the bubble relative to the content container.
  annBubble.style.left = (firstRect.left - contentRect.left + contentEl.scrollLeft - 32) + 'px';
  annBubble.style.top = (firstRect.top - contentRect.top + contentEl.scrollTop - 14) + 'px';
  annBubble.addEventListener('click', (ev) => {
    ev.stopPropagation();
    openAnnPopupForCreate(info, firstRect);
  });
  contentEl.appendChild(annBubble);
}

function removeAnnBubble() {
  if (annBubble) { annBubble.remove(); annBubble = null; }
}

// Close the bubble and popup when clicking elsewhere.
document.addEventListener('mousedown', (e) => {
  if (annBubble && !annBubble.contains(e.target)) removeAnnBubble();
  if (annPopupEl && !annPopupEl.contains(e.target) && !e.target.closest('.ann-mark') && !e.target.closest('.ann-badge')) {
    closeAnnPopup();
  }
});

// Annotation popup.
function openAnnPopupForCreate(info, anchorRect) {
  removeAnnBubble();
  closeAnnPopup();
  window.getSelection().removeAllRanges();
  const popup = document.createElement('div');
  popup.className = 'ann-popup';
  popup.innerHTML = `
    <div class="ann-quote"></div>
    <textarea data-i18n-placeholder="writeNote" placeholder="Write a note…"></textarea>
    <div class="ann-actions">
      <button class="approve" data-i18n-title="approve" title="Approve">✓</button>
      <button class="primary" data-i18n="save">Save</button>
    </div>`;
  popup.querySelector('.ann-quote').textContent = info.quote;
  contentEl.appendChild(popup);
  positionPopupNearRect(popup, anchorRect);
  annPopupEl = popup;
  const ta = popup.querySelector('textarea');
  ta.focus();
  const saveWith = (noteText) => {
    annSeq++;
    annotations.push({ id: annSeq, quote: info.quote, note: noteText, segments: info.segments });
    saveAnnotations();
    closeAnnPopup();
    applyAllAnnotations();
  };
  popup.querySelector('.approve').addEventListener('click', () => saveWith(t('approve')));
  popup.querySelector('.primary').addEventListener('click', () => {
    const note = ta.value.trim();
    if (!note) { closeAnnPopup(); return; }
    saveWith(note);
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); popup.querySelector('.primary').click(); }
    else if (e.key === 'Escape') { e.preventDefault(); closeAnnPopup(); }
  });
}

function openAnnPopupForView(ann, anchorEl) {
  closeAnnPopup();
  const popup = document.createElement('div');
  popup.className = 'ann-popup';
  popup.innerHTML = `
    <div class="ann-quote"></div>
    <textarea></textarea>
    <div class="ann-meta">Note #${ann.id}</div>
    <div class="ann-actions">
      <button class="approve" data-i18n-title="approve" title="Approve">✓</button>
      <button class="danger" data-i18n="delete">Delete</button>
      <button class="primary" data-i18n="save">Save</button>
    </div>`;
  popup.querySelector('.ann-quote').textContent = ann.quote;
  popup.querySelector('textarea').value = ann.note;
  contentEl.appendChild(popup);
  const rect = anchorEl ? anchorEl.getBoundingClientRect() : null;
  positionPopupNearRect(popup, rect);
  annPopupEl = popup;
  const ta = popup.querySelector('textarea');
  ta.focus(); ta.select();
  popup.querySelector('.approve').addEventListener('click', () => {
    const idx = annotations.findIndex(a => a.id === ann.id);
    if (idx >= 0) {
      annotations[idx].note = t('approve');
      saveAnnotations();
      applyAllAnnotations();
    }
    closeAnnPopup();
  });
  popup.querySelector('.primary').addEventListener('click', () => {
    const note = ta.value.trim();
    const idx = annotations.findIndex(a => a.id === ann.id);
    if (idx >= 0) {
      if (note) annotations[idx].note = note;
      else annotations.splice(idx, 1);
      saveAnnotations();
      applyAllAnnotations();
    }
    closeAnnPopup();
  });
  popup.querySelector('.danger').addEventListener('click', () => {
    const idx = annotations.findIndex(a => a.id === ann.id);
    if (idx >= 0) { annotations.splice(idx, 1); saveAnnotations(); applyAllAnnotations(); }
    closeAnnPopup();
  });
}

// Anchor below the selection and flip when the popup crosses an edge.
function positionPopupNearRect(popup, rect) {
  if (!rect) {
    popup.style.left = '50%';
    popup.style.top = '100px';
    popup.style.transform = 'translateX(-50%)';
    return;
  }
  const contentRect = contentEl.getBoundingClientRect();
  // Start at the lower-left position.
  let left = rect.left - contentRect.left + contentEl.scrollLeft;
  let top = rect.bottom - contentRect.top + contentEl.scrollTop + 6;
  // Measure the inserted popup before checking boundaries.
  const pw = popup.offsetWidth || 280;
  const ph = popup.offsetHeight || 160;
  const viewW = contentEl.clientWidth;
  const viewH = contentEl.clientHeight;
  // Right edge.
  if (left + pw > contentEl.scrollLeft + viewW - 8) {
    left = Math.max(contentEl.scrollLeft + 8, contentEl.scrollLeft + viewW - pw - 8);
  }
  // Flip upward at the bottom edge.
  if (top + ph > contentEl.scrollTop + viewH - 8) {
    top = rect.top - contentRect.top + contentEl.scrollTop - ph - 6;
  }
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
}

function closeAnnPopup() {
  if (annPopupEl) { annPopupEl.remove(); annPopupEl = null; }
}

// Bottom preview panel.
function renderAnnPreview() {
  let preview = contentEl.querySelector('.ann-preview');
  if (annotations.length === 0) {
    if (preview) preview.remove();
    return;
  }
  if (!preview) {
    preview = document.createElement('div');
    preview.className = 'ann-preview';
    contentEl.appendChild(preview);
  }
  const sorted = [...annotations].sort((a, b) => a.id - b.id);
  const lines = [];
  sorted.forEach((a, i) => {
    lines.push(`${i + 1}. "${a.quote}"`);
    lines.push('');
    // Indent every line of a multiline note consistently.
    const noteLines = String(a.note || '').split('\n');
    for (const nl of noteLines) lines.push(`   ${nl}`);
    if (i < sorted.length - 1) lines.push('');
  });
  const bodyText = lines.join('\n');
  preview.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'ann-preview-head';
  const title = document.createElement('span');
  title.textContent = t('notesCount', { count: sorted.length });
  const copyBtn = document.createElement('button');
  copyBtn.className = 'copy-btn';
  copyBtn.title = t('copyAllNotes');
  copyBtn.innerHTML = COPY_SVG;
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(bodyText);
      const orig = copyBtn.innerHTML;
      copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="width:14px;height:14px"><path d="M20 6L9 17l-5-5"/></svg>';
      setTimeout(() => { copyBtn.innerHTML = orig; }, 1200);
    } catch (err) { alert(t('copyFailedWith') + err.message); }
  });
  // The clear button removes all annotations for the current document.
  const clearBtn = document.createElement('button');
  clearBtn.className = 'clear-btn';
  clearBtn.title = t('clearAllNotes');
  clearBtn.innerHTML = TRASH_SVG;
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(t('clearAllNotesConfirm'))) return;
    annotations = [];
    saveAnnotations();
    applyAllAnnotations();
  });
  head.appendChild(title);
  head.appendChild(clearBtn);
  head.appendChild(copyBtn);
  const body = document.createElement('div');
  body.className = 'ann-preview-body';
  body.textContent = bodyText;
  preview.appendChild(head);
  preview.appendChild(body);
}

// Clean up when switching files.
function resetAnnotationsForCurrentDoc() {
  removeAnnBubble();
  closeAnnPopup();
  loadAnnotations();
  applyAllAnnotations();
}



// ── Init ──
applyTranslations();
document.querySelector('#language-select').addEventListener('change', (event) => persistLocale(event.target.value));
loadTrashCapability();
loadProjects({ restore: true });
