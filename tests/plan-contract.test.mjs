import assert from "node:assert/strict";
import test from "node:test";
import {
  intentPlanFromBlocks,
  safeIntentFallback,
  validateSubmittedAnalysis
} from "../lib/index.js";

const interactionId = "interaction_contract-12345678";

function rawPlan(overrides = {}) {
  return {
    protocol: "shadow.nexus.plan.v1",
    version: 3,
    interactionId,
    route: "propose",
    response: "识别到一条记录。",
    drafts: [{ domain: "alpha", intent: "alpha.record", summary: "Alpha", risk: "medium", fields: { value: "1" } }],
    ...overrides
  };
}

test("parses one complete provider-neutral JSON frame and records provenance", () => {
  const plan = intentPlanFromBlocks([{ kind: "text", text: JSON.stringify(rawPlan()) }], interactionId, { provider: "openai", model: "example" });
  assert.equal(plan?.version, 3);
  assert.equal(plan?.contract.source, "json-frame");
  assert.equal(plan?.contract.provider, "openai");
});

test("prefers a structured tool-call block when a provider exposes one", () => {
  const plan = intentPlanFromBlocks([{
    kind: "tool-call", name: "shadow_nexus_plan", argsRaw: JSON.stringify(rawPlan())
  }], interactionId, { provider: "tool-provider" });
  assert.equal(plan?.contract.source, "tool-call");
  assert.equal(plan?.drafts[0]?.domain, "alpha");
});

test("upgrades a strictly shaped legacy tagged envelope without weakening validation", () => {
  const legacy = { ...rawPlan(), version: 2 };
  delete legacy.protocol;
  const plan = intentPlanFromBlocks([{
    kind: "text", text: `旧版可见回复\n<shadow-nexus-plan>\n${JSON.stringify(legacy)}\n</shadow-nexus-plan>`
  }], interactionId);
  assert.equal(plan?.version, 3);
  assert.equal(plan?.contract.source, "legacy-envelope");
});

test("rejects extracted prose, extra fields, and inconsistent routes", () => {
  assert.equal(intentPlanFromBlocks([{ kind: "text", text: `prefix ${JSON.stringify(rawPlan())}` }], interactionId), undefined);
  assert.throws(() => intentPlanFromBlocks([{ kind: "text", text: JSON.stringify(rawPlan({ extra: true })) }], interactionId), /字段/u);
  assert.throws(() => intentPlanFromBlocks([{ kind: "text", text: JSON.stringify(rawPlan({ route: "answer" })) }], interactionId), /不一致/u);
});

test("fails closed without a contract and never creates fallback drafts", () => {
  const answer = safeIntentFallback([{ kind: "text", text: "这是普通回答。" }], interactionId, false, { provider: "legacy" });
  assert.equal(answer.route, "answer");
  assert.deepEqual(answer.drafts, []);
  assert.equal(answer.contract.source, "safe-fallback");

  const record = safeIntentFallback([{ kind: "text", text: "已经记好了。" }], interactionId, true);
  assert.equal(record.route, "clarify");
  assert.deepEqual(record.drafts, []);
  assert.match(record.response, /未执行任何操作/u);
});

test("revalidates the complete submitted contract at the Host boundary", () => {
  const parsed = intentPlanFromBlocks([{ kind: "text", text: JSON.stringify(rawPlan()) }], interactionId);
  assert.equal(validateSubmittedAnalysis(parsed).protocol, "shadow.nexus.plan.v1");
  assert.throws(() => validateSubmittedAnalysis({ ...parsed, injected: true }), /字段/u);
  assert.throws(() => validateSubmittedAnalysis({ ...parsed, contract: { ...parsed.contract, source: "unknown" } }), /元数据/u);
});
