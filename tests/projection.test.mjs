import assert from "node:assert/strict";
import test from "node:test";
import { assertTrustedRequest, createBootstrap, createDraft, reviewDraft } from "../lib/index.js";

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

test("keeps unknown information in archive capture", () => {
  const draft = createDraft("session-a", "以后可能用得上的零散内容", new Date("2026-08-23T08:00:00Z"));
  assert.equal(draft.domain, "archive");
  assert.equal(draft.risk, "low");
  assert.equal(draft.fields.original, "以后可能用得上的零散内容");
});

test("bootstrap only projects drafts from the current session", () => {
  const now = new Date("2026-08-23T08:00:00Z");
  const a = createDraft("session-a", "收藏一篇文章", now);
  const b = createDraft("session-b", "旅行路线", now);
  const bootstrap = createBootstrap("session-a", [a, b], now);
  assert.equal(bootstrap.protocol, "shadow.nexus.v1");
  assert.deepEqual(bootstrap.drafts.map((draft) => draft.id), [a.id]);
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
