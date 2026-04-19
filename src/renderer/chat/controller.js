import { escapeHtml } from "../shared/html.js";
import { renderMarkdown, renderPlainText } from "../shared/markdown.js";

const MESSAGE_PREVIEW_MAX_LENGTH = 180;
const MESSAGE_COLLAPSE_THRESHOLD = 140;
const BOTTOM_SCROLL_THRESHOLD = 80;
const PROMPT_MAX_HEIGHT = 220;
const FILE_PREVIEW_MAX_LENGTH = 220;

function createChatController({
  prompt,
  send,
  status,
  messages,
  scrollToBottomButton,
  attachmentButton,
  attachments,
}) {
  let isRunning = false;
  let activeRequestId = null;
  let activeAssistantMessage = null;
  let shouldAutoScroll = true;
  const messageModels = new Map();
  let stagedAttachments = [];
  let draftRequestId = crypto.randomUUID();

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

  function buildUserPreview(contents) {
    return contents
      .map((part) => {
        if (part.type === "text") {
          return String(part.text || "");
        }
        if (part.type === "image") {
          return `[image] ${part.name || "image"}`;
        }
        if (part.type === "file") {
          return `[file] ${part.name || "file"}`;
        }
        return `[${part.type}]`;
      })
      .join("\n");
  }

  function attachUserMessageToggle(article, contentNode, previewText) {
    const text = String(previewText ?? "");
    const normalized = text.trim();
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
    preview.textContent = truncateText(text);

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

  function renderUserTextFile(part) {
    const preview = truncateText(
      String(part.summaryText || "No inline preview. Use the workspace path to inspect this file."),
      FILE_PREVIEW_MAX_LENGTH
    );
    const metaBits = [part.mediaType, formatBytes(part.sizeBytes), part.relativePath].filter(Boolean).join(" · ");
    return `
      <div class="message__card message__card--file">
        <p class="message__card-label">File</p>
        <p class="message__filename">${escapeHtml(part.name || "file")}</p>
        ${metaBits ? `<p class="message__filemeta">${escapeHtml(metaBits)}</p>` : ""}
        <p class="message__filepreview">${escapeHtml(preview)}</p>
      </div>
    `;
  }

  function renderUserImage(part) {
    const src = buildDataUri(part);
    const metaBits = [part.mediaType, formatBytes(part.sizeBytes), part.relativePath].filter(Boolean).join(" · ");
    return `
      <div class="message__card message__card--image">
        <p class="message__card-label">Image</p>
        <p class="message__filename">${escapeHtml(part.name || "image")}</p>
        ${metaBits ? `<p class="message__filemeta">${escapeHtml(metaBits)}</p>` : ""}
        <img class="message__image" src="${escapeHtml(src)}" alt="${escapeHtml(part.name || "Attached image")}" />
      </div>
    `;
  }

  function renderUserContents(message) {
    const blocks = [];
    for (const part of message.contents) {
      if (part.type === "text") {
        blocks.push(renderPlainText(part.text || ""));
        continue;
      }
      if (part.type === "image") {
        blocks.push(renderUserImage(part));
        continue;
      }
      if (part.type === "file") {
        blocks.push(renderUserTextFile(part));
      }
    }
    return blocks.join("") || "<p></p>";
  }

  function renderToolCall(part) {
    return `
      <div class="message__card message__card--tool">
        <p class="message__card-label">Tool Request</p>
        <p class="message__toolname">${escapeHtml(part.name || "Unnamed tool")}</p>
        <pre class="message__toolargs">${escapeHtml(part.argumentsText || "No arguments")}</pre>
      </div>
    `;
  }

  function renderStructuredText(text) {
    return text ? renderMarkdown(text) : "";
  }

  function renderNestedResultItems(items, context, parentRef) {
    if (!Array.isArray(items) || !items.length) {
      return "";
    }

    const richItems = items.filter((item) => item.type !== "text");
    if (!richItems.length) {
      return "";
    }

    return `
      <div class="message__nested">
        ${richItems.map((item, index) => renderAssistantPart(item, context, `${parentRef}.items.${index}`)).join("")}
      </div>
    `;
  }

  function renderToolResult(part, context, ref) {
    return `
      <div class="message__card message__card--tool">
        <p class="message__card-label">Tool Result</p>
        ${part.result ? `<div class="message__toolresult">${renderStructuredText(part.result)}</div>` : ""}
        ${renderNestedResultItems(part.items, context, ref)}
      </div>
    `;
  }

  function renderApprovalCard(part, context) {
    const functionCall = part.functionCall || {};
    const decision = part.decision || "pending";
    const isPending = decision === "pending";
    const isActionable = isPending && context.isActive;
    const decisionLabel =
      decision === "approved"
        ? "Approved"
        : decision === "rejected"
          ? "Rejected"
          : "Awaiting your decision";

    return `
      <div class="message__card message__card--approval">
        <div class="message__approval-header">
          <p class="message__card-label">Approval Needed</p>
          <span class="message__badge message__badge--${escapeHtml(decision)}">${escapeHtml(decisionLabel)}</span>
        </div>
        <p class="message__toolname">${escapeHtml(functionCall.name || "Tool action")}</p>
        <pre class="message__toolargs">${escapeHtml(functionCall.argumentsText || "No arguments")}</pre>
        ${isActionable ? `
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

  function renderDownloadCard(part, context, ref, label) {
    const preview = part.type === "image" ? `
      <img class="message__image" src="${escapeHtml(buildDataUri(part))}" alt="${escapeHtml(part.name || label)}" />
    ` : `
      <div class="message__fileicon" aria-hidden="true">FILE</div>
    `;
    const metaBits = [part.mediaType].filter(Boolean).join(" · ");

    return `
      <button
        class="message__card message__card--download"
        type="button"
        data-save-ref="${escapeHtml(ref)}"
        data-message-id="${escapeHtml(context.messageId)}"
      >
        <p class="message__card-label">${escapeHtml(label)}</p>
        <p class="message__filename">${escapeHtml(part.name || label.toLowerCase())}</p>
        ${metaBits ? `<p class="message__filemeta">${escapeHtml(metaBits)}</p>` : ""}
        ${preview}
        <span class="message__download-hint">Click to save</span>
      </button>
    `;
  }

  function renderJsonCard(part) {
    return `
      <pre class="message__card message__card--json">${escapeHtml(JSON.stringify(part.data || {}, null, 2))}</pre>
    `;
  }

  function renderCitationsCard(part) {
    const items = Array.isArray(part.items) ? part.items : [];
    return `
      <div class="message__card message__card--tool">
        <p class="message__card-label">Web Sources</p>
        ${items.map((item) => `
          <div class="message__toolresult">
            <p><strong>${escapeHtml(item.title || item.site_name || item.url || "Source")}</strong></p>
            ${item.url ? `<p>${escapeHtml(item.url)}</p>` : ""}
            ${item.summary ? `<p>${escapeHtml(truncateText(item.summary, 260))}</p>` : ""}
          </div>
        `).join("")}
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
      return renderToolCall(part);
    }
    if (part.type === "function_result") {
      return renderToolResult(part, context, ref);
    }
    if (part.type === "function_approval_request") {
      return renderApprovalCard(part, context);
    }
    if (part.type === "image") {
      return renderDownloadCard(part, context, ref, "Image Output");
    }
    if (part.type === "file") {
      return renderDownloadCard(part, context, ref, "File Output");
    }
    if (part.type === "citations") {
      return renderCitationsCard(part);
    }
    return renderJsonCard(part);
  }

  function renderAssistantContents(message, context) {
    if (!message.contents.length) {
      return '<p class="message__placeholder">Thinking...</p>';
    }

    return message.contents
      .map((part, index) => renderAssistantPart(part, context, `${index}`))
      .join("");
  }

  function renderMessageContent(message, messageId, isActive = false) {
    if (message.role === "user") {
      return renderUserContents(message);
    }

    return renderAssistantContents(message, {
      isActive,
      messageId,
    });
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
      attachUserMessageToggle(article, contentNode, buildUserPreview(normalizedMessage.contents));
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

  function createAssistantPlaceholder() {
    const placeholder = appendMessage(
      { role: "assistant", status: "running", contents: [] },
      { isActive: true }
    );
    if (!placeholder) {
      activeAssistantMessage = null;
      return null;
    }

    activeAssistantMessage = placeholder;
    return activeAssistantMessage;
  }

  function updateAssistantMessage(message) {
    if (!activeAssistantMessage) {
      createAssistantPlaceholder();
    }

    if (!activeAssistantMessage) {
      return;
    }

    updateExistingMessage(activeAssistantMessage, message, { isActive: true });
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
        const metaBits = [
          attachment.mediaType,
          formatBytes(attachment.sizeBytes),
          attachment.relativePath,
        ].filter(Boolean).join(" · ");
        return `
          <div class="composer-attachment">
            <div class="composer-attachment__main">
              <p class="composer-attachment__label">${escapeHtml(label)}</p>
              <p class="composer-attachment__name">${escapeHtml(attachment.name || label.toLowerCase())}</p>
              ${metaBits ? `<p class="composer-attachment__meta">${escapeHtml(metaBits)}</p>` : ""}
            </div>
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

  function updateComposerAvailability(ready) {
    if (send) {
      send.disabled = isRunning || !ready;
    }
    if (attachmentButton) {
      attachmentButton.disabled = isRunning || !ready;
    }
  }

  async function refreshStatus() {
    const [{ ok }, config] = await Promise.all([
      window.agentAPI.health().catch(() => ({ ok: false })),
      window.configAPI.get().catch(() => null),
    ]);
    const ready = ok && Boolean(config?.openaiChatModel);

    status.textContent = isRunning ? "running" : !ok ? "starting" : ready ? "ready" : "config needed";
    updateComposerAvailability(ready);
  }

  function buildRunContents() {
    const text = prompt.value.trim();
    const contents = stagedAttachments.map((attachment) => cloneData(attachment));
    if (text) {
      contents.push({ type: "text", text });
    }
    return contents;
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

  async function run() {
    const contents = buildRunContents();
    if (!contents.length || send.disabled) {
      return;
    }

    const requestId = stagedAttachments.length ? ensureDraftRequestId() : crypto.randomUUID();
    isRunning = true;
    activeRequestId = requestId;
    activeAssistantMessage = null;
    shouldAutoScroll = true;
    status.textContent = "running";
    updateComposerAvailability(true);

    appendMessage({
      role: "user",
      status: "completed",
      contents: cloneData(contents),
    });
    createAssistantPlaceholder();
    clearComposer();

    try {
      const result = await window.agentAPI.runPrompt({ requestId, contents });
      if (activeRequestId === requestId && result?.message) {
        updateAssistantMessage(result.message);
      }
      status.textContent = "ready";
    } catch (error) {
      const errorText = error?.message || String(error);
      updateAssistantMessage({
        role: "assistant",
        status: "error",
        contents: [{ type: "error", message: errorText }],
      });
      status.textContent = "error";
    } finally {
      isRunning = false;
      activeRequestId = null;
    }

    await refreshStatus();
  }

  function resolvePartByRef(contents, ref) {
    const segments = String(ref || "").split(".");
    let current = contents;
    for (const segment of segments) {
      if (Array.isArray(current)) {
        const index = Number.parseInt(segment, 10);
        if (!Number.isInteger(index)) {
          return null;
        }
        current = current[index];
        continue;
      }

      if (!current || typeof current !== "object") {
        return null;
      }
      current = current[segment];
    }
    return current || null;
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

  async function handleMessagesClick(event) {
    const saveButton = event.target.closest("[data-save-ref]");
    if (saveButton) {
      const messageId = saveButton.dataset.messageId;
      const partRef = saveButton.dataset.saveRef;
      const message = messageModels.get(messageId);
      const part = resolvePartByRef(message?.contents, partRef);
      if (!part) {
        return;
      }

      saveButton.disabled = true;
      try {
        await window.agentAPI.saveOutputPart(part);
      } catch (error) {
        console.error(error);
        status.textContent = "save error";
      } finally {
        saveButton.disabled = false;
      }
      return;
    }

    const approvalButton = event.target.closest("[data-approval-action]");
    if (!approvalButton || !activeAssistantMessage || !activeRequestId) {
      return;
    }

    const approvalId = approvalButton.dataset.approvalId;
    const approved = approvalButton.dataset.approvalAction === "approve";
    const localDecision = approved ? "approved" : "rejected";

    const nextMessage = applyLocalApprovalDecision(activeAssistantMessage.message, approvalId, localDecision);
    updateExistingMessage(activeAssistantMessage, nextMessage, { isActive: true });

    try {
      await window.agentAPI.respondApproval({
        requestId: activeRequestId,
        approvalId,
        approved,
      });
    } catch (error) {
      const revertedMessage = applyLocalApprovalDecision(activeAssistantMessage.message, approvalId, "pending");
      updateExistingMessage(activeAssistantMessage, revertedMessage, { isActive: true });
      status.textContent = "error";
      console.error(error);
    }
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
        const removeButton = event.target.closest("[data-remove-attachment]");
        if (!removeButton) {
          return;
        }

        const index = Number.parseInt(removeButton.dataset.removeAttachment, 10);
        if (!Number.isInteger(index)) {
          return;
        }

        stagedAttachments = stagedAttachments.filter((_, currentIndex) => currentIndex !== index);
        renderAttachmentList();
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

    send.addEventListener("click", () => {
      void run();
    });
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
