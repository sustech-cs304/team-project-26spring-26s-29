import { escapeHtml } from "../shared/html.js";
import { renderMarkdown, renderPlainText } from "../shared/markdown.js";

const MESSAGE_PREVIEW_MAX_LENGTH = 180;
const MESSAGE_COLLAPSE_THRESHOLD = 140;
const BOTTOM_SCROLL_THRESHOLD = 80;
const PROMPT_MAX_HEIGHT = 220;
const TOOL_DETAIL_MAX_LENGTH = 160;
const FILE_TILE_TEXT_MAX_LENGTH = 76;
const ALWAYS_APPROVE_STORAGE_KEY = "chat.alwaysApproveTools";
const READY_MOTD_TRIGGER_PROMPT = "[[APP_MOTD_ON_READY]]";

function createChatController({
  prompt,
  send,
  status,
  messages,
  scrollToBottomButton,
  attachmentButton,
  attachments,
  alwaysApproveToolsButton,
  interruptRunButton,
  previewModal,
  previewModalBody,
  previewModalClose,
  previewModalCopy,
  previewModalLabel,
  previewModalMeta,
  previewModalSave,
  previewModalTitle,
}) {
  let isRunning = false;
  let activeRequestId = null;
  let activeAssistantMessage = null;
  let shouldAutoScroll = true;
  const messageModels = new Map();
  const localPreviewCache = new Map();
  let stagedAttachments = [];
  let draftRequestId = crypto.randomUUID();
  let previewState = null;
  let alwaysApproveTools = (() => {
    try {
      return window.localStorage.getItem(ALWAYS_APPROVE_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  })();
  let lastReadyState = false;
  let readyMotdInFlight = false;
  const approvalRequestsInFlight = new Set();

  function cloneData(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isNearBottom() {
    if (!messages) {
      return true;
    }

    const distance = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
    return distance < BOTTOM_SCROLL_THRESHOLD;
  }

  function updateScrollButtonVisibility() {
    if (!scrollToBottomButton || !messages) {
      return;
    }

    scrollToBottomButton.hidden = isNearBottom();
  }

  function scrollMessagesToBottom(force = false) {
    if (!messages) {
      return;
    }

    if (!force && !shouldAutoScroll) {
      updateScrollButtonVisibility();
      return;
    }

    messages.scrollTop = messages.scrollHeight;
    shouldAutoScroll = true;
    updateScrollButtonVisibility();
  }

  function createMessageElement(role, messageId) {
    const article = document.createElement("article");
    article.className = `message message--${role}`;
    article.dataset.messageId = messageId;

    const meta = document.createElement("div");
    meta.className = "message__meta";
    meta.textContent = role === "user" ? "You" : "Assistant";

    const bubble = document.createElement("div");
    bubble.className = "message__bubble";

    const content = document.createElement("div");
    content.className = "message__content";

    bubble.append(content);
    article.append(meta, bubble);
    return { article, content };
  }

  function truncateText(text, maxLength = MESSAGE_PREVIEW_MAX_LENGTH) {
    const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength).trimEnd()}...`;
  }

  function normalizeMessage(message, fallbackRole = "assistant") {
    return {
      role: message?.role || fallbackRole,
      status: message?.status || "completed",
      contents: Array.isArray(message?.contents) ? cloneData(message.contents) : [],
    };
  }

  function buildDataUri(part) {
    if (part?.dataBase64 && part?.mediaType) {
      return `data:${part.mediaType};base64,${part.dataBase64}`;
    }
    return part?.uri || "";
  }

  function formatBytes(sizeBytes) {
    const size = Number(sizeBytes || 0);
    if (!size) {
      return "";
    }
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function isTextLikeMediaType(mediaType) {
    const normalized = String(mediaType || "").toLowerCase();
    return (
      normalized.startsWith("text/") ||
      normalized.includes("json") ||
      normalized.includes("xml") ||
      normalized.includes("yaml") ||
      normalized.includes("javascript") ||
      normalized.includes("typescript")
    );
  }

  function getPreviewKind(part) {
    if (part?.type === "image") {
      return "image";
    }

    const mediaType = String(part?.mediaType || "").toLowerCase();
    if (mediaType.startsWith("image/")) {
      return "image";
    }
    if (mediaType === "application/pdf") {
      return "pdf";
    }
    if (mediaType.startsWith("audio/")) {
      return "audio";
    }
    if (mediaType.startsWith("video/")) {
      return "video";
    }
    if (part?.summaryText || isTextLikeMediaType(mediaType)) {
      return "text";
    }
    return "file";
  }

  function getPreviewBadge(kind) {
    switch (kind) {
      case "pdf":
        return "PDF";
      case "audio":
        return "AUDIO";
      case "video":
        return "VIDEO";
      case "text":
        return "TEXT";
      default:
        return "FILE";
    }
  }

  function renderInlinePreview(part) {
    const kind = getPreviewKind(part);
    const src = buildDataUri(part);

    if (kind === "image" && src) {
      return `<img class="message__image message__image--thumb" src="${escapeHtml(src)}" alt="${escapeHtml(part.name || "image")}" />`;
    }

    if (kind === "text") {
      return `
        <div class="message__filethumb message__filethumb--text">
          <span class="message__filethumb-badge">${escapeHtml(getPreviewBadge(kind))}</span>
          <p class="message__filethumb-copy">${escapeHtml(truncateText(part.summaryText || "Open preview", FILE_TILE_TEXT_MAX_LENGTH))}</p>
        </div>
      `;
    }

    return `
      <div class="message__filethumb">
        <span class="message__filethumb-badge">${escapeHtml(getPreviewBadge(kind))}</span>
      </div>
    `;
  }

  function attachUserMessageToggle(article, contentNode, contents) {
    if (contents.some((part) => part.type === "image" || part.type === "file")) {
      return;
    }

    const normalized = contents
      .filter((part) => part.type === "text")
      .map((part) => String(part.text || ""))
      .join("\n")
      .trim();
    const shouldCollapse =
      normalized.length > MESSAGE_COLLAPSE_THRESHOLD || normalized.includes("\n");

    if (!shouldCollapse) {
      return;
    }

    article.classList.add("message--collapsible", "is-collapsed");

    const bubble = contentNode.parentElement;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "message__toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Expand message");
    toggle.innerHTML = '<span class="message__toggle-icon" aria-hidden="true">▾</span>';

    const preview = document.createElement("div");
    preview.className = "message__preview";
    preview.textContent = truncateText(normalized);

    bubble.insertBefore(toggle, contentNode);
    bubble.insertBefore(preview, contentNode);

    toggle.addEventListener("click", () => {
      const nextExpanded = article.classList.contains("is-collapsed");
      article.classList.toggle("is-collapsed", !nextExpanded);
      article.classList.toggle("is-expanded", nextExpanded);
      toggle.setAttribute("aria-expanded", String(nextExpanded));
      toggle.setAttribute("aria-label", nextExpanded ? "Collapse message" : "Expand message");
    });
  }

  function renderMediaTile(part, context, ref, label = null) {
    const meta = [formatBytes(part.sizeBytes), part.relativePath].filter(Boolean).join(" · ");
    return `
      <button
        class="message__media-tile"
        type="button"
        data-preview-ref="${escapeHtml(ref)}"
        data-message-id="${escapeHtml(context.messageId)}"
      >
        <div class="message__media-art">
          ${renderInlinePreview(part)}
        </div>
        <div class="message__media-copy">
          ${label ? `<p class="message__card-label">${escapeHtml(label)}</p>` : ""}
          <p class="message__filename">${escapeHtml(part.name || "attachment")}</p>
          ${meta ? `<p class="message__filemeta">${escapeHtml(meta)}</p>` : ""}
        </div>
      </button>
    `;
  }

  function renderUserContents(message, context) {
    const blocks = [];
    for (const [index, part] of message.contents.entries()) {
      if (part.type === "text") {
        blocks.push(renderPlainText(part.text || ""));
        continue;
      }
      if (part.type === "image" || part.type === "file") {
        blocks.push(renderMediaTile(part, context, String(index), part.type === "image" ? "Image" : "File"));
      }
    }
    return blocks.join("") || "<p></p>";
  }

  function stringifyArgumentValue(value) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string") {
      return truncateText(value, 64);
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (Array.isArray(value)) {
      return truncateText(value.join(", "), 64);
    }
    return truncateText(JSON.stringify(value), 64);
  }

  function summarizeToolArguments(part) {
    if (part?.arguments && typeof part.arguments === "object" && !Array.isArray(part.arguments)) {
      const summary = Object.entries(part.arguments)
        .slice(0, 2)
        .map(([key, value]) => {
          const rendered = stringifyArgumentValue(value);
          return rendered ? `${key}=${rendered}` : null;
        })
        .filter(Boolean)
        .join(" · ");
      if (summary) {
        return summary;
      }
    }

    return truncateText(part?.argumentsText || "No arguments", TOOL_DETAIL_MAX_LENGTH);
  }

  function renderToolLine({ label, tone = "neutral", title, detail }) {
    return `
      <div class="message__tool-line message__tool-line--${escapeHtml(tone)}">
        <span class="message__tool-line-head">
          <span class="message__tool-line-label">${escapeHtml(label)}</span>
          <span class="message__tool-line-title">${escapeHtml(title)}</span>
        </span>
        ${detail ? `<span class="message__tool-line-detail">${escapeHtml(detail)}</span>` : ""}
      </div>
    `;
  }

  function renderToolResult(part, context, ref) {
    const toolName = context.toolNames.get(part.callId) || "tool";
    const textItems = Array.isArray(part?.items)
      ? part.items.filter((item) => item.type === "text" && String(item.text || "").trim())
      : [];
    const detail = textItems.length
      ? truncateText(textItems[0].text, TOOL_DETAIL_MAX_LENGTH)
      : typeof part?.result === "string" && part.result.trim()
        ? truncateText(part.result, TOOL_DETAIL_MAX_LENGTH)
        : "Completed";
    const richItems = Array.isArray(part.items)
      ? part.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.type !== "text")
      : [];

    const line = renderToolLine({
      label: "Tool",
      tone: part.exception ? "error" : "neutral",
      title: toolName,
      detail: part.exception ? truncateText(part.exception, TOOL_DETAIL_MAX_LENGTH) : detail,
    });

    if (!richItems.length) {
      return line;
    }

    return `
      <div class="message__tool-stack">
        ${line}
        <div class="message__tool-rich">
          ${richItems
            .map(({ item, index }) => renderAssistantPart(item, context, `${ref}.items.${index}`))
            .join("")}
        </div>
      </div>
    `;
  }

  function renderApprovalCard(part, context) {
    const functionCall = part.functionCall || {};
    const decision = part.decision || "pending";
    const pending = decision === "pending";

    if (!pending) {
      const isApproved = decision === "approved";
      const isInterrupted = decision === "interrupted";
      return renderToolLine({
        label: isApproved ? "Approved" : isInterrupted ? "Interrupted" : "Rejected",
        tone: isApproved ? "approved" : isInterrupted ? "interrupted" : "rejected",
        title: functionCall.name || "Tool action",
        detail: summarizeToolArguments(functionCall),
      });
    }

    return `
      <div class="message__approval-card">
        <div class="message__approval-row">
          <span class="message__badge message__badge--pending">Approval needed</span>
          <span class="message__approval-name">${escapeHtml(functionCall.name || "Tool action")}</span>
        </div>
        <p class="message__approval-summary">${escapeHtml(summarizeToolArguments(functionCall))}</p>
        ${context.isActive ? `
          <div class="message__approval-actions">
            <button
              class="button"
              type="button"
              data-approval-action="approve"
              data-approval-id="${escapeHtml(part.approvalId || "")}"
            >
              Approve
            </button>
            <button
              class="button button--secondary"
              type="button"
              data-approval-action="reject"
              data-approval-id="${escapeHtml(part.approvalId || "")}"
            >
              Reject
            </button>
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderAssistantPart(part, context, ref) {
    if (part.type === "text") {
      return renderMarkdown(part.text || "");
    }
    if (part.type === "error") {
      return `
        <div class="message__card message__card--error">
          <p class="message__card-label">Error</p>
          <p>${escapeHtml(part.message || "Agent request failed.")}</p>
        </div>
      `;
    }
    if (part.type === "function_call") {
      return renderToolLine({
        label: "Tool",
        tone: "neutral",
        title: part.name || "tool",
        detail: summarizeToolArguments(part),
      });
    }
    if (part.type === "function_result") {
      return renderToolResult(part, context, ref);
    }
    if (part.type === "function_approval_request") {
      return renderApprovalCard(part, context);
    }
    if (part.type === "image" || part.type === "file") {
      return renderMediaTile(part, context, ref, null);
    }
    return `
      <pre class="message__card message__card--json">${escapeHtml(JSON.stringify(part.data || {}, null, 2))}</pre>
    `;
  }

  function renderAssistantContents(message, context) {
    if (!message.contents.length) {
      return '<p class="message__placeholder">Thinking...</p>';
    }

    const toolNames = new Map();
    const approvalCallIds = new Set();
    const resultCallIds = new Set();

    for (const part of message.contents) {
      if (part.type === "function_call" && part.callId) {
        toolNames.set(part.callId, part.name || "tool");
      }
      if (part.type === "function_result" && part.callId) {
        resultCallIds.add(part.callId);
      }
      if (part.type === "function_approval_request" && part.functionCall?.callId) {
        approvalCallIds.add(part.functionCall.callId);
        toolNames.set(part.functionCall.callId, part.functionCall.name || "tool");
      }
    }

    const nextContext = {
      ...context,
      toolNames,
    };

    return message.contents
      .map((part, index) => {
        if (
          part.type === "function_call" &&
          part.callId &&
          (approvalCallIds.has(part.callId) || resultCallIds.has(part.callId))
        ) {
          return "";
        }
        return renderAssistantPart(part, nextContext, `${index}`);
      })
      .join("");
  }

  function renderMessageContent(message, messageId, isActive = false) {
    const context = {
      isActive,
      messageId,
    };

    if (message.role === "user") {
      return renderUserContents(message, context);
    }

    return renderAssistantContents(message, context);
  }

  function appendMessage(message, { isActive = false } = {}) {
    if (!messages) {
      return null;
    }

    const normalizedMessage = normalizeMessage(message, message.role || "assistant");
    const messageId = crypto.randomUUID();
    const { article, content: contentNode } = createMessageElement(normalizedMessage.role, messageId);
    messageModels.set(messageId, normalizedMessage);
    contentNode.innerHTML = renderMessageContent(normalizedMessage, messageId, isActive);

    if (normalizedMessage.role === "user") {
      attachUserMessageToggle(article, contentNode, normalizedMessage.contents);
    }

    messages.append(article);
    scrollMessagesToBottom();
    return { article, contentNode, messageId, message: normalizedMessage };
  }

  function updateExistingMessage(target, nextMessage, { isActive = false } = {}) {
    if (!target) {
      return;
    }

    const normalizedMessage = normalizeMessage(nextMessage, target.message.role);
    target.message = normalizedMessage;
    messageModels.set(target.messageId, normalizedMessage);
    target.contentNode.innerHTML = renderMessageContent(normalizedMessage, target.messageId, isActive);
    scrollMessagesToBottom();
  }

  function updateAssistantMessage(message) {
    if (!activeAssistantMessage) {
      activeAssistantMessage = appendMessage(
        { role: "assistant", status: "running", contents: [] },
        { isActive: true }
      );
    }

    if (!activeAssistantMessage) {
      return;
    }

    updateExistingMessage(activeAssistantMessage, message, { isActive: true });
    maybeAutoApprovePendingRequests();
  }

  function renderAttachmentList() {
    if (!attachments) {
      return;
    }

    if (!stagedAttachments.length) {
      attachments.hidden = true;
      attachments.innerHTML = "";
      return;
    }

    attachments.hidden = false;
    attachments.innerHTML = stagedAttachments
      .map((attachment, index) => {
        const label = attachment.type === "image" ? "Image" : "File";
        const meta = [formatBytes(attachment.sizeBytes), attachment.relativePath].filter(Boolean).join(" · ");

        return `
          <div class="composer-attachment">
            <button
              class="composer-attachment__preview"
              type="button"
              data-composer-preview-index="${index}"
            >
              <div class="composer-attachment__art">
                ${renderInlinePreview(attachment)}
              </div>
              <div class="composer-attachment__main">
                <p class="composer-attachment__label">${escapeHtml(label)}</p>
                <p class="composer-attachment__name">${escapeHtml(attachment.name || label.toLowerCase())}</p>
                ${meta ? `<p class="composer-attachment__meta">${escapeHtml(meta)}</p>` : ""}
              </div>
            </button>
            <button
              class="composer-attachment__remove"
              type="button"
              aria-label="Remove attachment"
              data-remove-attachment="${index}"
            >
              ×
            </button>
          </div>
        `;
      })
      .join("");
  }

  function resizePromptToFit() {
    if (!prompt) {
      return;
    }

    prompt.style.height = "auto";
    prompt.style.height = `${Math.min(prompt.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
  }

  function syncAlwaysApproveToolsButton() {
    if (!alwaysApproveToolsButton) {
      return;
    }

    alwaysApproveToolsButton.setAttribute("aria-pressed", String(alwaysApproveTools));
    alwaysApproveToolsButton.classList.toggle("button--toggled", alwaysApproveTools);
    alwaysApproveToolsButton.textContent = alwaysApproveTools
      ? "Always Approve Tools: On"
      : "Always Approve Tools: Off";
  }

  function updateComposerAvailability(ready) {
    if (send) {
      send.disabled = isRunning || !ready;
    }
    if (attachmentButton) {
      attachmentButton.disabled = isRunning || !ready;
    }
    if (interruptRunButton) {
      interruptRunButton.disabled = !isRunning || !activeRequestId;
    }
  }

  async function refreshStatus() {
    const [{ ok }, config] = await Promise.all([
      window.agentAPI.health().catch(() => ({ ok: false })),
      window.configAPI.get().catch(() => null),
    ]);
    const ready = ok && Boolean(config?.openaiChatModel);
    const becameReady = ready && !lastReadyState;
    lastReadyState = ready;

    status.textContent = isRunning ? "running" : !ok ? "starting" : ready ? "ready" : "config needed";
    updateComposerAvailability(ready);

    if (becameReady) {
      void runReadyMotd();
    }
  }

  function ensureDraftRequestId() {
    if (!draftRequestId) {
      draftRequestId = crypto.randomUUID();
    }
    return draftRequestId;
  }

  async function pickAttachments() {
    if (!attachmentButton || attachmentButton.disabled) {
      return;
    }

    try {
      const picked = await window.agentAPI.pickAttachments({ requestId: ensureDraftRequestId() });
      if (!Array.isArray(picked) || !picked.length) {
        return;
      }
      stagedAttachments = [...stagedAttachments, ...picked.map((item) => cloneData(item))];
      renderAttachmentList();
      resizePromptToFit();
    } catch (error) {
      status.textContent = "attachment error";
      console.error(error);
    }
  }

  function clearComposer() {
    prompt.value = "";
    prompt.style.height = "auto";
    stagedAttachments = [];
    draftRequestId = crypto.randomUUID();
    renderAttachmentList();
  }

  async function runAgent(
    contents,
    {
      showUserMessage = true,
      clearComposerOnStart = true,
      requestId = null,
    } = {}
  ) {
    if (!Array.isArray(contents) || !contents.length || isRunning) {
      return;
    }

    const nextRequestId = requestId
      || (showUserMessage && stagedAttachments.length ? ensureDraftRequestId() : crypto.randomUUID());
    approvalRequestsInFlight.clear();
    isRunning = true;
    activeRequestId = nextRequestId;
    activeAssistantMessage = null;
    shouldAutoScroll = true;
    status.textContent = "running";
    updateComposerAvailability(true);

    if (showUserMessage) {
      appendMessage({
        role: "user",
        status: "completed",
        contents: cloneData(contents),
      });
    }
    activeAssistantMessage = appendMessage(
      { role: "assistant", status: "running", contents: [] },
      { isActive: true }
    );
    if (clearComposerOnStart) {
      clearComposer();
    }

    try {
      const result = await window.agentAPI.runPrompt({ requestId: nextRequestId, contents });
      if (activeRequestId === nextRequestId && result?.message) {
        updateAssistantMessage(result.message);
      }
      status.textContent = "ready";
    } catch (error) {
      const errorText = error?.message || String(error);
      if (errorText === "Agent run interrupted.") {
        updateAssistantMessage(buildInterruptedMessage(activeAssistantMessage?.message));
        status.textContent = "interrupted";
      } else {
        updateAssistantMessage({
          role: "assistant",
          status: "error",
          contents: [{ type: "error", message: errorText }],
        });
        status.textContent = "error";
      }
    } finally {
      approvalRequestsInFlight.clear();
      isRunning = false;
      activeRequestId = null;
    }

    await refreshStatus();
  }

  async function run() {
    const text = prompt.value.trim();
    const contents = stagedAttachments.map((attachment) => cloneData(attachment));
    if (text) {
      contents.push({ type: "text", text });
    }
    if (!contents.length || send.disabled) {
      return;
    }

    await runAgent(contents, {
      showUserMessage: true,
      clearComposerOnStart: true,
    });
  }

  async function runReadyMotd() {
    if (readyMotdInFlight || isRunning) {
      return;
    }

    readyMotdInFlight = true;
    try {
      await runAgent(
        [{ type: "text", text: READY_MOTD_TRIGGER_PROMPT }],
        {
          showUserMessage: false,
          clearComposerOnStart: false,
          requestId: crypto.randomUUID(),
        }
      );
    } finally {
      readyMotdInFlight = false;
    }
  }

  async function interruptRun() {
    if (!isRunning || !activeRequestId || !interruptRunButton || interruptRunButton.disabled) {
      return;
    }

    interruptRunButton.disabled = true;
    status.textContent = "interrupting";

    try {
      await window.agentAPI.interruptRun({ requestId: activeRequestId });
    } catch (error) {
      status.textContent = "error";
      console.error(error);
      updateComposerAvailability(true);
    }
  }

  function applyLocalApprovalDecision(message, approvalId, decision) {
    if (!message || !Array.isArray(message.contents)) {
      return message;
    }

    const nextMessage = cloneData(message);
    for (const part of nextMessage.contents) {
      if (part.type === "function_approval_request" && part.approvalId === approvalId) {
        part.decision = decision;
      }
    }
    return nextMessage;
  }

  function buildInterruptedMessage(message) {
    const nextMessage = normalizeMessage(message || { role: "assistant", contents: [] }, "assistant");
    nextMessage.status = "interrupted";

    let hasInterruptionNote = false;
    for (const part of nextMessage.contents) {
      if (
        part.type === "function_approval_request" &&
        (part.decision || "pending") === "pending"
      ) {
        part.decision = "interrupted";
      }
      if (part.type === "text" && String(part.text || "").trim() === "_Run interrupted._") {
        hasInterruptionNote = true;
      }
    }

    if (!hasInterruptionNote) {
      nextMessage.contents.push({ type: "text", text: "_Run interrupted._" });
    }

    return nextMessage;
  }

  async function submitApprovalDecision(approvalId, approved) {
    if (
      !approvalId ||
      !activeAssistantMessage ||
      !activeRequestId ||
      approvalRequestsInFlight.has(approvalId)
    ) {
      return;
    }

    const localDecision = approved ? "approved" : "rejected";
    const optimisticMessage = applyLocalApprovalDecision(
      activeAssistantMessage.message,
      approvalId,
      localDecision
    );
    updateExistingMessage(activeAssistantMessage, optimisticMessage, { isActive: true });
    approvalRequestsInFlight.add(approvalId);

    try {
      await window.agentAPI.respondApproval({
        requestId: activeRequestId,
        approvalId,
        approved,
      });
    } catch (error) {
      const revertedMessage = applyLocalApprovalDecision(
        activeAssistantMessage.message,
        approvalId,
        "pending"
      );
      updateExistingMessage(activeAssistantMessage, revertedMessage, { isActive: true });
      status.textContent = "error";
      console.error(error);
    } finally {
      approvalRequestsInFlight.delete(approvalId);
    }
  }

  function maybeAutoApprovePendingRequests() {
    if (!alwaysApproveTools || !isRunning || !activeAssistantMessage || !activeRequestId) {
      return;
    }

    const pendingApprovalId = activeAssistantMessage.message?.contents
      ?.filter(
        (part) =>
          part.type === "function_approval_request" &&
          part.approvalId &&
          (part.decision || "pending") === "pending"
      )
      .map((part) => part.approvalId)
      .find(
      (approvalId) => !approvalRequestsInFlight.has(approvalId)
      );
    if (!pendingApprovalId) {
      return;
    }

    void submitApprovalDecision(pendingApprovalId, true);
  }

  async function resolvePreviewPayload(part) {
    const cacheKey = JSON.stringify({
      name: part?.name,
      relativePath: part?.relativePath,
      mediaType: part?.mediaType,
      uri: part?.uri,
      dataBase64: part?.dataBase64 ? "inline" : "",
      summaryText: part?.summaryText || "",
    });

    if (localPreviewCache.has(cacheKey)) {
      return localPreviewCache.get(cacheKey);
    }

    const src = buildDataUri(part);
    const kind = getPreviewKind(part);
    const directPreview = kind === "text" && part?.summaryText
      ? {
        kind: "text",
        name: part.name,
        mediaType: part.mediaType,
        relativePath: part.relativePath,
        text: part.summaryText,
        truncated: false,
      }
      : src && ["image", "pdf", "audio", "video"].includes(kind)
        ? {
          kind,
          name: part.name,
          mediaType: part.mediaType,
          relativePath: part.relativePath,
          dataBase64: part.dataBase64 || null,
          src,
          sizeBytes: part.sizeBytes,
        }
        : null;
    if (directPreview) {
      localPreviewCache.set(cacheKey, directPreview);
      return directPreview;
    }

    if (part?.relativePath) {
      const loadedPreview = await window.agentAPI.loadPreview({
        relativePath: part.relativePath,
        mediaType: part.mediaType,
      });
      localPreviewCache.set(cacheKey, loadedPreview);
      return loadedPreview;
    }

    const fallback = {
      kind: "file",
      name: part?.name || "attachment",
      mediaType: part?.mediaType,
      relativePath: part?.relativePath,
      message: "Preview unavailable for this attachment.",
    };
    localPreviewCache.set(cacheKey, fallback);
    return fallback;
  }

  function buildPreviewBody(payload, part) {
    const src =
      payload?.src ||
      (payload?.dataBase64 && payload?.mediaType
        ? `data:${payload.mediaType};base64,${payload.dataBase64}`
        : buildDataUri(part));

    switch (payload?.kind) {
      case "image":
        return `<img class="preview-modal__image" src="${escapeHtml(src)}" alt="${escapeHtml(payload?.name || part?.name || "Preview image")}" />`;
      case "pdf":
        return `<iframe class="preview-modal__frame" src="${escapeHtml(src)}" title="${escapeHtml(payload?.name || part?.name || "PDF preview")}"></iframe>`;
      case "audio":
        return `<audio class="preview-modal__media" controls src="${escapeHtml(src)}"></audio>`;
      case "video":
        return `<video class="preview-modal__media" controls src="${escapeHtml(src)}"></video>`;
      case "text":
        return `
          <div class="preview-modal__text-wrap">
            <pre class="preview-modal__text">${escapeHtml(payload.text || "(empty file)")}</pre>
            ${payload.truncated ? '<p class="preview-modal__hint">Preview truncated for readability.</p>' : ""}
          </div>
        `;
      default:
        return `
          <div class="preview-modal__empty">
            <p>${escapeHtml(payload?.message || "Preview unavailable.")}</p>
          </div>
        `;
    }
  }

  function closePreviewModal() {
    previewState = null;
    if (!previewModal || !previewModalBody || !previewModalSave || !previewModalCopy) {
      return;
    }

    previewModal.hidden = true;
    previewModalBody.innerHTML = "";
    previewModalSave.hidden = true;
    previewModalCopy.hidden = true;
  }

  async function openPreview(part) {
    if (
      !previewModal ||
      !previewModalBody ||
      !previewModalCopy ||
      !previewModalSave ||
      !previewModalTitle ||
      !previewModalMeta ||
      !previewModalLabel
    ) {
      return;
    }

    previewState = {
      outputPart: null,
    };
    previewModal.hidden = false;
    previewModalLabel.textContent = getPreviewKind(part) === "image" ? "Image Preview" : "File Preview";
    previewModalTitle.textContent = part?.name || "Attachment";
    previewModalMeta.textContent = [part.mediaType, formatBytes(part.sizeBytes), part.relativePath].filter(Boolean).join(" · ");
    previewModalBody.innerHTML = '<p class="preview-modal__hint">Loading preview...</p>';
    previewModalSave.hidden = true;
    previewModalCopy.hidden = true;

    try {
      const payload = await resolvePreviewPayload(part);
      if (!previewState || previewModal.hidden) {
        return;
      }
      const outputPart = {
        name: payload?.name || part?.name || "download",
        mediaType: payload?.mediaType || part?.mediaType || "application/octet-stream",
        relativePath: payload?.relativePath || part?.relativePath || null,
      };
      if ((payload?.kind || getPreviewKind(part)) === "text" && typeof payload?.text === "string") {
        outputPart.textContent = payload.text;
      } else if (typeof payload?.dataBase64 === "string" && payload.dataBase64) {
        outputPart.dataBase64 = payload.dataBase64;
      } else if (typeof payload?.src === "string" && payload.src) {
        outputPart.uri = payload.src;
      } else {
        outputPart.dataBase64 = part?.dataBase64;
        outputPart.uri = part?.uri;
        outputPart.textContent = part?.textContent;
      }
      previewState.outputPart = outputPart;
      previewModalTitle.textContent = payload?.name || part?.name || "Attachment";
      previewModalMeta.textContent = [payload?.mediaType || part?.mediaType, formatBytes(payload?.sizeBytes || part?.sizeBytes), payload?.relativePath || part?.relativePath].filter(Boolean).join(" · ");
      previewModalBody.innerHTML = buildPreviewBody(payload, part);
      previewModalSave.hidden = false;
      previewModalCopy.hidden = !["text", "image", "pdf", "audio", "video", "file"].includes(payload?.kind || "");
    } catch (error) {
      previewModalBody.innerHTML = `
        <div class="preview-modal__empty">
          <p>${escapeHtml(error?.message || "Failed to load preview.")}</p>
        </div>
      `;
    }
  }

  async function handleMessagesClick(event) {
    const previewButton = event.target.closest("[data-preview-ref]");
    if (previewButton) {
      const messageId = previewButton.dataset.messageId;
      const partRef = previewButton.dataset.previewRef;
      const message = messageModels.get(messageId);
      let part = message?.contents;
      for (const segment of String(partRef || "").split(".")) {
        if (Array.isArray(part)) {
          const index = Number.parseInt(segment, 10);
          if (!Number.isInteger(index)) {
            part = null;
            break;
          }
          part = part[index];
          continue;
        }

        if (!part || typeof part !== "object") {
          part = null;
          break;
        }
        part = part[segment];
      }
      if (!part) {
        return;
      }

      await openPreview(part);
      return;
    }

    const approvalButton = event.target.closest("[data-approval-action]");
    if (!approvalButton || !activeAssistantMessage || !activeRequestId) {
      return;
    }

    const approvalId = approvalButton.dataset.approvalId;
    const approved = approvalButton.dataset.approvalAction === "approve";
    await submitApprovalDecision(approvalId, approved);
  }

  async function handleAttachmentListClick(event) {
    const removeButton = event.target.closest("[data-remove-attachment]");
    if (removeButton) {
      const index = Number.parseInt(removeButton.dataset.removeAttachment, 10);
      if (!Number.isInteger(index)) {
        return;
      }

      stagedAttachments = stagedAttachments.filter((_, currentIndex) => currentIndex !== index);
      renderAttachmentList();
      return;
    }

    const previewButton = event.target.closest("[data-composer-preview-index]");
    if (!previewButton) {
      return;
    }

    const index = Number.parseInt(previewButton.dataset.composerPreviewIndex, 10);
    if (!Number.isInteger(index) || !stagedAttachments[index]) {
      return;
    }

    await openPreview(stagedAttachments[index]);
  }

  function bindPreviewModal() {
    if (!previewModal || !previewModalClose || !previewModalCopy || !previewModalSave) {
      return;
    }

    previewModal.addEventListener("click", (event) => {
      if (event.target?.dataset?.previewClose === "backdrop") {
        closePreviewModal();
      }
    });

    previewModalClose.addEventListener("click", () => {
      closePreviewModal();
    });

    previewModalCopy.addEventListener("click", async () => {
      if (!previewState?.outputPart) {
        return;
      }

      previewModalCopy.disabled = true;
      try {
        await window.agentAPI.copyPreviewPart(previewState.outputPart);
      } catch (error) {
        status.textContent = "copy error";
        console.error(error);
      } finally {
        previewModalCopy.disabled = false;
      }
    });

    previewModalSave.addEventListener("click", async () => {
      if (!previewState?.outputPart) {
        return;
      }

      previewModalSave.disabled = true;
      try {
        await window.agentAPI.saveOutputPart(previewState.outputPart);
      } catch (error) {
        status.textContent = "save error";
        console.error(error);
      } finally {
        previewModalSave.disabled = false;
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && previewModal && !previewModal.hidden) {
        closePreviewModal();
      }
    });
  }

  function init() {
    window.agentAPI.onStreamEvent((streamEvent) => {
      if (streamEvent.requestId !== activeRequestId) {
        return;
      }

      if (streamEvent.type === "update" || streamEvent.type === "done") {
        updateAssistantMessage(streamEvent.message);
      }
    });

    if (messages) {
      messages.addEventListener("scroll", () => {
        shouldAutoScroll = isNearBottom();
        updateScrollButtonVisibility();
      });
      messages.addEventListener("click", (event) => {
        void handleMessagesClick(event);
      });
    }

    if (attachments) {
      attachments.addEventListener("click", (event) => {
        void handleAttachmentListClick(event);
      });
    }

    if (scrollToBottomButton) {
      scrollToBottomButton.addEventListener("click", () => {
        scrollMessagesToBottom(true);
      });
    }

    if (attachmentButton) {
      attachmentButton.addEventListener("click", () => {
        void pickAttachments();
      });
    }

    bindPreviewModal();
    syncAlwaysApproveToolsButton();

    send.addEventListener("click", () => {
      void run();
    });
    if (interruptRunButton) {
      interruptRunButton.addEventListener("click", () => {
        void interruptRun();
      });
    }
    if (alwaysApproveToolsButton) {
      alwaysApproveToolsButton.addEventListener("click", () => {
        alwaysApproveTools = !alwaysApproveTools;
        try {
          window.localStorage.setItem(ALWAYS_APPROVE_STORAGE_KEY, alwaysApproveTools ? "true" : "false");
        } catch { }
        syncAlwaysApproveToolsButton();
        if (alwaysApproveTools) {
          maybeAutoApprovePendingRequests();
        }
      });
    }
    prompt.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        void run();
      }
    });
    prompt.addEventListener("input", resizePromptToFit);
  }

  return {
    init,
    refreshStatus,
    scrollToBottom: scrollMessagesToBottom,
  };
}

export { createChatController };
