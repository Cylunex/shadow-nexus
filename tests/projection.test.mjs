import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertTrustedRequest,
  createAnalyzedDrafts,
  createBootstrap,
  createContextPack,
  createDraft,
  createDrafts,
  createNexusState,
  nexusBasePathFromPluginUrl,
  reclassifyStoredDraft,
  reviewDraft
} from "../lib/index.js";

function proposal(sessionId = "session-a") {
  return createAnalyzedDrafts(sessionId, "保存这条记录", {
    version: 2,
    interactionId: "interaction_12345678-abcd",
    route: "propose",
    response: "已生成待确认 Proposal。",
    drafts: [{
      domain: "alpha",
      intent: "alpha.record",
      summary: "Alpha Proposal",
      risk: "medium",
      fields: { source_uri: "https://example.test", nestedJson: "[{\"value\":1}]" }
    }]
  }, new Date("2026-08-26T08:00:00Z"), [], new Set(["alpha"]))[0];
}

test("derives Nexus API base path from its loaded plugin script", () => {
  assert.equal(nexusBasePathFromPluginUrl("https://nexus.example.com/plugins/@cylunex/shadow-nexus/client.js?rev=1"), "");
  assert.equal(nexusBasePathFromPluginUrl("https://nas.example.com/harness/plugins/@cylunex/shadow-nexus/client.js?rev=1"), "/harness");
  assert.equal(nexusBasePathFromPluginUrl("https://nas.example.com/agent/ui/plugins/@cylunex/shadow-nexus/client.js"), "/agent/ui");
});

test("uses completed DSH analysis and installed projection as the only routing authority", () => {
  const draft = proposal();
  assert.equal(draft.domain, "alpha");
  assert.equal(draft.fields.source_uri, "https://example.test");
  assert.throws(() => createAnalyzedDrafts("session-a", "x", {
    version: 2,
    interactionId: "interaction_unknown-1234",
    route: "propose",
    response: "x",
    drafts: [{ domain: "missing", intent: "missing.record", summary: "x", risk: "low", fields: {} }]
  }, new Date(), [], new Set(["alpha"])), /未安装/u);
  assert.throws(() => createDraft(), /关键词路由已停用/u);
  assert.throws(() => createDrafts(), /关键词路由已停用/u);
});

test("preserves legacy drafts without silently reclassifying their domain", () => {
  const legacy = { ...proposal(), classificationVersion: undefined, captureGroupId: undefined, domain: "legacy-domain" };
  const migrated = reclassifyStoredDraft(legacy);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].domain, "legacy-domain");
  assert.equal(migrated[0].classificationVersion, 2);
});

test("bootstrap projects only compiled domains", () => {
  const domain = {
    id: "alpha", label: "Alpha", caption: "Alpha facts", status: "ready", metric: "7", detail: "ready",
    icon: "alpha", color: "#112233", order: 10, captureEnabled: true, searchEnabled: false, appUrl: "https://alpha.example.test/", reviewRisk: "medium", intentPrefixes: ["alpha.record"]
  };
  const bootstrap = createBootstrap("session-a", [proposal()], new Date("2026-08-26T08:00:00Z"), { mode: "connected", domains: [domain], signals: [] }, true);
  assert.equal(bootstrap.protocol, "shadow.nexus.v1");
  assert.deepEqual(bootstrap.domains.map((item) => item.id), ["alpha"]);
  assert.equal(bootstrap.assetUpload.enabled, true);
});

test("creates expiring Context Packs and persists them with the current session", async (context) => {
  const pack = createContextPack({
    session_id: "session-a",
    source_domain: "archive",
    resource_refs: ["shadow://archive/records/record-1"],
    goal: "解释这份资料"
  }, new Date("2026-08-27T08:00:00Z"));
  assert.equal(pack.protocol, "shadow.context.v1");
  assert.equal(pack.expires_at, "2026-08-28T08:00:00.000Z");
  assert.throws(() => createContextPack({ session_id: "session-a" }), /不能为空/u);

  const directory = await mkdtemp(join(tmpdir(), "shadow-nexus-context-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  const state = createNexusState(file);
  await state.ready;
  state.contexts.set(pack.context_id, pack);
  await state.persist();
  const restored = createNexusState(file);
  await restored.ready;
  assert.equal(restored.contexts.get(pack.context_id)?.goal, "解释这份资料");
});

test("persists suggestion feedback separately from domain facts", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "shadow-nexus-suggestion-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  const state = createNexusState(file);
  await state.ready;
  state.suggestionFeedback.set("health:weekly:2026-W35", {
    dedupeKey: "health:weekly:2026-W35", domain: "health", ruleId: "health.weekly-review",
    action: "snooze", until: "2026-08-28T08:00:00Z", updatedAt: "2026-08-27T08:00:00Z"
  });
  await state.persist();
  const restored = createNexusState(file);
  await restored.ready;
  assert.equal(restored.suggestionFeedback.get("health:weekly:2026-W35")?.action, "snooze");
});

test("review creates a receipt and cannot be repeated", () => {
  const draft = proposal();
  const approved = reviewDraft(draft, "approve", new Date("2026-08-26T08:01:00Z"));
  assert.equal(approved.state, "approved");
  assert.match(approved.receipt ?? "", /^preview:alpha:/u);
  assert.throws(() => reviewDraft(approved, "reject"), /已经处理/u);
});

test("accepts same-origin JSON and rejects cross-site requests", () => {
  assert.doesNotThrow(() => assertTrustedRequest({ method: "POST", headers: { host: "localhost:18181", origin: "http://localhost:18181", "content-type": "application/json; charset=utf-8" } }));
  assert.throws(() => assertTrustedRequest({ method: "GET", headers: { host: "localhost:18181", "sec-fetch-site": "cross-site" } }), /跨站/u);
  assert.throws(() => assertTrustedRequest({ method: "POST", headers: { host: "localhost:18181", origin: "https://attacker.example", "content-type": "application/json" } }), /跨来源/u);
});

test("persists and reloads the review queue atomically", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "shadow-nexus-state-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "drafts.json");
  const state = createNexusState(file);
  await state.ready;
  const draft = proposal();
  state.drafts.set(draft.id, draft);
  await state.persist();
  assert.match(await readFile(file, "utf8"), new RegExp(draft.id, "u"));
  const restored = createNexusState(file);
  await restored.ready;
  assert.equal(restored.drafts.get(draft.id)?.domain, "alpha");
});
