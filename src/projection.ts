import { randomUUID } from "node:crypto";
import {
  NEXUS_PROTOCOL_VERSION,
  type CaptureDraft,
  type CaptureAnalysis,
  type DomainId,
  type DomainSummary,
  type NexusBootstrap,
  type RiskLevel,
  type TodaySignal
} from "./contracts.js";

interface DraftRoute { readonly domain: DomainId; readonly intent: string; readonly risk: RiskLevel }

const healthRoute: DraftRoute = { domain: "health", intent: "health.record", risk: "medium" };
const ledgerRoute: DraftRoute = { domain: "ledger", intent: "ledger.transaction", risk: "medium" };
const domainRules: readonly (DraftRoute & { readonly words: readonly string[] })[] = [
  { domain: "travel", intent: "travel.capture", words: ["旅行", "酒店", "机票", "景点", "路线", "到访"], risk: "low" },
  { domain: "archive", intent: "archive.capture", words: ["收藏", "归档", "保存", "资料", "文章"], risk: "low" },
  { domain: "foliant", intent: "foliant.note", words: ["笔记", "灵感", "书摘", "想法"], risk: "low" }
];

const healthWords = ["体重", "血压", "睡眠", "运动", "跑步", "吃了", "症状", "饮食", "营养", "热量", "kcal", "蛋白质", "碳水", "脂肪", "膳食纤维", "餐次"];
const ledgerWords = ["花了", "收入", "支出", "买了", "报销", "退款", "工资", "奖金", "转账", "费用", "实付", "实际支付", "单价", "原价", "优惠金额", "订单", "消费记录", "财务记账"];

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

function guessDomains(text: string): readonly DraftRoute[] {
  const normalized = text.toLocaleLowerCase();
  const supported: DraftRoute[] = [];
  if (healthWords.some((word) => normalized.includes(word))) supported.push(healthRoute);
  if (ledgerWords.some((word) => normalized.includes(word))) supported.push(ledgerRoute);
  if (supported.length > 0) return supported;
  const fallback = domainRules.find((rule) => rule.words.some((word) => normalized.includes(word)));
  return [fallback ?? {
    domain: "archive",
    intent: "archive.capture",
    risk: "low"
  }];
}

function extractFields(text: string, domain: DomainId): Readonly<Record<string, string>> {
  const fields: Record<string, string> = { source: "shadow-nexus", original: text };
  const amount = text.match(/(?:实际支付|实付合计|合计支付)\s*[:：]?\s*(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)/u)?.[1]
    ?? text.match(/\|\s*\*{0,2}合计\*{0,2}\s*\|[^\n]*?(?:¥|￥)\s*(\d+(?:\.\d{1,2})?)/u)?.[1]
    ?? text.match(/(?:¥|￥)?\s*(\d+(?:\.\d{1,2})?)\s*(?:元|块)/u)?.[1];
  if (amount !== undefined && domain === "ledger") {
    fields.amount = amount;
    fields.currency = "CNY";
    fields.moneyType = /收入|工资|奖金|收款/u.test(text) ? "income" : /退款|退回|报销到账/u.test(text) ? "refund" : "expense";
    const merchant = text.match(/商家名称\s*[:：]\s*([^\n]+)/u)?.[1]?.trim();
    const purpose = text.match(/消费类型\s*[:：]\s*([^\n]+)/u)?.[1]?.trim();
    if (merchant !== undefined && merchant !== "") fields.merchant = merchant.slice(0, 120);
    const categoryKey = /餐|外卖|咖啡|奶茶|食品|麻辣烫/u.test(text) ? "food"
      : /公交|地铁|打车|出租车|高铁|机票|交通/u.test(text) ? "transport"
        : /房租|水费|电费|燃气|物业|居住/u.test(text) ? "housing"
          : /医院|看病|药品|体检|健康/u.test(text) ? "health"
            : /订阅|会员|续费/u.test(text) ? "subscription"
              : /旅行|酒店|景点/u.test(text) ? "travel"
                : /电影|演出|游戏|娱乐/u.test(text) ? "entertainment"
                  : /购物|商品|买了/u.test(text) ? "shopping"
                    : undefined;
    if (categoryKey !== undefined) fields.categoryKey = categoryKey;
    fields.title = [purpose, merchant].filter((value): value is string => value !== undefined && value !== "").join(" · ").slice(0, 160)
      || text.replaceAll(/\s+/gu, " ").slice(0, 160);
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
    const rpe = text.match(/(?:RPE|运动强度|主观强度)\s*[:：]?\s*(\d+)/iu)?.[1];
    if (rpe !== undefined) fields.rpe = rpe;
    const meal = text.match(/早餐|早饭|午餐|午饭|晚餐|晚饭|加餐/u)?.[0];
    if (meal !== undefined) fields.meal = /早/u.test(meal) ? "早餐" : /午/u.test(meal) ? "午餐" : /晚/u.test(meal) ? "晚餐" : "加餐";
    const mealName = text.match(/餐次\s*[:：]\s*(?:早餐|午餐|晚餐|加餐)(?:\s*\/\s*)?([^\n]*)/u)?.[1]?.trim()
      ?? text.match(/(?:早餐|早饭|午餐|午饭|晚餐|晚饭|加餐)(?:吃了|是|[:：])?\s*([^\n，,。]{1,60})/u)?.[1]?.trim();
    if (mealName !== undefined && mealName !== "") fields.mealName = mealName.slice(0, 120);
    const kcal = text.match(/总热量\s*[:：]\s*\*{0,2}\s*(?:约|~)?\s*(\d+(?:\.\d+)?)/iu)?.[1]
      ?? text.match(/(?:热量)\s*[:：]?\s*\*{0,2}\s*(?:约|~)?\s*(\d+(?:\.\d+)?)\s*kcal/iu)?.[1];
    if (kcal !== undefined) fields.kcal = kcal;
    const protein = text.match(/蛋白质\s*[:：]\s*\*{0,2}\s*(?:约|~)?\s*(\d+(?:\.\d+)?)\s*g/iu)?.[1];
    if (protein !== undefined) fields.proteinG = protein;
    const amountG = text.match(/总(?:重量|份量)\s*[:：]\s*\*{0,2}\s*(?:约|~)?\s*(\d+(?:\.\d+)?)\s*g/iu)?.[1]
      ?? text.match(/(?:合计|总计)\s*[:：]?\s*\*{0,2}\s*(?:约|~)?\s*(\d+(?:\.\d+)?)\s*g/iu)?.[1];
    if (amountG !== undefined) fields.amountG = amountG;
    fields.recordType = fields.weightKg !== undefined || fields.sleepHours !== undefined || fields.moodScore !== undefined
      ? "metric"
      : fields.meal !== undefined || fields.kcal !== undefined || fields.proteinG !== undefined
        ? "meal"
        : "workout";
  }
  return fields;
}

function draftSummary(text: string, domain: DomainId, fields: Readonly<Record<string, string>>): string {
  if (domain === "health" && fields.recordType === "meal") {
    return [fields.meal, fields.mealName, fields.kcal === undefined ? undefined : `约 ${fields.kcal} kcal`, fields.proteinG === undefined ? undefined : `蛋白质 ${fields.proteinG} g`]
      .filter((value): value is string => value !== undefined && value !== "").join(" · ") || "饮食与营养记录";
  }
  if (domain === "ledger" && fields.amount !== undefined) {
    return [fields.title, `¥${fields.amount}`].filter((value): value is string => value !== undefined && value !== "").join(" · ");
  }
  const compact = text.replaceAll(/\s+/gu, " ");
  return compact.length > 88 ? `${compact.slice(0, 88)}…` : compact;
}

function validateCapture(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new Error("记录内容不能为空。");
  if (trimmed.length > 4_000) throw new Error("单条记录不能超过 4000 个字符。");
  return trimmed;
}

function buildDraft(sessionId: string, text: string, route: DraftRoute, id: string, groupId: string, createdAt: string): CaptureDraft {
  const fields = extractFields(text, route.domain);
  return {
    id,
    captureGroupId: groupId,
    classificationVersion: 2,
    sessionId,
    text,
    domain: route.domain,
    intent: route.intent,
    summary: draftSummary(text, route.domain, fields),
    createdAt,
    state: "pending",
    risk: route.risk,
    fields
  };
}

export function createDrafts(sessionId: string, text: string, now = new Date()): readonly CaptureDraft[] {
  const trimmed = validateCapture(text);
  const routes = guessDomains(trimmed);
  const stamp = now.toISOString();
  const groupId = `draft_${stamp.replaceAll(/[-:.TZ]/gu, "")}_${randomUUID().slice(0, 8)}`;
  return routes.map((route) => buildDraft(sessionId, trimmed, route, routes.length === 1 ? groupId : `${groupId}_${route.domain}`, groupId, stamp));
}

const supportedAnalysisDomains = new Set<DomainId>(["health", "ledger", "travel", "archive", "foliant"]);
const supportedRisks = new Set<RiskLevel>(["low", "medium", "high"]);

/** Build review drafts from the completed DSH analysis, never from local keyword routing. */
export function createAnalyzedDrafts(
  sessionId: string,
  text: string,
  analysis: CaptureAnalysis,
  now = new Date(),
  attachmentRefs: readonly string[] = []
): readonly CaptureDraft[] {
  const trimmed = text.trim() === "" && attachmentRefs.length > 0 ? "来自附件的批量记录" : validateCapture(text);
  if (analysis.version !== 1 || !/^capture_[A-Za-z0-9-]{8,80}$/u.test(analysis.captureId)) {
    throw new Error("DSH 返回的采集分析标识无效。");
  }
  if (!Array.isArray(analysis.drafts) || analysis.drafts.length < 1 || analysis.drafts.length > 200) {
    throw new Error("DSH 没有返回可确认的领域草稿。");
  }
  const createdAt = now.toISOString();
  const groupId = `draft_${analysis.captureId}`;
  return analysis.drafts.map((item, index) => {
    if (!supportedAnalysisDomains.has(item.domain)) throw new Error("DSH 返回了不支持的领域。");
    if (!supportedRisks.has(item.risk) || typeof item.intent !== "string" || !/^[a-z][a-z0-9.-]{2,80}$/u.test(item.intent)) {
      throw new Error("DSH 返回的草稿类型无效。");
    }
    if (typeof item.summary !== "string" || item.summary.trim() === "" || item.summary.length > 240) {
      throw new Error("DSH 返回的草稿摘要无效。");
    }
    if (typeof item.fields !== "object" || item.fields === null || Array.isArray(item.fields)) {
      throw new Error("DSH 返回的结构化字段无效。");
    }
    const fields: Record<string, string> = { source: "shadow-nexus", original: trimmed };
    for (const [key, value] of Object.entries(item.fields)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key) || typeof value !== "string" || value.length > 500) {
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

export function createDraft(sessionId: string, text: string, now = new Date()): CaptureDraft {
  const draft = createDrafts(sessionId, text, now)[0];
  if (draft === undefined) throw new Error("没有生成可确认的草稿。");
  return draft;
}

export function reclassifyStoredDraft(draft: CaptureDraft): readonly CaptureDraft[] {
  if (draft.state !== "pending" || draft.classificationVersion === 2) return [draft];
  const text = validateCapture(draft.text);
  const routes = guessDomains(text);
  const groupId = draft.captureGroupId ?? draft.id;
  return routes.map((route) => {
    const fields = extractFields(text, route.domain);
    return {
      ...draft,
      id: routes.length === 1 ? draft.id : `${groupId}_${route.domain}`,
      captureGroupId: groupId,
      classificationVersion: 2,
      domain: route.domain,
      intent: route.intent,
      risk: route.risk,
      summary: draftSummary(text, route.domain, fields),
      fields
    };
  });
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
