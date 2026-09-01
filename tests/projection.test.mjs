import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertTrustedRequest,
  createAnalyzedDrafts,
  createBootstrap,
  createContextPack,
  createMemory,
  createNexusBrief,
  createDraft,
  createDrafts,
  createNexusState,
  handleNexusRequest,
  nexusBasePathFromPluginUrl,
  reclassifyStoredDraft,
  reviewDraft
} from "../lib/index.js";

function proposal(sessionId = "session-a") {
  return createAnalyzedDrafts(sessionId, "保存这条记录", {
    protocol: "shadow.nexus.plan.v1",
    version: 3,
    interactionId: "interaction_12345678-abcd",
    route: "propose",
    response: "已生成待确认 Proposal。",
    drafts: [{
      domain: "alpha",
      intent: "alpha.record",
      summary: "Alpha Proposal",
      risk: "medium",
      fields: { source_uri: "https://example.test", nestedJson: "[{\"value\":1}]" }
    }],
    contract: { protocol: "shadow.nexus.plan-contract.v1", source: "json-frame" }
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
    protocol: "shadow.nexus.plan.v1",
    version: 3,
    interactionId: "interaction_unknown-1234",
    route: "propose",
    response: "x",
    drafts: [{ domain: "missing", intent: "missing.record", summary: "x", risk: "low", fields: {} }],
    contract: { protocol: "shadow.nexus.plan-contract.v1", source: "json-frame" }
  }, new Date(), [], new Set(["alpha"])), /未安装/u);
  assert.throws(() => createDraft(), /关键词路由已停用/u);
  assert.throws(() => createDrafts(), /关键词路由已停用/u);
});

test("keeps only attachments selected by each Proposal", () => {
  const available = ["shadow://nexus/assets/meal", "shadow://nexus/assets/order"];
  const analysis = {
    protocol: "shadow.nexus.plan.v1",
    version: 3,
    interactionId: "interaction_attachments-1234",
    route: "propose",
    response: "已拆分领域事实。",
    drafts: [
      { domain: "health", intent: "health.record", summary: "午餐", risk: "low", fields: {}, attachmentRefs: [available[0]] },
      { domain: "ledger", intent: "ledger.record", summary: "午餐消费", risk: "low", fields: {}, attachmentRefs: [available[1]] },
      { domain: "alpha", intent: "alpha.record", summary: "无附件", risk: "low", fields: {} }
    ],
    contract: { protocol: "shadow.nexus.plan-contract.v1", source: "json-frame" }
  };
  const drafts = createAnalyzedDrafts("session-a", "记录午餐", analysis, new Date(), available, new Set(["health", "ledger", "alpha"]));
  assert.deepEqual(drafts[0].attachmentRefs, [available[0]]);
  assert.deepEqual(drafts[1].attachmentRefs, [available[1]]);
  assert.equal(drafts[2].attachmentRefs, undefined);

  const forged = { ...analysis, drafts: [{ ...analysis.drafts[0], attachmentRefs: ["shadow://nexus/assets/forged"] }] };
  assert.throws(() => createAnalyzedDrafts("session-a", "记录午餐", forged, new Date(), available, new Set(["health"])), /不属于本次交互/u);
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
  assert.equal(bootstrap.activity.length, 1);
  assert.equal(bootstrap.activity[0].status, "pending");
  assert.equal(bootstrap.trust.pending, 1);
});

test("normalizes automatic, failed, and prohibited drafts into activity and trust projections", () => {
  const base = proposal();
  const bootstrap = createBootstrap("session-a", [
    { ...base, id: "automatic", state: "approved", decisionMode: "automatic", receipt: "shadow://alpha/records/1" },
    { ...base, id: "failed", reviewReason: "execution-failed", executionError: "temporarily unavailable" },
    { ...base, id: "blocked", reviewReason: "prohibited", confirmable: false }
  ], new Date("2026-08-26T08:00:00Z"));
  assert.deepEqual(bootstrap.activity.map((item) => item.status), ["completed", "failed", "prohibited"]);
  assert.equal(bootstrap.activity[0].receiptAvailable, true);
  assert.equal(bootstrap.trust.automatic, 1);
  assert.equal(bootstrap.trust.failed, 1);
  assert.equal(bootstrap.trust.prohibited, 1);
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

test("persists governed memory revisions and proactive preferences", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "shadow-nexus-memory-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "state.json");
  const state = createNexusState(file);
  await state.ready;
  const memory = createMemory({ content: "Prefer quiet evening workouts", expiresInDays: 30 }, new Date("2026-08-27T08:00:00Z"));
  state.memories.set(`${memory.id}:${memory.version}`, memory);
  state.preferences = { ...state.preferences, briefCadence: "weekly", notificationsEnabled: false };
  await state.persist();
  const restored = createNexusState(file);
  await restored.ready;
  assert.equal(restored.memories.get(`${memory.id}:1`)?.content, memory.content);
  assert.equal(restored.preferences.briefCadence, "weekly");
  assert.equal(restored.preferences.notificationsEnabled, false);
});

test("creates stable briefs without leaking entity values", () => {
  const preferences = { notificationsEnabled: true, quietHoursStart: "22:00", quietHoursEnd: "08:00", sensitivePreviews: false, briefCadence: "daily" };
  const brief = createNexusBrief({ mode: "connected", signals: [], domains: [{
    id: "health", label: "Health", caption: "", status: "ready", metric: "", detail: "", icon: "health", color: "#112233", order: 1,
    captureEnabled: true, searchEnabled: false, intentPrefixes: [], entities: [{ id: "weight", domain: "health", label: "Weight", class: "measurement", sensitivity: "sensitive", availability: "stale", value: "72.4", unit: "kg", icon: "weight", tone: "neutral", order: 1, actionIds: [] }]
  }] }, { total: 1, automatic: 0, manual: 0, rejected: 0, pending: 1, failed: 0, prohibited: 0, domains: [] }, [], preferences, new Date("2026-08-27T12:00:00Z"));
  assert.equal(brief?.notify, true);
  assert.match(brief?.body ?? "", /需要复核/u);
  assert.doesNotMatch(brief?.body ?? "", /72\.4/u);
});

test("automatically executes trusted proposals and keeps a review receipt", async (context) => {
  const state = createNexusState();
  let commits = 0;
  const domains = {
    runtime: { domains: [{ id: "alpha" }] },
    policyFor: () => ({
      risk: "medium", mode: "automatic",
      capabilityRef: "shadow://capabilities/shadow-alpha/alpha-test/alpha.records.write",
      operationId: "commit_alpha_review"
    }),
    quickActionDraft: ({ sessionId = "quick-action:alpha", fields }) => ({
      ...proposal(), id: "quick-alpha", captureGroupId: "quick-alpha", sessionId,
      text: "快捷记录", summary: "快捷记录", fields: { value: fields.value }, risk: "medium"
    }),
    createDraft: async (draft) => {
      if (draft.summary === "自动失败") throw new Error("领域暂时不可用。");
      commits += 1;
      return "shadow://alpha/records/automatic";
    },
    rejectDraft: async () => {},
    reconcileConfirmedDraft: async () => undefined,
    discoverDrafts: async () => [],
    discoverSuggestions: async () => [],
    search: async () => ({ query: "", items: [], searchedDomains: [], unavailableDomains: [] }),
    project: async () => ({ mode: "connected", domains: [], signals: [] })
  };
  const assets = { configured: false };
  const server = createServer((request, response) => { void handleNexusRequest(request, response, state, domains, assets); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.equal(typeof address, "object");
  const response = await fetch(`http://127.0.0.1:${address.port}/shadow-nexus/capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-a",
      text: "保存这条记录",
      analysis: {
        protocol: "shadow.nexus.plan.v1",
        version: 3,
        interactionId: "interaction_auto-12345678",
        route: "propose",
        response: "已处理。",
        drafts: [{ domain: "alpha", intent: "alpha.record", summary: "自动处理", risk: "low", fields: { value: "1" } }],
        contract: { protocol: "shadow.nexus.plan-contract.v1", source: "json-frame", provider: "test" }
      }
    })
  });
  assert.equal(response.status, 201);
  const [result] = await response.json();
  assert.equal(commits, 1);
  assert.equal(result.state, "approved");
  assert.equal(result.risk, "medium");
  assert.equal(result.decisionMode, "automatic");
  assert.equal(result.receipt, "shadow://alpha/records/automatic");
  assert.equal(result.capabilityRef, "shadow://capabilities/shadow-alpha/alpha-test/alpha.records.write");
  assert.equal(result.correlationId, result.captureGroupId);
  assert.equal(result.idempotencyKey, result.id);
  assert.equal(state.drafts.get(result.id)?.receipt, result.receipt);

  const quickResponse = await fetch(`http://127.0.0.1:${address.port}/shadow-nexus/quick-actions/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "session-a", domain: "alpha", actionId: "quick-value", fields: { value: "3" } })
  });
  assert.equal(quickResponse.status, 201);
  const quickResult = await quickResponse.json();
  assert.equal(quickResult.state, "approved");
  assert.equal(quickResult.decisionMode, "automatic");
  assert.equal(quickResult.receipt, "shadow://alpha/records/automatic");

  const failedResponse = await fetch(`http://127.0.0.1:${address.port}/shadow-nexus/capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-a",
      text: "保存另一条记录",
      analysis: {
        protocol: "shadow.nexus.plan.v1",
        version: 3,
        interactionId: "interaction_fail-12345678",
        route: "propose",
        response: "稍后复核。",
        drafts: [{ domain: "alpha", intent: "alpha.record", summary: "自动失败", risk: "low", fields: { value: "2" } }],
        contract: { protocol: "shadow.nexus.plan-contract.v1", source: "json-frame", provider: "test" }
      }
    })
  });
  assert.equal(failedResponse.status, 201);
  const [failed] = await failedResponse.json();
  assert.equal(failed.state, "pending");
  assert.equal(failed.reviewReason, "execution-failed");
  assert.equal(failed.executionError, "领域暂时不可用。");
  assert.equal(failed.failureCode, "unexpected-execution-failure");

  const beforeInvalid = commits;
  const invalidResponse = await fetch(`http://127.0.0.1:${address.port}/shadow-nexus/capture`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId: "session-a", text: "不要执行畸形计划", analysis: {
        protocol: "shadow.nexus.plan.v1", version: 3, interactionId: "interaction_invalid-12345678",
        route: "propose", response: "x", injected: true,
        drafts: [{ domain: "alpha", intent: "alpha.record", summary: "不应执行", risk: "low", fields: { value: "9" } }],
        contract: { protocol: "shadow.nexus.plan-contract.v1", source: "json-frame" }
      }
    })
  });
  assert.equal(invalidResponse.status, 422);
  assert.equal(commits, beforeInvalid);
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
