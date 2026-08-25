export const NEXUS_PROTOCOL_VERSION = "shadow.nexus.v1" as const;

export type DomainId = "health" | "ledger" | "travel" | "archive" | "foliant";
export type NexusView = "today" | "capture" | "review" | DomainId;
export type DraftState = "pending" | "approved" | "rejected";
export type RiskLevel = "low" | "medium" | "high";

export interface DomainSummary {
  readonly id: DomainId;
  readonly label: string;
  readonly caption: string;
  readonly status: "ready" | "attention" | "offline";
  readonly metric: string;
  readonly detail: string;
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
  readonly receipt?: string;
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
}

export interface ReviewRequest {
  readonly sessionId: string;
  readonly draftId: string;
  readonly decision: "approve" | "reject";
}

export interface ApiError {
  readonly error: string;
}
