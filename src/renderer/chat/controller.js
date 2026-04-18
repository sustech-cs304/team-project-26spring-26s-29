import { escapeHtml } from "../shared/html.js";
import { renderMarkdown, renderPlainText } from "../shared/markdown.js";

const MESSAGE_PREVIEW_MAX_LENGTH = 180;
const MESSAGE_COLLAPSE_THRESHOLD = 140;
const BOTTOM_SCROLL_THRESHOLD = 80;
const PROMPT_MAX_HEIGHT = 220;

function createChatController({
  prompt,
  send,
  status,
  messages,
  scrollToBottomButton,
}) {
  let isRunning = false;
  let activeRequestId = null;
  let activeAssistantMessage = null;
  let shouldAutoScroll = true;

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

  function createMessageElement(role) {
    const article = document.createElement("article");
    article.className = `message message--${role}`;

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

  function attachUserMessageToggle(article, contentNode, content) {
    const text = String(content ?? "");
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

  function renderMessageContent(content, { contentType = "text", role = "assistant" } = {}) {
    if (role === "user") {
      return renderPlainText(content);
    }

    if (contentType === "json") {
      return `<pre class="message__card message__card--json">${escapeHtml(content)}</pre>`;
    }

    if (contentType === "image") {
      return `<div class="message__card message__card--image">${escapeHtml(content)}</div>`;
    }

    if (contentType === "file") {
      return `<div class="message__card message__card--file">${escapeHtml(content)}</div>`;
    }

    return renderMarkdown(content);
  }

  function resizePromptToFit() {
    if (!prompt) {
      return;
    }

    prompt.style.height = "auto";
    prompt.style.height = `${Math.min(prompt.scrollHeight, PROMPT_MAX_HEIGHT)}px`;
  }

  function appendMessage({ role, content, contentType = "text" }) {
    if (!messages) {
      return null;
    }

    const { article, content: contentNode } = createMessageElement(role);
    contentNode.innerHTML = renderMessageContent(content, { contentType, role });

    if (role === "user") {
      attachUserMessageToggle(article, contentNode, content);
    }

    messages.append(article);
    scrollMessagesToBottom();
    return { article, contentNode };
  }

  function createAssistantPlaceholder() {
    const placeholder = appendMessage({ role: "assistant", content: "" });
    if (!placeholder) {
      activeAssistantMessage = null;
      return null;
    }

    placeholder.contentNode.innerHTML = '<p class="message__placeholder">Thinking...</p>';
    activeAssistantMessage = {
      article: placeholder.article,
      contentNode: placeholder.contentNode,
      rawContent: "",
      contentType: "text",
    };
    return activeAssistantMessage;
  }

  function updateAssistantMessage() {
    if (!activeAssistantMessage) {
      return;
    }

    activeAssistantMessage.contentNode.innerHTML =
      activeAssistantMessage.rawContent.trim()
        ? renderMessageContent(activeAssistantMessage.rawContent, {
            contentType: activeAssistantMessage.contentType,
            role: "assistant",
          })
        : '<p class="message__placeholder">Thinking...</p>';

    scrollMessagesToBottom();
  }

  function appendAssistantChunk(chunk) {
    if (!activeAssistantMessage) {
      createAssistantPlaceholder();
    }

    if (!activeAssistantMessage) {
      return;
    }

    activeAssistantMessage.rawContent += chunk;
    updateAssistantMessage();
  }

  async function refreshStatus() {
    const [{ ok }, config] = await Promise.all([
      window.agentAPI.health().catch(() => ({ ok: false })),
      window.configAPI.get().catch(() => null),
    ]);
    const ready = ok && Boolean(config?.openaiChatModel);

    status.textContent = isRunning ? "running" : !ok ? "starting" : ready ? "ready" : "config needed";
    send.disabled = isRunning || !ready;
  }

  async function run() {
    const message = prompt.value.trim();
    if (!message || send.disabled) {
      return;
    }

    isRunning = true;
    activeRequestId = crypto.randomUUID();
    activeAssistantMessage = null;
    send.disabled = true;
    status.textContent = "running";
    shouldAutoScroll = true;
    appendMessage({ role: "user", content: message });
    createAssistantPlaceholder();
    prompt.value = "";
    prompt.style.height = "auto";

    try {
      const result = await window.agentAPI.runPrompt(message, activeRequestId);
      if (activeAssistantMessage && !activeAssistantMessage.rawContent.trim()) {
        activeAssistantMessage.rawContent = result.reply || "";
        updateAssistantMessage();
      }
      status.textContent = "ready";
    } catch (error) {
      const errorText = error?.message || String(error);
      if (!activeAssistantMessage) {
        createAssistantPlaceholder();
      }
      if (activeAssistantMessage) {
        activeAssistantMessage.rawContent = `**Error**\n\n${errorText}`;
        updateAssistantMessage();
      }
      status.textContent = "error";
    } finally {
      isRunning = false;
      activeRequestId = null;
    }

    await refreshStatus();
  }

  function init() {
    window.agentAPI.onStreamChunk(({ requestId, chunk }) => {
      if (requestId !== activeRequestId) {
        return;
      }

      appendAssistantChunk(chunk);
    });

    if (messages) {
      messages.addEventListener("scroll", () => {
        shouldAutoScroll = isNearBottom();
        updateScrollButtonVisibility();
      });
    }

    if (scrollToBottomButton) {
      scrollToBottomButton.addEventListener("click", () => {
        scrollMessagesToBottom(true);
      });
    }

    send.addEventListener("click", run);
    prompt.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        run();
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
