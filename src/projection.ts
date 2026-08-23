import { randomUUID } from "node:crypto";
import {
  NEXUS_PROTOCOL_VERSION,
  type CaptureDraft,
  type DomainId,
  type DomainSummary,
  type NexusBootstrap,
  type RiskLevel,
  type TodaySignal
} from "./contracts.js";

const domainRules: readonly { domain: DomainId; intent: string; words: readonly string[]; risk: RiskLevel }[] = [
  { domain: "health", intent: "health.record", words: ["体重", "血压", "睡眠", "运动", "跑步", "吃了", "症状"], risk: "medium" },
  { domain: "ledger", intent: "ledger.transaction", words: ["花了", "收入", "支出", "买了", "报销", "退款", "工资", "奖金", "转账"], risk: "medium" },
  { domain: "travel", intent: "travel.capture", words: ["旅行", "酒店", "机票", "景点", "路线", "到访"], risk: "low" },
  { domain: "archive", intent: "archive.capture", words: ["收藏", "归档", "保存", "资料", "文章"], risk: "low" },
  { domain: "foliant", intent: "foliant.note", words: ["笔记", "灵感", "书摘", "想法"], risk: "low" }
];

const domains: readonly DomainSummary[] = [
  { id: "health", label: "Health", caption: "身体与日常状态", status: "offline", metric: "等待连接", detail: "未读取领域服务" },
  { id: "ledger", label: "Ledger", caption: "收支与消费记忆", status: "offline", metric: "等待连接", detail: "未读取领域服务" },
  { id: "travel", label: "Travel", caption: "目的地、行程与足迹", status: "offline", metric: "稍后接入", detail: "保留领域入口" },
  { id: "archive", label: "Archive", caption: "资料、附件与长期存档", status: "offline", metric: "稍后接入", detail: "保留领域入口" },
  { id: "foliant", label: "Foliant", caption: "阅读、笔记与想法", status: "offline", metric: "稍后接入", detail: "保留领域入口，不读取未完成项目" }
];

export interface BootstrapProjection {
  readonly mode: "preview" | "connected";
  readonly domains: readonly DomainSummary[];
  readonly signals: readonly TodaySignal[];
}

export const disconnectedProjection: BootstrapProjection = { mode: "preview", domains, signals: [] };

function guessDomain(text: string): { domain: DomainId; intent: string; risk: RiskLevel } {
  const normalized = text.toLocaleLowerCase();
  return domainRules.find((rule) => rule.words.some((word) => normalized.includes(word))) ?? {
    domain: "archive",
    intent: "archive.capture",
    risk: "low"
  };
}

function extractFields(text: string, domain: DomainId): Readonly<Record<string, string>> {
  const fields: Record<string, string> = { source: "shadow-nexus", original: text };
  const amount = text.match(/(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)/u)?.[1];
  if (amount !== undefined && domain === "ledger") {
    fields.amount = amount;
    fields.currency = "CNY";
    fields.moneyType = /收入|工资|奖金|收款/u.test(text) ? "income" : /退款|退回|报销到账/u.test(text) ? "refund" : "expense";
  }
  const weight = text.match(/(\d+(?:\.\d)?)\s*(?:kg|公斤|千克)/iu)?.[1];
  if (domain === "health") {
    if (weight !== undefined) fields.weightKg = weight;
    const sleep = text.match(/(?:睡眠|睡了?)\s*(\d+(?:\.\d+)?)\s*(?:小时|h)/iu)?.[1];
    if (sleep !== undefined) fields.sleepHours = sleep;
    const mood = text.match(/(?:心情|情绪)\s*(\d+(?:\.\d+)?)/u)?.[1];
    if (mood !== undefined) fields.moodScore = mood;
    const distance = text.match(/(\d+(?:\.\d+)?)\s*(?:公里|km)/iu)?.[1];
    if (distance !== undefined) fields.distanceKm = distance;
    const minutes = text.match(/(\d+)\s*(?:分钟|min)/iu)?.[1];
    if (minutes !== undefined) fields.durationMin = minutes;
    const meal = text.match(/早餐|早饭|午餐|午饭|晚餐|晚饭|加餐/u)?.[0];
    if (meal !== undefined) fields.meal = /早/u.test(meal) ? "早餐" : /午/u.test(meal) ? "午餐" : /晚/u.test(meal) ? "晚餐" : "加餐";
    fields.recordType = fields.weightKg !== undefined || fields.sleepHours !== undefined || fields.moodScore !== undefined
      ? "metric"
      : fields.meal !== undefined
        ? "meal"
        : "workout";
  }
  return fields;
}

export function createDraft(sessionId: string, text: string, now = new Date()): CaptureDraft {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error("记录内容不能为空。");
  if (trimmed.length > 4_000) throw new Error("单条记录不能超过 4000 个字符。");
  const route = guessDomain(trimmed);
  const stamp = now.toISOString();
  return {
    id: `draft_${stamp.replaceAll(/[-:.TZ]/gu, "")}_${randomUUID().slice(0, 8)}`,
    sessionId,
    text: trimmed,
    domain: route.domain,
    intent: route.intent,
    summary: trimmed.length > 58 ? `${trimmed.slice(0, 58)}…` : trimmed,
    createdAt: stamp,
    state: "pending",
    risk: route.risk,
    fields: extractFields(trimmed, route.domain)
  };
}

export function createBootstrap(
  sessionId: string,
  drafts: readonly CaptureDraft[],
  now = new Date(),
  projection: BootstrapProjection = disconnectedProjection
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
    drafts: drafts.filter((draft) => draft.sessionId === sessionId)
  };
}

export function reviewDraft(
  draft: CaptureDraft,
  decision: "approve" | "reject",
  now = new Date(),
  receipt?: string
): CaptureDraft {
  if (draft.state !== "pending") throw new Error("这个草稿已经处理过了。");
  return {
    ...draft,
    state: decision === "approve" ? "approved" : "rejected",
    receipt: decision === "approve"
      ? receipt ?? `preview:${draft.domain}:${now.toISOString()}`
      : `rejected:${now.toISOString()}`
  };
}
