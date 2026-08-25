import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertTrustedRequest, createAnalyzedDrafts, createBootstrap, createDraft, createDrafts, createNexusState, nexusBasePathFromPluginUrl, reclassifyStoredDraft, reviewDraft } from "../lib/index.js";

test("derives Nexus API base path from its loaded plugin script", () => {
  assert.equal(nexusBasePathFromPluginUrl("https://nexus.example.com/plugins/@cylunex/shadow-nexus/client.js?rev=1"), "");
  assert.equal(nexusBasePathFromPluginUrl("https://nas.example.com/harness/plugins/@cylunex/shadow-nexus/client.js?rev=1"), "/harness");
  assert.equal(nexusBasePathFromPluginUrl("https://nas.example.com/agent/ui/plugins/@cylunex/shadow-nexus/client.js"), "/agent/ui");
  assert.equal(nexusBasePathFromPluginUrl("not a plugin URL"), "");
});

test("routes health capture and extracts weight", () => {
  const draft = createDraft("session-a", "今天体重 68.4kg，睡眠不错", new Date("2026-08-23T08:00:00Z"));
  assert.equal(draft.domain, "health");
  assert.equal(draft.intent, "health.record");
  assert.equal(draft.risk, "medium");
  assert.equal(draft.fields.weightKg, "68.4");
});

test("routes ledger capture and extracts amount", () => {
  const draft = createDraft("session-a", "午餐花了 48 元", new Date("2026-08-23T08:00:00Z"));
  assert.equal(draft.domain, "ledger");
  assert.equal(draft.fields.amount, "48");
});

test("fans a mixed meal receipt out to reviewable Health and Ledger drafts", () => {
  const text = `商家名称：张亮麻辣烫（百子湾店）
消费类型：午餐 / 单人麻辣烫
实际支付：¥25.52
餐次：午餐 / 单人麻辣烫
总重量：**~570g**
总热量：**~679 kcal**
蛋白质：**~44.7 g**
用途：营养记录、财务记账`;
  const drafts = createDrafts("session-a", text, new Date("2026-08-23T08:00:00Z"));
  assert.deepEqual(drafts.map((draft) => draft.domain), ["health", "ledger"]);
  assert.equal(new Set(drafts.map((draft) => draft.captureGroupId)).size, 1);
  const health = drafts.find((draft) => draft.domain === "health");
  const ledger = drafts.find((draft) => draft.domain === "ledger");
  assert.equal(health?.fields.meal, "午餐");
  assert.equal(health?.fields.mealName, "单人麻辣烫");
  assert.equal(health?.fields.amountG, "570");
  assert.equal(health?.fields.kcal, "679");
  assert.equal(health?.fields.proteinG, "44.7");
  assert.equal(ledger?.fields.amount, "25.52");
  assert.equal(ledger?.fields.merchant, "张亮麻辣烫（百子湾店）");
  assert.equal(ledger?.fields.categoryKey, "food");
  assert.equal(ledger?.fields.title, "午餐 / 单人麻辣烫 · 张亮麻辣烫（百子湾店）");
});

test("uses completed DSH analysis as the capture routing authority", () => {
  const text = "午餐吃了麻辣烫，支付 25.52 元";
  const drafts = createAnalyzedDrafts("session-a", text, {
    version: 1,
    captureId: "capture_12345678-abcd",
    drafts: [{
      domain: "health",
      intent: "health.record",
      summary: "午餐 · 麻辣烫 · 约 679 kcal",
      risk: "medium",
      fields: { recordType: "meal", meal: "午餐", mealName: "麻辣烫", kcal: "679" }
    }]
  }, new Date("2026-08-25T08:00:00Z"));
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].domain, "health");
  assert.equal(drafts[0].fields.original, text);
  assert.equal(drafts[0].captureGroupId, "draft_capture_12345678-abcd");
});

test("accepts repeated domains for batch capture and rejects oversized DSH analysis", () => {
  const item = { domain: "health", intent: "health.record", summary: "午餐", risk: "medium", fields: { recordType: "meal" } };
  const drafts = createAnalyzedDrafts("session-a", "两顿午餐", {
    version: 1,
    captureId: "capture_12345678-abcd",
    drafts: [item, item]
  }, new Date("2026-08-25T08:00:00Z"), ["shadow://assets/receipt"]);
  assert.equal(drafts.length, 2);
  assert.equal(new Set(drafts.map((draft) => draft.id)).size, 2);
  assert.deepEqual(drafts[0].attachmentRefs, ["shadow://assets/receipt"]);
  assert.throws(() => createAnalyzedDrafts("session-a", "批量", {
    version: 1,
    captureId: "capture_12345678-abcd",
    drafts: Array.from({ length: 201 }, () => item)
  }), /没有返回/u);
});

test("migrates a pending legacy Archive draft into deterministic domain drafts", () => {
  const legacy = {
    ...createDraft("session-a", "保存一条资料", new Date("2026-08-23T08:00:00Z")),
    id: "draft_legacy",
    classificationVersion: undefined,
    captureGroupId: undefined,
    domain: "archive",
    intent: "archive.capture",
    text: "午餐总热量 679 kcal，实际支付 ¥25.52，用于营养记录和财务记账"
  };
  const migrated = reclassifyStoredDraft(legacy);
  assert.deepEqual(migrated.map((draft) => draft.id), ["draft_legacy_health", "draft_legacy_ledger"]);
  assert.deepEqual(migrated.map((draft) => draft.domain), ["health", "ledger"]);
  assert.ok(migrated.every((draft) => draft.classificationVersion === 2));
});

test("keeps unknown information in archive capture", () => {
  const draft = createDraft("session-a", "以后可能用得上的零散内容", new Date("2026-08-23T08:00:00Z"));
  assert.equal(draft.domain, "archive");
  assert.equal(draft.risk, "low");
  assert.equal(draft.fields.original, "以后可能用得上的零散内容");
});

test("bootstrap projects the global review queue across source sessions", () => {
  const now = new Date("2026-08-23T08:00:00Z");
  const a = createDraft("session-a", "收藏一篇文章", now);
  const b = createDraft("session-b", "旅行路线", now);
  const bootstrap = createBootstrap("session-a", [a, b], now);
  assert.equal(bootstrap.protocol, "shadow.nexus.v1");
  assert.deepEqual(bootstrap.drafts.map((draft) => draft.id), [a.id, b.id]);
  assert.deepEqual(bootstrap.assetUpload, { enabled: false, maxFilesPerMessage: 8 });
});

test("bootstrap advertises the shared Asset upload path when configured", () => {
  const bootstrap = createBootstrap("session-a", [], new Date("2026-08-23T08:00:00Z"), undefined, true);
  assert.equal(bootstrap.assetUpload.enabled, true);
});

test("bootstrap without a selected session keeps global projections and review drafts", () => {
  const now = new Date("2026-08-23T08:00:00Z");
  const draft = createDraft("session-a", "午餐花了 48 元", now);
  const bootstrap = createBootstrap(undefined, [draft], now);
  assert.deepEqual(bootstrap.drafts.map((item) => item.id), [draft.id]);
  assert.equal(bootstrap.domains.length, 5);
});

test("review creates a receipt and cannot be repeated", () => {
  const draft = createDraft("session-a", "买了咖啡 26 元", new Date("2026-08-23T08:00:00Z"));
  const approved = reviewDraft(draft, "approve", new Date("2026-08-23T08:01:00Z"));
  assert.equal(approved.state, "approved");
  assert.match(approved.receipt ?? "", /^preview:ledger:/u);
  assert.throws(() => reviewDraft(approved, "reject"), /已经处理/u);
});

test("rejects empty and oversized captures", () => {
  assert.throws(() => createDraft("session-a", "  "), /不能为空/u);
  assert.throws(() => createDraft("session-a", "x".repeat(4_001)), /4000/u);
});

test("accepts same-origin JSON and rejects cross-site requests", () => {
  assert.doesNotThrow(() => assertTrustedRequest({
    method: "POST",
    headers: { host: "localhost:18181", origin: "http://localhost:18181", "content-type": "application/json; charset=utf-8" }
  }));
  assert.throws(() => assertTrustedRequest({
    method: "GET",
    headers: { host: "localhost:18181", "sec-fetch-site": "cross-site" }
  }), /跨站/u);
  assert.throws(() => assertTrustedRequest({
    method: "POST",
    headers: { host: "localhost:18181", origin: "https://attacker.example", "content-type": "application/json" }
  }), /跨来源/u);
});

test("persists and reloads the review queue atomically", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "shadow-nexus-state-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "drafts.json");
  const state = createNexusState(file);
  await state.ready;
  const draft = createDraft("session-a", "午餐花了 48 元", new Date("2026-08-23T08:00:00Z"));
  const attachment = {
    id: "attachment-a",
    sessionId: "session-a",
    assetId: "asset-a",
    versionId: "version-a",
    referenceUri: "shadow://nexus/conversations/test/attachments/attachment-a",
    conversationPath: "/workspace/.shadow-nexus/assets/test/attachment-a-report.pdf",
    filename: "report.pdf",
    contentType: "application/pdf",
    sizeBytes: 5,
    createdAt: "2026-08-23T08:00:00.000Z"
  };
  state.drafts.set(draft.id, draft);
  state.attachments.set(attachment.id, attachment);
  await state.persist();
  assert.match(await readFile(file, "utf8"), new RegExp(draft.id, "u"));
  const restored = createNexusState(file);
  await restored.ready;
  assert.equal(restored.drafts.get(draft.id)?.summary, draft.summary);
  assert.equal(restored.attachments.get(attachment.id)?.referenceUri, attachment.referenceUri);
});
