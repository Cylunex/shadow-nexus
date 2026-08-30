import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyzedDrafts, sameProposal, upsertProposal } from "../lib/index.js";

function analyzed(sessionId, interactionId, fields, summary = "Alpha proposal") {
  return createAnalyzedDrafts(sessionId, summary, {
    version: 2,
    interactionId,
    route: "propose",
    response: "已整理为待确认 Proposal。",
    drafts: [{ domain: "alpha", intent: "alpha.record", summary, risk: "medium", fields }]
  }, new Date("2026-08-26T04:00:00Z"), [], new Set(["alpha"]))[0];
}

test("accepts an answer-only plan without proposals", () => {
  assert.deepEqual(createAnalyzedDrafts("session-a", "question", {
    version: 2,
    interactionId: "interaction_12345678-abcd",
    route: "answer",
    response: "answer",
    drafts: []
  }), []);
});

test("deduplicates any domain by intent and normalized declared fields", () => {
  const first = analyzed("session-a", "interaction_alpha-a1", { key: "value", count: "2" });
  const same = { ...first, id: "domain-alpha", sessionId: "domain:alpha", origin: "domain", domainDraftRef: "shadow://alpha/reviews/r1", domainReviewId: "r1", confirmable: true };
  const distinct = { ...same, id: "domain-alpha-2", fields: { ...same.fields, count: "3" }, domainDraftRef: "shadow://alpha/reviews/r2", domainReviewId: "r2" };
  assert.equal(sameProposal(first, same), true);
  assert.equal(sameProposal(first, distinct), false);

  const drafts = new Map();
  upsertProposal(drafts, first, new Date("2026-08-26T04:00:01Z"));
  const linked = upsertProposal(drafts, same, new Date("2026-08-26T04:00:02Z"));
  assert.equal(drafts.size, 1);
  assert.equal(linked.draft.domainReviewId, "r1");
  assert.equal(linked.draft.confirmable, true);
  upsertProposal(drafts, distinct);
  assert.equal(drafts.size, 2);
});

test("keeps an unchanged federated refresh silent", () => {
  const domain = { ...analyzed("domain:alpha", "interaction_alpha-b1", { key: "value" }), id: "domain_alpha_refresh", origin: "domain", domainDraftRef: "shadow://alpha/reviews/r1", domainReviewId: "r1" };
  const drafts = new Map();
  const created = upsertProposal(drafts, domain, new Date("2026-08-26T04:00:01Z"));
  const repeated = upsertProposal(drafts, domain, new Date("2026-08-26T04:05:00Z"));
  assert.equal(created.changed, true);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.draft.updatedAt, created.draft.updatedAt);
});

test("returns an approved semantic match instead of reopening it", () => {
  const first = analyzed("session-a", "interaction_alpha-c1", { key: "value" });
  const approved = { ...first, state: "approved", receipt: "shadow://alpha/records/1" };
  const repeated = { ...first, id: "another_proposal" };
  const drafts = new Map([[approved.id, approved]]);
  const result = upsertProposal(drafts, repeated);
  assert.equal(result.changed, false);
  assert.equal(result.draft.id, approved.id);
  assert.equal(result.draft.match, "existing");
});

test("never lowers the risk of an equivalent pending proposal", () => {
  const drafts = new Map();
  const base = analyzed("session-a", "interaction_alpha-risk", { value: "same" });
  const high = { ...base, id: "high", risk: "high" };
  const low = { ...base, id: "low", risk: "low" };
  upsertProposal(drafts, high);
  const result = upsertProposal(drafts, low);
  assert.equal(result.draft.risk, "high");
});
