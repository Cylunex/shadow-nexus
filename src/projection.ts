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
  { domain: "ledger", intent: "ledger.transaction", words: ["花了", "收入", "支出", "买了", "报销", "转账"], risk: "medium" },
  { domain: "travel", intent: "travel.capture", words: ["旅行", "酒店", "机票", "景点", "路线", "到访"], risk: "low" },
  { domain: "archive", intent: "archive.capture", words: ["收藏", "归档", "保存", "资料", "文章"], risk: "low" },
  { domain: "foliant", intent: "foliant.note", words: ["笔记", "灵感", "书摘", "想法"], risk: "low" }
];

const domains: readonly DomainSummary[] = [
  { id: "health", label: "Health", caption: "身体与日常状态", status: "ready", metric: "7h 18m", detail: "昨夜睡眠 · 较近七日 +24m" },
  { id: "ledger", label: "Ledger", caption: "收支与资产流水", status: "attention", metric: "3 笔", detail: "今天待确认的自动分类" },
  { id: "travel", label: "Travel", caption: "目的地、行程与足迹", status: "ready", metric: "12 天", detail: "下一段计划 · 杭州与绍兴" },
  { id: "archive", label: "Archive", caption: "资料、附件与长期存档", status: "ready", metric: "28 项", detail: "本周新增内容" },
  { id: "foliant", label: "Foliant", caption: "阅读、笔记与想法", status: "offline", metric: "稍后接入", detail: "保留领域入口，不读取未完成项目" }
];

const signals: readonly TodaySignal[] = [
  { id: "morning", domain: "health", eyebrow: "晨间状态", title: "恢复状态平稳", detail: "睡眠较上周略有改善，今天适合保持中等活动量。", time: "08:10", tone: "calm" },
  { id: "ledger-review", domain: "ledger", eyebrow: "待确认", title: "三笔流水需要分类", detail: "Nexus 只生成草稿；确认后才由 Ledger 完成最终写入。", time: "09:32", tone: "focus" },
  { id: "trip", domain: "travel", eyebrow: "行程提醒", title: "周末路线还缺一处落脚点", detail: "可以直接在右侧会话里继续规划，结果再回到 Review。", time: "11:00", tone: "warning" }
];

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
  if (amount !== undefined && domain === "ledger") fields.amount = amount;
  const weight = text.match(/(\d+(?:\.\d)?)\s*(?:kg|公斤|千克)/iu)?.[1];
  if (weight !== undefined && domain === "health") fields.weightKg = weight;
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

export function createBootstrap(sessionId: string, drafts: readonly CaptureDraft[], now = new Date()): NexusBootstrap {
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(now);
  const hour = now.getHours();
  const greeting = hour < 6 ? "夜深了，欢迎回来。" : hour < 12 ? "早上好，欢迎回来。" : hour < 18 ? "下午好，欢迎回来。" : "晚上好，欢迎回来。";
  return {
    protocol: NEXUS_PROTOCOL_VERSION,
    mode: "preview",
    generatedAt: now.toISOString(),
    greeting,
    dateLabel,
    focus: "把散落的信息收回来，再决定它们最终属于哪里。",
    signals,
    domains,
    drafts: drafts.filter((draft) => draft.sessionId === sessionId)
  };
}

export function reviewDraft(draft: CaptureDraft, decision: "approve" | "reject", now = new Date()): CaptureDraft {
  if (draft.state !== "pending") throw new Error("这个草稿已经处理过了。");
  return {
    ...draft,
    state: decision === "approve" ? "approved" : "rejected",
    receipt: decision === "approve"
      ? `preview:${draft.domain}:${now.toISOString()}`
      : `rejected:${now.toISOString()}`
  };
}
