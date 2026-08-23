import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { HttpDomainGateway, createDraft } from "../lib/index.js";

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function fixtureServer() {
  const calls = [];
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
    if (request.method === "POST" && request.url?.endsWith("/profiles/primary/drafts")) {
      const body = await jsonBody(request);
      assert.deepEqual(body.fields, { weight_kg: 68.4, sleep_hours: 7.5 });
      response.statusCode = 201;
      response.end(JSON.stringify({ resource_uri: "shadow://health/drafts/hd_test" }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/machine/v1/agent/drafts") {
      const body = await jsonBody(request);
      assert.equal(body.money_type, "expense");
      assert.equal(body.amount, "48");
      response.statusCode = 201;
      response.end(JSON.stringify({ record_ref: "shadow://ledger/records/record-test" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return { server, calls, baseUrl: `http://127.0.0.1:${address.port}` };
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
  assert.equal(await gateway.createDraft(health), "shadow://health/drafts/hd_test");
  assert.equal(await gateway.createDraft(ledger), "shadow://ledger/records/record-test");
  assert.ok(fixture.calls.every((call) => call.authorization?.startsWith("Bearer ")));
  assert.equal(fixture.calls.at(-1)?.idempotency, ledger.id);
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
