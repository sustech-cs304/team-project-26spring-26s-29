import { escapeHtml } from "./html.js";

const RENDERED_MARKDOWN_SELECTOR = "[data-rendered-markdown='true']";
const TRANSPARENT_IMAGE_SRC = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";

function buildPlainTextHtml(text) {
  const paragraphs = escapeHtml(text)
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (!paragraphs.length) {
    return "<p></p>";
  }

  return paragraphs.map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br />")}</p>`).join("");
}

function wrapRenderedMarkdown(html) {
  return `<div class="message__markdown" data-rendered-markdown="true">${html}</div>`;
}

function normalizeWorkspaceImagePath(src) {
  const raw = String(src || "").trim();
  if (!raw || /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) {
    return null;
  }

  const [withoutHash] = raw.split("#", 1);
  const [withoutQuery] = withoutHash.split("?", 1);
  const decoded = (() => {
    try {
      return decodeURI(withoutQuery);
    } catch {
      return withoutQuery;
    }
  })();
  const parts = decoded
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== ".");

  if (!parts.length || parts.some((part) => part === "..")) {
    return null;
  }

  return parts.join("/");
}

function createMarkdownRenderer() {
  if (typeof window === "undefined" || typeof window.markdownit !== "function") {
    return null;
  }

  const renderer = window.markdownit({
    html: false,
    breaks: true,
    linkify: true,
  });

  const defaultLinkOpen =
    renderer.renderer.rules.link_open
    || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet("target", "_blank");
    tokens[index].attrSet("rel", "noreferrer noopener");
    return defaultLinkOpen(tokens, index, options, env, self);
  };

  const defaultImage =
    renderer.renderer.rules.image
    || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  renderer.renderer.rules.image = (tokens, index, options, env, self) => {
    const src = tokens[index].attrGet("src");
    const relativePath = normalizeWorkspaceImagePath(src);
    tokens[index].attrJoin("class", "message__image");
    tokens[index].attrSet("loading", "lazy");
    if (String(src || "").trim()) {
      tokens[index].attrSet("data-markdown-image", "true");
    }
    if (relativePath) {
      tokens[index].attrSet("src", TRANSPARENT_IMAGE_SRC);
      tokens[index].attrSet("data-relative-path", relativePath);
      tokens[index].attrSet("data-markdown-image-state", "pending");
    }
    return defaultImage(tokens, index, options, env, self);
  };

  return renderer;
}

const markdownRenderer = createMarkdownRenderer();

function renderPlainText(text) {
  return buildPlainTextHtml(text);
}

function renderMarkdown(markdown) {
  const normalized = String(markdown ?? "").replace(/\r\n/g, "\n");

  if (!normalized.trim()) {
    return wrapRenderedMarkdown("<p></p>");
  }

  if (!markdownRenderer) {
    return wrapRenderedMarkdown(buildPlainTextHtml(normalized));
  }

  return wrapRenderedMarkdown(markdownRenderer.render(normalized));
}

function renderMathInMarkdownBlocks(root) {
  if (!root || typeof window === "undefined" || typeof window.renderMathInElement !== "function") {
    return;
  }

  const blocks = [];

  if (root.matches?.(RENDERED_MARKDOWN_SELECTOR)) {
    blocks.push(root);
  }

  if (typeof root.querySelectorAll === "function") {
    blocks.push(...root.querySelectorAll(RENDERED_MARKDOWN_SELECTOR));
  }

  for (const block of blocks) {
    window.renderMathInElement(block, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option"],
      throwOnError: false,
      strict: "ignore",
    });
  }
}

export {
  normalizeWorkspaceImagePath,
  renderMarkdown,
  renderMathInMarkdownBlocks,
  renderPlainText,
};
