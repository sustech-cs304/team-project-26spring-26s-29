const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { stageAttachments } = require("../../src/electron/attachment-staging");

test("stageAttachments preserves image bytes and file metadata in the workspace", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "attachment-stage-"));
  const sourceDir = path.join(tempRoot, "source");
  const workspacePath = path.join(tempRoot, "workspace");
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.mkdir(path.join(workspacePath, "inputs"), { recursive: true });
  await fs.mkdir(path.join(workspacePath, "outputs"), { recursive: true });

  const imagePath = path.join(sourceDir, "diagram.png");
  const textPath = path.join(sourceDir, "notes.txt");
  const binaryPath = path.join(sourceDir, "archive.bin");

  await fs.writeFile(imagePath, Buffer.from("fakepng"));
  await fs.writeFile(textPath, "hello workspace");
  await fs.writeFile(binaryPath, Buffer.from([0x00, 0xff, 0x10, 0x81]));

  const attachments = await stageAttachments({
    filePaths: [imagePath, textPath, binaryPath],
    requestId: "req-123",
    workspacePath,
  });

  assert.equal(attachments.length, 3);
  assert.equal(attachments[0].type, "image");
  assert.equal(attachments[0].relativePath, "inputs/req-123/01-diagram.png");
  assert.ok(attachments[0].dataBase64);

  assert.equal(attachments[1].type, "file");
  assert.equal(attachments[1].summaryText, "hello workspace");
  assert.equal(attachments[1].relativePath, "inputs/req-123/02-notes.txt");

  assert.equal(attachments[2].type, "file");
  assert.equal(attachments[2].summaryText, null);
  assert.equal(attachments[2].relativePath, "inputs/req-123/03-archive.bin");

  const stagedImage = await fs.readFile(path.join(workspacePath, "inputs", "req-123", "01-diagram.png"));
  assert.equal(stagedImage.toString(), "fakepng");
});
