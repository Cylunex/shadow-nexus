import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HttpDomainGateway, loadNexusRuntime } from "../lib/index.js";

function operation(operationId, method, path, capabilityId, riskLevel = "L0", effect = "read", confirmationResource = null) {
  return {
    operation_id: operationId,
    method,
    path,
    capability_id: capabilityId,
    tool_name: capabilityId,
    effect,
    risk_level: riskLevel,
    confirmation_resource: confirmationResource
  };
}

function runtime() {
  const list = operation("list_alpha_reviews", "GET", "/alpha/reviews", "alpha.records.review", "L2", "write");
  const create = operation("create_alpha_review", "POST", "/alpha/reviews", "alpha.records.draft", "L1", "draft");
  const commit = operation("commit_alpha_review", "POST", "/alpha/reviews/{review_id}/commit", "alpha.records.write", "L2", "write");
  const reject = operation("reject_alpha_review", "POST", "/alpha/reviews/{review_id}/reject", "alpha.records.review", "L2", "write");
  return {
    version: 1,
    protocol: "shadow.nexus.runtime.v1",
    deployment_id: "test-deployment",
    build_id: "build-test",
    domains: [{
      id: "alpha",
      product_id: "shadow-alpha",
      plugin_id: "shadow-alpha",
      plugin_version: "1.0.0",
      instance_id: "alpha-test",
      presentation: { short_id: "alpha", title: "Alpha", caption: "Alpha facts", icon: "alpha", color: "#112233", order: 10 },
      connection: { base_url_env: "ALPHA_URL", credential_env: "ALPHA_TOKEN", context_env: {} },
      surfaces: [
        { id: "today", type: "summary", operation_id: "alpha_summary", operation: operation("alpha_summary", "GET", "/alpha/summary", "alpha.summary.read"), display: { metric_pointer: "/metric", detail_pointer: "/detail" } },
        { id: "suggestions", type: "suggestions", operation_id: "alpha_suggestions", operation: operation("alpha_suggestions", "GET", "/alpha/suggestions", "alpha.suggestions.read") },
        { id: "search", type: "search", operation_id: "search_alpha", operation: operation("search_alpha", "POST", "/alpha/search", "alpha.records.search"), display: { collection_pointer: "/items", item_title_pointer: "/title", item_detail_pointer: "/summary", item_reference_pointer: "/resource_uri" } },
        { id: "capture", type: "capture", operation_id: "create_alpha_review", operation: create, risk_level: "L2", intent_prefixes: ["alpha.record"] },
        { id: "review", type: "review", risk_level: "L2", intent_prefixes: ["alpha.record"] }
      ],
      review: { protocol: "shadow.review.v1", mode: "commit", operations: { list, create, commit, reject } },
      app_id: "alpha",
      app: { canonical_url: "https://alpha.example.test/", aliases: [] }
    }, {
      id: "beta",
      product_id: "shadow-beta",
      plugin_id: "shadow-beta",
      plugin_version: "1.0.0",
      instance_id: "beta-test",
      presentation: { short_id: "beta", title: "Beta", caption: "Beta archive", icon: "beta", color: "#445566", order: 20 },
      connection: { base_url_env: "BETA_URL", credential_env: "BETA_TOKEN", health_path: "/beta/healthz", context_env: {} },
      surfaces: [{
        id: "capture", type: "capture", operation_id: "create_beta_capture",
        operation: operation("create_beta_capture", "POST", "/beta/captures", "beta.captures.draft", "L1", "draft"),
        risk_level: "L1", intent_prefixes: ["beta.import"]
      }],
      review: null,
      app_id: "beta"
    }]
  };
}

async function fixtureServer() {
  const calls = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length === 0 ? undefined : JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls.push({ method: request.method, url: request.url, headers: request.headers, body });
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/alpha/summary") return response.end(JSON.stringify({ metric: 7, detail: "Seven records" }));
    if (request.method === "GET" && request.url === "/alpha/suggestions") return response.end(JSON.stringify({ items: [{
      protocol: "shadow.suggestion.v1", suggestion_id: "sug_alpha_weekly_12345678", domain: "alpha",
      rule_id: "alpha.weekly-review", dedupe_key: "alpha:weekly:2026-W35", title: "Alpha weekly",
      summary: "Weekly summary", reason: "Because seven records changed.", evidence_refs: ["shadow://alpha/reports/week"],
      importance: "normal", confidence: 0.8, allowed_actions: ["view_evidence", "snooze", "ignore"],
      created_at: "2026-08-26T00:00:00Z", valid_until: "2099-08-31T00:00:00Z",
      data_freshness: { observed_at: "2026-08-26T00:00:00Z", missing_ratio: 0 }
    }] }));
    if (request.method === "GET" && request.url === "/beta/healthz") {
      response.statusCode = 204;
      return response.end();
    }
    if (request.method === "POST" && request.url === "/alpha/search") return response.end(JSON.stringify({ items: [{ title: `Found ${body.query}`, summary: "Search detail", resource_uri: "shadow://alpha/records/1" }] }));
    if (request.method === "GET" && request.url === "/alpha/reviews") return response.end(JSON.stringify({ protocol: "shadow.review.v1", items: [{
      protocol: "shadow.review.v1", review_id: "existing", reference: "shadow://alpha/reviews/existing", revision: 3,
      domain: "alpha", intent: "alpha.record", summary: "Existing proposal", fields: { value: 1 }, risk_level: "L2",
      state: "pending", created_at: "2026-08-26T00:00:00Z", source_refs: [], trace_id: "trace-existing", receipt: null, replayed: false
    }] }));
    if (request.method === "POST" && request.url === "/alpha/reviews") {
      response.statusCode = 201;
      return response.end(JSON.stringify({
        protocol: "shadow.review.v1", review_id: "created", reference: "shadow://alpha/reviews/created", revision: 1,
        domain: "alpha", intent: body.intent, summary: body.summary, fields: body.fields, risk_level: "L2",
        state: "pending", created_at: "2026-08-26T00:00:00Z", source_refs: [], trace_id: "trace-created", receipt: null, replayed: false
      }));
    }
    if (request.method === "POST" && request.url === "/alpha/reviews/created/commit") return response.end(JSON.stringify({ receipt: "shadow://alpha/records/1" }));
    if (request.method === "POST" && request.url === "/alpha/reviews/existing/commit") return response.end(JSON.stringify({ receipt: "shadow://alpha/records/2" }));
    if (request.method === "POST" && request.url === "/alpha/reviews/existing/reject") return response.end(JSON.stringify({ state: "rejected" }));
    if (request.method === "POST" && request.url === "/beta/captures") return response.end(JSON.stringify({ resource_uri: "shadow://beta/captures/1" }));
    response.statusCode = 404;
    response.end(JSON.stringify({ detail: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return { server, calls, baseUrl: `http://127.0.0.1:${address.port}` };
}

function draft(domain, fields = { value: "8" }) {
  return {
    id: `draft-${domain}`,
    captureGroupId: `group-${domain}`,
    classificationVersion: 2,
    sessionId: "session-a",
    text: "record this",
    domain,
    intent: domain === "alpha" ? "alpha.record" : "beta.import",
    summary: `${domain} proposal`,
    createdAt: "2026-08-26T00:00:00Z",
    state: "pending",
    risk: "low",
    fields,
    origin: "nexus"
  };
}

test("loads a compiled runtime and projects arbitrary domains without source adapters", async (context) => {
  const fixture = await fixtureServer();
  context.after(() => new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())));
  process.env.ALPHA_URL = fixture.baseUrl;
  process.env.ALPHA_TOKEN = "alpha-token";
  process.env.BETA_URL = fixture.baseUrl;
  process.env.BETA_TOKEN = "beta-token";
  const gateway = new HttpDomainGateway(1_000, runtime());
  const projection = await gateway.project(new Date("2026-08-26T08:00:00Z"));
  assert.deepEqual(projection.domains.map((item) => item.id), ["alpha", "beta"]);
  assert.equal(projection.domains[0].metric, "7");
  assert.equal(projection.domains[0].intentPrefixes[0], "alpha.record");
  assert.equal(projection.domains[0].searchEnabled, true);
  assert.equal(projection.domains[0].appUrl, "https://alpha.example.test/");
  assert.equal(projection.domains[1].status, "ready");
  assert.equal(projection.domains[1].metric, "已连接");

  const search = await gateway.search("needle", 10);
  assert.deepEqual(search.searchedDomains, ["alpha"]);
  assert.deepEqual(search.unavailableDomains, []);
  assert.deepEqual(search.items, [{
    domain: "alpha",
    domainLabel: "Alpha",
    title: "Found needle",
    detail: "Search detail",
    reference: "shadow://alpha/records/1"
  }]);

  const discovered = await gateway.discoverDrafts();
  assert.equal(discovered[0].domainReviewId, "existing");
  assert.equal(discovered[0].domainRevision, 3);
  const suggestions = await gateway.discoverSuggestions();
  assert.equal(suggestions[0].suggestion_id, "sug_alpha_weekly_12345678");
  assert.equal(await gateway.createDraft(draft("alpha")), "shadow://alpha/records/1");
  assert.equal(await gateway.createDraft(draft("beta", { source_kind: "url", source_uri: "https://example.test" })), "shadow://beta/captures/1");
  assert.ok(fixture.calls.every((call) => call.headers.authorization?.startsWith("Bearer ")));
  assert.deepEqual(fixture.calls.find((call) => call.url === "/alpha/reviews" && call.method === "POST")?.body, {
    intent: "alpha.record",
    summary: "alpha proposal",
    fields: { value: "8" },
    source_text: "record this",
    source_refs: []
  });
  assert.deepEqual(fixture.calls.find((call) => call.url === "/alpha/reviews/created/commit")?.body, { revision: 1 });
});

test("commits and rejects a federated review by its opaque domain id", async (context) => {
  const fixture = await fixtureServer();
  context.after(() => new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())));
  process.env.ALPHA_URL = fixture.baseUrl;
  process.env.ALPHA_TOKEN = "alpha-token";
  const gateway = new HttpDomainGateway(1_000, runtime());
  const existing = (await gateway.discoverDrafts())[0];
  assert.equal(await gateway.createDraft(existing), "shadow://alpha/records/2");
  await gateway.rejectDraft(existing);
  assert.equal(fixture.calls.filter((call) => call.url === "/alpha/reviews").length, 1);
  assert.deepEqual(fixture.calls.find((call) => call.url === "/alpha/reviews/existing/commit")?.body, { revision: 3 });
  assert.deepEqual(fixture.calls.find((call) => call.url === "/alpha/reviews/existing/reject")?.body, { revision: 3 });
});

test("loads runtime files and signs L3 execution receipts", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "shadow-nexus-runtime-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = await fixtureServer();
  context.after(() => new Promise((resolve, reject) => fixture.server.close((error) => error ? reject(error) : resolve())));
  const value = runtime();
  const alpha = value.domains[0];
  alpha.review.operations.commit.risk_level = "L3";
  alpha.review.operations.commit.effect = "publish";
  alpha.review.operations.commit.capability_id = "alpha.records.publish";
  alpha.review.operations.commit.tool_name = "alpha.records.publish";
  alpha.review.operations.commit.confirmation_resource = { template: "shadow://alpha/reviews/{review_id}", arguments: ["review_id"] };
  const runtimeFile = join(directory, "runtime.json");
  await writeFile(runtimeFile, JSON.stringify(value));
  assert.equal(loadNexusRuntime(runtimeFile).domains[0].id, "alpha");

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyFile = join(directory, "private.pem");
  await writeFile(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  process.env.SHADOW_CONFIRMATION_PRIVATE_KEY_FILE = keyFile;
  process.env.SHADOW_CONFIRMATION_KEY_ID = "test-key";
  process.env.SHADOW_CONFIRMATION_ISSUER = "shadow-nexus-test";
  process.env.ALPHA_URL = fixture.baseUrl;
  process.env.ALPHA_TOKEN = "alpha-token";
  await new HttpDomainGateway(1_000, value).createDraft(draft("alpha"), "user-a");
  const header = fixture.calls.find((call) => call.url === "/alpha/reviews/created/commit")?.headers["x-shadow-confirmation"];
  assert.equal(typeof header, "string");
  const receipt = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  const signature = Buffer.from(receipt.signature.value, "base64url");
  const unsigned = { ...receipt };
  delete unsigned.signature;
  const canonical = (input) => Array.isArray(input) ? `[${input.map(canonical).join(",")}]` : input && typeof input === "object" ? `{${Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}` : JSON.stringify(input);
  assert.equal(verify(null, Buffer.from(canonical(unsigned)), publicKey, signature), true);
  assert.equal(receipt.resource_uri, "shadow://alpha/reviews/created");
});
