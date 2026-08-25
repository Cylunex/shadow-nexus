import type { CaptureDraft, DomainId, DomainSummary, TodaySignal } from "./contracts.js";
import type { BootstrapProjection } from "./projection.js";

interface DomainConnection {
  readonly baseUrl: string;
  readonly token: string;
}

interface HealthConnection extends DomainConnection {
  readonly profileId: string;
}

interface HealthSummary {
  readonly summary: string;
  readonly date: string;
  readonly indicators: {
    readonly diet_kcal: number;
    readonly protein_g: number;
    readonly steps: number | null;
    readonly workout_sessions: number;
    readonly workout_min: number;
    readonly weight_kg: number | null;
    readonly sleep_hours: number | null;
    readonly mood_score: number | null;
  };
}

interface LedgerSummary {
  readonly month: string;
  readonly currency: string;
  readonly expense: string;
  readonly income: string;
  readonly refund: string;
  readonly net_spending: string;
}

interface HealthDraftReceipt {
  readonly resource_uri: string;
  readonly draft_id: string;
}

interface HealthCommitReceipt {
  readonly resource_uri: string;
  readonly status: "applied";
}

interface LedgerDraftReceipt {
  readonly record_ref: string;
}

export class DomainGatewayError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface DomainGateway {
  project(now?: Date): Promise<BootstrapProjection>;
  createDraft(draft: CaptureDraft): Promise<string>;
  reconcileConfirmedDraft(draft: CaptureDraft): Promise<string | undefined>;
}

function environmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function connection(baseUrlName: string, tokenName: string): DomainConnection | undefined {
  const baseUrl = environmentValue(baseUrlName);
  const token = environmentValue(tokenName);
  return baseUrl === undefined || token === undefined ? undefined : { baseUrl: baseUrl.replace(/\/+$/u, ""), token };
}

function formatMoney(value: string, currency: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return `${value} ${currency}`;
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(number);
}

function localDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

function signalTime(now: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(now);
}

function offlineDomain(id: DomainId, label: string, caption: string, configured: boolean): DomainSummary {
  return {
    id,
    label,
    caption,
    status: "offline",
    metric: configured ? "连接异常" : "尚未配置",
    detail: configured ? "领域服务暂时不可用" : "未启用这个领域的数据连接"
  };
}

async function requestJson<T>(
  connectionValue: DomainConnection,
  path: string,
  timeoutMs: number,
  init: RequestInit = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${connectionValue.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${connectionValue.token}`,
        accept: "application/json",
        ...init.headers
      },
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
      ? String((value as { readonly detail?: unknown }).detail ?? "")
      : "";
    const message = response.status === 401 || response.status === 403
      ? "领域连接没有执行此操作的权限。"
      : response.status >= 500
        ? "领域服务暂时不可用。"
        : upstream || "领域服务拒绝了这条草稿。";
    throw new DomainGatewayError(response.status >= 500 ? 503 : 422, message);
  }
  return value as T;
}

function healthPayload(draft: CaptureDraft): Record<string, unknown> {
  const fields = draft.fields;
  const effectiveDate = localDate(new Date(draft.createdAt));
  if (fields.recordType === "metric") {
    const metric: Record<string, number> = {};
    if (fields.weightKg !== undefined) metric.weight_kg = Number(fields.weightKg);
    if (fields.sleepHours !== undefined) metric.sleep_hours = Number(fields.sleepHours);
    if (fields.moodScore !== undefined) metric.mood_score = Number(fields.moodScore);
    if (Object.keys(metric).length === 0 || Object.values(metric).some((value) => !Number.isFinite(value))) {
      throw new DomainGatewayError(422, "没有识别出可写入的体重、睡眠或情绪数值。");
    }
    return { record_type: "metric", effective_date: effectiveDate, fields: metric, note: draft.text.slice(0, 500) };
  }
  if (fields.recordType === "meal" && fields.meal !== undefined) {
    const meal: Record<string, unknown> = {
      meal: fields.meal,
      name: fields.mealName ?? draft.text.replaceAll(/\s+/gu, " ").slice(0, 120)
    };
    if (fields.amountG !== undefined) meal.amount_g = Number(fields.amountG);
    if (fields.kcal !== undefined) meal.kcal = Number(fields.kcal);
    if (fields.proteinG !== undefined) meal.protein_g = Number(fields.proteinG);
    if (Object.values(meal).some((value) => typeof value === "number" && !Number.isFinite(value))) {
      throw new DomainGatewayError(422, "饮食记录包含无效的营养数值。");
    }
    return {
      record_type: "meal",
      effective_date: effectiveDate,
      fields: meal,
      note: draft.text.slice(0, 500)
    };
  }
  if (fields.durationMin !== undefined) {
    const workout: Record<string, unknown> = {
      session_type: /跑/u.test(draft.text) ? "跑步" : "运动",
      duration_min: Number(fields.durationMin)
    };
    if (fields.distanceKm !== undefined) workout.distance_km = Number(fields.distanceKm);
    if (fields.rpe !== undefined) workout.rpe = Number(fields.rpe);
    if (Object.values(workout).some((value) => typeof value === "number" && !Number.isFinite(value))) {
      throw new DomainGatewayError(422, "运动记录包含无效数值。");
    }
    return { record_type: "workout", effective_date: effectiveDate, fields: workout, note: draft.text.slice(0, 500) };
  }
  throw new DomainGatewayError(422, "这条健康记录还缺少可确认的数值；运动记录至少需要时长。");
}

function ledgerPayload(draft: CaptureDraft): Record<string, unknown> {
  const amount = draft.fields.amount;
  const moneyType = draft.fields.moneyType;
  if (amount === undefined || !["expense", "income", "refund"].includes(moneyType ?? "")) {
    throw new DomainGatewayError(422, "这条收支记录还缺少金额或收支类型。");
  }
  const payload: Record<string, unknown> = {
    occurred_at: draft.createdAt,
    timezone: "Asia/Shanghai",
    money_type: moneyType,
    amount,
    currency: draft.fields.currency ?? "CNY",
    title: draft.fields.title ?? draft.text.replaceAll(/\s+/gu, " ").slice(0, 160)
  };
  if (draft.fields.categoryKey !== undefined) payload.category_key = draft.fields.categoryKey;
  return payload;
}

export class HttpDomainGateway implements DomainGateway {
  private readonly health: HealthConnection | undefined;
  private readonly ledger: DomainConnection | undefined;

  constructor(private readonly timeoutMs = 4_000) {
    const health = connection("SHADOW_HEALTH_BASE_URL", "SHADOW_HEALTH_AGENT_TOKEN");
    const profileId = environmentValue("SHADOW_HEALTH_PROFILE_ID");
    this.health = health === undefined || profileId === undefined ? undefined : { ...health, profileId };
    this.ledger = connection("SHADOW_LEDGER_BASE_URL", "SHADOW_LEDGER_AGENT_TOKEN");
  }

  async project(now = new Date()): Promise<BootstrapProjection> {
    const domains: DomainSummary[] = [
      offlineDomain("health", "Health", "身体与日常状态", this.health !== undefined),
      offlineDomain("ledger", "Ledger", "收支与消费记忆", this.ledger !== undefined),
      offlineDomain("travel", "Travel", "目的地、行程与足迹", false),
      offlineDomain("archive", "Archive", "资料、附件与长期存档", false),
      offlineDomain("foliant", "Foliant", "阅读、笔记与想法", false)
    ];
    const signals: TodaySignal[] = [];
    let connected = 0;
    const currentTime = signalTime(now);

    if (this.health !== undefined) {
      try {
        const summary = await requestJson<HealthSummary>(
          this.health,
          `/api/machine/v1/agent/profiles/${encodeURIComponent(this.health.profileId)}/summary?date=${localDate(now)}`,
          this.timeoutMs
        );
        const metric = summary.indicators.sleep_hours !== null
          ? `${summary.indicators.sleep_hours} h`
          : summary.indicators.weight_kg !== null
            ? `${summary.indicators.weight_kg} kg`
            : summary.indicators.steps !== null
              ? `${summary.indicators.steps.toLocaleString("zh-CN")} 步`
              : "今日已同步";
        domains[0] = { id: "health", label: "Health", caption: "身体与日常状态", status: "ready", metric, detail: `${summary.date} · ${summary.indicators.workout_min} 分钟运动` };
        signals.push({ id: `health-${summary.date}`, domain: "health", eyebrow: "今日健康", title: metric, detail: summary.summary, time: currentTime, tone: "calm" });
        connected += 1;
      } catch { /* The domain card already carries the isolated failure state. */ }
    }

    if (this.ledger !== undefined) {
      try {
        const summary = await requestJson<LedgerSummary>(this.ledger, "/api/machine/v1/agent/summary?currency=CNY", this.timeoutMs);
        const metric = formatMoney(summary.net_spending, summary.currency);
        domains[1] = { id: "ledger", label: "Ledger", caption: "收支与消费记忆", status: "ready", metric, detail: `${summary.month} 净支出 · 收入 ${formatMoney(summary.income, summary.currency)}` };
        signals.push({ id: `ledger-${summary.month}`, domain: "ledger", eyebrow: "本月收支", title: `净支出 ${metric}`, detail: `支出 ${formatMoney(summary.expense, summary.currency)}，退款 ${formatMoney(summary.refund, summary.currency)}。`, time: currentTime, tone: "focus" });
        connected += 1;
      } catch { /* The domain card already carries the isolated failure state. */ }
    }
    return { mode: connected > 0 ? "connected" : "preview", domains, signals };
  }

  async createDraft(draft: CaptureDraft): Promise<string> {
    if (draft.domain === "health") {
      if (this.health === undefined) throw new DomainGatewayError(503, "Health 尚未连接。");
      const draftResult = await requestJson<HealthDraftReceipt>(
        this.health,
        `/api/machine/v1/agent/profiles/${encodeURIComponent(this.health.profileId)}/drafts`,
        this.timeoutMs,
        {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": draft.id },
          body: JSON.stringify(healthPayload(draft))
        }
      );
      const commitResult = await requestJson<HealthCommitReceipt>(
        this.health,
        `/api/machine/v1/agent/profiles/${encodeURIComponent(this.health.profileId)}/drafts/${encodeURIComponent(draftResult.draft_id)}/commit`,
        this.timeoutMs,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
      );
      return commitResult.resource_uri;
    }
    if (draft.domain === "ledger") {
      if (this.ledger === undefined) throw new DomainGatewayError(503, "Ledger 尚未连接。");
      const result = await requestJson<LedgerDraftReceipt>(this.ledger, "/api/machine/v1/agent/drafts", this.timeoutMs, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": draft.id },
        body: JSON.stringify(ledgerPayload(draft))
      });
      return result.record_ref;
    }
    throw new DomainGatewayError(503, "这个领域尚未接入 Nexus 写入适配器。");
  }

  async reconcileConfirmedDraft(draft: CaptureDraft): Promise<string | undefined> {
    if (draft.state !== "approved" || draft.domain !== "health" || this.health === undefined) return undefined;
    const match = draft.receipt?.match(/^shadow:\/\/health\/drafts\/(hd_[a-f0-9]{32})$/u);
    if (match?.[1] === undefined) return undefined;
    const result = await requestJson<HealthCommitReceipt>(
      this.health,
      `/api/machine/v1/agent/profiles/${encodeURIComponent(this.health.profileId)}/drafts/${encodeURIComponent(match[1])}/commit`,
      this.timeoutMs,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
    );
    return result.resource_uri;
  }
}

export function createDomainGateway(): DomainGateway {
  const timeout = Number(environmentValue("SHADOW_NEXUS_DOMAIN_TIMEOUT_MS") ?? "4000");
  return new HttpDomainGateway(Number.isInteger(timeout) && timeout >= 500 && timeout <= 15_000 ? timeout : 4_000);
}
