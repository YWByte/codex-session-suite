import { isLoadedSessionStatus, normalizeSessionStatus } from "./session-status.js";
import { commandPresentation } from "./command-display.js";
import * as constants from "./app/constants.js";
import { createElements } from "./app/elements.js";
import { createState } from "./app/state.js";
import { storedArray } from "./app/storage.js";
import { installRuntime } from "./app/runtime.js";
import { installDom } from "./app/dom.js";
import { installApi } from "./app/api.js";
import { installAnnotations } from "./app/annotations.js";
import { installViewers } from "./app/viewers.js";
import { installComposer } from "./app/composer.js";
import { installNavigation } from "./app/navigation.js";
import { installConnection } from "./app/connection.js";
import { installTimeline } from "./app/timeline.js";
import { installGitTools } from "./app/git-tools.js";
import { installRequests } from "./app/requests.js";
import { initI18nFactory } from "./app/i18n.js";

const { IMAGE_TYPES } = constants;
const elements = createElements();
const state = createState();
const unreadThreadIds = new Set(storedArray(localStorage, constants.UNREAD_STORAGE_KEY));
const resentMessageKeys = new Set(storedArray(localStorage, constants.RESENT_MESSAGES_STORAGE_KEY));
const annotationState = { items: [], sequence: 0, bubble: null, popup: null };
const actions = {};
const i18n = initI18nFactory(globalThis);
const context = {
  ...i18n,
  ...constants,
  state,
  elements,
  unreadThreadIds,
  resentMessageKeys,
  annotationState,
  actions,
  isLoadedSessionStatus,
  normalizeSessionStatus,
  commandPresentation,
  storedArray,
};

installRuntime(context);
installDom(context);
installApi(context);
installAnnotations(context);
installViewers(context);
installComposer(context);
installNavigation(context);
installConnection(context);
installTimeline(context);
installGitTools(context);
installRequests(context);

const t = context.t;
const setLocale = context.setLocale;
const getLocale = context.getLocale;

const {
  activateThread, addComposerImages, api, clearAnnotations, closeComposerModelMenu, composerImages, composerMode, connectEvents,
  handleAnnotationSelection, interruptTurn, listFrom, loadGitContext, loadHealth, loadModels, loadOlderTurns,
  loadProjects, openArchViewer, openCollectionSourceFromQuery, openCollectViewer, openPlanViewer, openComposerModelMenu, openDifgraph, openDifit, removeAnnotationBubble,
  renderComposerImages, renderComposerMode, renderGlobalRequests, renderHeader, renderRequests,
  renderSidebar, renderTimeline, restartAppServer, restoreAfterRestart, runSearch, saveScrollPosition, scheduleSearch,
  selectThread, sendMessage, startCompaction, syncConversationRailActive, syncRequestFlags, toast,
  updateComposer,
} = actions;

function updateLocaleSwitcher() {
  if (!elements.localeSwitcher) return;
  const locale = getLocale();
  elements.localeSwitcher.querySelectorAll("button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.locale === locale));
  });
}

function changeLocale(locale) {
  if (!["en", "zh-CN"].includes(locale)) return;
  setLocale(locale);
  updateLocaleSwitcher();
  renderHeader();
  renderSidebar();
  renderTimeline();
  renderComposerImages();
  updateComposer();
  renderRequests();
  renderGlobalRequests();
  localizeStaticDom();
  document.documentElement.lang = getLocale();
}

function localizeStaticDom() {
  const dictionary = {
    mobileToggle: { "aria-label": "navigation.openNavigation" },
    sessionSearch: { "aria-label": "navigation.searchSessions", placeholder: "navigation.searchPlaceholder" },
    searchClear: { "aria-label": "actions.clearSearch", title: "actions.clearSearch" },
    projectsSidebar: { "aria-label": "navigation.projectsAndSessions" },
    resizer: { "aria-label": "actions.resizeSidebar" },
    conversationHead: {},
    threadTitle: { textContent: "navigation.selectASession" },
    threadProject: {},
    threadMeta: { textContent: "navigation.localCodexSessions" },
    threadStatus: {},
    timeline: { "aria-label": "navigation.conversationContent" },
    conversationRail: { "aria-label": "navigation.userMessages" },
    gitRail: { "aria-label": "navigation.tools" },
    globalRequestsToggle: { "aria-label": "navigation.pendingRequests", textContent: null },
    connection: { title: "status.checkingService" },
    connectionLabel: { textContent: "status.connecting" },
    requestDock: { "aria-label": "navigation.pendingRequests" },
    activateThread: {},
    annotationList: { "aria-label": "navigation.annotations" },
    annotationTitle: { textContent: "annotations.title0" },
    annotationClear: { title: "actions.clearAnnotations", "aria-label": "actions.clearAnnotations" },
    annotationBody: { "aria-label": "navigation.pendingAnnotations" },
    composer: {},
    composerModelToggle: { title: "actions.modelAndEffort", "aria-label": "actions.modelAndEffort" },
    composerModelMenu: { "aria-label": "actions.modelAndEffort" },
    modelMenuModelsLabel: { textContent: "common.models" },
    modelMenuEffortLabel: { textContent: "common.reasoningEffort" },
    composerTokenGroup: { "aria-label": "status.latestTokenUsage" },
    composerTokenIn: { title: "status.inputTokens" },
    composerTokenOut: { title: "status.outputTokens" },
    composerRestart: { title: "actions.restartAppServer", "aria-label": "actions.restartAppServer" },
    composerModeToggle: { title: "actions.switchToPlanMode" },
    composerCompact: { title: "actions.compactContext", "aria-label": "actions.compactContext" },
    composerCopy: { title: "actions.copyInput", "aria-label": "actions.copyInput" },
    composerClear: { title: "actions.clearInput", "aria-label": "actions.clearInput" },
    send: { title: "actions.sendMessage", "aria-label": "actions.sendMessage" },
    composerImageTray: { "aria-label": "composer.pendingImages" },
    composerText: { "aria-label": "actions.messageToCodex", placeholder: "composer.placeholder" },
    archViewer: { "aria-label": "actions.openArchViewer" },
    planViewer: { "aria-label": "actions.openPlanViewer" },
    collectViewer: { "aria-label": "actions.openCollectViewer" },
    gitBranch: { "aria-label": "actions.viewGitBranch" },
    gitGraph: { "aria-label": "actions.viewCommitGraph" },
    gitStaged: { "aria-label": "actions.viewStagedChanges" },
    gitCommitted: { "aria-label": "actions.viewCommittedChanges" },
  };
  const textDictionary = {
    gitCurrentBranch: "common.emDash",
    gitBaseBranch: "common.emDash",
    gitBaseSource: "common.emDash",
    gitGraphSummary: "git.openDifgraphNewTab",
    gitStagedSummary: "status.loading",
    gitCommittedSummary: "status.loading",
    composerModeLabel: "common.default",
    composerStatus: "status.codexWorking",
    interrupt: "actions.interrupt",
  };
  for (const [name, properties] of Object.entries(dictionary)) {
    const element = elements[name];
    if (!element) continue;
    for (const [property, key] of Object.entries(properties)) {
      if (key !== null) element.setAttribute(property, t(key));
    }
  }
  for (const [name, key] of Object.entries(textDictionary)) {
    const element = elements[name];
    if (element) element.textContent = t(key);
  }
  const staticTexts = {
    "[data-i18n]": null,
  };
  document.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  void staticTexts;
  document.querySelectorAll("[data-i18n-aria]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAria));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.title = t(element.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  });
}

function closeMobileNav() {
  document.body.classList.remove("nav-open");
  elements.mobileToggle.setAttribute("aria-expanded", "false");
  elements.scrim.hidden = true;
}
actions.closeMobileNav = closeMobileNav;

elements.search.addEventListener("input", () => {
  scheduleSearch();
});
elements.searchClear.addEventListener("click", () => {
  elements.search.value = "";
  void runSearch();
  elements.search.focus();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.requestPanelOpen) {
    state.requestPanelOpen = false;
    renderGlobalRequests();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.search.focus();
    return;
  }
  if (document.activeElement !== elements.search) return;
  if (event.key === "Escape") {
    elements.search.value = "";
    void runSearch();
    return;
  }
  if ((event.key === "ArrowDown" || event.key === "ArrowUp") && state.searchResults.length) {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    state.searchIndex = (state.searchIndex + delta + state.searchResults.length) % state.searchResults.length;
    elements.searchResults.querySelectorAll("[data-search-index]").forEach((node, index) => node.classList.toggle("selected", index === state.searchIndex));
    elements.searchResults.querySelector(`[data-search-index="${state.searchIndex}"]`)?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (event.key === "Enter" && state.searchIndex >= 0) {
    event.preventDefault();
    void selectThread(state.searchResults[state.searchIndex].id);
  }
});
elements.fork.addEventListener("click", async () => {
  const threadId = elements.fork.dataset.threadId;
  if (!threadId) return;
  try {
    await selectThread(threadId);
  } catch (error) {
    toast(t("errors.forkSourceUnavailable", { message: error.message }), "error");
  }
});
elements.project.addEventListener("click", () => {
  if (elements.project.dataset.parentThreadId) void selectThread(elements.project.dataset.parentThreadId);
});
elements.project.addEventListener("keydown", (event) => {
  if ((event.key === "Enter" || event.key === " ") && elements.project.dataset.parentThreadId) {
    event.preventDefault();
    void selectThread(elements.project.dataset.parentThreadId);
  }
});
elements.globalRequestsToggle.addEventListener("click", () => {
  state.requestPanelOpen = !state.requestPanelOpen;
  renderGlobalRequests();
});
elements.archViewer.addEventListener("click", openArchViewer);
elements.planViewer.addEventListener("click", openPlanViewer);
elements.collectViewer.addEventListener("click", openCollectViewer);
elements.gitGraph.addEventListener("click", () => void openDifgraph());
elements.gitStaged.addEventListener("click", () => void openDifit("staged", elements.gitStaged));
elements.gitCommitted.addEventListener("click", () => void openDifit("committed", elements.gitCommitted));
window.addEventListener("focus", () => { if (state.selectedThreadId) void loadGitContext(); });
window.addEventListener("beforeunload", () => saveScrollPosition(state.selectedThreadId, elements.timeline.scrollTop));

elements.composer.addEventListener("dragover", (event) => {
  if ([...(event.dataTransfer?.items || [])].some((item) => item.kind === "file")) {
    event.preventDefault();
    elements.composer.classList.add("dragging-files");
  }
});
elements.composer.addEventListener("dragleave", () => elements.composer.classList.remove("dragging-files"));
elements.composer.addEventListener("drop", (event) => {
  elements.composer.classList.remove("dragging-files");
  const files = [...(event.dataTransfer?.files || [])];
  if (!files.length) return;
  event.preventDefault();
  void addComposerImages(files);
});
elements.composerText.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.files || [])];
  if (files.some((file) => IMAGE_TYPES.has(file.type))) void addComposerImages(files);
});

elements.composerCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(elements.composerText.value);
    toast(t("messages.inputCopied"));
  } catch {
    toast(t("errors.copyFailed"), "error");
  }
});
elements.composerClear.addEventListener("click", () => {
  elements.composerText.value = "";
  state.composerDrafts.delete(state.selectedThreadId);
  state.composerImages.delete(state.selectedThreadId);
  renderComposerImages();
  elements.composerText.focus();
  updateComposer();
});
elements.annotationClear.addEventListener("click", () => clearAnnotations());

function setSidebarWidth(value) {
  const width = Math.max(180, Math.min(600, Math.round(Number(value) || 336)));
  document.documentElement.style.setProperty("--sidebar-w", `${width}px`);
  localStorage.setItem("codex-session.sidebarWidth", String(width));
  elements.resizer.setAttribute("aria-valuenow", String(width));
}

const savedSidebarWidth = Number(localStorage.getItem("codex-session.sidebarWidth"));
if (Number.isFinite(savedSidebarWidth) && savedSidebarWidth >= 180 && savedSidebarWidth <= 600) setSidebarWidth(savedSidebarWidth);
let resizingSidebar = false;
elements.resizer.addEventListener("pointerdown", (event) => {
  resizingSidebar = true;
  elements.resizer.classList.add("dragging");
  elements.resizer.setPointerCapture(event.pointerId);
});
elements.resizer.addEventListener("pointermove", (event) => {
  if (!resizingSidebar) return;
  setSidebarWidth(event.clientX);
});
elements.resizer.addEventListener("keydown", (event) => {
  const current = Number(elements.resizer.getAttribute("aria-valuenow")) || 336;
  const widths = {
    ArrowLeft: current - 10,
    ArrowRight: current + 10,
    Home: 180,
    End: 600,
  };
  if (!Object.hasOwn(widths, event.key)) return;
  event.preventDefault();
  setSidebarWidth(widths[event.key]);
});
elements.resizer.addEventListener("pointerup", () => {
  resizingSidebar = false;
  elements.resizer.classList.remove("dragging");
});

let conversationRailScrollFrame = null;
elements.timeline.addEventListener("scroll", () => {
  if (elements.timeline.scrollTop < 100 && state.olderCursor && !state.loadingOlder) void loadOlderTurns();
  removeAnnotationBubble();
  if (conversationRailScrollFrame) return;
  conversationRailScrollFrame = requestAnimationFrame(() => {
    conversationRailScrollFrame = null;
    syncConversationRailActive();
  });
}, { passive: true });
elements.timeline.addEventListener("mouseup", () => setTimeout(handleAnnotationSelection, 10));
elements.timeline.addEventListener("touchend", () => setTimeout(handleAnnotationSelection, 10));
document.addEventListener("mousedown", (event) => {
  if (annotationState.bubble && !annotationState.bubble.contains(event.target)) removeAnnotationBubble();
  if (annotationState.popup && !annotationState.popup.contains(event.target) && !event.target.closest(".ann-mark") && !event.target.closest(".ann-badge")) {
    closeAnnotationPopup();
  }
  if (state.modelMenuOpen && !event.target.closest(".model-badge-wrap")) closeComposerModelMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.modelMenuOpen) {
    event.preventDefault();
    closeComposerModelMenu({ focus: true });
  }
});
elements.composerText.addEventListener("input", updateComposer);
elements.composerText.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!elements.send.disabled) void sendMessage();
  }
});
elements.send.addEventListener("click", () => void sendMessage());
elements.composerRestart.addEventListener("click", () => void restartAppServer());
elements.composerCompact.addEventListener("click", () => void startCompaction());
elements.composerModelToggle.addEventListener("click", () => {
  if (state.modelMenuOpen) closeComposerModelMenu();
  else void openComposerModelMenu();
});
elements.composerModeToggle.addEventListener("click", () => {
  if (elements.composerModeToggle.disabled || !state.selectedThreadId) return;
  state.composerModes.set(state.selectedThreadId, composerMode() === "plan" ? "default" : "plan");
  renderComposerMode();
});
elements.activateThread.addEventListener("click", () => void activateThread());
elements.interrupt.addEventListener("click", () => void interruptTurn());
elements.mobileToggle.addEventListener("click", () => {
  const open = !document.body.classList.contains("nav-open");
  document.body.classList.toggle("nav-open", open);
  elements.mobileToggle.setAttribute("aria-expanded", String(open));
  elements.scrim.hidden = !open;
});
elements.scrim.addEventListener("click", closeMobileNav);

localizeStaticDom();
connectEvents();
const initialProjects = loadProjects();
void Promise.all([
  loadHealth(),
  loadModels(),
  initialProjects,
  api("/api/requests").then((payload) => {
    for (const request of listFrom(payload, "requests")) {
      state.pendingRequests.set(request.requestId, request);
      syncRequestFlags(request.threadId);
    }
    renderSidebar();
    renderHeader();
    renderRequests();
    updateComposer();
  }).catch(() => {}),
]).then(async () => {
  state.initialSyncComplete = true;
  await restoreAfterRestart();
  await openCollectionSourceFromQuery();
});


export { changeLocale, updateLocaleSwitcher };


elements.localeSwitcher?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-locale]");
  if (button) changeLocale(button.dataset.locale);
});
updateLocaleSwitcher();
document.documentElement.lang = getLocale();
