import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyzedDrafts, sameProposal, upsertProposal } from "../lib/index.js";

function analyzed(sessionId, interactionId, domain, fields, summary) {
  return createAnalyzedDrafts(sessionId, summary, {
    version: 2,
    interactionId,
    route: "propose",
    response: "已整理为待确认 Proposal。",
    drafts: [{ domain, intent: `${domain}.record`, summary, risk: "medium", fields }]
  }, new Date("2026-08-26T04:00:00Z"))[0];
}

test("accepts an answer-only unified plan without creating proposals", () => {
  const drafts = createAnalyzedDrafts("session-a", "最近体重趋势怎么样", {
    version: 2,
    interactionId: "interaction_12345678-abcd",
    route: "answer",
    response: "最近一个月整体平稳。",
    drafts: []
  }, new Date("2026-08-26T04:00:00Z"));
  assert.deepEqual(drafts, []);
});

test("links the same Ledger fact from Nexus and the domain draft", () => {
  const nexus = analyzed("session-a", "interaction_ledger-a1", "ledger", {
    occurredAt: "2026-08-26T12:00:00+08:00",
    moneyType: "expense",
    amount: "25.52",
    currency: "CNY",
    categoryKey: "food",
    merchant: "张亮麻辣烫（百子湾店）",
    title: "午餐 / 单人麻辣烫"
  }, "午餐麻辣烫实际支付 25.52 元");
  const domain = {
    ...nexus,
    id: "domain_ledger_3333",
    sessionId: "domain:ledger",
    summary: "午餐 · 张亮麻辣烫（百子湾店） · ¥25.52",
    fields: { ...nexus.fields, title: "午餐 · 张亮麻辣烫（百子湾店）" },
    origin: "domain",
    domainDraftRef: "shadow://ledger/records/33333333-3333-4333-8333-333333333333",
    domainRevision: 4
  };
  assert.equal(sameProposal(nexus, domain), true);
  const drafts = new Map();
  upsertProposal(drafts, nexus, new Date("2026-08-26T04:00:01Z"));
  const linked = upsertProposal(drafts, domain, new Date("2026-08-26T04:00:02Z"));
  assert.equal(drafts.size, 1);
  assert.equal(linked.matched, true);
  assert.equal(linked.draft.id, nexus.id);
  assert.equal(linked.draft.origin, "domain");
  assert.equal(linked.draft.domainDraftRef, domain.domainDraftRef);
  assert.equal(linked.draft.domainRevision, 4);
  assert.equal(linked.draft.match, "linked");
  const revised = {
    ...domain,
    summary: "修订后的餐饮交易 · ¥25.52",
    fields: { ...domain.fields, merchant: "修订商家名", title: "修订后的餐饮交易" },
    domainRevision: 5
  };
  const refreshed = upsertProposal(drafts, revised, new Date("2026-08-26T04:04:00Z"));
  assert.equal(refreshed.changed, true);
  assert.equal(refreshed.draft.id, nexus.id);
  assert.equal(refreshed.draft.domainRevision, 5);
  assert.equal(drafts.size, 1);
  const repeated = upsertProposal(drafts, revised, new Date("2026-08-26T04:05:00Z"));
  assert.equal(repeated.changed, false);
  assert.equal(repeated.draft.updatedAt, refreshed.draft.updatedAt);
});

test("links matching Health nutrition and leaves distinct meals separate", () => {
  const nexus = analyzed("session-a", "interaction_health-a1", "health", {
    recordType: "meal",
    effectiveDate: "2026-08-26",
    meal: "午餐",
    mealName: "单人麻辣烫",
    amountG: "570",
    kcal: "679",
    proteinG: "44.7"
  }, "午餐麻辣烫约 679 kcal");
  const domain = {
    ...nexus,
    id: "domain_health_abcd",
    sessionId: "domain:health:primary",
    summary: "午餐 · 单人麻辣烫 · 约 679 kcal",
    origin: "domain",
    domainDraftRef: "shadow://health/drafts/hd_abcd"
  };
  const dinner = {
    ...domain,
    id: "domain_health_efgh",
    domainDraftRef: "shadow://health/drafts/hd_efgh",
    fields: { ...domain.fields, meal: "晚餐" }
  };
  assert.equal(sameProposal(nexus, domain), true);
  assert.equal(sameProposal(nexus, dinner), false);
  const drafts = new Map([[nexus.id, nexus]]);
  upsertProposal(drafts, domain);
  upsertProposal(drafts, dinner);
  assert.equal(drafts.size, 2);
});

test("keeps an unchanged federated proposal refresh silent", () => {
  const domain = {
    ...analyzed("domain:ledger", "interaction_ledger-b1", "ledger", {
      occurredAt: "2026-08-26T13:00:00+08:00",
      moneyType: "expense",
      amount: "18.00",
      currency: "CNY",
      merchant: "咖啡店",
      title: "咖啡"
    }, "咖啡 18 元"),
    id: "domain_ledger_refresh",
    origin: "domain",
    domainDraftRef: "shadow://ledger/records/44444444-4444-4444-8444-444444444444",
    domainRevision: 1
  };
  const drafts = new Map();
  const created = upsertProposal(drafts, domain, new Date("2026-08-26T04:00:01Z"));
  const repeated = upsertProposal(drafts, domain, new Date("2026-08-26T04:05:00Z"));
  assert.equal(created.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.draft.updatedAt, created.draft.updatedAt);
});

test("returns an already approved semantic match instead of reopening it", () => {
  const first = analyzed("session-a", "interaction_ledger-c1", "ledger", {
    occurredAt: "2026-08-26T14:00:00+08:00",
    moneyType: "expense",
    amount: "12",
    currency: "CNY",
    merchant: "便利店",
    title: "饮料"
  }, "便利店饮料 12 元");
  const approved = { ...first, state: "approved", receipt: "shadow://ledger/records/receipt" };
  const repeated = { ...first, id: "another_proposal", summary: "饮料 · 便利店 · ¥12" };
  const drafts = new Map([[approved.id, approved]]);
  const result = upsertProposal(drafts, repeated);
  assert.equal(result.changed, false);
  assert.equal(result.draft.id, approved.id);
  assert.equal(result.draft.match, "existing");
  assert.equal(drafts.size, 1);
});
