export const NEXUS_PROTOCOL_VERSION = "shadow.nexus.v1" as const;

export type DomainId = string;
export type NexusView = "today" | "capture" | "review" | DomainId;
export type DraftState = "pending" | "approved" | "rejected";
export type RiskLevel = "low" | "medium" | "high";
export type ProposalMatch = "new" | "linked" | "existing";
export type DraftDecisionMode = "automatic" | "manual";
export type DraftReviewReason = "high-risk" | "policy" | "execution-failed" | "prohibited";
export type PlanContractSource = "tool-call" | "json-frame" | "legacy-envelope" | "safe-fallback";
export type CapabilityMaturity = "not-selected" | "none" | "contract" | "client" | "deployed" | "observed" | "restore-tested" | "failed";

export interface PlanContractMetadata {
  readonly protocol: "shadow.nexus.plan-contract.v1";
  readonly source: PlanContractSource;
  readonly provider?: string;
  readonly model?: string;
}

export interface NexusCapabilityAttention {
  readonly capabilityRef: string;
  readonly maturity: CapabilityMaturity;
  readonly detail: string;
  readonly evidenceId?: string;
}

export interface NexusCapabilityStatus {
  readonly protocol: "shadow.capability-status.v1" | "unavailable";
  readonly buildId?: string;
  readonly generatedAt?: string;
  readonly selected: number;
  readonly client: number;
  readonly deployed: number;
  readonly observed: number;
  readonly restoreTested: number;
  readonly failed: number;
  readonly attention: readonly NexusCapabilityAttention[];
}

export interface DomainMetric {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly detail?: string;
  readonly tone?: "neutral" | "good" | "attention" | "warning";
}

export type EntityClass = "measurement" | "counter" | "money" | "status" | "progress" | "content" | "schedule" | "device" | "location" | "custom";
export type EntitySensitivity = "public" | "personal" | "sensitive" | "restricted";
export type EntityAvailability = "fresh" | "stale" | "unavailable";

export interface DomainEntity {
  readonly id: string;
  readonly domain: DomainId;
  readonly label: string;
  readonly class: EntityClass;
  readonly sensitivity: EntitySensitivity;
  readonly availability: EntityAvailability;
  readonly value: string;
  readonly unit?: string;
  readonly detail?: string;
  readonly observedAt?: string;
  readonly freshnessSeconds?: number;
  readonly icon: string;
  readonly tone: DomainMetric["tone"];
  readonly order: number;
  readonly actionIds: readonly string[];
  readonly attention?: { readonly ruleId: string; readonly severity: "attention" | "warning"; readonly message: string };
}

export type QuickActionFieldType = "hidden" | "decimal" | "integer" | "text" | "date" | "datetime" | "select";

export interface NexusQuickActionField {
  readonly id: string;
  readonly label: string;
  readonly type: QuickActionFieldType;
  readonly required: boolean;
  readonly default?: string;
  readonly placeholder?: string;
  readonly unit?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly step?: number;
  readonly maxLength?: number;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

export interface NexusQuickAction {
  readonly id: string;
  readonly domain: DomainId;
  readonly title: string;
  readonly description: string;
  readonly intent: string;
  readonly icon: string;
  readonly order: number;
  readonly risk: RiskLevel;
  readonly submitLabel: string;
  readonly successMessage: string;
  readonly summaryTemplate?: string;
  readonly fields: readonly NexusQuickActionField[];
}

export interface NexusQuickActionRequest {
  readonly sessionId?: string;
  readonly domain: DomainId;
  readonly actionId: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface DomainSummary {
  readonly id: DomainId;
  readonly label: string;
  readonly caption: string;
  readonly status: "ready" | "attention" | "offline";
  readonly metric: string;
  readonly detail: string;
  readonly metrics?: readonly DomainMetric[];
  readonly entities?: readonly DomainEntity[];
  readonly quickActions?: readonly NexusQuickAction[];
  readonly icon: string;
  readonly color: string;
  readonly order: number;
  readonly captureEnabled: boolean;
  readonly searchEnabled: boolean;
  readonly appUrl?: string;
  readonly reviewRisk?: RiskLevel;
  readonly intentPrefixes: readonly string[];
  readonly capabilityMaturity?: CapabilityMaturity;
}

export interface NexusSearchItem {
  readonly domain: DomainId;
  readonly domainLabel: string;
  readonly title: string;
  readonly detail: string;
  readonly reference?: string;
}

export interface NexusSearchResult {
  readonly query: string;
  readonly items: readonly NexusSearchItem[];
  readonly searchedDomains: readonly DomainId[];
  readonly unavailableDomains: readonly DomainId[];
}

export interface TodaySignal {
  readonly id: string;
  readonly domain: DomainId;
  readonly eyebrow: string;
  readonly title: string;
  readonly detail: string;
  readonly time: string;
  readonly tone: "calm" | "focus" | "warning";
}

export interface NexusContextPack {
  readonly protocol: "shadow.context.v1";
  readonly context_id: string;
  readonly session_id: string;
  readonly source_domain: DomainId | null;
  readonly resource_refs: readonly string[];
  readonly time_range: { readonly start: string; readonly end: string } | null;
  readonly goal: string | null;
  readonly asset_refs: readonly string[];
  readonly capability_grants: readonly string[];
  readonly created_at: string;
  readonly expires_at: string;
}

export interface NexusContextCreate {
  readonly session_id: string;
  readonly source_domain?: DomainId | null;
  readonly resource_refs?: readonly string[];
  readonly time_range?: { readonly start: string; readonly end: string } | null;
  readonly goal?: string | null;
  readonly asset_refs?: readonly string[];
  readonly capability_grants?: readonly string[];
}

export type SuggestionAction = "ignore" | "snooze" | "mute" | "create_draft" | "view_evidence";

export interface NexusSuggestion {
  readonly protocol: "shadow.suggestion.v1";
  readonly suggestion_id: string;
  readonly domain: DomainId;
  readonly rule_id: string;
  readonly dedupe_key: string;
  readonly title: string;
  readonly summary: string;
  readonly reason: string;
  readonly evidence_refs: readonly string[];
  readonly importance: "low" | "normal" | "high" | "urgent";
  readonly confidence: number | null;
  readonly allowed_actions: readonly SuggestionAction[];
  readonly created_at: string;
  readonly valid_until: string;
  readonly data_freshness: { readonly observed_at: string; readonly missing_ratio: number };
}

export interface CaptureDraft {
  readonly id: string;
  readonly captureGroupId?: string;
  readonly classificationVersion?: 2;
  readonly sessionId: string;
  readonly text: string;
  readonly domain: DomainId;
  readonly intent: string;
  readonly summary: string;
  readonly createdAt: string;
  readonly state: DraftState;
  readonly risk: RiskLevel;
  readonly fields: Readonly<Record<string, string>>;
  readonly origin?: "nexus" | "domain";
  readonly domainDraftRef?: string;
  readonly domainRevision?: number;
  readonly domainReviewId?: string;
  readonly confirmable?: boolean;
  readonly fingerprint?: string;
  readonly sourceRefs?: readonly string[];
  readonly match?: ProposalMatch;
  readonly updatedAt?: string;
  readonly attachmentRefs?: readonly string[];
  readonly receipt?: string;
  readonly decisionMode?: DraftDecisionMode;
  readonly reviewReason?: DraftReviewReason;
  readonly executionError?: string;
  readonly failureCode?: string;
  readonly capabilityRef?: string;
  readonly operationId?: string;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
  readonly traceId?: string;
  readonly planContract?: PlanContractMetadata;
}

export type ActivityStatus = "pending" | "completed" | "rejected" | "failed" | "prohibited";

export interface ActivityEntry {
  readonly id: string;
  readonly domain: DomainId;
  readonly title: string;
  readonly occurredAt: string;
  readonly actor: "agent" | "user";
  readonly status: ActivityStatus;
  readonly risk: RiskLevel;
  readonly reviewRequired: boolean;
  readonly receiptAvailable: boolean;
  readonly detail: string;
  readonly receipt?: string;
  readonly capabilityRef?: string;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
  readonly traceId?: string;
  readonly failureCode?: string;
  readonly planSource?: PlanContractSource;
}

export interface TrustDomainStats {
  readonly domain: DomainId;
  readonly automatic: number;
  readonly manual: number;
  readonly rejected: number;
  readonly pending: number;
  readonly failed: number;
  readonly prohibited: number;
}

export interface TrustOverview {
  readonly total: number;
  readonly automatic: number;
  readonly manual: number;
  readonly rejected: number;
  readonly pending: number;
  readonly failed: number;
  readonly prohibited: number;
  readonly domains: readonly TrustDomainStats[];
}

export interface NexusPreferences {
  readonly notificationsEnabled: boolean;
  readonly quietHoursStart: string;
  readonly quietHoursEnd: string;
  readonly sensitivePreviews: boolean;
  readonly briefCadence: "off" | "daily" | "weekly";
}

export interface NexusBrief {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly severity: "info" | "attention" | "urgent";
  readonly generatedAt: string;
  readonly notify: boolean;
  readonly itemCount: number;
}

export interface NexusMemory {
  readonly id: string;
  readonly version: number;
  readonly content: string;
  readonly sourceDomain: DomainId | null;
  readonly sourceRefs: readonly string[];
  readonly sensitivity: "personal" | "sensitive";
  readonly state: "active" | "superseded" | "forgotten" | "expired";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt?: string;
}

export interface NexusMemoryCreate {
  readonly content: string;
  readonly sourceDomain?: DomainId | null;
  readonly sourceRefs?: readonly string[];
  readonly sensitivity?: NexusMemory["sensitivity"];
  readonly expiresInDays?: number;
}

export interface NexusMemoryCorrect {
  readonly id: string;
  readonly content: string;
  readonly sourceRefs?: readonly string[];
}

export interface NexusBootstrap {
  readonly protocol: typeof NEXUS_PROTOCOL_VERSION;
  readonly mode: "preview" | "connected";
  readonly generatedAt: string;
  readonly greeting: string;
  readonly dateLabel: string;
  readonly focus: string;
  readonly signals: readonly TodaySignal[];
  readonly domains: readonly DomainSummary[];
  readonly drafts: readonly CaptureDraft[];
  readonly activity: readonly ActivityEntry[];
  readonly trust: TrustOverview;
  readonly preferences: NexusPreferences;
  readonly brief: NexusBrief | null;
  readonly memories: readonly NexusMemory[];
  readonly contexts: readonly NexusContextPack[];
  readonly suggestions: readonly NexusSuggestion[];
  readonly capabilities: NexusCapabilityStatus;
  readonly assetUpload: {
    readonly enabled: boolean;
    readonly maxFilesPerMessage: number;
  };
}

export interface NexusAssetUploadInit {
  readonly sessionId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface NexusAssetUploadTicket {
  readonly ticketId: string;
  readonly attachmentId: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

export interface NexusAssetAttachment {
  readonly id: string;
  readonly sessionId: string;
  readonly assetId: string;
  readonly versionId: string;
  readonly referenceUri: string;
  readonly conversationPath: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

export interface CaptureRequest {
  readonly sessionId: string;
  readonly text: string;
  readonly analysis: CaptureAnalysis | NexusIntentPlan;
  readonly attachmentIds?: readonly string[];
}

export interface CaptureAnalysisDraft {
  readonly domain: DomainId;
  readonly intent: string;
  readonly summary: string;
  readonly risk: RiskLevel;
  readonly fields: Readonly<Record<string, string>>;
  readonly attachmentRefs?: readonly string[];
}

export interface CaptureAnalysis {
  readonly protocol: "shadow.nexus.capture.v1";
  readonly version: 2;
  readonly captureId: string;
  readonly drafts: readonly CaptureAnalysisDraft[];
  readonly contract: PlanContractMetadata;
}

export type IntentRoute = "answer" | "propose" | "mixed" | "clarify";

export interface NexusIntentPlan {
  readonly protocol: "shadow.nexus.plan.v1";
  readonly version: 3;
  readonly interactionId: string;
  readonly route: IntentRoute;
  readonly response: string;
  readonly drafts: readonly CaptureAnalysisDraft[];
  readonly contract: PlanContractMetadata;
}

export interface NexusInteractionResult {
  readonly plan: NexusIntentPlan;
  readonly drafts: readonly CaptureDraft[];
}

export interface ReviewRequest {
  readonly sessionId: string;
  readonly draftId: string;
  readonly decision: "approve" | "reject";
}

export interface BatchReviewRequest {
  readonly captureGroupId: string;
  readonly decision: "approve" | "reject";
}

export interface ApiError {
  readonly error: string;
}
