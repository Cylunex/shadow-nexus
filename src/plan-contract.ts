import type {
  CaptureAnalysis,
  CaptureAnalysisDraft,
  NexusIntentPlan,
  PlanContractMetadata,
  PlanContractSource
} from "./contracts.js";

export interface PlanOutputBlock {
  readonly kind: string;
  readonly text?: string;
  readonly name?: string;
  readonly argsRaw?: string;
}

export interface PlanOutputProvenance {
  readonly provider?: string;
  readonly model?: string;
}

export class PlanContractError extends Error {}

const PLAN_TOOL_NAMES = new Set(["shadow_nexus_plan", "shadow.nexus.plan.submit"]);
const CAPTURE_TOOL_NAMES = new Set(["shadow_nexus_capture", "shadow.nexus.capture.submit"]);
const ROUTES = new Set(["answer", "propose", "mixed", "clarify"]);
const RISKS = new Set(["low", "medium", "high"]);

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PlanContractError(`${label}必须是对象。`);
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    throw new PlanContractError(`${label}字段不符合协议。`);
  }
}

function exactKeysWithOptional(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  label: string
): void {
  const actual = new Set(Object.keys(value));
  if (required.some((key) => !actual.has(key)) || [...actual].some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new PlanContractError(`${label}字段不符合协议。`);
  }
}

function boundedString(value: unknown, label: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && value.trim() === "")) {
    throw new PlanContractError(`${label}无效。`);
  }
  return value;
}

function parseDraft(value: unknown): CaptureAnalysisDraft {
  const item = record(value, "Proposal");
  exactKeysWithOptional(item, ["domain", "intent", "summary", "risk", "fields"], ["attachmentRefs"], "Proposal");
  const domain = boundedString(item.domain, "Proposal domain", 64);
  if (!/^[a-z][a-z0-9-]{1,63}$/u.test(domain)) throw new PlanContractError("Proposal domain 无效。");
  const intent = boundedString(item.intent, "Proposal intent", 120);
  if (!intent.startsWith(`${domain}.`) || !/^[a-z][A-Za-z0-9._-]+$/u.test(intent)) throw new PlanContractError("Proposal intent 无效。");
  if (!RISKS.has(item.risk as string)) throw new PlanContractError("Proposal risk 无效。");
  const rawFields = record(item.fields, "Proposal fields");
  if (Object.keys(rawFields).length > 64) throw new PlanContractError("Proposal fields 过多。");
  const fields: Record<string, string> = {};
  for (const [key, raw] of Object.entries(rawFields)) {
    const maximum = key.endsWith("Json") || key.endsWith("_json") ? 8_000 : 2_048;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key) || typeof raw !== "string" || raw.length > maximum) {
      throw new PlanContractError("Proposal fields 无效。");
    }
    fields[key] = raw;
  }
  let attachmentRefs: readonly string[] | undefined;
  if (item.attachmentRefs !== undefined) {
    if (!Array.isArray(item.attachmentRefs) || item.attachmentRefs.length > 8
      || item.attachmentRefs.some((reference) => typeof reference !== "string"
        || reference.length > 1_024
        || !/^shadow:\/\/[a-z][a-z0-9-]{1,63}\/.+/u.test(reference))) {
      throw new PlanContractError("Proposal attachmentRefs 无效。");
    }
    attachmentRefs = [...new Set(item.attachmentRefs as readonly string[])];
  }
  return {
    domain,
    intent,
    summary: boundedString(item.summary, "Proposal summary", 240).trim(),
    risk: item.risk as CaptureAnalysisDraft["risk"],
    fields,
    ...(attachmentRefs === undefined ? {} : { attachmentRefs })
  };
}

function parseDrafts(value: unknown, allowEmpty: boolean): readonly CaptureAnalysisDraft[] {
  if (!Array.isArray(value) || value.length > 200 || (!allowEmpty && value.length === 0)) {
    throw new PlanContractError("Proposal 数量无效。");
  }
  return value.map(parseDraft);
}

function metadata(source: PlanContractSource, provenance: PlanOutputProvenance = {}): PlanContractMetadata {
  return {
    protocol: "shadow.nexus.plan-contract.v1",
    source,
    ...(provenance.provider === undefined ? {} : { provider: provenance.provider.slice(0, 80) }),
    ...(provenance.model === undefined ? {} : { model: provenance.model.slice(0, 120) })
  };
}

export function validateIntentPlan(
  value: unknown,
  interactionId: string,
  source: PlanContractSource = "json-frame",
  provenance: PlanOutputProvenance = {}
): NexusIntentPlan {
  const plan = record(value, "处理计划");
  exactKeys(plan, ["protocol", "version", "interactionId", "route", "response", "drafts"], "处理计划");
  if (plan.protocol !== "shadow.nexus.plan.v1" || plan.version !== 3 || plan.interactionId !== interactionId) {
    throw new PlanContractError("处理计划版本或标识无效。");
  }
  if (!ROUTES.has(plan.route as string)) throw new PlanContractError("处理计划 route 无效。");
  const drafts = parseDrafts(plan.drafts, true);
  const route = plan.route as NexusIntentPlan["route"];
  if ((route === "answer" || route === "clarify") && drafts.length > 0) throw new PlanContractError("处理计划 route 与 Proposal 不一致。");
  if (route === "propose" && drafts.length === 0) throw new PlanContractError("处理计划缺少 Proposal。");
  return {
    protocol: "shadow.nexus.plan.v1",
    version: 3,
    interactionId,
    route,
    response: boundedString(plan.response, "处理计划 response", 4_000, true),
    drafts,
    contract: metadata(source, provenance)
  };
}

export function validateCaptureAnalysis(
  value: unknown,
  captureId: string,
  source: PlanContractSource = "json-frame",
  provenance: PlanOutputProvenance = {}
): CaptureAnalysis {
  const analysis = record(value, "采集分析");
  exactKeys(analysis, ["protocol", "version", "captureId", "drafts"], "采集分析");
  if (analysis.protocol !== "shadow.nexus.capture.v1" || analysis.version !== 2 || analysis.captureId !== captureId) {
    throw new PlanContractError("采集分析版本或标识无效。");
  }
  return {
    protocol: "shadow.nexus.capture.v1",
    version: 2,
    captureId,
    drafts: parseDrafts(analysis.drafts, false),
    contract: metadata(source, provenance)
  };
}

function parseJson(raw: string, label: string): unknown {
  try { return JSON.parse(raw); }
  catch { throw new PlanContractError(`${label}不是有效 JSON。`); }
}

function textFrame(text: string, legacyTag: "plan" | "capture"): { readonly value: unknown; readonly source: PlanContractSource } | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return { value: parseJson(trimmed, "结构化结果"), source: "json-frame" };
  const fence = trimmed.match(/^```(?:json|shadow-nexus-(?:plan|capture))\s*\r?\n([\s\S]*?)\r?\n```$/u);
  if (fence?.[1] !== undefined) return { value: parseJson(fence[1], "结构化结果"), source: "json-frame" };
  const legacy = legacyTag === "plan"
    ? trimmed.match(/<shadow-nexus-plan>\s*([\s\S]*?)\s*<\/shadow-nexus-plan>\s*$/u)
    : trimmed.match(/<shadow-nexus-capture>\s*([\s\S]*?)\s*<\/shadow-nexus-capture>\s*$/u);
  if (legacy?.[1] !== undefined) return { value: parseJson(legacy[1], "旧版结构化结果"), source: "legacy-envelope" };
  return undefined;
}

function structuredCandidate(
  blocks: readonly PlanOutputBlock[],
  toolNames: ReadonlySet<string>,
  legacyTag: "plan" | "capture"
): { readonly value: unknown; readonly source: PlanContractSource } | undefined {
  const calls = blocks.filter((block) => block.kind === "tool-call" && block.name !== undefined && toolNames.has(block.name));
  if (calls.length > 1) throw new PlanContractError("结构化结果重复提交。");
  const call = calls[0];
  if (call !== undefined) return { value: parseJson(call.argsRaw ?? "", "结构化 tool call"), source: "tool-call" };
  const text = blocks.flatMap((block) => block.kind === "text" && block.text !== undefined ? [block.text] : []).join("\n");
  return textFrame(text, legacyTag);
}

export function intentPlanFromBlocks(
  blocks: readonly PlanOutputBlock[],
  interactionId: string,
  provenance: PlanOutputProvenance = {}
): NexusIntentPlan | undefined {
  const candidate = structuredCandidate(blocks, PLAN_TOOL_NAMES, "plan");
  if (candidate === undefined) return undefined;
  let value = candidate.value;
  if (candidate.source === "legacy-envelope") {
    const legacy = record(value, "旧版处理计划");
    if (legacy.version === 2 && legacy.protocol === undefined) {
      exactKeys(legacy, ["version", "interactionId", "route", "response", "drafts"], "旧版处理计划");
      value = { ...legacy, protocol: "shadow.nexus.plan.v1", version: 3 };
    }
  }
  return validateIntentPlan(value, interactionId, candidate.source, provenance);
}

export function captureAnalysisFromBlocks(
  blocks: readonly PlanOutputBlock[],
  captureId: string,
  provenance: PlanOutputProvenance = {}
): CaptureAnalysis | undefined {
  const candidate = structuredCandidate(blocks, CAPTURE_TOOL_NAMES, "capture");
  if (candidate === undefined) return undefined;
  let value = candidate.value;
  if (candidate.source === "legacy-envelope") {
    const legacy = record(value, "旧版采集分析");
    if (legacy.version === 1 && legacy.protocol === undefined) {
      exactKeys(legacy, ["version", "captureId", "drafts"], "旧版采集分析");
      value = { ...legacy, protocol: "shadow.nexus.capture.v1", version: 2 };
    }
  }
  return validateCaptureAnalysis(value, captureId, candidate.source, provenance);
}

export function safeIntentFallback(
  blocks: readonly PlanOutputBlock[],
  interactionId: string,
  explicitRecord: boolean,
  provenance: PlanOutputProvenance = {}
): NexusIntentPlan {
  const visible = blocks.flatMap((block) => block.kind === "text" && block.text !== undefined ? [block.text] : []).join("\n").trim();
  const looksLikeBrokenContract = visible.startsWith("{") || visible.includes("<shadow-nexus-plan>") || visible.startsWith("```");
  const response = explicitRecord
    ? "模型没有返回可验证的结构化计划。为避免误写，Nexus 未执行任何操作；请重试或使用已声明的快捷动作。"
    : looksLikeBrokenContract || visible === "" ? "模型已完成响应，但没有返回可验证的结构化计划；Nexus 未执行任何写入。" : visible.slice(0, 4_000);
  return {
    protocol: "shadow.nexus.plan.v1",
    version: 3,
    interactionId,
    route: explicitRecord ? "clarify" : "answer",
    response,
    drafts: [],
    contract: metadata("safe-fallback", provenance)
  };
}

function submittedMetadata(value: unknown): PlanContractMetadata {
  const contract = record(value, "计划契约元数据");
  const keys = Object.keys(contract);
  if (keys.some((key) => !["protocol", "source", "provider", "model"].includes(key))
    || contract.protocol !== "shadow.nexus.plan-contract.v1"
    || !new Set<PlanContractSource>(["tool-call", "json-frame", "legacy-envelope", "safe-fallback"]).has(contract.source as PlanContractSource)
    || (contract.provider !== undefined && typeof contract.provider !== "string")
    || (contract.model !== undefined && typeof contract.model !== "string")) {
    throw new PlanContractError("计划契约元数据无效。");
  }
  return contract as unknown as PlanContractMetadata;
}

export function validateSubmittedAnalysis(value: unknown): CaptureAnalysis | NexusIntentPlan {
  const submitted = record(value, "提交的结构化结果");
  const contract = submittedMetadata(submitted.contract);
  if (submitted.protocol === "shadow.nexus.plan.v1") {
    exactKeys(submitted, ["protocol", "version", "interactionId", "route", "response", "drafts", "contract"], "提交的处理计划");
    const interactionId = boundedString(submitted.interactionId, "interactionId", 96);
    const { contract: _contract, ...raw } = submitted;
    return validateIntentPlan(raw, interactionId, contract.source, contract);
  }
  if (submitted.protocol === "shadow.nexus.capture.v1") {
    exactKeys(submitted, ["protocol", "version", "captureId", "drafts", "contract"], "提交的采集分析");
    const captureId = boundedString(submitted.captureId, "captureId", 96);
    const { contract: _contract, ...raw } = submitted;
    return validateCaptureAnalysis(raw, captureId, contract.source, contract);
  }
  throw new PlanContractError("提交的结构化结果协议无效。");
}
