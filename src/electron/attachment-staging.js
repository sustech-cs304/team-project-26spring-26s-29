const { Buffer } = require("node:buffer");
const fs = require("node:fs/promises");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SUMMARY_CHARACTERS = 4000;
const MAX_INLINE_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_PREVIEW_CHARACTERS = 12000;

const IMAGE_MEDIA_TYPES = {
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".webp": "image/webp",
};

const GENERIC_MEDIA_TYPES = {
  ".aac": "audio/aac",
  ".avi": "video/x-msvideo",
  ".c": "text/plain",
  ".cc": "text/plain",
  ".cpp": "text/plain",
  ".css": "text/css",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".go": "text/plain",
  ".html": "text/html",
  ".java": "text/plain",
  ".js": "text/javascript",
  ".json": "application/json",
  ".jsx": "text/javascript",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".py": "text/x-python",
  ".rs": "text/plain",
  ".sql": "application/sql",
  ".text": "text/plain",
  ".toml": "application/toml",
  ".ts": "text/typescript",
  ".tsx": "text/typescript",
  ".txt": "text/plain",
  ".xml": "application/xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".zip": "application/zip",
  ".wav": "audio/wav",
  ".webm": "video/webm",
};

const DOCUMENT_EXTENSIONS = new Set([
  ".csv",
  ".docx",
  ".html",
  ".htm",
  ".json",
  ".md",
  ".odt",
  ".pdf",
  ".pptx",
  ".rtf",
  ".txt",
  ".xlsx",
  ".xml",
]);

const MEDIA_TYPE_TO_EXTENSION = Object.fromEntries(
  [...Object.entries(IMAGE_MEDIA_TYPES), ...Object.entries(GENERIC_MEDIA_TYPES)].map(([extension, mediaType]) => [
    mediaType,
    extension,
  ])
);

function sanitizeFileName(fileName) {
  const extension = path.extname(fileName || "");
  const stem = path.basename(fileName || "file", extension) || "file";
  const sanitizedStem = stem
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "file";
  const sanitizedExtension = extension
    .replace(/[^.a-zA-Z0-9_-]+/g, "")
    .slice(0, 20);
  return `${sanitizedStem}${sanitizedExtension}`;
}

function detectMediaType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return IMAGE_MEDIA_TYPES[extension] || GENERIC_MEDIA_TYPES[extension] || "application/octet-stream";
}

function isImageMediaType(mediaType) {
  return String(mediaType || "").toLowerCase().startsWith("image/");
}

function isTemporalMediaType(mediaType) {
  const normalized = String(mediaType || "").toLowerCase();
  return normalized.startsWith("audio/") || normalized.startsWith("video/");
}

function isDocumentPath(filePath) {
  return DOCUMENT_EXTENSIONS.has(path.extname(filePath || "").toLowerCase());
}

function isTextInlineMediaType(mediaType) {
  const normalized = String(mediaType || "").toLowerCase();
  return normalized.startsWith("text/") || normalized.includes("json") || normalized.includes("xml");
}

function previewKindForMediaType(mediaType) {
  const normalized = String(mediaType || "").toLowerCase();
  if (!normalized) {
    return "file";
  }
  if (normalized.startsWith("image/")) {
    return "image";
  }
  if (normalized.startsWith("audio/")) {
    return "file";
  }
  if (normalized.startsWith("video/")) {
    return "file";
  }
  if (normalized.startsWith("text/") || normalized.includes("json") || normalized.includes("xml")) {
    return "text";
  }
  return "file";
}

function decodeTextBuffer(buffer) {
  if (buffer.byteLength >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(3));
  }

  if (buffer.byteLength >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return new TextDecoder("utf-16le", { fatal: true }).decode(buffer.subarray(2));
  }

  if (buffer.byteLength >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return new TextDecoder("utf-16be", { fatal: true }).decode(buffer.subarray(2));
  }

  for (const encoding of ["utf-8", "utf-16le", "utf-16be", "gb18030"]) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(buffer);
    } catch { }
  }

  return null;
}

function isProbablyBinaryBuffer(buffer) {
  if (!buffer?.byteLength) {
    return false;
  }

  const sample = buffer.subarray(0, Math.min(buffer.byteLength, 512));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if (byte < 7 || (byte > 13 && byte < 32)) {
      suspicious += 1;
    }
  }

  return suspicious / sample.length > 0.1;
}

function isProbablyText(text) {
  const content = String(text || "");
  if (!content) {
    return true;
  }

  let suspicious = 0;
  for (const char of content) {
    const code = char.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13) {
      continue;
    }
    if ((code >= 0 && code < 32) || code === 65533) {
      suspicious += 1;
    }
  }

  return suspicious / content.length < 0.05;
}

function buildSummaryText(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_SUMMARY_CHARACTERS);
}

function ensureWorkspaceRelativePath(workspacePath, relativePath) {
  const root = path.resolve(workspacePath);
  const candidate = path.resolve(root, relativePath || ".");
  const normalizedRoot = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(normalizedRoot)) {
    throw new Error("Attachment preview path escapes the workspace root.");
  }
  return candidate;
}

async function stageAttachments({ filePaths, requestId, workspacePath }) {
  const requestDirectory = path.join(workspacePath, "inputs", requestId);
  await fs.mkdir(requestDirectory, { recursive: true });

  const existingEntries = await fs.readdir(requestDirectory).catch(() => []);
  let nextIndex = existingEntries.length;
  const attachments = [];

  for (const filePath of filePaths) {
    const fileBuffer = await fs.readFile(filePath);
    const mediaType = detectMediaType(filePath);
    const name = sanitizeFileName(path.basename(filePath));
    nextIndex += 1;
    const stagedName = `${String(nextIndex).padStart(2, "0")}-${name}`;
    const stagedPath = path.join(requestDirectory, stagedName);
    await fs.copyFile(filePath, stagedPath);

    const relativePath = path.relative(workspacePath, stagedPath).split(path.sep).join("/");
    const sizeBytes = fileBuffer.byteLength;
    const decodedText = isProbablyBinaryBuffer(fileBuffer) ? null : decodeTextBuffer(fileBuffer);
    const summaryText = decodedText && isProbablyText(decodedText) ? buildSummaryText(decodedText) : null;

    if (isImageMediaType(mediaType) && sizeBytes <= MAX_INLINE_IMAGE_BYTES) {
      attachments.push({
        type: "image",
        name,
        mediaType,
        sizeBytes,
        relativePath,
        dataBase64: fileBuffer.toString("base64"),
        capability: "image_native",
        readability: "llm_native",
      });
      continue;
    }

    const capability = resolveAttachmentCapability(filePath, mediaType, summaryText, sizeBytes);
    const attachment = {
      type: "file",
      name,
      mediaType,
      sizeBytes,
      relativePath,
      capability,
      readability: capability === "image_native" && sizeBytes > MAX_INLINE_IMAGE_BYTES
        ? "llm_unavailable"
        : readabilityForCapability(capability),
      message: messageForCapability(capability, sizeBytes),
    };
    if (capability === "text_inline") {
      attachment.summaryText = summaryText;
    }
    attachments.push(attachment);
  }

  return attachments;
}

async function loadWorkspacePreview({
  workspacePath,
  relativePath,
  mediaType,
  maxTextCharacters = MAX_TEXT_PREVIEW_CHARACTERS,
  maxInlineBytes = MAX_INLINE_PREVIEW_BYTES,
}) {
  const absolutePath = ensureWorkspaceRelativePath(workspacePath, relativePath);
  const fileBuffer = await fs.readFile(absolutePath);
  const resolvedMediaType = mediaType || detectMediaType(absolutePath);
  const previewKind = previewKindForMediaType(resolvedMediaType);
  const name = path.basename(absolutePath);

  if (previewKind === "text") {
    const decodedText = isProbablyBinaryBuffer(fileBuffer) ? null : decodeTextBuffer(fileBuffer);
    const text = decodedText && isProbablyText(decodedText) ? decodedText : null;
    if (text === null) {
      return {
        kind: "file",
        mediaType: resolvedMediaType,
        relativePath,
        message: "This file is not safely decodable as text.",
      };
    }

    const normalized = text.replace(/\r\n/g, "\n");
    return {
      kind: "text",
      name,
      mediaType: resolvedMediaType,
      relativePath,
      text: normalized.slice(0, maxTextCharacters),
      truncated: normalized.length > maxTextCharacters,
    };
  }

  if (previewKind === "image") {
    if (fileBuffer.byteLength > maxInlineBytes) {
      return {
        kind: previewKind,
        name,
        mediaType: resolvedMediaType,
        relativePath,
        tooLarge: true,
        sizeBytes: fileBuffer.byteLength,
        message: `This ${previewKind} is too large to preview inline.`,
      };
    }

    return {
      kind: previewKind,
      name,
      mediaType: resolvedMediaType,
      relativePath,
      dataBase64: fileBuffer.toString("base64"),
      sizeBytes: fileBuffer.byteLength,
    };
  }

  return {
    kind: "file",
    name,
    mediaType: resolvedMediaType,
    relativePath,
    sizeBytes: fileBuffer.byteLength,
    message: previewMessageForMediaType(resolvedMediaType, absolutePath),
  };
}

function resolveAttachmentCapability(filePath, mediaType, summaryText, sizeBytes) {
  if (isTemporalMediaType(mediaType)) {
    return "unsupported_temporal";
  }
  if (isImageMediaType(mediaType)) {
    return "image_native";
  }
  if (summaryText && isTextInlineMediaType(mediaType)) {
    return "text_inline";
  }
  if (isDocumentPath(filePath)) {
    return "document_extractable";
  }
  return "unsupported_binary";
}

function readabilityForCapability(capability) {
  switch (capability) {
    case "image_native":
      return "llm_native";
    case "document_extractable":
      return "agent_extractable";
    case "text_inline":
      return "text_inline";
    case "unsupported_temporal":
      return "unsupported_temporal";
    default:
      return "unsupported_binary";
  }
}

function messageForCapability(capability, sizeBytes) {
  switch (capability) {
    case "image_native":
      return sizeBytes > MAX_INLINE_IMAGE_BYTES
        ? "Image is too large to provide inline to the model."
        : "Image bytes are provided inline to the model.";
    case "document_extractable":
      return "Agent can extract text from this document. Human preview is not supported.";
    case "text_inline":
      return "Text preview is provided inline.";
    case "unsupported_temporal":
      return "Audio and video files are not supported.";
    default:
      return "This file type is not directly readable by the model.";
  }
}

function previewMessageForMediaType(mediaType, filePath) {
  if (isTemporalMediaType(mediaType)) {
    return "Audio and video preview is not supported.";
  }
  if (isDocumentPath(filePath)) {
    return "Document preview is not supported here. The agent can extract text from supported documents.";
  }
  return "Inline preview is not available for this file type.";
}

module.exports = {
  MAX_INLINE_IMAGE_BYTES,
  MAX_INLINE_PREVIEW_BYTES,
  MAX_SUMMARY_CHARACTERS,
  MAX_TEXT_PREVIEW_CHARACTERS,
  buildSummaryText,
  decodeTextBuffer,
  detectMediaType,
  extensionFromMediaType: (mediaType) => MEDIA_TYPE_TO_EXTENSION[String(mediaType || "").toLowerCase()] || "",
  isProbablyBinaryBuffer,
  isImageMediaType,
  isTemporalMediaType,
  loadWorkspacePreview,
  previewKindForMediaType,
  resolveAttachmentCapability,
  sanitizeFileName,
  stageAttachments,
};
