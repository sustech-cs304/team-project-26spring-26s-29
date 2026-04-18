import { escapeHtml } from "./html.js";

function applyInlineMarkdown(text) {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function renderPlainText(text) {
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

function renderMarkdown(markdown) {
  const safe = escapeHtml(markdown).replace(/\r\n/g, "\n");
  const codeBlocks = [];
  const withCodePlaceholders = safe.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return placeholder;
  });

  const lines = withCodePlaceholders.split("\n");
  const chunks = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let quoteLines = [];
  let tableHeader = null;
  let tableRows = [];

  function flushParagraph() {
    if (!paragraph.length) {
      return;
    }

    chunks.push(`<p>${applyInlineMarkdown(paragraph.join("<br />"))}</p>`);
    paragraph = [];
  }

  function flushList() {
    if (!listItems.length || !listType) {
      return;
    }

    const items = listItems.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join("");
    chunks.push(`<${listType}>${items}</${listType}>`);
    listItems = [];
    listType = null;
  }

  function flushQuote() {
    if (!quoteLines.length) {
      return;
    }

    chunks.push(`<blockquote>${quoteLines.map((line) => `<p>${applyInlineMarkdown(line)}</p>`).join("")}</blockquote>`);
    quoteLines = [];
  }

  function flushTable() {
    if (!tableHeader || !tableRows.length) {
      tableHeader = null;
      tableRows = [];
      return;
    }

    const headerCells = tableHeader.map((cell) => `<th>${applyInlineMarkdown(cell)}</th>`).join("");
    const bodyRows = tableRows
      .map((row) => `<tr>${row.map((cell) => `<td>${applyInlineMarkdown(cell)}</td>`).join("")}</tr>`)
      .join("");
    chunks.push(`<table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`);
    tableHeader = null;
    tableRows = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      const level = headingMatch[1].length;
      chunks.push(`<h${level}>${applyInlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      chunks.push("<hr />");
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      flushTable();
      quoteLines.push(quoteMatch[1]);
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      flushQuote();
      flushTable();
      if (listType && listType !== "ol") {
        flushList();
      }
      listType = "ol";
      listItems.push(orderedMatch[1]);
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      flushQuote();
      flushTable();
      if (listType && listType !== "ul") {
        flushList();
      }
      listType = "ul";
      listItems.push(unorderedMatch[1]);
      continue;
    }

    if (trimmed.startsWith("__CODE_BLOCK_") && trimmed.endsWith("__")) {
      flushParagraph();
      flushList();
      flushQuote();
      flushTable();
      chunks.push(trimmed);
      continue;
    }

    const tableCells = trimmed
      .split("|")
      .map((cell) => cell.trim())
      .filter((cell, index, parts) => {
        if (parts.length <= 1) {
          return true;
        }
        if (index === 0 && !cell) {
          return false;
        }
        return !(index === parts.length - 1 && !cell);
      });

    if (trimmed.includes("|") && tableCells.length >= 2) {
      const isSeparator = tableCells.every((cell) => /^:?-{3,}:?$/.test(cell));
      if (isSeparator && tableHeader) {
        continue;
      }

      flushParagraph();
      flushList();
      flushQuote();

      if (!tableHeader) {
        tableHeader = tableCells;
      } else {
        tableRows.push(tableCells);
      }
      continue;
    }

    flushList();
    flushQuote();
    flushTable();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushQuote();
  flushTable();

  return chunks
    .join("")
    .replace(/__CODE_BLOCK_(\d+)__/g, (_match, index) => codeBlocks[Number(index)] || "");
}

export {
  renderMarkdown,
  renderPlainText,
};
