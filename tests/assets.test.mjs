import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { HttpAssetGateway, sanitizeAssetFilename } from "../lib/index.js";

test("sanitizes attachment filenames before creating a read view", () => {
  assert.equal(sanitizeAssetFilename("../report.pdf"), "report.pdf");
  assert.equal(sanitizeAssetFilename("..\\photo.png"), "photo.png");
  assert.equal(sanitizeAssetFilename("\u0000\u200b"), "asset");
});

test("uploads images and files through Asset and exposes a read-only conversation path", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "shadow-nexus-assets-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const tokenFile = join(directory, "service-token");
  const viewRoot = join(directory, "view");
  await writeFile(tokenFile, "service-secret\n", { mode: 0o600 });
  await chmod(tokenFile, 0o600);

  const calls = [];
  let uploaded = Buffer.alloc(0);
  const fetchFixture = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method, authorization: new Headers(init.headers).get("authorization") });
    if (url === "https://asset.example.test/v1/upload-sessions") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.original_filename, "report.pdf");
      assert.equal(body.initial_reference.usage_role, "conversation.attachment");
      return new Response(JSON.stringify({
        upload_session_id: "upload-1",
        target: {
          method: "PUT",
          url: "https://upload.example.test/content",
          headers: { authorization: "Upload short-lived-secret" }
        }
      }), { status: 201, headers: { "content-type": "application/json" } });
    }
    if (url === "https://upload.example.test/content") {
      const request = new Request(url, init);
      uploaded = Buffer.from(await request.arrayBuffer());
      assert.equal(request.headers.get("authorization"), "Upload short-lived-secret");
      return new Response(null, { status: 204 });
    }
    if (url === "https://asset.example.test/v1/upload-sessions/upload-1/complete") {
      return new Response(JSON.stringify({ id: "asset-1", current_version_id: "version-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ detail: "not found" }), { status: 404, headers: { "content-type": "application/json" } });
  };

  const gateway = new HttpAssetGateway({
    baseUrl: "https://asset.example.test",
    serviceTokenFile: tokenFile,
    ownerId: "11111111-1111-4111-8111-111111111111",
    conversationRoot: viewRoot,
    fetch: fetchFixture
  });
  const ticket = await gateway.initUpload({
    sessionId: "session-a",
    filename: "../report.pdf",
    contentType: "application/pdf; charset=binary",
    sizeBytes: 5
  });
  await gateway.uploadContent(ticket.ticketId, Readable.from([Buffer.from("hello")]));
  const attachment = await gateway.completeUpload(ticket.ticketId);

  assert.equal(uploaded.toString("utf8"), "hello");
  assert.equal(attachment.assetId, "asset-1");
  assert.equal(attachment.versionId, "version-1");
  assert.equal(attachment.filename, "report.pdf");
  assert.match(attachment.referenceUri, /^shadow:\/\/nexus\/conversations\/[0-9a-f]{32}\/attachments\//u);
  assert.equal(await readFile(attachment.conversationPath, "utf8"), "hello");
  assert.equal((await stat(attachment.conversationPath)).mode & 0o777, process.platform === "win32" ? 0o444 : 0o400);
  assert.equal(calls[0]?.authorization, "Bearer service-secret");
  assert.equal(calls.at(-1)?.authorization, "Bearer service-secret");
  assert.ok(calls.every((call) => !call.url.includes("short-lived-secret")));
});
