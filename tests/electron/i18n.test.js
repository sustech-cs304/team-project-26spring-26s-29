const assert = require("node:assert/strict");
const test = require("node:test");

test("renderer i18n normalizes supported locales and falls back to zh-CN", async () => {
  const { createI18n, normalizeLocale } = await import("../../src/renderer/shared/i18n.mjs");

  assert.equal(normalizeLocale("en"), "en");
  assert.equal(normalizeLocale("English"), "en");
  assert.equal(normalizeLocale("fr"), "zh-CN");

  const i18n = createI18n("fr");
  assert.equal(i18n.locale, "zh-CN");
  assert.equal(i18n.t("config.save"), "保存");
  assert.equal(i18n.setLocale("en"), "en");
  assert.equal(i18n.t("config.save"), "Save");
});

test("renderer i18n interpolates parameters", async () => {
  const { createI18n } = await import("../../src/renderer/shared/i18n.mjs");

  const i18n = createI18n("en");
  assert.equal(
    i18n.t("todo.undoText", { title: "Lab report" }),
    'Deleted "Lab report". You can undo before your next action.'
  );
});

test("renderer i18n dictionaries expose matching keys", async () => {
  const { TRANSLATIONS } = await import("../../src/renderer/shared/i18n.mjs");

  const englishKeys = Object.keys(TRANSLATIONS.en).sort();
  const chineseKeys = Object.keys(TRANSLATIONS["zh-CN"]).sort();

  assert.deepEqual(chineseKeys, englishKeys);
});
