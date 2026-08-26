import {
  NEXUS_PROTOCOL_VERSION,
  type CaptureAnalysis,
  type CaptureDraft,
  type DomainSummary,
  type NexusBootstrap,
  type NexusIntentPlan,
  type RiskLevel,
  type TodaySignal
} from "./contracts.js";

export interface BootstrapProjection {
  readonly mode: "preview" | "connected";
  readonly domains: readonly DomainSummary[];
  readonly signals: readonly TodaySignal[];
}

export const disconnectedProjection: BootstrapProjection = { mode: "preview", domains: [], signals: [] };

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
  const analysisId = analysis.version === 1 ? analysis.captureId : analysis.interactionId;
  const validId = analysis.version === 1
    ? /^capture_[A-Za-z0-9-]{8,80}$/u.test(analysisId)
    : /^interaction_[A-Za-z0-9-]{8,80}$/u.test(analysisId);
  if (!validId) throw new Error("DSH 返回的采集分析标识无效。");
  if (!Array.isArray(analysis.drafts) || analysis.drafts.length > 200 || (analysis.version === 1 && analysis.drafts.length < 1)) {
    throw new Error("DSH 没有返回可确认的领域草稿。");
  }
  if (analysis.version === 2) {
    if (!new Set(["answer", "propose", "mixed", "clarify"]).has(analysis.route)) throw new Error("DSH 返回的处理路由无效。");
    if (typeof analysis.response !== "string" || analysis.response.length > 4_000) throw new Error("DSH 返回的回复摘要无效。");
    if ((analysis.route === "answer" || analysis.route === "clarify") && analysis.drafts.length > 0) throw new Error("DSH 返回的处理路由与 Proposal 不一致。");
    if (analysis.route === "propose" && analysis.drafts.length === 0) throw new Error("DSH 没有返回需要确认的 Proposal。");
  }
  const createdAt = now.toISOString();
  const groupId = `draft_${analysisId}`;
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
      attachmentRefs
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
  assetUploadEnabled = false
): NexusBootstrap {
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now);
  const hour = now.getHours();
  const greeting = hour < 6 ? "夜深了，欢迎回来。" : hour < 12 ? "早上好，欢迎回来。" : hour < 18 ? "下午好，欢迎回来。" : "晚上好，欢迎回来。";
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
    assetUpload: { enabled: assetUploadEnabled, maxFilesPerMessage: 8 }
  };
}

export function reviewDraft(draft: CaptureDraft, decision: "approve" | "reject", now = new Date(), receipt?: string): CaptureDraft {
  if (draft.state !== "pending") throw new Error("这个草稿已经处理过了。");
  return {
    ...draft,
    state: decision === "approve" ? "approved" : "rejected",
    receipt: decision === "approve" ? receipt ?? `preview:${draft.domain}:${now.toISOString()}` : `rejected:${now.toISOString()}`
  };
}
