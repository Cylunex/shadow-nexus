import {
  NEXUS_PROTOCOL_VERSION,
  type CaptureAnalysis,
  type ActivityEntry,
  type CaptureDraft,
  type DomainSummary,
  type NexusBootstrap,
  type NexusContextPack,
  type NexusBrief,
  type NexusCapabilityStatus,
  type NexusMemory,
  type NexusPreferences,
  type NexusIntentPlan,
  type NexusSuggestion,
  type RiskLevel,
  type TrustOverview,
  type TodaySignal
} from "./contracts.js";

export interface BootstrapProjection {
  readonly mode: "preview" | "connected";
  readonly domains: readonly DomainSummary[];
  readonly signals: readonly TodaySignal[];
  readonly capabilities?: NexusCapabilityStatus;
}

export const unavailableCapabilityStatus: NexusCapabilityStatus = {
  protocol: "unavailable", selected: 0, client: 0, deployed: 0, observed: 0, restoreTested: 0, failed: 0, attention: []
};

export const disconnectedProjection: BootstrapProjection = { mode: "preview", domains: [], signals: [], capabilities: unavailableCapabilityStatus };

export const defaultNexusPreferences: NexusPreferences = {
  notificationsEnabled: true,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  sensitivePreviews: false,
  briefCadence: "daily"
};

const supportedRisks = new Set<RiskLevel>(["low", "medium", "high"]);

function validateCapture(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error("记录内容不能为空。");
  if (trimmed.length > 4_000) throw new Error("单条记录不能超过 4000 个字符。");
  return trimmed;
}

/**
 * Local keyword routing was removed in v0.2. Capture classification must come from
 * the selected DSH Profile and the compiled Platform projection.
 */
export function createDrafts(): readonly CaptureDraft[] {
  throw new Error("本地关键词路由已停用；请提交 DSH 结构化分析。");
}

export function createDraft(): CaptureDraft {
  throw new Error("本地关键词路由已停用；请提交 DSH 结构化分析。");
}

/** Build review drafts from completed DSH analysis, never from local keyword routing. */
export function createAnalyzedDrafts(
  sessionId: string,
  text: string,
  analysis: CaptureAnalysis | NexusIntentPlan,
  now = new Date(),
  attachmentRefs: readonly string[] = [],
  installedDomains?: ReadonlySet<string>
): readonly CaptureDraft[] {
  const trimmed = text.trim() === "" && attachmentRefs.length > 0 ? "来自附件的批量记录" : validateCapture(text);
  const analysisId = analysis.version === 2 ? analysis.captureId : analysis.interactionId;
  const validId = analysis.version === 2
    ? /^capture_[A-Za-z0-9-]{8,80}$/u.test(analysisId)
    : /^interaction_[A-Za-z0-9-]{8,80}$/u.test(analysisId);
  if (!validId) throw new Error("DSH 返回的采集分析标识无效。");
  if (!Array.isArray(analysis.drafts) || analysis.drafts.length > 200 || (analysis.version === 2 && analysis.drafts.length < 1)) {
    throw new Error("DSH 没有返回可确认的领域草稿。");
  }
  if (analysis.version === 3) {
    if (!new Set(["answer", "propose", "mixed", "clarify"]).has(analysis.route)) throw new Error("DSH 返回的处理路由无效。");
    if (typeof analysis.response !== "string" || analysis.response.length > 4_000) throw new Error("DSH 返回的回复摘要无效。");
    if ((analysis.route === "answer" || analysis.route === "clarify") && analysis.drafts.length > 0) throw new Error("DSH 返回的处理路由与 Proposal 不一致。");
    if (analysis.route === "propose" && analysis.drafts.length === 0) throw new Error("DSH 没有返回需要确认的 Proposal。");
  }
  const createdAt = now.toISOString();
  const groupId = `draft_${analysisId}`;
  const availableAttachmentRefs = new Set(attachmentRefs);
  return analysis.drafts.map((item, index) => {
    const validDomain = typeof item.domain === "string" && /^[a-z][a-z0-9-]{1,63}$/u.test(item.domain)
      && (installedDomains === undefined || installedDomains.has(item.domain));
    if (!validDomain) throw new Error("DSH 返回了未安装的领域。");
    const validIntent = typeof item.intent === "string"
      && item.intent.length <= 120
      && item.intent.startsWith(`${item.domain}.`)
      && /^[a-z][A-Za-z0-9._-]+$/u.test(item.intent);
    if (!supportedRisks.has(item.risk) || !validIntent) throw new Error("DSH 返回的草稿类型无效。");
    if (typeof item.summary !== "string" || item.summary.trim() === "" || item.summary.length > 240) {
      throw new Error("DSH 返回的草稿摘要无效。");
    }
    if (typeof item.fields !== "object" || item.fields === null || Array.isArray(item.fields)) {
      throw new Error("DSH 返回的结构化字段无效。");
    }
    const fields: Record<string, string> = { source: "shadow-nexus", original: trimmed };
    for (const [key, value] of Object.entries(item.fields)) {
      const maxLength = key.endsWith("Json") || key.endsWith("_json") ? 8_000 : 2_048;
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key) || typeof value !== "string" || value.length > maxLength) {
        throw new Error("DSH 返回的结构化字段无效。");
      }
      fields[key] = value;
    }
    const selectedAttachmentRefs = item.attachmentRefs ?? [];
    if (selectedAttachmentRefs.some((reference: string) => !availableAttachmentRefs.has(reference))) {
      throw new Error("DSH 返回了不属于本次交互的附件引用。");
    }
    return {
      id: `${groupId}_${item.domain}_${String(index + 1)}`,
      captureGroupId: groupId,
      classificationVersion: 2,
      sessionId,
      text: trimmed,
      domain: item.domain,
      intent: item.intent,
      summary: item.summary.trim(),
      createdAt,
      state: "pending",
      risk: item.risk,
      fields,
      origin: "nexus",
      ...(selectedAttachmentRefs.length === 0 ? {} : { attachmentRefs: selectedAttachmentRefs }),
      planContract: analysis.contract
    };
  });
}

/** Preserve old persisted drafts without silently re-routing them. */
export function reclassifyStoredDraft(draft: CaptureDraft): readonly CaptureDraft[] {
  if (draft.classificationVersion === 2) return [draft];
  return [{ ...draft, classificationVersion: 2, captureGroupId: draft.captureGroupId ?? draft.id }];
}

export function createBootstrap(
  _sessionId: string | undefined,
  drafts: readonly CaptureDraft[],
  now = new Date(),
  projection: BootstrapProjection = disconnectedProjection,
  assetUploadEnabled = false,
  contexts: readonly NexusContextPack[] = [],
  suggestions: readonly NexusSuggestion[] = [],
  preferences: NexusPreferences = defaultNexusPreferences,
  memories: readonly NexusMemory[] = []
): NexusBootstrap {
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now);
  const hour = now.getHours();
  const greeting = hour < 6 ? "夜深了，欢迎回来。" : hour < 12 ? "早上好，欢迎回来。" : hour < 18 ? "下午好，欢迎回来。" : "晚上好，欢迎回来。";
  const activity = createActivityLedger(drafts);
  const trust = createTrustOverview(drafts);
  return {
    protocol: NEXUS_PROTOCOL_VERSION,
    mode: projection.mode,
    generatedAt: now.toISOString(),
    greeting,
    dateLabel,
    focus: "把散落的信息收回来，再决定它们最终属于哪里。",
    signals: projection.signals,
    domains: projection.domains,
    drafts,
    activity,
    trust,
    preferences,
    brief: createNexusBrief(projection, trust, suggestions, preferences, now),
    memories,
    contexts,
    suggestions,
    capabilities: projection.capabilities ?? unavailableCapabilityStatus,
    assetUpload: { enabled: assetUploadEnabled, maxFilesPerMessage: 8 }
  };
}

function minutesOfDay(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

function inQuietHours(preferences: NexusPreferences, now: Date): boolean {
  const current = now.getHours() * 60 + now.getMinutes();
  const start = minutesOfDay(preferences.quietHoursStart);
  const end = minutesOfDay(preferences.quietHoursEnd);
  return start === end ? false : start < end ? current >= start && current < end : current >= start || current < end;
}

export function createNexusBrief(
  projection: BootstrapProjection,
  trust: TrustOverview,
  suggestions: readonly NexusSuggestion[],
  preferences: NexusPreferences,
  now = new Date()
): NexusBrief | null {
  if (preferences.briefCadence === "off") return null;
  const entityAttention = projection.domains.flatMap((domain) => domain.entities ?? []).filter((entity) => entity.attention !== undefined).length;
  const exceptions = trust.pending + trust.failed + trust.prohibited;
  const itemCount = exceptions + suggestions.length + entityAttention;
  const period = preferences.briefCadence === "weekly"
    ? `${String(now.getFullYear())}-W${String(Math.ceil((((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86_400_000) + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7)).padStart(2, "0")}`
    : now.toISOString().slice(0, 10);
  const parts = [
    exceptions > 0 ? `${String(exceptions)} 项需要复核` : "没有待复核例外",
    suggestions.length > 0 ? `${String(suggestions.length)} 条建议` : "暂无新建议",
    entityAttention > 0 ? `${String(entityAttention)} 项数据提醒` : "常用数据无需关注"
  ];
  if (preferences.sensitivePreviews) {
    const preview = projection.domains.flatMap((domain) => domain.entities ?? [])
      .filter((entity) => entity.sensitivity === "sensitive" && entity.availability !== "unavailable")
      .slice(0, 2).map((entity) => `${entity.label} ${entity.value}${entity.unit ?? ""}`);
    if (preview.length > 0) parts.push(preview.join("，"));
  }
  const cadenceReady = preferences.briefCadence === "daily" || now.getDay() === 1;
  return {
    id: `brief-${preferences.briefCadence}-${period}`,
    title: preferences.briefCadence === "weekly" ? "Shadow 本周简报" : "Shadow 今日简报",
    body: parts.join(" · "),
    severity: trust.failed + trust.prohibited > 0 ? "urgent" : itemCount > 0 ? "attention" : "info",
    generatedAt: now.toISOString(),
    notify: preferences.notificationsEnabled && cadenceReady && itemCount > 0 && !inQuietHours(preferences, now),
    itemCount
  };
}

function activityStatus(draft: CaptureDraft): ActivityEntry["status"] {
  if (draft.state === "approved") return "completed";
  if (draft.state === "rejected") return "rejected";
  if (draft.reviewReason === "execution-failed") return "failed";
  if (draft.reviewReason === "prohibited") return "prohibited";
  return "pending";
}

function activityDetail(draft: CaptureDraft, status: ActivityEntry["status"]): string {
  if (status === "completed") return draft.decisionMode === "automatic" ? "Agent 自动完成，领域回执已保留" : "由你确认后完成";
  if (status === "rejected") return "由你退回，未写入领域事实";
  if (status === "failed") return draft.executionError ?? "自动执行失败，已转入复核";
  if (status === "prohibited") return "策略禁止执行，未写入领域事实";
  return draft.reviewReason === "high-risk" ? "高影响操作等待明确复核" : "策略例外等待复核";
}

export function createActivityLedger(drafts: readonly CaptureDraft[]): readonly ActivityEntry[] {
  return drafts.map((draft): ActivityEntry => {
    const status = activityStatus(draft);
    return {
      id: draft.id,
      domain: draft.domain,
      title: draft.summary,
      occurredAt: draft.updatedAt ?? draft.createdAt,
      actor: draft.decisionMode === "automatic" || draft.state === "pending" ? "agent" : "user",
      status,
      risk: draft.risk,
      reviewRequired: status === "pending" || status === "failed",
      receiptAvailable: draft.state === "approved" && typeof draft.receipt === "string" && draft.receipt !== "",
      detail: activityDetail(draft, status),
      ...(draft.state !== "approved" || draft.receipt === undefined ? {} : { receipt: draft.receipt }),
      ...(draft.capabilityRef === undefined ? {} : { capabilityRef: draft.capabilityRef }),
      ...(draft.correlationId === undefined ? {} : { correlationId: draft.correlationId }),
      ...(draft.idempotencyKey === undefined ? {} : { idempotencyKey: draft.idempotencyKey }),
      ...(draft.traceId === undefined ? {} : { traceId: draft.traceId }),
      ...(draft.failureCode === undefined ? {} : { failureCode: draft.failureCode }),
      ...(draft.planContract === undefined ? {} : { planSource: draft.planContract.source })
    };
  }).toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt));
}

export function createTrustOverview(drafts: readonly CaptureDraft[]): TrustOverview {
  const activity = createActivityLedger(drafts);
  const domains = new Map<string, { automatic: number; manual: number; rejected: number; pending: number; failed: number; prohibited: number }>();
  for (const draft of drafts) {
    const stats = domains.get(draft.domain) ?? { automatic: 0, manual: 0, rejected: 0, pending: 0, failed: 0, prohibited: 0 };
    const status = activityStatus(draft);
    if (status === "completed" && draft.decisionMode === "automatic") stats.automatic += 1;
    if (status === "completed" && draft.decisionMode !== "automatic") stats.manual += 1;
    if (status === "rejected") stats.rejected += 1;
    if (status === "pending") stats.pending += 1;
    if (status === "failed") stats.failed += 1;
    if (status === "prohibited") stats.prohibited += 1;
    domains.set(draft.domain, stats);
  }
  return {
    total: activity.length,
    automatic: drafts.filter((draft) => draft.state === "approved" && draft.decisionMode === "automatic").length,
    manual: drafts.filter((draft) => draft.state === "approved" && draft.decisionMode !== "automatic").length,
    rejected: activity.filter((entry) => entry.status === "rejected").length,
    pending: activity.filter((entry) => entry.status === "pending").length,
    failed: activity.filter((entry) => entry.status === "failed").length,
    prohibited: activity.filter((entry) => entry.status === "prohibited").length,
    domains: [...domains.entries()].map(([domain, stats]) => ({ domain, ...stats })).toSorted((left, right) => left.domain.localeCompare(right.domain))
  };
}

export function reviewDraft(draft: CaptureDraft, decision: "approve" | "reject", now = new Date(), receipt?: string): CaptureDraft {
  if (draft.state !== "pending") throw new Error("这个草稿已经处理过了。");
  return {
    ...draft,
    state: decision === "approve" ? "approved" : "rejected",
    updatedAt: now.toISOString(),
    receipt: decision === "approve" ? receipt ?? `preview:${draft.domain}:${now.toISOString()}` : `rejected:${now.toISOString()}`
  };
}
