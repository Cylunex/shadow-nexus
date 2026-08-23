import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import type { CaptureDraft, CaptureRequest, ReviewRequest } from "./contracts.js";
import { createBootstrap, createDraft, reviewDraft } from "./projection.js";

const MAX_BODY_BYTES = 16_384;

class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function assertTrustedRequest(request: Pick<IncomingMessage, "headers" | "method">): void {
  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite === "cross-site") throw new RequestError(403, "拒绝跨站请求。");
  const host = request.headers.host;
  const origin = request.headers.origin;
  if (origin !== undefined) {
    if (origin === "null" || host === undefined) throw new RequestError(403, "请求来源无效。");
    let originHost: string;
    try { originHost = new URL(origin).host; }
    catch { throw new RequestError(403, "请求来源无效。"); }
    if (originHost.toLocaleLowerCase() !== host.toLocaleLowerCase()) throw new RequestError(403, "拒绝跨来源请求。");
  }
  if (request.method === "POST") {
    const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLocaleLowerCase();
    if (contentType !== "application/json") throw new RequestError(415, "请求必须使用 application/json。");
  }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request as AsyncIterable<Uint8Array>) {
    const value = Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) throw new RequestError(413, "请求内容过大。");
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new RequestError(400, "请求必须是 JSON 对象。");
  }
}

function sessionIdFrom(url: URL): string {
  const sessionId = url.searchParams.get("sessionId")?.trim();
  if (sessionId === undefined || sessionId === "") throw new RequestError(400, "缺少 sessionId。");
  if (sessionId.length > 256) throw new RequestError(400, "sessionId 无效。");
  return sessionId;
}

export interface NexusState {
  readonly drafts: Map<string, CaptureDraft>;
}

export function createNexusState(): NexusState {
  return { drafts: new Map() };
}

export async function handleNexusRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: NexusState
): Promise<void> {
  try {
    assertTrustedRequest(request);
    const url = new URL(request.url ?? "/", "http://dsh.local");
    if (request.method === "GET" && url.pathname === "/shadow-nexus/bootstrap") {
      const sessionId = sessionIdFrom(url);
      send(response, 200, createBootstrap(sessionId, [...state.drafts.values()]));
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/capture") {
      const input = await readJson(request) as Partial<CaptureRequest>;
      if (typeof input.sessionId !== "string" || input.sessionId.trim() === "") throw new RequestError(400, "缺少 sessionId。");
      if (typeof input.text !== "string") throw new RequestError(400, "缺少 text。");
      const draft = createDraft(input.sessionId.trim(), input.text);
      state.drafts.set(draft.id, draft);
      send(response, 201, draft);
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/review") {
      const input = await readJson(request) as Partial<ReviewRequest>;
      if (typeof input.sessionId !== "string" || typeof input.draftId !== "string") throw new RequestError(400, "缺少草稿标识。");
      if (input.decision !== "approve" && input.decision !== "reject") throw new RequestError(400, "decision 无效。");
      const current = state.drafts.get(input.draftId);
      if (current === undefined || current.sessionId !== input.sessionId) throw new RequestError(404, "没有找到这个草稿。");
      const updated = reviewDraft(current, input.decision);
      state.drafts.set(updated.id, updated);
      send(response, 200, updated);
      return;
    }
    send(response, 404, { error: "Shadow Nexus route not found." });
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Shadow Nexus request failed.";
    send(response, status, { error: message });
  }
}

export function registerNexusHttp(context: Context, state: NexusState): void {
  context.effect(() => context.webServer.register({
    kind: "prefix",
    path: "/shadow-nexus",
    handler: (request, response) => handleNexusRequest(request, response, state)
  }), "shadow-nexus: workbench projection API");
}
