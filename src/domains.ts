import { createHash, createPrivateKey, randomBytes, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { CaptureDraft, DomainId, DomainMetric, DomainSummary, NexusQuickAction, NexusQuickActionField, NexusQuickActionRequest, NexusSearchResult, NexusSuggestion, RiskLevel, TodaySignal } from "./contracts.js";
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
  readonly type: "summary" | "suggestions" | "capture" | "quick-action" | "review" | "search" | "run-status" | "app-link" | "resource-link";
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
    readonly metrics?: readonly {
      readonly id: string;
      readonly label: string;
      readonly value_pointer: string;
      readonly detail_pointer?: string;
      readonly unit?: string;
      readonly tone?: DomainMetric["tone"];
    }[];
  };
  readonly action?: {
    readonly title: string;
    readonly description: string;
    readonly intent: string;
    readonly icon?: string;
    readonly order?: number;
    readonly submit_label: string;
    readonly success_message?: string;
    readonly summary_template?: string;
    readonly fields: readonly {
      readonly id: string;
      readonly label: string;
      readonly type: NexusQuickActionField["type"];
      readonly required: boolean;
      readonly default?: string;
      readonly placeholder?: string;
      readonly unit?: string;
      readonly minimum?: number;
      readonly maximum?: number;
      readonly step?: number;
      readonly max_length?: number;
      readonly options?: readonly { readonly value: string; readonly label: string }[];
    }[];
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
  policyFor(draft: CaptureDraft): DraftExecutionPolicy;
  quickActionDraft(input: NexusQuickActionRequest, now?: Date): CaptureDraft;
  project(now?: Date): Promise<BootstrapProjection>;
  discoverDrafts(): Promise<readonly CaptureDraft[]>;
  discoverSuggestions(): Promise<readonly NexusSuggestion[]>;
  search(query: string, limit?: number): Promise<NexusSearchResult>;
  createDraft(draft: CaptureDraft, actor?: string): Promise<string>;
  rejectDraft(draft: CaptureDraft): Promise<void>;
  reconcileConfirmedDraft(draft: CaptureDraft, actor?: string): Promise<string | undefined>;
}

export type NexusExecutionPolicy = "trusted" | "review-first";

export interface DraftExecutionPolicy {
  readonly risk: RiskLevel;
  readonly mode: "automatic" | "review" | "prohibited";
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

const metricTones = new Set(["neutral", "good", "attention", "warning"]);
const quickActionFieldTypes = new Set(["hidden", "decimal", "integer", "text", "date", "datetime", "select"]);

function validateDisplayMetrics(surface: RuntimeSurface): void {
  const metrics = surface.display?.metrics;
  if (metrics === undefined) return;
  if (!Array.isArray(metrics) || metrics.length > 8) throw new DomainGatewayError(500, "Nexus 面板指标投影无效。");
  const ids = new Set<string>();
  for (const metric of metrics) {
    if (typeof metric !== "object" || metric === null) throw new DomainGatewayError(500, "Nexus 面板指标投影无效。");
    const id = runtimeString(metric.id, "metric id");
    const label = runtimeString(metric.label, "metric label");
    const valuePointer = runtimeString(metric.value_pointer, "metric value pointer");
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(id) || ids.has(id) || label.length > 40
      || !valuePointer.startsWith("/") || valuePointer.length > 200
      || (metric.detail_pointer !== undefined && (typeof metric.detail_pointer !== "string" || !metric.detail_pointer.startsWith("/") || metric.detail_pointer.length > 200))
      || (metric.unit !== undefined && (typeof metric.unit !== "string" || metric.unit.length > 16))
      || (metric.tone !== undefined && !metricTones.has(metric.tone))) {
      throw new DomainGatewayError(500, "Nexus 面板指标投影无效。");
    }
    ids.add(id);
  }
}

function validateQuickActionSurface(surface: RuntimeSurface): void {
  if (surface.type !== "quick-action") {
    if (surface.action !== undefined) throw new DomainGatewayError(500, "Nexus 快捷动作投影无效。");
    return;
  }
  const action = surface.action;
  if (action === undefined || surface.operation === undefined || surface.risk_level === undefined) {
    throw new DomainGatewayError(500, "Nexus 快捷动作投影无效。");
  }
  const intent = runtimeString(action.intent, "quick action intent");
  if (runtimeString(action.title, "quick action title").length > 40
    || runtimeString(action.description, "quick action description").length > 120
    || runtimeString(action.submit_label, "quick action submit label").length > 24
    || !/^[a-z][a-z0-9-]*(?:\.[a-z][A-Za-z0-9-]*)+$/u.test(intent)
    || !Array.isArray(action.fields)
    || action.fields.length < 1 || action.fields.length > 12) {
    throw new DomainGatewayError(500, "Nexus 快捷动作投影无效。");
  }
  const ids = new Set<string>();
  for (const field of action.fields) {
    if (typeof field !== "object" || field === null) throw new DomainGatewayError(500, "Nexus 快捷动作投影无效。");
    const optionsValid = field.options === undefined || (Array.isArray(field.options)
      && field.options.length >= 1 && field.options.length <= 50
      && field.options.every((option: unknown) => {
        if (typeof option !== "object" || option === null) return false;
        const candidate = option as Readonly<Record<string, unknown>>;
        return typeof candidate.value === "string" && candidate.value.length <= 100
          && typeof candidate.label === "string" && candidate.label.trim() !== "" && candidate.label.length <= 80;
      }));
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field.id)
      || ids.has(field.id) || runtimeString(field.label, "quick action field label").length > 40
      || !quickActionFieldTypes.has(field.type) || typeof field.required !== "boolean"
      || (field.default !== undefined && (typeof field.default !== "string" || field.default.length > 200))
      || (field.placeholder !== undefined && (typeof field.placeholder !== "string" || field.placeholder.length > 80))
      || (field.unit !== undefined && (typeof field.unit !== "string" || field.unit.length > 16))
      || (field.type === "hidden" && typeof field.default !== "string")
      || (field.type === "select" && field.options === undefined) || !optionsValid
      || (field.minimum !== undefined && !Number.isFinite(field.minimum))
      || (field.maximum !== undefined && !Number.isFinite(field.maximum))
      || (field.minimum !== undefined && field.maximum !== undefined && field.minimum > field.maximum)
      || (field.step !== undefined && (!Number.isFinite(field.step) || field.step <= 0))
      || (field.max_length !== undefined && (!Number.isInteger(field.max_length) || field.max_length < 1 || field.max_length > 2_000))) {
      throw new DomainGatewayError(500, "Nexus 快捷动作投影无效。");
    }
    ids.add(field.id);
  }
  const placeholders = [...(action.summary_template ?? "").matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu)].map((match) => match[1]);
  if (placeholders.some((id) => id === undefined || !ids.has(id))) throw new DomainGatewayError(500, "Nexus 快捷动作摘要模板无效。");
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
    for (const surface of domain.surfaces) {
      validateDisplayMetrics(surface);
      validateQuickActionSurface(surface);
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

function quickActions(domain: RuntimeDomain): readonly NexusQuickAction[] {
  return domain.surfaces.flatMap((surface) => {
    const action = surface.type === "quick-action" ? surface.action : undefined;
    if (action === undefined) return [];
    return [{
      id: surface.id,
      domain: domain.id,
      title: action.title,
      description: action.description,
      intent: action.intent,
      icon: action.icon ?? surface.id,
      order: action.order ?? domain.presentation.order,
      risk: riskLevel(surface.risk_level),
      submitLabel: action.submit_label,
      successMessage: action.success_message ?? `${action.title}已完成`,
      ...(action.summary_template === undefined ? {} : { summaryTemplate: action.summary_template }),
      fields: action.fields.map((field) => ({
        id: field.id,
        label: field.label,
        type: field.type,
        required: field.required,
        ...(field.default === undefined ? {} : { default: field.default }),
        ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
        ...(field.unit === undefined ? {} : { unit: field.unit }),
        ...(field.minimum === undefined ? {} : { minimum: field.minimum }),
        ...(field.maximum === undefined ? {} : { maximum: field.maximum }),
        ...(field.step === undefined ? {} : { step: field.step }),
        ...(field.max_length === undefined ? {} : { maxLength: field.max_length }),
        ...(field.options === undefined ? {} : { options: field.options })
      }))
    }];
  }).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

const runtimeRiskRank: Readonly<Record<RuntimeOperation["risk_level"], number>> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4
};

const modelRiskRank: Readonly<Record<RiskLevel, number>> = { low: 0, medium: 2, high: 3 };

function maxRuntimeRisk(values: readonly (RuntimeOperation["risk_level"] | undefined)[]): RuntimeOperation["risk_level"] {
  return values.reduce<RuntimeOperation["risk_level"]>((highest, value) =>
    value !== undefined && runtimeRiskRank[value] > runtimeRiskRank[highest] ? value : highest, "L0");
}

function configuredExecutionPolicy(value = environmentValue("SHADOW_NEXUS_EXECUTION_POLICY")): NexusExecutionPolicy {
  if (value === undefined || value === "trusted") return "trusted";
  if (value === "review-first") return "review-first";
  throw new DomainGatewayError(500, "SHADOW_NEXUS_EXECUTION_POLICY 只支持 trusted 或 review-first。");
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

function displayMetrics(value: unknown, surface: RuntimeSurface): readonly DomainMetric[] {
  return (surface.display?.metrics ?? []).slice(0, 8).flatMap((definition) => {
    const raw = displayValue(pointer(value, definition.value_pointer));
    if (raw === undefined) return [];
    const metricValue = definition.unit === undefined ? raw : `${raw} ${definition.unit}`;
    const detail = displayValue(pointer(value, definition.detail_pointer));
    return [{
      id: definition.id,
      label: definition.label,
      value: metricValue,
      ...(detail === undefined ? {} : { detail }),
      ...(definition.tone === undefined ? {} : { tone: definition.tone })
    }];
  });
}

function operationPath(operation: RuntimeOperation, context: Readonly<Record<string, string>>, argumentsValue: Readonly<Record<string, unknown>> = {}): string {
  const consumed = new Set<string>();
  const path = operation.path.replaceAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (_match, name: string) => {
    const value = argumentsValue[name] ?? context[name];
    if (typeof value !== "string" && typeof value !== "number") throw new DomainGatewayError(422, `缺少领域参数 ${name}。`);
    consumed.add(name);
    return encodeURIComponent(String(value));
  });
  const url = new URL(path, "http://shadow.local");
  for (const [name, value] of Object.entries(context)) {
    if (!consumed.has(name) && !url.searchParams.has(name)) url.searchParams.set(name, value);
  }
  return `${url.pathname}${url.search}`;
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

function localDate(now: Date): string {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function actionDefault(value: string | undefined, now: Date): string | undefined {
  if (value === "$today") return localDate(now);
  if (value === "$now") return now.toISOString();
  return value;
}

function validateQuickActionFields(action: NexusQuickAction, input: Readonly<Record<string, string>>, now: Date): Readonly<Record<string, string>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw new DomainGatewayError(422, "快捷动作字段无效。");
  const definitions = new Map(action.fields.map((field) => [field.id, field]));
  if (Object.keys(input).some((key) => !definitions.has(key))) throw new DomainGatewayError(422, "快捷动作包含未声明字段。");
  const fields: Record<string, string> = {};
  for (const definition of action.fields) {
    if (definition.type === "hidden") {
      if (definition.id in input) throw new DomainGatewayError(422, "快捷动作隐藏字段不能由浏览器覆盖。");
      const value = actionDefault(definition.default, now);
      if (value !== undefined) fields[definition.id] = value;
      continue;
    }
    const supplied = input[definition.id];
    if (supplied !== undefined && typeof supplied !== "string") throw new DomainGatewayError(422, `${definition.label}格式无效。`);
    const value = supplied === undefined || supplied.trim() === "" ? actionDefault(definition.default, now) : supplied.trim();
    if (value === undefined || value === "") {
      if (definition.required) throw new DomainGatewayError(422, `${definition.label}不能为空。`);
      continue;
    }
    if (value.length > (definition.maxLength ?? 2_000)) throw new DomainGatewayError(422, `${definition.label}过长。`);
    if (definition.type === "decimal" || definition.type === "integer") {
      const valid = definition.type === "integer" ? /^-?[0-9]+$/u.test(value) : /^-?[0-9]+(?:\.[0-9]+)?$/u.test(value);
      const numeric = Number(value);
      if (!valid || !Number.isFinite(numeric)
        || (definition.minimum !== undefined && numeric < definition.minimum)
        || (definition.maximum !== undefined && numeric > definition.maximum)) throw new DomainGatewayError(422, `${definition.label}超出允许范围。`);
    } else if (definition.type === "date") {
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new DomainGatewayError(422, `${definition.label}不是有效日期。`);
    } else if (definition.type === "datetime") {
      if (Number.isNaN(Date.parse(value))) throw new DomainGatewayError(422, `${definition.label}不是有效时间。`);
    } else if (definition.type === "select") {
      if (!(definition.options ?? []).some((option) => option.value === value)) throw new DomainGatewayError(422, `${definition.label}选项无效。`);
    }
    fields[definition.id] = value;
  }
  return fields;
}

function quickActionSummary(action: NexusQuickAction, fields: Readonly<Record<string, string>>): string {
  const templated = (action.summaryTemplate ?? action.title).replaceAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (_match, id: string) => fields[id] ?? "");
  return templated.replaceAll(/\s+/gu, " ").trim().slice(0, 240) || action.title;
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

  constructor(
    private readonly timeoutMs = 4_000,
    runtime = loadNexusRuntime(),
    private readonly executionPolicy = configuredExecutionPolicy()
  ) { this.runtime = runtime; }

  policyFor(draft: CaptureDraft): DraftExecutionPolicy {
    const domain = this.runtime.domains.find((item) => item.id === draft.domain);
    if (domain === undefined) throw new DomainGatewayError(422, "Proposal 指向了未安装的领域。");
    const capture = domain.surfaces.find((surface) => surface.type === "capture"
      && (surface.intent_prefixes ?? []).some((prefix) => draft.intent === prefix || draft.intent.startsWith(`${prefix}.`)));
    const declared = maxRuntimeRisk([
      capture?.risk_level,
      capture?.operation?.risk_level,
      domain.surfaces.find((surface) => surface.type === "review")?.risk_level,
      domain.review?.operations.create.risk_level,
      domain.review?.operations.commit.risk_level
    ]);
    const effectiveRisk = Math.max(runtimeRiskRank[declared], modelRiskRank[draft.risk]);
    const risk: RiskLevel = effectiveRisk >= 3 ? "high" : effectiveRisk >= 2 ? "medium" : "low";
    if (declared === "L4") return { risk, mode: "prohibited" };
    if (this.executionPolicy === "review-first" || effectiveRisk >= 3) return { risk, mode: "review" };
    return { risk, mode: "automatic" };
  }

  quickActionDraft(input: NexusQuickActionRequest, now = new Date()): CaptureDraft {
    const domain = this.runtime.domains.find((item) => item.id === input.domain);
    const action = domain === undefined ? undefined : quickActions(domain).find((item) => item.id === input.actionId);
    if (domain === undefined || action === undefined) throw new DomainGatewayError(404, "没有找到这个快捷动作。");
    const sessionId = input.sessionId?.trim() || `quick-action:${domain.id}`;
    if (sessionId.length > 256) throw new DomainGatewayError(422, "快捷动作会话标识无效。");
    const values = validateQuickActionFields(action, input.fields, now);
    const summary = quickActionSummary(action, values);
    const id = `quick_${domain.id}_${input.actionId}_${randomUUID()}`;
    return {
      id,
      captureGroupId: id,
      classificationVersion: 2,
      sessionId,
      text: summary,
      domain: domain.id,
      intent: action.intent,
      summary,
      createdAt: now.toISOString(),
      state: "pending",
      risk: action.risk,
      fields: { ...values, source: "shadow-nexus-quick-action", original: summary },
      origin: "nexus",
      sourceRefs: [`shadow://nexus/quick-actions/${domain.id}/${input.actionId}`]
    };
  }

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
        quickActions: quickActions(domain),
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
        const primaryMetric = unit === undefined ? metric : `${metric} ${unit}`;
        const declaredMetrics = displayMetrics(value, summarySurface);
        const metrics: readonly DomainMetric[] = declaredMetrics.length > 0 ? declaredMetrics : [{
          id: "primary",
          label: "当前",
          value: primaryMetric,
          detail
        }];
        const ready: DomainSummary = { ...base, status: "ready", metric: primaryMetric, detail, metrics };
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
    if (this.policyFor(draft).mode === "prohibited") throw new DomainGatewayError(422, "受保护的 L4 操作不能由 Nexus 执行。");
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
