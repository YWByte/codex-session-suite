const { t } = globalThis.collectI18n;
const state = { view: 'active', collections: [], counts: { active: 0, archived: 0 } };
const cards = document.querySelector('#cards');
const status = document.querySelector('#status');
const template = document.querySelector('#card-template');
const QUOTE_COLLAPSE_LIMIT = 220;
const QUOTE_MARKDOWN_TAGS = ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'a', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td'];
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>';
const COPIED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
const COPY_FAILED_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';

function escapeText(element, text) { element.textContent = text || ''; }
function renderQuoteMarkdown(element, markdown) {
  const html = marked.parse(markdown || '', { gfm: true, breaks: true });
  element.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: QUOTE_MARKDOWN_TAGS,
    ALLOWED_ATTR: ['href', 'title'],
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
  for (const link of element.querySelectorAll('a')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  for (const table of element.querySelectorAll('table')) {
    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'quote-table-scroll';
    scrollContainer.tabIndex = 0;
    scrollContainer.setAttribute('role', 'region');
    scrollContainer.setAttribute('aria-label', t('markdownTable'));
    table.before(scrollContainer);
    scrollContainer.append(table);
  }
}
function quoteLength(value) { return Array.from(value || '').length; }
function setQuoteCollapsed(container, toggle, collapsed) {
  container.classList.toggle('collapsed', collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.setAttribute('aria-label', collapsed ? t('expand') : t('collapse'));
  toggle.title = collapsed ? t('expand') : t('collapse');
}
function enableQuoteToggle(container, toggle) {
  container.classList.add('collapsible');
  toggle.hidden = false;
  setQuoteCollapsed(container, toggle, true);
  toggle.addEventListener('click', () => setQuoteCollapsed(container, toggle, toggle.getAttribute('aria-expanded') === 'true'));
}
async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {}
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('clipboard_unavailable');
}
function showCopyResult(button, success) {
  const label = success ? t('copied') : t('copyFailed');
  const revision = String(Number(button.dataset.revision || '0') + 1);
  button.dataset.revision = revision;
  button.dataset.feedback = label;
  button.classList.toggle('success', success);
  button.classList.toggle('error', !success);
  button.innerHTML = success ? COPIED_ICON : COPY_FAILED_ICON;
  button.setAttribute('aria-label', label);
  button.title = label;
  window.setTimeout(() => {
    if (button.dataset.revision !== revision) return;
    delete button.dataset.feedback;
    button.classList.remove('success', 'error');
    button.innerHTML = COPY_ICON;
    button.setAttribute('aria-label', t('copyMarkdown'));
    button.title = t('copyMarkdown');
  }, 1800);
}
async function copyQuote(button, markdown) {
  if (button.getAttribute('aria-busy') === 'true') return;
  button.setAttribute('aria-busy', 'true');
  try {
    await writeClipboard(markdown);
    showCopyResult(button, true);
  } catch {
    showCopyResult(button, false);
  } finally {
    button.removeAttribute('aria-busy');
  }
}
function formatTime(value) { return new Intl.DateTimeFormat(globalThis.collectI18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function showStatus(message = '', error = false) { status.textContent = message; status.classList.toggle('error', error); }
async function request(path, options = {}) {
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) { const key = `error.${data.error?.code}`; const translated = t(key); const error = new Error(translated === key ? (data.error?.message || t('requestFailed')) : translated); error.code = data.error?.code; throw error; }
  return data;
}
async function loadCounts() {
  const [active, archived] = await Promise.all([request('/api/collections?archived=false'), request('/api/collections?archived=true')]);
  state.counts.active = active.collections.length;
  state.counts.archived = archived.collections.length;
  document.querySelector('#active-count').textContent = state.counts.active;
  document.querySelector('#archived-count').textContent = state.counts.archived;
  return state.view === 'active' ? active.collections : archived.collections;
}
function render() {
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
  const archived = state.view === 'archived';
  document.querySelector('#eyebrow').textContent = archived ? t('archivedEyebrow') : t('activeEyebrow');
  document.querySelector('#title').textContent = archived ? t('archived') : t('active');
  cards.replaceChildren();
  if (!state.collections.length) {
    const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = archived ? t('emptyArchived') : t('emptyActive'); cards.append(empty); return;
  }
  for (const collection of state.collections) cards.append(renderCard(collection));
}
function deleteButtonLabel(fragment) { fragment.querySelector('.delete').textContent = t('delete'); }
function renderCard(collection) {
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector('.card');
  const quoteContainer = fragment.querySelector('.quote-container');
  const quote = fragment.querySelector('.quote');
  const quoteCopy = fragment.querySelector('.quote-copy');
  const quoteToggle = fragment.querySelector('.quote-toggle');
  const note = fragment.querySelector('.note');
  const source = fragment.querySelector('.source');
  const edit = fragment.querySelector('.edit');
  const archive = fragment.querySelector('.archive');
  const editArea = fragment.querySelector('.edit-area');
  const textarea = fragment.querySelector('textarea');
  fragment.querySelector('.note-label').textContent = t('noteLabel');
  fragment.querySelectorAll('.meta dt').forEach((element, index) => { element.textContent = t(['role', 'project', 'session', 'created'][index]); });
  source.textContent = t('viewSource');
  edit.textContent = t('editNote');
  deleteButtonLabel(fragment);
  textarea.setAttribute('aria-label', t('noteLabel'));
  fragment.querySelector('.edit-area .cancel').textContent = t('cancel');
  fragment.querySelector('.edit-area .save').textContent = t('save');
  renderQuoteMarkdown(quote, collection.quote);
  quoteCopy.addEventListener('click', () => void copyQuote(quoteCopy, collection.quote));
  if (quoteLength(collection.quote) > QUOTE_COLLAPSE_LIMIT) enableQuoteToggle(quoteContainer, quoteToggle);
  escapeText(note, collection.note || t('noNote')); note.classList.toggle('empty', !collection.note);
  if (collection.source) {
    escapeText(fragment.querySelector('.role'), collection.source.role === 'user' ? 'You' : collection.source.role === 'assistant' ? 'Codex' : collection.source.role);
    escapeText(fragment.querySelector('.project'), collection.source.projectName || collection.source.projectPath || t('noProject'));
    escapeText(fragment.querySelector('.session'), collection.source.sessionTitle);
    const viewerOrigin = collection.source.viewerOrigin || globalThis.__CODEX_SUITE_CONFIG__?.viewerOrigins?.session || 'http://127.0.0.1:3460';
    source.href = `${viewerOrigin}/?collection=${encodeURIComponent(collection.id)}`;
  } else {
    escapeText(fragment.querySelector('.role'), t('manual'));
    escapeText(fragment.querySelector('.project'), '—');
    escapeText(fragment.querySelector('.session'), collection.origin || t('manualCreated'));
    source.remove();
  }
  escapeText(fragment.querySelector('.created'), formatTime(collection.createdAt));
  archive.textContent = collection.archivedAt ? t('restore') : t('archive');
  const deleteButton = fragment.querySelector('.delete');
  if (collection.archivedAt) {
    deleteButton.hidden = false;
    deleteButton.addEventListener('click', async () => {
      if (!window.confirm(t('deleteConfirm'))) return;
      try { await request(`/api/collections/${encodeURIComponent(collection.id)}`, { method:'DELETE' }); await refresh(); }
      catch (error) { showStatus(error.message, true); }
    });
  }
  edit.addEventListener('click', () => { textarea.value = collection.note || ''; editArea.hidden = false; edit.hidden = true; textarea.focus(); });
  fragment.querySelector('.cancel').addEventListener('click', () => { editArea.hidden = true; edit.hidden = false; });
  fragment.querySelector('.save').addEventListener('click', async () => {
    try { await request(`/api/collections/${encodeURIComponent(collection.id)}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ note: textarea.value }) }); await refresh(); }
    catch (error) { showStatus(error.message, true); }
  });
  archive.addEventListener('click', async () => {
    try { await request(`/api/collections/${encodeURIComponent(collection.id)}/${collection.archivedAt ? 'restore' : 'archive'}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' }); await refresh(); }
    catch (error) { showStatus(error.message, true); }
  });
  return fragment;
}
async function refresh() { showStatus(t('loading')); try { state.collections = await loadCounts(); render(); showStatus(); } catch (error) { cards.replaceChildren(); showStatus(t('loadFailed', { message: error.message }), true); } }
document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => { state.view = item.dataset.view; refresh(); }));
document.querySelector('#refresh').addEventListener('click', refresh);
document.querySelector('#locale-select').addEventListener('change', (event) => globalThis.collectI18n.setLocale(event.target.value));
window.addEventListener('suite-locale-change', () => { globalThis.collectI18n.apply(); render(); });

const createDialog = document.querySelector('#create-dialog');
const createForm = document.querySelector('#create-form');
const createQuote = document.querySelector('#create-quote');
const createNote = document.querySelector('#create-note');
const createOrigin = document.querySelector('#create-origin');
const createError = document.querySelector('#create-error');
const createSave = document.querySelector('#create-save');
function syncCreateSave() { createSave.disabled = !createQuote.value.trim(); }
function resetCreateForm() {
  createQuote.value = ''; createNote.value = ''; createOrigin.value = '';
  createError.textContent = ''; createSave.disabled = true;
}
document.querySelector('#create').addEventListener('click', () => {
  resetCreateForm();
  createDialog.showModal();
  createQuote.focus();
});
document.querySelector('#create-cancel').addEventListener('click', () => createDialog.close());
createQuote.addEventListener('input', syncCreateSave);
createForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (createSave.disabled) return;
  createSave.disabled = true;
  try {
    const body = { quote: createQuote.value, note: createNote.value };
    const origin = createOrigin.value.trim();
    if (origin) body.origin = origin;
    await request('/api/collections', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
    createDialog.close();
    await refresh();
  } catch (error) {
    createError.textContent = t('saveFailed', { message: error.message });
    createSave.disabled = false;
  }
});
globalThis.collectI18n.apply();
refresh();
