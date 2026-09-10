import { layoutGraph } from './graph.js';

const { t, apply } = globalThis.difgraphI18n;
const historyElement = document.querySelector('#history');
const statusElement = document.querySelector('#history-status');
const detailPanel = document.querySelector('#detail-panel');
const repoLabel = document.querySelector('#repo-label');
const directorySelect = document.querySelector('#directory-select');
const refreshButton = document.querySelector('#refresh');
const branchControl = document.querySelector('#branch-control');
const branchSelect = document.querySelector('#branch-select');
const localeSelect = document.querySelector('#locale-select');
const colors = ['#58a6ff', '#f778ba', '#3fb950', '#d2a8ff', '#e3b341', '#ff7b72', '#39c5cf'];
let commits = [];
let selectedSha = null;
let lastDetail = null;
let difitOpen = false;
let detailRequest = 0;
let selectedBranch = null;

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const date = timestamp => timestamp ? new Intl.DateTimeFormat(globalThis.difgraphI18n.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp * 1000) : t('unknownTime');
function relative(timestamp) {
  if (!timestamp) return t('unknown');
  const seconds = Math.round(Date.now() / 1000 - timestamp);
  const units = [[31536000, 'years'], [2592000, 'months'], [86400, 'days'], [3600, 'hours'], [60, 'minutes']];
  for (const [size, unit] of units) if (seconds >= size) return `${Math.floor(seconds / size)} ${t(unit)} ${t('ago')}`;
  return t('justNow');
}
async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ?? t('requestFailed', { status: response.status }));
  return body;
}

function renderGraph() {
  const layout = layoutGraph(commits);
  const rowHeight = 82;
  const laneWidth = 15;
  const left = 14;
  const graphWidth = Math.max(48, left + layout.laneCount * laneWidth + 12);
  historyElement.style.setProperty('--graph-width', `${graphWidth}px`);
  historyElement.innerHTML = commits.map(commit => `
    <article class="commit${commit.sha === selectedSha ? ' selected' : ''}" data-sha="${commit.sha}" tabindex="0">
      <div class="subject">${escapeHtml(commit.subject || t('noSubject'))}<span class="refs">${commit.refs.map(ref => `<span class="ref ${ref.type}">${escapeHtml(ref.name)}</span>`).join('')}</span></div>
      <div class="meta"><span class="hash">${commit.sha.slice(0, 8)}</span><span>${escapeHtml(commit.author.name || t('unknownAuthor'))}</span></div>
      <div class="dates"><span>${relative(commit.committedAt)}</span><span>${date(commit.committedAt)}</span></div>
    </article>`).join('');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('graph-svg');
  svg.setAttribute('width', graphWidth); svg.setAttribute('height', commits.length * rowHeight);
  const point = (lane, row) => [left + lane * laneWidth, row * rowHeight + rowHeight / 2];
  for (const row of layout.rows) {
    for (const edge of row.edges) {
      const [x1, y1] = point(edge.fromLane, row.row);
      const y2 = edge.truncated ? y1 + rowHeight / 2 : point(edge.toLane, row.row + 1)[1];
      const x2 = edge.truncated ? x1 : point(edge.toLane, row.row + 1)[0];
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', x1 === x2 ? `M ${x1} ${y1} L ${x2} ${y2}` : `M ${x1} ${y1} C ${x1} ${y1 + 24}, ${x2} ${y2 - 24}, ${x2} ${y2}`);
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', colors[edge.fromLane % colors.length]); path.setAttribute('stroke-width', '2');
      if (edge.truncated) path.setAttribute('stroke-dasharray', '3 4');
      svg.append(path);
    }
  }
  for (const row of layout.rows) {
    const [cx, cy] = point(row.lane, row.row);
    const node = document.createElementNS(svg.namespaceURI, 'circle');
    node.setAttribute('cx', cx); node.setAttribute('cy', cy); node.setAttribute('r', row.sha === selectedSha ? '6' : '5');
    node.setAttribute('fill', '#0d1117'); node.setAttribute('stroke', colors[row.lane % colors.length]); node.setAttribute('stroke-width', row.sha === selectedSha ? '3' : '2');
    svg.append(node);
  }
  historyElement.prepend(svg);
  historyElement.querySelectorAll('.commit').forEach(element => {
    element.addEventListener('click', () => selectCommit(element.dataset.sha));
    element.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') selectCommit(element.dataset.sha); });
  });
}

async function stopDifit() {
  if (!difitOpen) return;
  difitOpen = false;
  await api('/api/difit', { method: 'DELETE' }).catch(() => {});
}
async function selectCommit(sha, { retranslateOnly = false } = {}) {
  if (sha !== selectedSha) await stopDifit();
  selectedSha = sha; renderGraph();
  if (retranslateOnly && lastDetail) { renderDetail(lastDetail); return; }
  const request = ++detailRequest;
  detailPanel.innerHTML = `<div class="notice">${escapeHtml(t('loadingDetail'))}</div>`;
  try {
    const detail = await api(`/api/commits/${sha}`);
    if (request !== detailRequest) return;
    lastDetail = detail;
    renderDetail(detail);
  } catch (error) { if (request === detailRequest) detailPanel.innerHTML = `<div class="notice error">${escapeHtml(error.message)}</div>`; }
}
function person(label, personValue) { return `${label}：${escapeHtml(personValue.name)} &lt;${escapeHtml(personValue.email)}&gt; · ${date(personValue.timestamp)}`; }
function renderDetail(detail) {
  detailPanel.innerHTML = `
    <div class="detail-header"><div><h1>${escapeHtml(detail.subject || t('noSubject'))}</h1><div class="detail-meta"><div class="hash">${detail.sha}</div><div>${person(t('author'), detail.author)}</div><div>${person(t('committer'), detail.committer)}</div><div>${t('parents')}：${detail.parents.length ? detail.parents.map(parent => `<span class="hash">${parent.slice(0, 12)}</span>`).join('、') : t('noParents')}</div></div></div><button id="open-difit" class="primary">${escapeHtml(t('viewInDifit'))}</button></div>
    <div class="message">${escapeHtml(detail.message || t('noCommitMessage'))}</div>
    <div class="summary"><strong>${t('filesChanged', { count: detail.totals.files })}</strong><span class="add">+${detail.totals.additions}</span><span class="del">−${detail.totals.deletions}</span>${detail.totals.binary ? `<span>${t('binaryFiles', { count: detail.totals.binary })}</span>` : ''}</div>
    <div class="files">${detail.files.length ? detail.files.map(file => `<div class="file"><span class="file-name">${file.oldPath ? `<span class="old-path">${escapeHtml(file.oldPath)} → </span>` : ''}${escapeHtml(file.path)}</span><span class="add">${file.additions === null ? t('binaryFile') : `+${file.additions}`}</span><span class="del">${file.deletions === null ? '' : `−${file.deletions}`}</span></div>`).join('') : `<div class="file">${escapeHtml(t('noFileChanges'))}</div>`}</div>`;
  document.querySelector('#open-difit').addEventListener('click', launchDifit);
}
async function launchDifit(event) {
  const launchSha = selectedSha;
  const button = event.currentTarget; button.disabled = true; button.textContent = t('startingDifit');
  try {
    const result = await api('/api/difit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sha: launchSha }) });
    if (selectedSha !== launchSha) { await api('/api/difit', { method: 'DELETE' }).catch(() => {}); return; }
    difitOpen = true;
    detailPanel.innerHTML = `<div class="difit-view"><div class="difit-toolbar"><span>difit · <span class="hash">${launchSha.slice(0, 12)}</span></span><button id="close-difit">${escapeHtml(t('closeDifit'))}</button></div><iframe title="${escapeHtml(t('difitReview'))}" src="${escapeHtml(result.url)}"></iframe></div>`;
    document.querySelector('#close-difit').addEventListener('click', async () => { await stopDifit(); selectCommit(selectedSha); });
  } catch (error) { button.disabled = false; button.textContent = t('retryDifit'); button.insertAdjacentHTML('afterend', `<div class="error">${escapeHtml(error.message)}</div>`); }
}

async function load(branch = selectedBranch) {
  const scrollTop = document.querySelector('.history-panel').scrollTop;
  refreshButton.disabled = true; statusElement.hidden = false; statusElement.className = 'notice'; statusElement.textContent = t('loadingHistory');
  try {
    await stopDifit();
    const query = branch === null ? '' : `?branch=${encodeURIComponent(branch)}`;
    const data = await api(`/api/repository${query}`);
    commits = data.commits;
    const branches = Array.isArray(data.repository.branches)
      ? data.repository.branches
      : data.repository.branch
        ? [{ name: data.repository.branch, sha: data.repository.head }]
        : [];
    selectedBranch = data.repository.selectedBranch ?? data.repository.branch ?? null;
    repoLabel.textContent = `${data.repository.name} · ${data.repository.directory ?? data.repository.root}`;
    directorySelect.title = data.repository.directory ?? data.repository.root;
    branchSelect.innerHTML = '';
    if (data.repository.detached) {
      const option = new Option(t('detachedAt', { sha: data.repository.head.slice(0, 8) }), '', true, selectedBranch === null);
      branchSelect.add(option);
    }
    for (const item of branches) branchSelect.add(new Option(item.name, item.name, item.name === selectedBranch, item.name === selectedBranch));
    branchSelect.value = selectedBranch ?? '';
    branchControl.hidden = false;
    statusElement.hidden = true;
    selectedSha = commits.find(commit => commit.sha === (data.repository.selectedHead ?? data.repository.head))?.sha ?? commits[0]?.sha ?? null;
    renderGraph();
    document.querySelector('.history-panel').scrollTop = scrollTop;
    if (selectedSha) await selectCommit(selectedSha);
  } catch (error) { statusElement.className = 'notice error'; statusElement.textContent = error.message; historyElement.innerHTML = ''; }
  finally { refreshButton.disabled = false; }
}
async function selectDirectory() {
  if (directorySelect.disabled) return;
  directorySelect.disabled = true;
  try {
    const result = await api('/api/repository/select', { method: 'POST' });
    if (!result.cancelled) {
      selectedBranch = null;
      selectedSha = null;
      lastDetail = null;
      document.querySelector('.history-panel').scrollTop = 0;
      await load(null);
    }
  } catch (error) {
    statusElement.hidden = false;
    statusElement.className = 'notice error';
    statusElement.textContent = error.message;
  } finally { directorySelect.disabled = false; }
}
refreshButton.addEventListener('click', () => load(selectedBranch));
directorySelect.addEventListener('click', selectDirectory);
branchSelect.addEventListener('change', () => load(branchSelect.value || null));
localeSelect.addEventListener('change', () => globalThis.difgraphI18n.setLocale(localeSelect.value));
apply();
load();
