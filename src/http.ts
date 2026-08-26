import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { AssetGatewayError, type AssetGateway } from "./assets.js";
import type { BatchReviewRequest, CaptureDraft, CaptureRequest, NexusAssetAttachment, NexusAssetUploadInit, ReviewRequest } from "./contracts.js";
import { DomainGatewayError, type DomainGateway } from "./domains.js";
import { createAnalyzedDrafts, createBootstrap, reclassifyStoredDraft, reviewDraft } from "./projection.js";
import { upsertProposal } from "./proposals.js";

const MAX_BODY_BYTES = 1_048_576;

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

function sessionIdFrom(url: URL): string | undefined {
  const sessionId = url.searchParams.get("sessionId")?.trim();
  if (sessionId === undefined || sessionId === "") return undefined;
  if (sessionId.length > 256) throw new RequestError(400, "sessionId 无效。");
  return sessionId;
}

function confirmationActor(request: IncomingMessage): string | undefined {
  const remoteAddress = request.socket.remoteAddress ?? "";
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress)) return undefined;
  for (const name of ["remote-user", "x-auth-request-user", "x-forwarded-user"] as const) {
    const value = request.headers[name];
    const candidate = Array.isArray(value) ? value[0] : value;
    if (candidate !== undefined && candidate.trim() !== "") return candidate.trim().slice(0, 200);
  }
  return undefined;
}

export interface NexusState {
  readonly drafts: Map<string, CaptureDraft>;
  readonly attachments: Map<string, NexusAssetAttachment>;
  readonly ready: Promise<void>;
  persist(): Promise<void>;
}

export function createNexusState(filePath = process.env.SHADOW_NEXUS_STATE_FILE?.trim()): NexusState {
  const drafts = new Map<string, CaptureDraft>();
  const attachments = new Map<string, NexusAssetAttachment>();
  const ready = filePath === undefined || filePath === "" ? Promise.resolve() : (async () => {
    try {
      const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      const storedDrafts = Array.isArray(value)
        ? value
        : typeof value === "object" && value !== null && Array.isArray((value as { readonly drafts?: unknown }).drafts)
          ? (value as { readonly drafts: unknown[] }).drafts
          : [];
      for (const item of storedDrafts) {
        if (typeof item === "object" && item !== null && typeof (item as CaptureDraft).id === "string") {
          for (const draft of reclassifyStoredDraft(item as CaptureDraft)) drafts.set(draft.id, draft);
        }
      }
      const storedAttachments = typeof value === "object" && value !== null && !Array.isArray(value)
        && Array.isArray((value as { readonly attachments?: unknown }).attachments)
        ? (value as { readonly attachments: unknown[] }).attachments
        : [];
      for (const item of storedAttachments) {
        if (typeof item === "object" && item !== null && typeof (item as NexusAssetAttachment).id === "string") {
          const attachment = item as NexusAssetAttachment;
          attachments.set(attachment.id, attachment);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  })();
  let writes = Promise.resolve();
  return {
    drafts,
    attachments,
    ready,
    persist: () => {
      if (filePath === undefined || filePath === "") return Promise.resolve();
      writes = writes.then(async () => {
        await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
        const temporary = `${filePath}.tmp`;
        await writeFile(temporary, `${JSON.stringify({ version: 2, drafts: [...drafts.values()], attachments: [...attachments.values()] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, filePath);
      });
      return writes;
    }
  };
}

async function syncFederatedDrafts(state: NexusState, domains: DomainGateway): Promise<void> {
  const discovered = await domains.discoverDrafts();
  let changed = false;
  for (const draft of discovered) {
    const result = upsertProposal(state.drafts, draft);
    changed ||= result.changed;
  }
  if (changed) await state.persist();
}

export async function handleNexusRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: NexusState,
  domains: DomainGateway,
  assets: AssetGateway
): Promise<void> {
  try {
    await state.ready;
    assertTrustedRequest(request);
    const url = new URL(request.url ?? "/", "http://dsh.local");
    if (request.method === "GET" && url.pathname === "/shadow-nexus/bootstrap") {
      const sessionId = sessionIdFrom(url);
      await syncFederatedDrafts(state, domains);
      const projection = await domains.project();
      send(response, 200, createBootstrap(sessionId, [...state.drafts.values()], new Date(), projection, assets.configured));
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/assets/init") {
      const input = await readJson(request) as Partial<NexusAssetUploadInit>;
      if (typeof input.sessionId !== "string" || typeof input.filename !== "string" || typeof input.contentType !== "string" || typeof input.sizeBytes !== "number") {
        throw new RequestError(400, "附件元数据不完整。");
      }
      send(response, 201, await assets.initUpload({
        sessionId: input.sessionId,
        filename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes
      }));
      return;
    }
    if (request.method === "PUT" && url.pathname === "/shadow-nexus/assets/content") {
      const ticketId = url.searchParams.get("ticket")?.trim();
      if (ticketId === undefined || ticketId === "" || ticketId.length > 128) throw new RequestError(400, "缺少上传票据。");
      await assets.uploadContent(ticketId, request as AsyncIterable<Uint8Array>);
      send(response, 200, { uploaded: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/assets/complete") {
      const input = await readJson(request);
      if (typeof input.ticketId !== "string" || input.ticketId.trim() === "") throw new RequestError(400, "缺少上传票据。");
      const attachment = await assets.completeUpload(input.ticketId.trim());
      state.attachments.set(attachment.id, attachment);
      await state.persist();
      send(response, 201, attachment);
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/capture") {
      const input = await readJson(request) as Partial<CaptureRequest>;
      if (typeof input.sessionId !== "string" || input.sessionId.trim() === "") throw new RequestError(400, "缺少 sessionId。");
      if (typeof input.text !== "string") throw new RequestError(400, "缺少 text。");
      if (typeof input.analysis !== "object" || input.analysis === null) throw new RequestError(400, "缺少 DSH 完成后的分析结果。");
      const attachmentIds = input.attachmentIds ?? [];
      if (!Array.isArray(attachmentIds) || attachmentIds.length > 8 || attachmentIds.some((id) => typeof id !== "string")) {
        throw new RequestError(400, "附件标识无效。");
      }
      const attachments = attachmentIds.map((id) => state.attachments.get(id));
      if (attachments.some((attachment) => attachment === undefined || attachment.sessionId !== input.sessionId)) {
        throw new RequestError(404, "没有找到这组附件。");
      }
      const proposed = createAnalyzedDrafts(
        input.sessionId.trim(),
        input.text,
        input.analysis,
        new Date(),
        attachments.flatMap((attachment) => attachment === undefined ? [] : [attachment.referenceUri]),
        new Set(domains.runtime.domains.map((domain) => domain.id))
      );
      const created = proposed.map((draft) => upsertProposal(state.drafts, draft).draft);
      await state.persist();
      send(response, 201, created);
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/review") {
      const input = await readJson(request) as Partial<ReviewRequest>;
      if (typeof input.sessionId !== "string" || typeof input.draftId !== "string") throw new RequestError(400, "缺少草稿标识。");
      if (input.decision !== "approve" && input.decision !== "reject") throw new RequestError(400, "decision 无效。");
      const current = state.drafts.get(input.draftId);
      if (current === undefined || current.sessionId !== input.sessionId) throw new RequestError(404, "没有找到这个草稿。");
      if (input.decision === "approve" && current.confirmable === false) throw new RequestError(409, "领域已将这个 Proposal 标记为不可确认。");
      const receipt = input.decision === "approve" ? await domains.createDraft(current, confirmationActor(request)) : undefined;
      if (input.decision === "reject") await domains.rejectDraft(current);
      const updated = reviewDraft(current, input.decision, new Date(), receipt);
      state.drafts.set(updated.id, updated);
      await state.persist();
      send(response, 200, updated);
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/review/batch") {
      const input = await readJson(request) as Partial<BatchReviewRequest>;
      if (typeof input.captureGroupId !== "string" || input.captureGroupId.trim() === "") throw new RequestError(400, "缺少草稿组标识。");
      if (input.decision !== "approve" && input.decision !== "reject") throw new RequestError(400, "decision 无效。");
      const pending = [...state.drafts.values()]
        .filter((draft) => draft.captureGroupId === input.captureGroupId && draft.state === "pending")
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      if (pending.length === 0) throw new RequestError(404, "没有找到待处理的草稿组。");
      const updated: CaptureDraft[] = [];
      for (const current of pending) {
        if (input.decision === "approve" && current.confirmable === false) throw new RequestError(409, "组内包含不可确认的 Proposal。");
        const receipt = input.decision === "approve" ? await domains.createDraft(current, confirmationActor(request)) : undefined;
        if (input.decision === "reject") await domains.rejectDraft(current);
        const result = reviewDraft(current, input.decision, new Date(), receipt);
        state.drafts.set(result.id, result);
        updated.push(result);
        await state.persist();
      }
      send(response, 200, updated);
      return;
    }
    send(response, 404, { error: "Shadow Nexus route not found." });
  } catch (error) {
    const status = error instanceof RequestError || error instanceof DomainGatewayError || error instanceof AssetGatewayError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Shadow Nexus request failed.";
    send(response, status, { error: message });
  }
}

export function registerNexusHttp(context: Context, state: NexusState, domains: DomainGateway, assets: AssetGateway): void {
  void state.ready.then(async () => {
    await syncFederatedDrafts(state, domains);
    let changed = false;
    for (const current of state.drafts.values()) {
      try {
        const receipt = await domains.reconcileConfirmedDraft(current);
        if (receipt !== undefined && receipt !== current.receipt) {
          state.drafts.set(current.id, { ...current, receipt });
          changed = true;
        }
      } catch {
        // Reconciliation is retryable on the next Host start; HTTP registration stays available.
      }
    }
    if (changed) await state.persist();
  }).catch(() => {
    // State loading/persistence failures are still reported by normal HTTP requests.
  });
  context.effect(() => context.webServer.register({
    kind: "prefix",
    path: "/shadow-nexus",
    handler: (request, response) => handleNexusRequest(request, response, state, domains, assets)
  }), "shadow-nexus: workbench projection API");
}
