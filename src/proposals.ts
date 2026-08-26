import type { CaptureDraft } from "./contracts.js";

function compact(value: string | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase()
    .replaceAll(/餐饮美食|外卖午餐|订单详情|消费记录|财务记账|早餐|午餐|晚餐|加餐/gu, "")
    .replaceAll(/[^0-9a-z\u4e00-\u9fff]+/gu, "");
}

function decimal(value: string | undefined): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(4) : value?.trim() ?? "";
}

function dateOf(draft: CaptureDraft): string {
  const explicit = draft.fields.effectiveDate ?? draft.fields.occurredAt;
  const value = explicit ?? draft.createdAt;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function fieldEqual(left: CaptureDraft, right: CaptureDraft, key: string): boolean {
  const a = left.fields[key];
  const b = right.fields[key];
  return a !== undefined && b !== undefined && decimal(a) === decimal(b);
}

function ledgerSame(left: CaptureDraft, right: CaptureDraft): boolean {
  if (decimal(left.fields.amount) === "" || decimal(left.fields.amount) !== decimal(right.fields.amount)) return false;
  if ((left.fields.moneyType ?? "expense") !== (right.fields.moneyType ?? "expense")) return false;
  if ((left.fields.currency ?? "CNY") !== (right.fields.currency ?? "CNY")) return false;
  if (dateOf(left) !== dateOf(right)) return false;
  const leftTitle = compact(left.fields.merchant ?? left.fields.title ?? left.summary);
  const rightTitle = compact(right.fields.merchant ?? right.fields.title ?? right.summary);
  const leftFull = compact([left.fields.merchant, left.fields.title, left.summary].filter(Boolean).join(" "));
  const rightFull = compact([right.fields.merchant, right.fields.title, right.summary].filter(Boolean).join(" "));
  if (leftTitle.length < 2 || rightTitle.length < 2) return false;
  return leftTitle === rightTitle || leftFull.includes(rightTitle) || rightFull.includes(leftTitle);
}

function healthSame(left: CaptureDraft, right: CaptureDraft): boolean {
  const kind = left.fields.recordType ?? left.intent;
  if (kind !== (right.fields.recordType ?? right.intent) || dateOf(left) !== dateOf(right)) return false;
  if (kind === "metric" || kind.includes("metric")) {
    const keys = ["weightKg", "sleepHours", "moodScore"];
    return keys.some((key) => fieldEqual(left, right, key));
  }
  if (kind === "workout" || kind.includes("workout")) {
    if (!fieldEqual(left, right, "durationMin")) return false;
    if (left.fields.distanceKm !== undefined || right.fields.distanceKm !== undefined) return fieldEqual(left, right, "distanceKm");
    const leftName = compact(left.fields.title ?? left.summary);
    const rightName = compact(right.fields.title ?? right.summary);
    return leftName.length >= 2 && rightName.length >= 2
      && (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName));
  }
  if ((left.fields.meal ?? "") !== (right.fields.meal ?? "")) return false;
  const nutrition = ["kcal", "proteinG", "amountG"].filter((key) => fieldEqual(left, right, key));
  if (nutrition.length >= 2) return true;
  const leftName = compact(left.fields.mealName ?? left.fields.title ?? left.summary);
  const rightName = compact(right.fields.mealName ?? right.fields.title ?? right.summary);
  return leftName.length >= 2 && rightName.length >= 2
    && (leftName === rightName || leftName.includes(rightName) || rightName.includes(leftName));
}

export function sameProposal(left: CaptureDraft, right: CaptureDraft): boolean {
  if (left.domain !== right.domain) return false;
  if (left.domain === "ledger") return ledgerSame(left, right);
  if (left.domain === "health") return healthSame(left, right);
  return left.intent === right.intent && compact(left.summary) === compact(right.summary);
}

export function proposalFingerprint(draft: CaptureDraft): string {
  const entries = Object.entries(draft.fields)
    .filter(([key]) => key !== "source" && key !== "original")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${compact(value) || decimal(value)}`)
    .join("&");
  return `${draft.domain}:${dateOf(draft)}:${entries}`;
}

function refs(draft: CaptureDraft): readonly string[] {
  return [
    ...(draft.sourceRefs ?? []),
    `shadow://nexus/proposals/${draft.id}`,
    ...(draft.domainDraftRef === undefined ? [] : [draft.domainDraftRef])
  ];
}

export function mergeProposal(existing: CaptureDraft, incoming: CaptureDraft, now = new Date()): CaptureDraft {
  const domain = incoming.origin === "domain" ? incoming : existing.origin === "domain" ? existing : undefined;
  const authoritative = domain ?? incoming;
  const origin = domain?.origin ?? existing.origin ?? incoming.origin;
  const domainDraftRef = domain?.domainDraftRef ?? existing.domainDraftRef ?? incoming.domainDraftRef;
  const domainRevision = domain?.domainRevision ?? existing.domainRevision ?? incoming.domainRevision;
  const attachmentRefs = [...new Set([...(existing.attachmentRefs ?? []), ...(incoming.attachmentRefs ?? [])])];
  return {
    ...existing,
    summary: authoritative.summary,
    fields: authoritative.fields,
    risk: authoritative.risk,
    ...(origin === undefined ? {} : { origin }),
    ...(domainDraftRef === undefined ? {} : { domainDraftRef }),
    ...(domainRevision === undefined ? {} : { domainRevision }),
    ...(attachmentRefs.length === 0 ? {} : { attachmentRefs }),
    sourceRefs: [...new Set([...refs(existing), ...refs(incoming)])],
    fingerprint: proposalFingerprint(authoritative),
    match: "linked",
    updatedAt: now.toISOString()
  };
}

export interface ProposalUpsert {
  readonly draft: CaptureDraft;
  readonly changed: boolean;
  readonly matched: boolean;
}

function reconcilePending(
  drafts: Map<string, CaptureDraft>,
  existing: CaptureDraft,
  incoming: CaptureDraft,
  match: "new" | "linked",
  now: Date
): ProposalUpsert {
  const previousTimestamp = existing.updatedAt ?? existing.createdAt;
  const comparable = {
    ...mergeProposal(existing, incoming, new Date(previousTimestamp)),
    match,
    updatedAt: previousTimestamp
  };
  if (JSON.stringify(existing) === JSON.stringify(comparable)) return { draft: existing, changed: false, matched: true };
  const merged = { ...mergeProposal(existing, incoming, now), match };
  drafts.set(existing.id, merged);
  return { draft: merged, changed: true, matched: true };
}

export function upsertProposal(drafts: Map<string, CaptureDraft>, incoming: CaptureDraft, now = new Date()): ProposalUpsert {
  const direct = drafts.get(incoming.id);
  if (direct !== undefined) {
    if (direct.state !== "pending") return { draft: { ...direct, match: "existing" }, changed: false, matched: true };
    return reconcilePending(drafts, direct, incoming, direct.match === "new" ? "new" : "linked", now);
  }
  const incomingRefs = new Set(refs(incoming));
  const referenced = [...drafts.values()].find((candidate) => refs(candidate).some((reference) => incomingRefs.has(reference)));
  if (referenced !== undefined) {
    if (referenced.state !== "pending") return { draft: { ...referenced, match: "existing" }, changed: false, matched: true };
    return reconcilePending(drafts, referenced, incoming, "linked", now);
  }
  const semantic = [...drafts.values()].find((candidate) =>
    (candidate.state === "pending" || candidate.state === "approved") && sameProposal(candidate, incoming)
  );
  if (semantic !== undefined) {
    if (semantic.state === "approved") return { draft: { ...semantic, match: "existing" }, changed: false, matched: true };
    return reconcilePending(drafts, semantic, incoming, "linked", now);
  }
  const created = {
    ...incoming,
    fingerprint: proposalFingerprint(incoming),
    sourceRefs: refs(incoming),
    match: "new" as const,
    updatedAt: now.toISOString()
  };
  drafts.set(created.id, created);
  return { draft: created, changed: true, matched: false };
}
