const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const indexHtml = fs.readFileSync(
  path.join(__dirname, "..", "..", "src", "renderer", "index.html"),
  "utf8"
);

test("sidebar manual link opens SUSTech manual as an external link", () => {
  assert.match(indexHtml, /href="https:\/\/sustech\.online\/"/);
  assert.match(indexHtml, /target="_blank"/);
  assert.match(indexHtml, /data-i18n="nav\.manual"/);
  assert.doesNotMatch(indexHtml, /data-page-target="manual"/);
});
