export function installRequests(context) {
  const {
    state, elements, unreadThreadIds, resentMessageKeys, annotationState,
    TRUTH_ICON, COPY_ICON, EDIT_ICON, ARCHIVE_ICON, DELETE_ICON, CLOSE_ICON,
    UNREAD_STORAGE_KEY, RESENT_MESSAGES_STORAGE_KEY, RESTART_STATE_KEY,
    ANNOTATION_STORAGE_PREFIX, COLLECT_VIEWER_ORIGIN, ANNOTATION_BLOCK_SELECTOR,
    IMAGE_TYPES, MAX_IMAGE_COUNT, MAX_IMAGE_BYTES, MAX_TOTAL_IMAGE_BYTES,
    TOOL_OUTPUT_HEAD_LIMIT, TOOL_OUTPUT_TAIL_LIMIT, TOOL_TRUNCATION_NOTICE,
    REASONING_EFFORTS, TERMINAL_TURN_STATUSES, isLoadedSessionStatus,
    normalizeSessionStatus, commandPresentation, storedArray,
  } = context;
  const { actions, t } = context;
  const runtimeFor = (...args) => actions.runtimeFor(...args);
  const el = (...args) => actions.el(...args);
  const toast = (...args) => actions.toast(...args);
  const sessionTitle = (...args) => actions.sessionTitle(...args);
  const formatTime = (...args) => actions.formatTime(...args);
  const selectThread = (...args) => actions.selectThread(...args);
  const pretty = (...args) => actions.pretty(...args);
  const resolveRequest = (...args) => actions.resolveRequest(...args);

function supportedFormSchema(schema) {
  if (!schema || schema.type !== "object" || !schema.properties || typeof schema.properties !== "object") return false;
  return Object.values(schema.properties).every((field) => {
    const type = field?.type;
    return type === "string" || type === "number" || type === "integer" || type === "boolean";
  });
}

function actionButton(text, className, handler) {
  const button = el("button", className, text);
  button.type = "button";
  button.addEventListener("click", handler);
  return button;
}

function renderRequestCard(request) {
  const card = el("article", "request-card");
  const params = request.params || {};
  const titles = {
    "item/commandExecution/requestApproval": t("requests.commandApproval"),
    "item/fileChange/requestApproval": t("requests.fileApproval"),
    "item/permissions/requestApproval": t("requests.permissionRequest"),
    "mcpServer/elicitation/request": t("requests.mcpRequest"),
  };
  if (request.method !== "item/tool/requestUserInput") {
    card.append(el("h3", "", titles[request.method] || request.method));
  }
  if (request.status === "responding") {
    card.append(el("p", "request-response-pending", t("requests.responsePending")));
    return card;
  }
  if (params.reason) card.append(el("p", "", params.reason));
  if (params.command) card.append(el("pre", "", `${params.kind === "writeStdin" ? t("requests.writeToProcess") : "$"} ${params.command}${params.cwd ? `\n${params.cwd}` : ""}`));
  if (request.method === "item/commandExecution/requestApproval") {
    const sensitiveContext = {
      kind: params.kind || "command",
      networkApprovalContext: params.networkApprovalContext,
      additionalPermissions: params.additionalPermissions,
      proposedExecpolicyAmendment: params.proposedExecpolicyAmendment,
      proposedNetworkPolicyAmendments: params.proposedNetworkPolicyAmendments,
    };
    if (Object.values(sensitiveContext).some((value) => value != null)) card.append(el("pre", "", pretty(sensitiveContext)));
  }
  if (request.method === "item/fileChange/requestApproval") card.append(el("pre", "", pretty({ grantRoot: params.grantRoot })));
  const actions = el("div", "request-actions");

  if (request.method === "item/commandExecution/requestApproval") {
    const decisionLabels = {
      accept: t("requests.allowOnce"),
      acceptForSession: t("requests.allowForSession"),
      decline: t("actions.decline"),
      cancel: t("actions.cancel"),
    };
    const decisions = Array.isArray(params.availableDecisions)
      ? params.availableDecisions
      : ["decline", "accept", "acceptForSession", "cancel"];
    for (const decision of decisions) {
      const key = typeof decision === "string" ? decision : Object.keys(decision || {})[0];
      const label = decisionLabels[key] || (key === "acceptWithExecpolicyAmendment" ? t("requests.acceptRuleAmendment") : key === "applyNetworkPolicyAmendment" ? t("requests.applyNetworkPolicy") : t("requests.approve"));
      const className = key === "decline" || key === "cancel" ? "danger" : key === "accept" ? "primary" : "";
      actions.append(actionButton(label, className, () => void resolveRequest(request.requestId, { decision })));
    }
  } else if (request.method === "item/fileChange/requestApproval") {
    actions.append(
      actionButton(t("actions.cancel"), "danger", () => void resolveRequest(request.requestId, { decision: "cancel" })),
      actionButton(t("actions.decline"), "danger", () => void resolveRequest(request.requestId, { decision: "decline" })),
      actionButton(t("requests.allowOnce"), "primary", () => void resolveRequest(request.requestId, { decision: "accept" })),
      actionButton(t("requests.allowForSession"), "", () => void resolveRequest(request.requestId, { decision: "acceptForSession" }))
    );
  } else if (request.method === "item/permissions/requestApproval") {
    const requestedPermissions = params.permissions || {};
    const permissionFields = el("fieldset", "request-question permission-selection");
    permissionFields.append(el("legend", "", t("requests.selectPermissions")));
    const choices = new Map();
    for (const [name, value] of Object.entries(requestedPermissions)) {
      if (value == null) continue;
      const label = el("label", "request-choice");
      const input = el("input");
      input.type = "checkbox";
      input.checked = true;
      label.append(input, el("span", "", name));
      const detail = el("pre", "", pretty(value));
      label.append(detail);
      permissionFields.append(label);
      choices.set(name, { input, value });
    }
    card.append(permissionFields);
    const selectedPermissions = () => Object.fromEntries(
      [...choices].filter(([, { input }]) => input.checked).map(([name, { value }]) => [name, value])
    );
    actions.append(
      actionButton(t("actions.decline"), "danger", () => void resolveRequest(request.requestId, { scope: "turn", permissions: {} })),
      actionButton(t("requests.allowThisTurn"), "primary", () => void resolveRequest(request.requestId, { scope: "turn", permissions: selectedPermissions() })),
      actionButton(t("requests.allowForSession"), "", () => void resolveRequest(request.requestId, { scope: "session", permissions: selectedPermissions() }))
    );
  } else if (request.method === "item/tool/requestUserInput") {
    card.classList.add("request-user-input");
    const fields = el("div", "request-fields");
    const inputs = new Map();
    for (const question of params.questions || []) {
      const field = el("fieldset", "request-question");
      const prompt = question.question || question.header || question.id;
      field.append(el("legend", "request-question-prompt", prompt));
      const optionInputs = [];
      let freeInput = null;
      let otherInput = null;
      let otherControl = null;
      const options = Array.isArray(question.options) ? question.options : [];

      if (options.length) {
        const optionList = el("div", "request-options");
        const inputType = question.multiSelect ? "checkbox" : "radio";
        const inputName = `request-${request.requestId}-${question.id}`;
        options.forEach((option, index) => {
          const label = el("label", "request-option");
          const input = el("input");
          input.type = inputType;
          input.name = inputName;
          input.value = option.label;
          if (!question.multiSelect && index === 0) input.checked = true;
          const copy = el("span", "request-option-copy");
          copy.append(el("strong", "request-option-label", option.label));
          if (option.description) copy.append(el("small", "request-option-description", option.description));
          label.append(input, copy);
          optionList.append(label);
          optionInputs.push({ input, value: option.label, custom: false });
        });

        if (question.isOther) {
          const label = el("label", "request-option request-option-other");
          otherControl = el("input");
          otherControl.type = inputType;
          otherControl.name = inputName;
          const copy = el("span", "request-option-copy");
          copy.append(
            el("strong", "request-option-label", t("requests.otherAnswer")),
            el("small", "request-option-description", t("requests.enterOtherAnswer"))
          );
          label.append(otherControl, copy);
          optionList.append(label);
          optionInputs.push({ input: otherControl, value: "", custom: true });

          otherInput = el("input", "request-other-input");
          otherInput.type = question.isSecret ? "password" : "text";
          otherInput.autocomplete = "off";
          otherInput.placeholder = t("requests.enterOtherAnswer");
          otherInput.hidden = true;
          const syncOtherInput = () => {
            otherInput.hidden = !otherControl.checked;
            if (!otherInput.hidden) requestAnimationFrame(() => otherInput.focus());
          };
          for (const entry of optionInputs) entry.input.addEventListener("change", syncOtherInput);
          optionList.append(otherInput);
        }
        field.append(optionList);
      } else {
        freeInput = el("input", "request-free-input");
        freeInput.type = question.isSecret ? "password" : "text";
        freeInput.autocomplete = "off";
        freeInput.placeholder = t("requests.enterAnswer");
        field.append(freeInput);
      }
      fields.append(field);
      inputs.set(question.id, {
        prompt,
        optionInputs,
        freeInput,
        otherInput,
        multiSelect: Boolean(question.multiSelect),
      });
    }
    card.append(fields);
    actions.append(actionButton(t("actions.submit"), "primary", () => {
      const answers = {};
      for (const [id, entry] of inputs) {
        const selectedOther = entry.optionInputs.some(({ input, custom }) => custom && input.checked);
        if (selectedOther && !entry.otherInput?.value.trim()) {
          toast(t("errors.fillOtherAnswer", { prompt: entry.prompt }), "error");
          entry.otherInput?.focus();
          return;
        }
        const values = entry.freeInput
          ? [entry.freeInput.value.trim()].filter(Boolean)
          : entry.optionInputs
            .filter(({ input }) => input.checked)
            .map(({ value, custom }) => custom ? entry.otherInput?.value.trim() || "" : value)
            .filter(Boolean);
        if (!values.length) {
          toast(t("errors.answerPrompt", { prompt: entry.prompt }), "error");
          return;
        }
        answers[id] = { answers: entry.multiSelect ? values : [values[0]] };
      }
      void resolveRequest(request.requestId, { answers });
    }));
  } else if (request.method === "mcpServer/elicitation/request") {
    card.append(el("p", "", params.message || t("requests.serverRequest", { server: params.serverName || "MCP" })));
    const fields = el("div", "request-fields");
    const inputs = new Map();
    const formSupported = supportedFormSchema(params.requestedSchema);
    const properties = formSupported ? params.requestedSchema.properties : {};
    const required = new Set(params.requestedSchema?.required || []);
    for (const [name, schema] of Object.entries(properties)) {
      const label = el("label");
      label.append(el("span", "", `${schema.title || name}${required.has(name) ? " *" : ""}`));
      let input;
      if (Array.isArray(schema.enum)) {
        input = el("select");
        if (!required.has(name)) {
          const empty = el("option", "", t("requests.leaveEmpty"));
          empty.value = "";
          input.append(empty);
        }
        for (const value of schema.enum) {
          const option = el("option", "", String(value));
          option.value = String(value);
          input.append(option);
        }
      } else {
        input = el("input");
        input.type = schema.type === "number" || schema.type === "integer" ? "number" : schema.type === "boolean" ? "checkbox" : "text";
        if (schema.minLength != null) input.minLength = schema.minLength;
        if (schema.maxLength != null) input.maxLength = schema.maxLength;
        if (schema.minimum != null) input.min = schema.minimum;
        if (schema.maximum != null) input.max = schema.maximum;
        input.required = required.has(name);
      }
      if (schema.default !== undefined) {
        if (schema.type === "boolean") input.checked = Boolean(schema.default);
        else input.value = String(schema.default);
      }
      if (schema.description) label.append(el("small", "request-field-description", schema.description));
      label.append(input);
      fields.append(label);
      inputs.set(name, { input, schema, required: required.has(name) });
    }
    if (params.mode !== "url" && !formSupported) {
      fields.append(el("p", "nav-message error", t("errors.unsupportedFormField")));
    }
    if (params.mode === "url" && typeof params.url === "string") {
      try {
        const url = new URL(params.url);
        if (url.protocol === "https:" || url.protocol === "http:") {
          const link = el("a", "", t("requests.openAuthorizationPage"));
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          card.append(link);
        }
      } catch {}
    }
    card.append(fields);
    actions.append(actionButton(t("actions.cancel"), "danger", () => void resolveRequest(request.requestId, { action: "cancel" })));
    actions.append(actionButton(t("actions.decline"), "", () => void resolveRequest(request.requestId, { action: "decline" })));
    if (params.mode === "url") {
      actions.append(actionButton(t("requests.authorizationComplete"), "primary", () => void resolveRequest(request.requestId, { action: "accept" })));
    } else if (formSupported) {
      actions.append(actionButton(t("actions.accept"), "primary", () => {
        const content = {};
        for (const [name, { input, schema, required: fieldRequired }] of inputs) {
          if (schema.type !== "boolean" && input.value === "" && !fieldRequired) continue;
          if (schema.type !== "boolean" && input.value === "") {
            toast(t("errors.fillField", { name }), "error");
            return;
          }
          if (schema.type === "boolean") content[name] = input.checked;
          else if (schema.type === "number" || schema.type === "integer") content[name] = Number(input.value);
          else if (Array.isArray(schema.enum)) {
            content[name] = schema.enum.find((value) => String(value) === input.value);
          } else content[name] = input.value;
        }
        void resolveRequest(request.requestId, { action: "accept", content });
      }));
    }
  }
  card.append(actions);
  return card;
}

function syncRequestFlags(threadId) {
  const runtime = runtimeFor(threadId);
  if (!runtime) return;
  const requests = [...state.pendingRequests.values()].filter((request) => request.threadId === threadId);
  runtime.requestFlags.clear();
  if (requests.some((request) => request.method?.includes("requestApproval"))) runtime.requestFlags.add("approval");
  if (requests.some((request) => request.method?.includes("requestUserInput") || request.method?.includes("elicitation"))) runtime.requestFlags.add("input");
}

function requestTitle(request) {
  const labels = {
    "item/commandExecution/requestApproval": t("requests.commandApproval"),
    "item/fileChange/requestApproval": t("requests.fileApproval"),
    "item/permissions/requestApproval": t("requests.permissionRequest"),
    "item/tool/requestUserInput": t("status.waitingForInput"),
    "mcpServer/elicitation/request": t("requests.mcpInput"),
  };
  return labels[request.method] || request.method || t("requests.unknownRequest");
}

function renderGlobalRequests() {
  const pending = [...state.pendingRequests.values()];
  if (!pending.length) {
    state.requestPanelOpen = false;
    elements.globalRequestsToggle.hidden = true;
    elements.globalRequestsCount.hidden = true;
    elements.globalRequestsPanel.hidden = true;
    elements.globalRequestsPanel.replaceChildren();
    return;
  }
  elements.globalRequestsToggle.hidden = false;
  elements.globalRequestsCount.textContent = String(pending.length);
  elements.globalRequestsCount.hidden = false;
  elements.globalRequestsToggle.setAttribute("aria-expanded", String(state.requestPanelOpen));
  elements.globalRequestsPanel.hidden = !state.requestPanelOpen;
  if (!state.requestPanelOpen) return;
  const content = [];
  const groups = new Map();
  for (const request of pending) {
    const entries = groups.get(request.threadId) || [];
    entries.push(request);
    groups.set(request.threadId, entries);
  }
  for (const [threadId, requests] of groups) {
    const session = state.sessions.get(threadId);
    const project = state.projects.find((entry) => entry.id === session?.projectId);
    const group = el("section", "global-request-group");
    group.append(el("h3", "", session ? sessionTitle(session) : t("requests.threadLabel", { id: String(threadId || t("common.unknown")).slice(0, 12) })), el("p", "", project?.name || session?.cwd || t("common.unknownWorkspace")));
    for (const request of requests) {
      const danger = request.status === "responding"
        ? t("requests.waitingForCodex")
        : request.method?.includes("Approval") || request.method?.includes("permissions") ? t("requests.highRiskConfirmation") : t("requests.inputRequired");
      const button = el("button", "global-request-item");
      button.type = "button";
      button.append(
        el("strong", "", requestTitle(request)),
        el("span", "request-risk", danger),
        el("time", "", formatTime(request.receivedAt)),
      );
      button.addEventListener("click", async () => {
        state.requestPanelOpen = false;
        renderGlobalRequests();
        if (request.threadId) await selectThread(request.threadId);
        const target = request.itemId ? elements.timeline.querySelector(`[data-item-id="${CSS.escape(request.itemId)}"]`) : null;
        (target || elements.requestDock).scrollIntoView({ block: "center" });
      });
      group.append(button);
    }
    content.push(group);
  }
  elements.globalRequestsPanel.replaceChildren(...content);
}

function renderRequests() {
  const relevant = [...state.pendingRequests.values()].filter((request) => request.threadId === state.selectedThreadId);
  elements.requestDock.hidden = relevant.length === 0;
  elements.requestDock.replaceChildren(...relevant.map(renderRequestCard));
  renderGlobalRequests();
}

  Object.assign(actions, {
    supportedFormSchema,
    actionButton,
    renderRequestCard,
    syncRequestFlags,
    requestTitle,
    renderGlobalRequests,
    renderRequests
  });
}
