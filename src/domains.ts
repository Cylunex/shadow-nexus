import { createHash, createPrivateKey, randomBytes, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CaptureDraft, DomainId, DomainSummary, NexusSearchResult, NexusSuggestion, RiskLevel, TodaySignal } from "./contracts.js";
import type { BootstrapProjection } from "./projection.js";

export interface RuntimeOperation {
  readonly operation_id: string;
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly capability_id: string;
  readonly tool_name: string;
  readonly effect: string;
  readonly risk_level: "L0" | "L1" | "L2" | "L3" | "L4";
  readonly confirmation_resource?: {
    readonly template: string;
    readonly arguments: readonly string[];
  } | null;
}

export interface RuntimeSurface {
  readonly id: string;
  readonly type: "summary" | "suggestions" | "capture" | "review" | "search" | "run-status" | "app-link" | "resource-link";
  readonly capability?: string;
  readonly risk_level?: "L0" | "L1" | "L2" | "L3" | "L4";
  readonly intent_prefixes?: readonly string[];
  readonly display?: {
    readonly metric_pointer?: string;
    readonly detail_pointer?: string;
    readonly collection_pointer?: string;
    readonly item_title_pointer?: string;
    readonly item_detail_pointer?: string;
    readonly item_reference_pointer?: string;
    readonly unit?: string;
  };
  readonly operation?: RuntimeOperation;
}

export interface RuntimeReview {
  readonly protocol: "shadow.review.v1";
  readonly mode: "commit" | "create-only";
  readonly operations: {
    readonly list: RuntimeOperation;
    readonly create: RuntimeOperation;
    readonly commit: RuntimeOperation;
    readonly reject: RuntimeOperation;
  };
}

export interface RuntimeDomain {
  readonly id: DomainId;
  readonly product_id: string;
  readonly plugin_id: string;
  readonly plugin_version: string;
  readonly instance_id: string;
  readonly presentation: {
    readonly short_id: string;
    readonly title: string;
    readonly caption: string;
    readonly icon: string;
    readonly color: string;
    readonly order: number;
  };
  readonly connection: {
    readonly base_url_env?: string;
    readonly credential_env?: string;
    readonly health_path?: string;
    readonly context_env: Readonly<Record<string, string>>;
  };
  readonly surfaces: readonly RuntimeSurface[];
  readonly review: RuntimeReview | null;
  readonly app_id?: string;
  readonly app?: {
    readonly canonical_url: string;
    readonly aliases: readonly string[];
  } | null;
}

export interface NexusRuntime {
  readonly version: 1;
  readonly protocol: "shadow.nexus.runtime.v1";
  readonly deployment_id: string;
  readonly build_id: string;
  readonly domains: readonly RuntimeDomain[];
}

interface DomainConnection {
  readonly baseUrl: string;
  readonly token: string;
  readonly context: Readonly<Record<string, string>>;
}

interface ReviewEnvelope {
  readonly protocol: "shadow.review.v1";
  readonly review_id: string;
  readonly reference: string;
  readonly revision: number;
  readonly domain: string;
  readonly intent: string;
  readonly summary: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly risk_level: RuntimeOperation["risk_level"];
  readonly state: "pending" | "committed" | "rejected";
  readonly created_at: string;
  readonly source_refs: readonly string[];
  readonly trace_id: string;
  readonly receipt: string | null;
  readonly replayed: boolean;
}

export class DomainGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface DomainGateway {
  readonly runtime: NexusRuntime;
  project(now?: Date): Promise<BootstrapProjection>;
  discoverDrafts(): Promise<readonly CaptureDraft[]>;
  discoverSuggestions(): Promise<readonly NexusSuggestion[]>;
  search(query: string, limit?: number): Promise<NexusSearchResult>;
  createDraft(draft: CaptureDraft, actor?: string): Promise<string>;
  rejectDraft(draft: CaptureDraft): Promise<void>;
  reconcileConfirmedDraft(draft: CaptureDraft, actor?: string): Promise<string | undefined>;
}

const emptyRuntime: NexusRuntime = {
  version: 1,
  protocol: "shadow.nexus.runtime.v1",
  deployment_id: "unconfigured",
  build_id: "unconfigured",
  domains: []
};

function environmentValue(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function runtimeString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new DomainGatewayError(500, `${label} 无效。`);
  return value;
}

function runtimeHttpsUrl(value: unknown, label: string): void {
  const raw = runtimeString(value, label);
  try {
    if (new URL(raw).protocol !== "https:") throw new Error();
  } catch { throw new DomainGatewayError(500, `${label} 无效。`); }
}

export function loadNexusRuntime(path = environmentValue("SHADOW_NEXUS_RUNTIME_FILE")): NexusRuntime {
  if (path === undefined) return emptyRuntime;
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new DomainGatewayError(500, "Nexus 运行时投影无法读取。"); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new DomainGatewayError(500, "Nexus 运行时投影无效。");
  const candidate = parsed as Partial<NexusRuntime>;
  if (candidate.version !== 1 || candidate.protocol !== "shadow.nexus.runtime.v1" || !Array.isArray(candidate.domains)) {
    throw new DomainGatewayError(500, "Nexus 运行时投影版本不受支持。");
  }
  runtimeString(candidate.deployment_id, "deployment_id");
  runtimeString(candidate.build_id, "build_id");
  const ids = new Set<string>();
  for (const domain of candidate.domains) {
    if (typeof domain !== "object" || domain === null || ids.has(domain.id)) throw new DomainGatewayError(500, "Nexus 领域投影无效。");
    runtimeString(domain.id, "domain id");
    runtimeString(domain.plugin_id, "plugin id");
    if (!Array.isArray(domain.surfaces) || typeof domain.presentation !== "object" || domain.presentation === null) {
      throw new DomainGatewayError(500, "Nexus 领域投影无效。");
    }
    if (domain.app !== undefined && domain.app !== null) {
      if (typeof domain.app !== "object" || !Array.isArray(domain.app.aliases)) throw new DomainGatewayError(500, "Nexus 应用入口无效。");
      runtimeHttpsUrl(domain.app.canonical_url, "canonical app URL");
      for (const alias of domain.app.aliases) runtimeHttpsUrl(alias, "app alias URL");
    }
    ids.add(domain.id);
  }
  return candidate as NexusRuntime;
}

function domainConnection(domain: RuntimeDomain): DomainConnection | undefined {
  const baseUrl = environmentValue(domain.connection.base_url_env);
  const token = environmentValue(domain.connection.credential_env);
  const context: Record<string, string> = {};
  for (const [key, envName] of Object.entries(domain.connection.context_env)) {
    const value = environmentValue(envName);
    if (value === undefined) return undefined;
    context[key] = value;
  }
  if (baseUrl === undefined || token === undefined) return undefined;
  return { baseUrl: baseUrl.replace(/\/+$/u, ""), token, context };
}

function riskLevel(value: RuntimeOperation["risk_level"] | undefined): RiskLevel {
  if (value === "L3" || value === "L4") return "high";
  if (value === "L2") return "medium";
  return "low";
}

function pointer(value: unknown, path: string | undefined): unknown {
  if (path === undefined || path === "") return value;
  let current = value;
  for (const raw of path.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (typeof current !== "object" || current === null || !(key in current)) return undefined;
    current = (current as Readonly<Record<string, unknown>>)[key];
  }
  return current;
}

function displayValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function operationPath(operation: RuntimeOperation, context: Readonly<Record<string, string>>, argumentsValue: Readonly<Record<string, unknown>> = {}): string {
  return operation.path.replaceAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (_match, name: string) => {
    const value = argumentsValue[name] ?? context[name];
    if (typeof value !== "string" && typeof value !== "number") throw new DomainGatewayError(422, `缺少领域参数 ${name}。`);
    return encodeURIComponent(String(value));
  });
}

async function requestJson<T>(connection: DomainConnection, operation: RuntimeOperation, timeoutMs: number, options: {
  readonly arguments?: Readonly<Record<string, unknown>>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly confirmation?: string;
} = {}): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${connection.token}`, accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.idempotencyKey !== undefined) headers["idempotency-key"] = options.idempotencyKey;
  if (options.confirmation !== undefined) headers["x-shadow-confirmation"] = options.confirmation;
  let response: Response;
  try {
    response = await fetch(`${connection.baseUrl}${operationPath(operation, connection.context, options.arguments)}`, {
      method: operation.method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new DomainGatewayError(503, "领域服务暂时不可用。");
  }
  let value: unknown;
  try { value = await response.json(); }
  catch { throw new DomainGatewayError(502, "领域服务返回了无效响应。"); }
  if (!response.ok) {
    const upstream = typeof value === "object" && value !== null && "detail" in value
      ? String((value as { readonly detail?: unknown }).detail ?? "") : "";
    const message = response.status === 401 || response.status === 403
      ? "领域连接没有执行此操作的权限。"
      : response.status >= 500 ? "领域服务暂时不可用。" : upstream || "领域服务拒绝了这条 Proposal。";
    throw new DomainGatewayError(response.status >= 500 ? 503 : 422, message);
  }
  return value as T;
}

async function requestHealth(connection: DomainConnection, path: string, timeoutMs: number): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${connection.baseUrl}${path.startsWith("/") ? path : `/${path}`}`, {
      method: "GET",
      headers: { authorization: `Bearer ${connection.token}`, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new DomainGatewayError(503, "领域服务暂时不可用。");
  }
  if (!response.ok) throw new DomainGatewayError(503, "领域服务暂时不可用。");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new DomainGatewayError(422, "确认参数无法规范化。");
  return encoded;
}

function confirmationReceipt(
  domain: RuntimeDomain,
  operation: RuntimeOperation,
  argumentsValue: Readonly<Record<string, unknown>>,
  actor: string | undefined,
): string | undefined {
  if (operation.risk_level !== "L3" && operation.risk_level !== "L4") return undefined;
  const keyFile = environmentValue("SHADOW_CONFIRMATION_PRIVATE_KEY_FILE");
  const keyId = environmentValue("SHADOW_CONFIRMATION_KEY_ID");
  const issuer = environmentValue("SHADOW_CONFIRMATION_ISSUER");
  if (keyFile === undefined || keyId === undefined || issuer === undefined || actor === undefined || actor.trim() === "") {
    throw new DomainGatewayError(503, "高影响操作的签名确认尚未配置完整。");
  }
  const resource = operation.confirmation_resource;
  const resourceUri = resource === null || resource === undefined ? undefined : resource.template.replaceAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (_match, name: string) => {
    const value = argumentsValue[name];
    if (typeof value !== "string" && typeof value !== "number") throw new DomainGatewayError(422, `确认资源缺少参数 ${name}。`);
    return encodeURIComponent(String(value));
  });
  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60_000);
  const unsigned: Record<string, unknown> = {
    version: 1,
    receipt_id: `receipt-${randomUUID()}`,
    issuer,
    actor: actor.trim(),
    audience: domain.id,
    plugin_id: domain.plugin_id,
    capability_id: operation.capability_id,
    tool_name: operation.tool_name,
    effect: operation.effect,
    arguments_sha256: createHash("sha256").update(canonicalJson(argumentsValue)).digest("hex"),
    issued_at: now.toISOString().replace(/\.000Z$/u, "Z"),
    expires_at: expires.toISOString().replace(/\.000Z$/u, "Z"),
    nonce: randomBytes(24).toString("base64url"),
    single_use: true,
    ...(resourceUri === undefined ? {} : { resource_uri: resourceUri })
  };
  let signature: Buffer;
  try {
    const key = createPrivateKey(readFileSync(keyFile));
    if (key.asymmetricKeyType !== "ed25519") throw new Error("unsupported key");
    signature = sign(null, Buffer.from(canonicalJson(unsigned)), key);
  } catch {
    throw new DomainGatewayError(503, "高影响操作的签名密钥不可用。");
  }
  return Buffer.from(canonicalJson({
    ...unsigned,
    signature: { algorithm: "EdDSA", key_id: keyId, value: signature.toString("base64url") }
  })).toString("base64url");
}

function normalizeFieldValue(value: string): unknown {
  const trimmed = value.trim();
  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    try { return JSON.parse(trimmed); } catch { return value; }
  }
  return value;
}

function nativeCaptureBody(draft: CaptureDraft): Record<string, unknown> {
  return Object.fromEntries(Object.entries(draft.fields).flatMap(([key, value]) =>
    key === "source" || key === "original" ? [] : [[key, normalizeFieldValue(value)]]
  ));
}

function reviewDraft(domain: RuntimeDomain, value: ReviewEnvelope): CaptureDraft {
  const fields = Object.fromEntries(Object.entries(value.fields).map(([key, item]) => [key, typeof item === "string" ? item : JSON.stringify(item)]));
  const reviewSurface = domain.surfaces.find((surface) => surface.type === "review");
  return {
    id: `federated_${domain.id}_${value.review_id}`,
    captureGroupId: `federated_${domain.id}_pending`,
    classificationVersion: 2,
    sessionId: `domain:${domain.id}`,
    text: value.summary,
    domain: domain.id,
    intent: value.intent,
    summary: value.summary,
    createdAt: value.created_at,
    state: "pending",
    risk: riskLevel(value.risk_level ?? reviewSurface?.risk_level),
    fields,
    origin: "domain",
    domainDraftRef: value.reference,
    domainRevision: value.revision,
    domainReviewId: value.review_id,
    confirmable: true,
    sourceRefs: value.source_refs
  };
}

function validSuggestion(value: NexusSuggestion, domain: string): boolean {
  const actions = new Set(["ignore", "snooze", "mute", "create_draft", "view_evidence"]);
  return value?.protocol === "shadow.suggestion.v1"
    && value.domain === domain
    && /^sug_[A-Za-z0-9_-]{8,128}$/u.test(value.suggestion_id)
    && /^[a-z][a-z0-9-]*(?:\.[a-z][A-Za-z0-9-]*)+$/u.test(value.rule_id)
    && typeof value.dedupe_key === "string" && value.dedupe_key.length <= 256
    && typeof value.title === "string" && value.title.length > 0 && value.title.length <= 160
    && typeof value.summary === "string" && value.summary.length > 0 && value.summary.length <= 1000
    && typeof value.reason === "string" && value.reason.length > 0 && value.reason.length <= 2000
    && Array.isArray(value.evidence_refs) && value.evidence_refs.length <= 32
    && value.evidence_refs.every((item) => typeof item === "string" && item.startsWith("shadow://"))
    && Array.isArray(value.allowed_actions) && value.allowed_actions.length > 0
    && value.allowed_actions.every((item) => actions.has(item))
    && Number.isFinite(Date.parse(value.created_at)) && Number.isFinite(Date.parse(value.valid_until))
    && typeof value.data_freshness === "object" && value.data_freshness !== null
    && Number.isFinite(value.data_freshness.missing_ratio)
    && value.data_freshness.missing_ratio >= 0 && value.data_freshness.missing_ratio <= 1;
}

function receiptReference(domain: RuntimeDomain, reviewId: string, response: unknown): string {
  if (typeof response === "object" && response !== null) {
    for (const key of ["receipt", "reference"] as const) {
      const value = (response as Readonly<Record<string, unknown>>)[key];
      if (typeof value === "string" && value !== "") return value;
    }
    const fields = (response as { readonly fields?: unknown }).fields;
    if (typeof fields === "object" && fields !== null) {
      for (const key of ["resourceUri", "resource_uri", "recordRef", "record_ref", "publicUrl"]) {
        const value = (fields as Readonly<Record<string, unknown>>)[key];
        if (typeof value === "string" && value !== "") return value;
      }
    }
  }
  return `shadow://${domain.id}/reviews/${encodeURIComponent(reviewId)}`;
}

export class HttpDomainGateway implements DomainGateway {
  readonly runtime: NexusRuntime;

  constructor(private readonly timeoutMs = 4_000, runtime = loadNexusRuntime()) { this.runtime = runtime; }

  async project(now = new Date()): Promise<BootstrapProjection> {
    const domains: DomainSummary[] = [];
    const signals: TodaySignal[] = [];
    let connected = 0;
    for (const domain of this.runtime.domains) {
      const connection = domainConnection(domain);
      const summarySurface = domain.surfaces.find((surface) => surface.type === "summary");
      const reviewSurface = domain.surfaces.find((surface) => surface.type === "review");
      const captureSurface = domain.surfaces.find((surface) => surface.type === "capture");
      const searchSurface = domain.surfaces.find((surface) => surface.type === "search");
      const base: DomainSummary = {
        id: domain.id,
        label: domain.presentation.title,
        caption: domain.presentation.caption,
        icon: domain.presentation.icon,
        color: domain.presentation.color,
        order: domain.presentation.order,
        status: "offline",
        metric: connection === undefined ? "尚未配置" : "连接异常",
        detail: connection === undefined ? "缺少运行时连接配置" : "领域服务暂时不可用",
        captureEnabled: captureSurface !== undefined,
        searchEnabled: searchSurface?.operation !== undefined,
        ...(domain.app?.canonical_url === undefined ? {} : { appUrl: domain.app.canonical_url }),
        ...(reviewSurface === undefined ? {} : { reviewRisk: riskLevel(reviewSurface.risk_level) }),
        intentPrefixes: captureSurface?.intent_prefixes ?? []
      };
      if (connection === undefined) { domains.push(base); continue; }
      if (summarySurface?.operation === undefined) {
        if (domain.connection.health_path === undefined) { domains.push(base); continue; }
        try {
          await requestHealth(connection, domain.connection.health_path, this.timeoutMs);
          domains.push({ ...base, status: "ready", metric: "已连接", detail: "领域服务与能力已就绪" });
          connected += 1;
        } catch { domains.push(base); }
        continue;
      }
      try {
        const value = await requestJson<unknown>(connection, summarySurface.operation, this.timeoutMs);
        const display = summarySurface.display;
        const collection = pointer(value, display?.collection_pointer);
        const rawMetric = pointer(value, display?.metric_pointer);
        const rawDetail = pointer(value, display?.detail_pointer);
        const metric = displayValue(rawMetric) ?? (Array.isArray(collection) ? `${collection.length} 项` : "已同步");
        const unit = display?.unit;
        const detail = displayValue(rawDetail) ?? "领域摘要已更新";
        const ready: DomainSummary = { ...base, status: "ready", metric: unit === undefined ? metric : `${metric} ${unit}`, detail };
        domains.push(ready);
        signals.push({
          id: `${domain.id}-${now.toISOString().slice(0, 10)}`,
          domain: domain.id,
          eyebrow: domain.presentation.title,
          title: ready.metric,
          detail: ready.detail,
          time: now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
          tone: "calm"
        });
        connected += 1;
      } catch { domains.push(base); }
    }
    return { mode: connected > 0 ? "connected" : "preview", domains: domains.sort((left, right) => left.order - right.order), signals };
  }

  async discoverDrafts(): Promise<readonly CaptureDraft[]> {
    const discovered = await Promise.all(this.runtime.domains.map(async (domain) => {
      const connection = domainConnection(domain);
      if (connection === undefined || domain.review === null) return [];
      try {
        const result = await requestJson<{ readonly items?: readonly ReviewEnvelope[] }>(connection, domain.review.operations.list, this.timeoutMs);
        return (result.items ?? []).filter((item) => item.protocol === "shadow.review.v1" && item.state === "pending").map((item) => reviewDraft(domain, item));
      } catch { return []; }
    }));
    return discovered.flat().sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async discoverSuggestions(): Promise<readonly NexusSuggestion[]> {
    const discovered = await Promise.all(this.runtime.domains.map(async (domain) => {
      const surface = domain.surfaces.find((item) => item.type === "suggestions" && item.operation !== undefined);
      const connection = domainConnection(domain);
      if (surface?.operation === undefined || connection === undefined) return [];
      try {
        const result = await requestJson<{ readonly items?: readonly NexusSuggestion[] }>(connection, surface.operation, this.timeoutMs);
        return (result.items ?? []).slice(0, 50).filter((item) => validSuggestion(item, domain.id));
      } catch { return []; }
    }));
    return discovered.flat().filter((item) => Date.parse(item.valid_until) > Date.now())
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  async search(query: string, limit = 20): Promise<NexusSearchResult> {
    const normalized = query.trim();
    if (normalized === "" || normalized.length > 200) throw new DomainGatewayError(422, "搜索内容无效。");
    const boundedLimit = Math.max(1, Math.min(50, Math.trunc(limit)));
    const results = await Promise.all(this.runtime.domains.map(async (domain) => {
      const surface = domain.surfaces.find((item) => item.type === "search" && item.operation !== undefined);
      if (surface?.operation === undefined) return undefined;
      const connection = domainConnection(domain);
      if (connection === undefined) return { domain: domain.id, available: false, items: [] } as const;
      try {
        const response = await requestJson<unknown>(connection, surface.operation, this.timeoutMs, {
          body: { query: normalized, limit: boundedLimit }
        });
        const collection = pointer(response, surface.display?.collection_pointer);
        if (!Array.isArray(collection)) throw new DomainGatewayError(502, "领域搜索响应无效。");
        const items = collection.slice(0, boundedLimit).flatMap((item) => {
          const title = displayValue(pointer(item, surface.display?.item_title_pointer));
          if (title === undefined) return [];
          const detail = displayValue(pointer(item, surface.display?.item_detail_pointer)) ?? "";
          const reference = displayValue(pointer(item, surface.display?.item_reference_pointer));
          return [{
            domain: domain.id,
            domainLabel: domain.presentation.title,
            title,
            detail,
            ...(reference === undefined ? {} : { reference })
          }];
        });
        return { domain: domain.id, available: true, items } as const;
      } catch {
        return { domain: domain.id, available: false, items: [] } as const;
      }
    }));
    const attempted = results.filter((result) => result !== undefined);
    return {
      query: normalized,
      items: attempted.flatMap((result) => result.items).slice(0, boundedLimit),
      searchedDomains: attempted.filter((result) => result.available).map((result) => result.domain),
      unavailableDomains: attempted.filter((result) => !result.available).map((result) => result.domain)
    };
  }

  async createDraft(draft: CaptureDraft, actor?: string): Promise<string> {
    const domain = this.runtime.domains.find((item) => item.id === draft.domain);
    if (domain === undefined) throw new DomainGatewayError(422, "Proposal 指向了未安装的领域。");
    const connection = domainConnection(domain);
    if (connection === undefined) throw new DomainGatewayError(503, `${domain.presentation.title} 尚未连接。`);
    if (domain.review !== null) {
      let reviewId = draft.origin === "domain" ? draft.domainReviewId : undefined;
      let reviewRevision = draft.domainRevision;
      if (reviewId === undefined) {
        const created = await requestJson<ReviewEnvelope>(connection, domain.review.operations.create, this.timeoutMs, {
          body: {
            intent: draft.intent,
            summary: draft.summary,
            fields: draft.fields,
            source_text: draft.text,
            source_refs: draft.sourceRefs ?? []
          },
          idempotencyKey: draft.id
        });
        if (created.protocol !== "shadow.review.v1" || typeof created.review_id !== "string" || created.domain !== domain.id) throw new DomainGatewayError(502, "领域返回了无效的审核对象。");
        reviewId = created.review_id;
        reviewRevision = created.revision;
      }
      const argumentsValue = { review_id: reviewId };
      const confirmation = confirmationReceipt(domain, domain.review.operations.commit, argumentsValue, actor);
      const committed = await requestJson<unknown>(connection, domain.review.operations.commit, this.timeoutMs, {
        arguments: argumentsValue,
        body: reviewRevision === undefined ? {} : { revision: reviewRevision },
        idempotencyKey: `${draft.id}:commit`,
        ...(confirmation === undefined ? {} : { confirmation })
      });
      return receiptReference(domain, reviewId, committed);
    }
    const capture = domain.surfaces.find((surface) => surface.type === "capture" && surface.operation !== undefined);
    if (capture?.operation === undefined) throw new DomainGatewayError(503, "这个领域没有声明可用的采集入口。");
    const result = await requestJson<unknown>(connection, capture.operation, this.timeoutMs, { body: nativeCaptureBody(draft), idempotencyKey: draft.id });
    if (typeof result === "object" && result !== null) {
      for (const key of ["resource_uri", "record_ref", "draft_uri", "id"]) {
        const value = (result as Readonly<Record<string, unknown>>)[key];
        if (typeof value === "string" && value !== "") return value;
      }
    }
    return `shadow://${domain.id}/captures/${encodeURIComponent(draft.id)}`;
  }

  async rejectDraft(draft: CaptureDraft): Promise<void> {
    if (draft.origin !== "domain" || draft.domainReviewId === undefined) return;
    const domain = this.runtime.domains.find((item) => item.id === draft.domain);
    const connection = domain === undefined ? undefined : domainConnection(domain);
    if (domain?.review === null || domain?.review === undefined || connection === undefined) throw new DomainGatewayError(503, "领域审核入口当前不可用。");
    await requestJson(connection, domain.review.operations.reject, this.timeoutMs, {
      arguments: { review_id: draft.domainReviewId },
      body: draft.domainRevision === undefined ? {} : { revision: draft.domainRevision },
      idempotencyKey: `${draft.id}:reject`
    });
  }

  async reconcileConfirmedDraft(draft: CaptureDraft, actor?: string): Promise<string | undefined> {
    if (draft.state !== "approved" || draft.domainReviewId === undefined) return undefined;
    return this.createDraft({ ...draft, state: "pending", origin: "domain" }, actor);
  }
}

export function createDomainGateway(): DomainGateway {
  const timeout = Number(environmentValue("SHADOW_NEXUS_DOMAIN_TIMEOUT_MS") ?? "4000");
  return new HttpDomainGateway(Number.isInteger(timeout) && timeout >= 500 && timeout <= 15_000 ? timeout : 4_000);
}
