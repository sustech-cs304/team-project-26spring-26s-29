const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadWorkspacePreview, stageAttachments } = require("../../src/electron/attachment-staging");

test("stageAttachments preserves image bytes and file metadata in the workspace", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-stage-"));
  const sourceDir = path.join(tempRoot, "source");
  const workspacePath = path.join(tempRoot, "workspace");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(path.join(workspacePath, "inputs"), { recursive: true });
  await fs.mkdir(path.join(workspacePath, "outputs"), { recursive: true });

  const imagePath = path.join(sourceDir, "diagram.png");
  const textPath = path.join(sourceDir, "notes.txt");
  const pdfPath = path.join(sourceDir, "doc.pdf");
  const audioPath = path.join(sourceDir, "clip.mp3");
  const binaryPath = path.join(sourceDir, "archive.bin");

  await fs.writeFile(imagePath, Buffer.from("fakepng"));
  await fs.writeFile(textPath, "hello workspace");
  await fs.writeFile(pdfPath, Buffer.from("%PDF-1.4 fake"));
  await fs.writeFile(audioPath, Buffer.from("fake-audio"));
  await fs.writeFile(binaryPath, Buffer.from([0x00, 0xff, 0x10, 0x81]));

  const attachments = await stageAttachments({
    filePaths: [imagePath, textPath, pdfPath, audioPath, binaryPath],
    requestId: "req-123",
    workspacePath,
  });

  assert.equal(attachments.length, 5);
  assert.equal(attachments[0].type, "image");
  assert.equal(attachments[0].relativePath, "inputs/req-123/01-diagram.png");
  assert.ok(attachments[0].dataBase64);
  assert.equal(attachments[0].capability, "image_native");

  assert.equal(attachments[1].type, "file");
  assert.equal(attachments[1].capability, "text_inline");
  assert.equal(attachments[1].summaryText, "hello workspace");
  assert.equal(attachments[1].relativePath, "inputs/req-123/02-notes.txt");

  assert.equal(attachments[2].type, "file");
  assert.equal(attachments[2].capability, "document_extractable");
  assert.equal(attachments[2].summaryText, undefined);
  assert.equal(attachments[2].relativePath, "inputs/req-123/03-doc.pdf");

  assert.equal(attachments[3].type, "file");
  assert.equal(attachments[3].capability, "unsupported_temporal");
  assert.equal(attachments[3].relativePath, "inputs/req-123/04-clip.mp3");

  assert.equal(attachments[4].type, "file");
  assert.equal(attachments[4].capability, "unsupported_binary");
  assert.equal(attachments[4].summaryText, undefined);
  assert.equal(attachments[4].relativePath, "inputs/req-123/05-archive.bin");

  const stagedImage = await fs.readFile(path.join(workspacePath, "inputs", "req-123", "01-diagram.png"));
  assert.equal(stagedImage.toString(), "fakepng");
});

test("loadWorkspacePreview returns text and image previews but not document or temporal previews", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-preview-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const inputsPath = path.join(workspacePath, "inputs", "req-456");
  await fs.mkdir(inputsPath, { recursive: true });

  await fs.writeFile(path.join(inputsPath, "01-notes.txt"), "preview me please");
  await fs.writeFile(path.join(inputsPath, "02-doc.pdf"), Buffer.from("%PDF-1.4 fake"));
  await fs.writeFile(path.join(inputsPath, "03-image.png"), Buffer.from("fakepng"));
  await fs.writeFile(path.join(inputsPath, "04-clip.mp3"), Buffer.from("fake-audio"));

  const textPreview = await loadWorkspacePreview({
    workspacePath,
    relativePath: "inputs/req-456/01-notes.txt",
    mediaType: "text/plain",
  });
  const pdfPreview = await loadWorkspacePreview({
    workspacePath,
    relativePath: "inputs/req-456/02-doc.pdf",
    mediaType: "application/pdf",
  });
  const imagePreview = await loadWorkspacePreview({
    workspacePath,
    relativePath: "inputs/req-456/03-image.png",
    mediaType: "image/png",
  });
  const audioPreview = await loadWorkspacePreview({
    workspacePath,
    relativePath: "inputs/req-456/04-clip.mp3",
    mediaType: "audio/mpeg",
  });

  assert.equal(textPreview.kind, "text");
  assert.equal(textPreview.text, "preview me please");
  assert.equal(pdfPreview.kind, "file");
  assert.match(pdfPreview.message, /Document preview is not supported/);
  assert.equal(imagePreview.kind, "image");
  assert.ok(imagePreview.dataBase64);
  assert.equal(audioPreview.kind, "file");
  assert.match(audioPreview.message, /Audio and video preview is not supported/);
});
