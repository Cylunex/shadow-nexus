import type { CaptureDraft } from "./contracts.js";

const riskRank = { low: 0, medium: 1, high: 2 } as const;

function highestRisk(...values: readonly CaptureDraft["risk"][]): CaptureDraft["risk"] {
  return values.reduce<CaptureDraft["risk"]>((highest, value) => riskRank[value] > riskRank[highest] ? value : highest, "low");
}

function compact(value: string | undefined): string {
  return (value ?? "")
    .toLocaleLowerCase()
    .replaceAll(/[^0-9a-z\u4e00-\u9fff]+/gu, "");
}

function comparableFields(draft: CaptureDraft): string {
  return Object.entries(draft.fields)
    .filter(([key]) => key !== "source" && key !== "original")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value.trim()}`)
    .join("&");
}

export function sameProposal(left: CaptureDraft, right: CaptureDraft): boolean {
  if (left.domain !== right.domain) return false;
  if (left.intent !== right.intent) return false;
  const leftFields = comparableFields(left);
  const rightFields = comparableFields(right);
  if (leftFields !== "" || rightFields !== "") return leftFields === rightFields;
  return compact(left.summary) === compact(right.summary);
}

export function proposalFingerprint(draft: CaptureDraft): string {
  const entries = Object.entries(draft.fields)
    .filter(([key]) => key !== "source" && key !== "original")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value.trim()}`)
    .join("&");
  return `${draft.domain}:${draft.intent}:${entries || compact(draft.summary)}`;
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
  const domainReviewId = domain?.domainReviewId ?? existing.domainReviewId ?? incoming.domainReviewId;
  const confirmable = domain?.confirmable ?? existing.confirmable ?? incoming.confirmable;
  const attachmentRefs = [...new Set([...(existing.attachmentRefs ?? []), ...(incoming.attachmentRefs ?? [])])];
  return {
    ...existing,
    summary: authoritative.summary,
    fields: authoritative.fields,
    risk: highestRisk(existing.risk, incoming.risk, authoritative.risk),
    ...(origin === undefined ? {} : { origin }),
    ...(domainDraftRef === undefined ? {} : { domainDraftRef }),
    ...(domainRevision === undefined ? {} : { domainRevision }),
    ...(domainReviewId === undefined ? {} : { domainReviewId }),
    ...(confirmable === undefined ? {} : { confirmable }),
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
