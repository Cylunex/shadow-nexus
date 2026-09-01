import assert from "node:assert/strict";
import test from "node:test";
import { buildNexusProcessingRules } from "../lib/index.js";

function domain(id) {
  return {
    id, label: id, caption: "", status: "ready", metric: "", detail: "", icon: id,
    color: "#000000", order: 1, captureEnabled: true, searchEnabled: false,
    reviewRisk: "medium", intentPrefixes: [`${id}.record`]
  };
}

test("requires complete cross-domain capture without unnecessary confirmation", () => {
  const rules = buildNexusProcessingRules([domain("health"), domain("ledger")]);
  assert.match(rules, /逐项检查用户明确要保存的事实/u);
  assert.match(rules, /不再次确认 L0–L2/u);
  assert.match(rules, /route=mixed，先生成完整 Proposal/u);
  assert.match(rules, /外卖可同时产生饮食和消费两类 Proposal/u);
  assert.match(rules, /不能因同时记录饮食而漏账/u);
});

test("preserves notes and refuses invented nutrition estimates", () => {
  const rules = buildNexusProcessingRules([domain("health")]);
  assert.match(rules, /个\/把\/根\/碗.*notes/u);
  assert.match(rules, /不从照片或份量估算 amount_g、kcal/u);
  assert.match(rules, /常规早餐/u);
  assert.doesNotMatch(rules, /Health × Ledger/u);
});

test("emits only guidance for capture-enabled installed domains", () => {
  const rules = buildNexusProcessingRules([{ ...domain("ledger"), captureEnabled: false }]);
  assert.doesNotMatch(rules, /Ledger：/u);
  assert.match(rules, /领域 Host 返回正式回执前不得说/u);
});

test("does not emit interaction-only route or receipt language for batch capture", () => {
  const rules = buildNexusProcessingRules([domain("health")], "capture");
  assert.match(rules, /缺必填字段的事实不得编造或阻断其他完整 Proposal/u);
  assert.doesNotMatch(rules, /route=mixed/u);
  assert.doesNotMatch(rules, /response/u);
});
