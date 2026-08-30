import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-host-webserver";
import { AssetGatewayError, type AssetGateway } from "./assets.js";
import type { BatchReviewRequest, CaptureDraft, CaptureRequest, NexusAssetAttachment, NexusAssetUploadInit, NexusContextCreate, NexusContextPack, NexusQuickActionRequest, NexusSuggestion, ReviewRequest, SuggestionAction } from "./contracts.js";
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
  readonly contexts: Map<string, NexusContextPack>;
  readonly suggestionFeedback: Map<string, SuggestionFeedback>;
  readonly ready: Promise<void>;
  persist(): Promise<void>;
}

interface SuggestionFeedback {
  readonly dedupeKey: string;
  readonly domain: string;
  readonly ruleId: string;
  readonly action: Extract<SuggestionAction, "ignore" | "snooze" | "mute">;
  readonly until?: string;
  readonly updatedAt: string;
}

export function createNexusState(filePath = process.env.SHADOW_NEXUS_STATE_FILE?.trim()): NexusState {
  const drafts = new Map<string, CaptureDraft>();
  const attachments = new Map<string, NexusAssetAttachment>();
  const contexts = new Map<string, NexusContextPack>();
  const suggestionFeedback = new Map<string, SuggestionFeedback>();
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
      const storedContexts = typeof value === "object" && value !== null && !Array.isArray(value)
        && Array.isArray((value as { readonly contexts?: unknown }).contexts)
        ? (value as { readonly contexts: unknown[] }).contexts
        : [];
      for (const item of storedContexts) {
        if (typeof item === "object" && item !== null && typeof (item as NexusContextPack).context_id === "string") {
          const context = item as NexusContextPack;
          contexts.set(context.context_id, context);
        }
      }
      const storedFeedback = typeof value === "object" && value !== null && !Array.isArray(value)
        && Array.isArray((value as { readonly suggestionFeedback?: unknown }).suggestionFeedback)
        ? (value as { readonly suggestionFeedback: unknown[] }).suggestionFeedback
        : [];
      for (const item of storedFeedback) {
        if (typeof item === "object" && item !== null && typeof (item as SuggestionFeedback).dedupeKey === "string") {
          const feedback = item as SuggestionFeedback;
          suggestionFeedback.set(feedback.dedupeKey, feedback);
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
    contexts,
    suggestionFeedback,
    ready,
    persist: () => {
      if (filePath === undefined || filePath === "") return Promise.resolve();
      writes = writes.then(async () => {
        await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
        const temporary = `${filePath}.tmp`;
        await writeFile(temporary, `${JSON.stringify({ version: 4, drafts: [...drafts.values()], attachments: [...attachments.values()], contexts: [...contexts.values()], suggestionFeedback: [...suggestionFeedback.values()] }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, filePath);
      });
      return writes;
    }
  };
}

function contextStringArray(value: unknown, label: string, pattern: RegExp, maximum: number): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !pattern.test(item))) {
    throw new RequestError(400, `${label} 无效。`);
  }
  return [...new Set(value)];
}

export function createContextPack(input: Partial<NexusContextCreate>, now = new Date()): NexusContextPack {
  const sessionId = input.session_id?.trim();
  if (sessionId === undefined || sessionId === "" || sessionId.length > 256) throw new RequestError(400, "session_id 无效。");
  const sourceDomain = input.source_domain ?? null;
  if (sourceDomain !== null && !/^[a-z][a-z0-9-]{1,63}$/u.test(sourceDomain)) throw new RequestError(400, "source_domain 无效。");
  const resources = contextStringArray(input.resource_refs, "resource_refs", /^shadow:\/\//u, 32);
  const assets = contextStringArray(input.asset_refs, "asset_refs", /^shadow:\/\//u, 32);
  const grants = contextStringArray(input.capability_grants, "capability_grants", /^[a-z][a-z0-9-]*(?:\.[a-z][A-Za-z0-9-]*)+$/u, 64);
  const goal = input.goal ?? null;
  if (goal !== null && (typeof goal !== "string" || goal.trim() === "" || goal.length > 500)) throw new RequestError(400, "goal 无效。");
  const timeRange = input.time_range ?? null;
  if (timeRange !== null) {
    const start = Date.parse(timeRange.start);
    const end = Date.parse(timeRange.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new RequestError(400, "time_range 无效。");
  }
  if (resources.length === 0 && assets.length === 0 && goal === null && timeRange === null) throw new RequestError(400, "上下文不能为空。");
  return {
    protocol: "shadow.context.v1",
    context_id: `ctx_${randomUUID()}`,
    session_id: sessionId,
    source_domain: sourceDomain,
    resource_refs: resources,
    time_range: timeRange,
    goal: goal?.trim() ?? null,
    asset_refs: assets,
    capability_grants: grants,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  };
}

async function syncFederatedDrafts(state: NexusState, domains: DomainGateway): Promise<void> {
  const discovered = await domains.discoverDrafts();
  let changed = false;
  for (const draft of discovered) {
    const result = upsertProposal(state.drafts, withExecutionPolicy(draft, domains));
    changed ||= result.changed;
    const current = withExecutionPolicy(result.draft, domains);
    const executed = await executeTrustedDraft(current, domains);
    if (executed !== result.draft) {
      state.drafts.set(executed.id, executed);
      changed = true;
    }
  }
  if (changed) await state.persist();
}

function withExecutionPolicy(draft: CaptureDraft, domains: DomainGateway): CaptureDraft {
  const policy = domains.policyFor(draft);
  if (policy.mode === "automatic") {
    if (draft.risk === policy.risk && draft.reviewReason === undefined && draft.executionError === undefined) return draft;
    const { reviewReason: _reviewReason, executionError: _executionError, ...rest } = draft;
    return { ...rest, risk: policy.risk };
  }
  const reviewReason = policy.mode === "prohibited" ? "prohibited" : policy.risk === "high" ? "high-risk" : "policy";
  if (draft.risk === policy.risk && draft.reviewReason === reviewReason
    && (policy.mode !== "prohibited" || draft.confirmable === false)) return draft;
  return {
    ...draft,
    risk: policy.risk,
    reviewReason,
    ...(policy.mode === "prohibited" ? { confirmable: false } : {})
  };
}

async function executeTrustedDraft(draft: CaptureDraft, domains: DomainGateway): Promise<CaptureDraft> {
  if (draft.state !== "pending" || draft.confirmable === false || domains.policyFor(draft).mode !== "automatic") return draft;
  try {
    const receipt = await domains.createDraft(draft);
    const { reviewReason: _reviewReason, executionError: _executionError, ...reviewed } = reviewDraft(draft, "approve", new Date(), receipt);
    return { ...reviewed, decisionMode: "automatic" };
  } catch (error) {
    return {
      ...draft,
      reviewReason: "execution-failed",
      executionError: error instanceof Error ? error.message : "自动执行失败，请在复核页重试。"
    };
  }
}

function visibleSuggestions(items: readonly NexusSuggestion[], state: NexusState, now: Date): readonly NexusSuggestion[] {
  return items.filter((item) => {
    const direct = state.suggestionFeedback.get(item.dedupe_key);
    if (direct?.action === "ignore") return false;
    if (direct?.action === "snooze" && direct.until !== undefined && Date.parse(direct.until) > now.getTime()) return false;
    return ![...state.suggestionFeedback.values()].some((entry) => entry.action === "mute" && entry.domain === item.domain && entry.ruleId === item.rule_id);
  });
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
      const now = new Date();
      let contextsChanged = false;
      for (const [id, context] of state.contexts) {
        if (Date.parse(context.expires_at) <= now.getTime()) {
          state.contexts.delete(id);
          contextsChanged = true;
        }
      }
      if (contextsChanged) await state.persist();
      await syncFederatedDrafts(state, domains);
      const projection = await domains.project();
      const suggestions = visibleSuggestions(await domains.discoverSuggestions(), state, now);
      const contexts = sessionId === undefined ? [] : [...state.contexts.values()].filter((context) => context.session_id === sessionId);
      send(response, 200, createBootstrap(sessionId, [...state.drafts.values()], now, projection, assets.configured, contexts, suggestions));
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/suggestions/action") {
      const input = await readJson(request);
      const suggestion = input.suggestion;
      const action = input.action;
      if (typeof suggestion !== "object" || suggestion === null) throw new RequestError(400, "建议标识无效。");
      if (action !== "ignore" && action !== "snooze" && action !== "mute") throw new RequestError(400, "建议操作无效。");
      const item = suggestion as NexusSuggestion;
      if (typeof item.dedupe_key !== "string" || item.dedupe_key.length < 1 || item.dedupe_key.length > 256
        || typeof item.domain !== "string" || !/^[a-z][a-z0-9-]{1,63}$/u.test(item.domain)
        || typeof item.rule_id !== "string" || !/^[a-z][a-z0-9-]*(?:\.[a-z][A-Za-z0-9-]*)+$/u.test(item.rule_id)
        || !Array.isArray(item.allowed_actions)) throw new RequestError(400, "建议标识无效。");
      if (!item.allowed_actions.includes(action)) throw new RequestError(409, "领域未允许这项操作。");
      const now = new Date();
      const feedback: SuggestionFeedback = {
        dedupeKey: item.dedupe_key,
        domain: item.domain,
        ruleId: item.rule_id,
        action,
        ...(action === "snooze" ? { until: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString() } : {}),
        updatedAt: now.toISOString()
      };
      state.suggestionFeedback.set(feedback.dedupeKey, feedback);
      await state.persist();
      send(response, 200, feedback);
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/context") {
      const context = createContextPack(await readJson(request) as Partial<NexusContextCreate>);
      state.contexts.set(context.context_id, context);
      await state.persist();
      send(response, 201, context);
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/context/remove") {
      const input = await readJson(request);
      if (typeof input.session_id !== "string" || typeof input.context_id !== "string") throw new RequestError(400, "上下文标识无效。");
      const context = state.contexts.get(input.context_id);
      if (context === undefined || context.session_id !== input.session_id) throw new RequestError(404, "没有找到这个上下文。");
      state.contexts.delete(context.context_id);
      await state.persist();
      send(response, 200, { removed: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/search") {
      const input = await readJson(request);
      if (typeof input.query !== "string") throw new RequestError(400, "缺少搜索内容。");
      const limit = input.limit === undefined ? 20 : Number(input.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new RequestError(400, "搜索数量无效。");
      send(response, 200, await domains.search(input.query, limit));
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
      const created: CaptureDraft[] = [];
      for (const draft of proposed) {
        const current = withExecutionPolicy(upsertProposal(state.drafts, withExecutionPolicy(draft, domains)).draft, domains);
        const executed = await executeTrustedDraft(current, domains);
        state.drafts.set(executed.id, executed);
        created.push(executed);
      }
      await state.persist();
      send(response, 201, created);
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/quick-actions/execute") {
      const input = await readJson(request) as Partial<NexusQuickActionRequest>;
      if (typeof input.domain !== "string" || typeof input.actionId !== "string"
        || typeof input.fields !== "object" || input.fields === null || Array.isArray(input.fields)
        || (input.sessionId !== undefined && typeof input.sessionId !== "string")) {
        throw new RequestError(400, "快捷动作请求无效。");
      }
      const proposed = domains.quickActionDraft({
        domain: input.domain,
        actionId: input.actionId,
        fields: input.fields as Readonly<Record<string, string>>,
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId })
      });
      const current = withExecutionPolicy(upsertProposal(state.drafts, withExecutionPolicy(proposed, domains)).draft, domains);
      const executed = await executeTrustedDraft(current, domains);
      state.drafts.set(executed.id, executed);
      await state.persist();
      send(response, 201, executed);
      return;
    }
    if (request.method === "POST" && url.pathname === "/shadow-nexus/review") {
      const input = await readJson(request) as Partial<ReviewRequest>;
      if (typeof input.sessionId !== "string" || typeof input.draftId !== "string") throw new RequestError(400, "缺少草稿标识。");
      if (input.decision !== "approve" && input.decision !== "reject") throw new RequestError(400, "decision 无效。");
      const current = state.drafts.get(input.draftId);
      if (current === undefined || current.sessionId !== input.sessionId) throw new RequestError(404, "没有找到这个草稿。");
      if (input.decision === "approve" && current.confirmable === false) throw new RequestError(409, "领域已将这个 Proposal 标记为不可确认。");
      if (input.decision === "approve" && domains.policyFor(current).mode === "prohibited") throw new RequestError(409, "受保护的操作不能执行。");
      const receipt = input.decision === "approve" ? await domains.createDraft(current, confirmationActor(request)) : undefined;
      if (input.decision === "reject") await domains.rejectDraft(current);
      const { reviewReason: _reviewReason, executionError: _executionError, ...reviewed } = reviewDraft(current, input.decision, new Date(), receipt);
      const updated: CaptureDraft = { ...reviewed, decisionMode: "manual" };
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
        if (input.decision === "approve" && domains.policyFor(current).mode === "prohibited") throw new RequestError(409, "组内包含受保护的操作。");
        const receipt = input.decision === "approve" ? await domains.createDraft(current, confirmationActor(request)) : undefined;
        if (input.decision === "reject") await domains.rejectDraft(current);
        const { reviewReason: _reviewReason, executionError: _executionError, ...reviewed } = reviewDraft(current, input.decision, new Date(), receipt);
        const result: CaptureDraft = { ...reviewed, decisionMode: "manual" };
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
