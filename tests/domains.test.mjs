import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { HttpDomainGateway, createDraft, createDrafts } from "../lib/index.js";

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fixtureServer() {
  const calls = [];
  const bodies = [];
  const server = createServer(async (request, response) => {
    calls.push({ method: request.method, url: request.url, authorization: request.headers.authorization, idempotency: request.headers["idempotency-key"] });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url?.startsWith("/api/machine/v1/agent/profiles/primary/summary")) {
      response.end(JSON.stringify({
        summary: "今日睡眠 7.5 小时，完成运动 30 分钟。",
        date: "2026-08-23",
        indicators: { diet_kcal: 0, protein_g: 0, steps: 8200, workout_sessions: 1, workout_min: 30, weight_kg: 68.4, sleep_hours: 7.5, mood_score: 8 }
      }));
      return;
    }
    if (request.method === "GET" && request.url?.startsWith("/api/machine/v1/agent/summary")) {
      response.end(JSON.stringify({ month: "2026-08", currency: "CNY", expense: "430.00", income: "1000.00", refund: "20.00", net_spending: "410.00" }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/machine/v1/agent/profiles/primary/drafts?limit=200") {
      response.end(JSON.stringify({ items: [{
        resource_uri: "shadow://health/drafts/hd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        draft_id: "hd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        profile_id: "primary",
        record_type: "meal",
        effective_date: "2026-08-22",
        fields: { meal: "晚餐", name: "鸡胸肉", kcal: 420, protein_g: 35 },
        note: "晚餐鸡胸肉",
        created_at: "2026-08-22T12:00:00Z",
        status: "pending"
      }], truncated: false }));
      return;
    }
    if (request.method === "GET" && request.url === "/api/machine/v1/agent/drafts?limit=200") {
      response.end(JSON.stringify({ items: [{
        record_ref: "shadow://ledger/records/33333333-3333-4333-8333-333333333333",
        revision: 4,
        created_at: "2026-08-22T13:00:00Z",
        occurred_at: "2026-08-22T11:30:00+08:00",
        money_type: "expense",
        amount: "36.50",
        currency: "CNY",
        category_key: "food",
        title: "晚餐"
      }], truncated: false }));
      return;
    }
    if (request.method === "POST" && request.url?.endsWith("/profiles/primary/drafts")) {
      const body = await jsonBody(request);
      bodies.push(body);
      if (body.record_type === "metric") assert.deepEqual(body.fields, { weight_kg: 68.4, sleep_hours: 7.5 });
      response.statusCode = 201;
      response.end(JSON.stringify({ resource_uri: "shadow://health/drafts/hd_test", draft_id: "hd_test" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/machine/v1/agent/profiles/primary/drafts/hd_test/commit") {
      response.end(JSON.stringify({ resource_uri: "shadow://health/diet/42", status: "applied" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/machine/v1/agent/profiles/primary/drafts/hd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/commit") {
      response.end(JSON.stringify({ resource_uri: "shadow://health/diet/43", status: "applied" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/machine/v1/agent/profiles/primary/drafts/hd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/commit") {
      response.end(JSON.stringify({ resource_uri: "shadow://health/diet/44", status: "applied" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/machine/v1/agent/profiles/primary/drafts/hd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/reject") {
      response.end(JSON.stringify({ resource_uri: "shadow://health/drafts/hd_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", status: "rejected" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/machine/v1/agent/drafts") {
      const body = await jsonBody(request);
      bodies.push(body);
      assert.equal(body.money_type, "expense");
      response.statusCode = 201;
      response.end(JSON.stringify({ record_ref: "shadow://ledger/records/11111111-1111-4111-8111-111111111111", revision: 1 }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/machine/v1/agent/drafts/11111111-1111-4111-8111-111111111111/commit") {
      bodies.push(await jsonBody(request));
      response.end(JSON.stringify({ record_ref: "shadow://ledger/records/11111111-1111-4111-8111-111111111111", state: "confirmed", revision: 2 }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/machine/v1/agent/drafts/22222222-2222-4222-8222-222222222222/commit") {
      bodies.push(await jsonBody(request));
      response.end(JSON.stringify({ record_ref: "shadow://ledger/records/22222222-2222-4222-8222-222222222222", state: "confirmed", revision: 2, replayed: false }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/machine/v1/agent/drafts/33333333-3333-4333-8333-333333333333/commit") {
      bodies.push(await jsonBody(request));
      response.end(JSON.stringify({ record_ref: "shadow://ledger/records/33333333-3333-4333-8333-333333333333", state: "confirmed", revision: 5 }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/machine/v1/agent/drafts/33333333-3333-4333-8333-333333333333/reject") {
      bodies.push(await jsonBody(request));
      response.end(JSON.stringify({ record_ref: "shadow://ledger/records/33333333-3333-4333-8333-333333333333", state: "rejected" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return { server, calls, bodies, baseUrl: `http://127.0.0.1:${address.port}` };
}

test("projects Health and Ledger summaries and creates reversible domain drafts", async (context) => {
  const fixture = await fixtureServer();
  context.after(() => new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())));
  const previous = { ...process.env };
  context.after(() => {
    for (const key of ["SHADOW_HEALTH_BASE_URL", "SHADOW_HEALTH_AGENT_TOKEN", "SHADOW_HEALTH_PROFILE_ID", "SHADOW_LEDGER_BASE_URL", "SHADOW_LEDGER_AGENT_TOKEN"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  process.env.SHADOW_HEALTH_BASE_URL = fixture.baseUrl;
  process.env.SHADOW_HEALTH_AGENT_TOKEN = "health-test-token";
  process.env.SHADOW_HEALTH_PROFILE_ID = "primary";
  process.env.SHADOW_LEDGER_BASE_URL = fixture.baseUrl;
  process.env.SHADOW_LEDGER_AGENT_TOKEN = "ledger-test-token";

  const gateway = new HttpDomainGateway(1_000);
  const projection = await gateway.project(new Date("2026-08-23T08:00:00Z"));
  assert.equal(projection.mode, "connected");
  assert.equal(projection.domains.find((item) => item.id === "health")?.metric, "7.5 h");
  assert.match(projection.domains.find((item) => item.id === "ledger")?.metric ?? "", /410/u);

  const health = createDraft("session-a", "今天体重 68.4kg，睡眠 7.5 小时", new Date("2026-08-23T08:00:00Z"));
  const ledger = createDraft("session-a", "午餐花了 48 元", new Date("2026-08-23T08:00:00Z"));
  assert.equal(await gateway.createDraft(health), "shadow://health/diet/42");
  assert.equal(await gateway.createDraft(ledger), "shadow://ledger/records/11111111-1111-4111-8111-111111111111");
  assert.ok(fixture.calls.every((call) => call.authorization?.startsWith("Bearer ")));
  assert.equal(fixture.calls.at(-2)?.idempotency, ledger.id);
  assert.deepEqual(fixture.bodies.at(-1), { revision: 1 });
});

test("sends confirmed meal nutrition and actual payment to separate domain drafts", async (context) => {
  const fixture = await fixtureServer();
  context.after(() => new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())));
  const previous = { ...process.env };
  context.after(() => {
    for (const key of ["SHADOW_HEALTH_BASE_URL", "SHADOW_HEALTH_AGENT_TOKEN", "SHADOW_HEALTH_PROFILE_ID", "SHADOW_LEDGER_BASE_URL", "SHADOW_LEDGER_AGENT_TOKEN"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  process.env.SHADOW_HEALTH_BASE_URL = fixture.baseUrl;
  process.env.SHADOW_HEALTH_AGENT_TOKEN = "health-test-token";
  process.env.SHADOW_HEALTH_PROFILE_ID = "primary";
  process.env.SHADOW_LEDGER_BASE_URL = fixture.baseUrl;
  process.env.SHADOW_LEDGER_AGENT_TOKEN = "ledger-test-token";
  const gateway = new HttpDomainGateway(1_000);
  const drafts = createDrafts("session-meal", "商家名称：张亮麻辣烫\n消费类型：午餐\n实际支付：¥25.52\n餐次：午餐 / 单人麻辣烫\n总重量：**~570g**\n总热量：679 kcal\n蛋白质：44.7 g\n营养记录和财务记账", new Date("2026-08-23T08:00:00Z"));
  for (const draft of drafts) await gateway.createDraft(draft);
  const healthBody = fixture.bodies.find((body) => body.record_type === "meal");
  const ledgerBody = fixture.bodies.find((body) => body.money_type === "expense");
  assert.deepEqual(healthBody.fields, { meal: "午餐", name: "单人麻辣烫", amount_g: 570, kcal: 679, protein_g: 44.7 });
  assert.equal(ledgerBody.amount, "25.52");
  assert.equal(ledgerBody.title, "午餐 · 张亮麻辣烫");
  assert.equal(ledgerBody.category_key, "food");
});

test("reconciles an already confirmed legacy Health proposal into canonical data", async (context) => {
  const fixture = await fixtureServer();
  context.after(() => new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())));
  process.env.SHADOW_HEALTH_BASE_URL = fixture.baseUrl;
  process.env.SHADOW_HEALTH_AGENT_TOKEN = "health-test-token";
  process.env.SHADOW_HEALTH_PROFILE_ID = "primary";
  const gateway = new HttpDomainGateway(1_000);
  const pending = createDraft("session-a", "午餐吃了麻辣烫", new Date("2026-08-23T08:00:00Z"));
  const approved = {
    ...pending,
    state: "approved",
    receipt: "shadow://health/drafts/hd_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  };
  assert.equal(await gateway.reconcileConfirmedDraft(approved), "shadow://health/diet/43");
});

test("reconciles an approved legacy Ledger proposal into a confirmed record", async (context) => {
  const fixture = await fixtureServer();
  context.after(() => new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())));
  process.env.SHADOW_LEDGER_BASE_URL = fixture.baseUrl;
  process.env.SHADOW_LEDGER_AGENT_TOKEN = "ledger-test-token";
  const gateway = new HttpDomainGateway(1_000);
  const pending = createDraft("session-a", "午餐花了 48 元", new Date("2026-08-23T08:00:00Z"));
  const approved = {
    ...pending,
    state: "approved",
    receipt: "shadow://ledger/records/22222222-2222-4222-8222-222222222222"
  };
  assert.equal(
    await gateway.reconcileConfirmedDraft(approved),
    "shadow://ledger/records/22222222-2222-4222-8222-222222222222"
  );
  assert.deepEqual(fixture.bodies.at(-1), { revision: 1 });
});

test("keeps unsupported Health captures out of the domain API", async (context) => {
  const fixture = await fixtureServer();
  context.after(() => new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())));
  process.env.SHADOW_HEALTH_BASE_URL = fixture.baseUrl;
  process.env.SHADOW_HEALTH_AGENT_TOKEN = "health-test-token";
  process.env.SHADOW_HEALTH_PROFILE_ID = "primary";
  const gateway = new HttpDomainGateway(1_000);
  const draft = createDraft("session-a", "今天跑步感觉不错", new Date("2026-08-23T08:00:00Z"));
  await assert.rejects(() => gateway.createDraft(draft), /至少需要时长/u);
});

test("federates existing domain drafts into Nexus without creating duplicates", async (context) => {
  const fixture = await fixtureServer();
  context.after(() => new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())));
  process.env.SHADOW_HEALTH_BASE_URL = fixture.baseUrl;
  process.env.SHADOW_HEALTH_AGENT_TOKEN = "health-test-token";
  process.env.SHADOW_HEALTH_PROFILE_ID = "primary";
  process.env.SHADOW_LEDGER_BASE_URL = fixture.baseUrl;
  process.env.SHADOW_LEDGER_AGENT_TOKEN = "ledger-test-token";
  const gateway = new HttpDomainGateway(1_000);
  const drafts = await gateway.discoverDrafts();
  assert.deepEqual(drafts.map((draft) => draft.domain), ["health", "ledger"]);
  assert.ok(drafts.every((draft) => draft.origin === "domain"));
  assert.equal(drafts[0].fields.effectiveDate, "2026-08-22");
  assert.equal(drafts[1].fields.occurredAt, "2026-08-22T11:30:00+08:00");
  assert.equal(await gateway.createDraft(drafts[0]), "shadow://health/diet/44");
  assert.equal(await gateway.createDraft(drafts[1]), "shadow://ledger/records/33333333-3333-4333-8333-333333333333");
  await gateway.rejectDraft(drafts[0]);
  await gateway.rejectDraft(drafts[1]);
  assert.deepEqual(fixture.bodies.slice(-2), [{ revision: 4 }, { revision: 4 }]);
  assert.equal(fixture.calls.filter((call) => call.method === "POST" && call.url === "/api/machine/v1/agent/drafts").length, 0);
});
