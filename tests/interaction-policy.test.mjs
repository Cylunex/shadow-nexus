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

test("allows authorized photo estimates while preserving uncertainty", () => {
  const rules = buildNexusProcessingRules([domain("health")]);
  assert.match(rules, /个\/把\/根\/碗.*notes/u);
  assert.match(rules, /用户允许估算时，可结合照片、订单和食物库估算 amount_g、kcal/u);
  assert.match(rules, /必须注明估算而非实测、依据、误差/u);
  assert.match(rules, /不把画面剩余量当完整摄入量/u);
  assert.match(rules, /常规早餐/u);
  assert.doesNotMatch(rules, /Health × Ledger/u);
});

test("asks for mandatory facts instead of inventing a purchase timestamp", () => {
  const rules = buildNexusProcessingRules([domain("ledger")]);
  assert.match(rules, /必填事实必须询问用户，不自行猜填/u);
  assert.match(rules, /报账时间不得冒充购买时间/u);
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
