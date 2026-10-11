/**
 * LIRA-306 — what the review page and the paired-PCs panel receive (US3).
 * PURE, types only — browser-safe (rule 29); the services that build them
 * are server-only.
 */
import type { OfflineReviewKind } from "./reviewKinds.js";

export type OfflineReviewItemState = "open" | "applied" | "dismissed" | "reviewed";

export type ReviewAction = "apply" | "dismiss" | "reviewed" | "book_anyway";

export interface ReviewItemView {
  id: number;
  kind: OfflineReviewKind;
  label: string;
  state: OfflineReviewItemState;
  holding: boolean;
  actions: ReviewAction[];
  reason: string | null;
  details: Record<string, unknown>;
  eventId: string | null;
  eventStatus: string | null;
  channel: string | null;
  channelLabel: string | null;
  occurredAt: string | null;
  deviceId: number;
  deviceNo: number | null;
  deviceName: string | null;
  actorUserId: number | null;
  actorName: string | null;
  createdAt: string;
  resolvedBy: number | null;
  resolvedAt: string | null;
}

export interface OfflineHistoryView {
  eventId: string;
  seq: number;
  deviceId: number;
  deviceNo: number | null;
  channel: string;
  channelLabel: string;
  status: string;
  occurredAt: string;
  correctedAt: string | null;
  clientDay: string;
  error: string | null;
  serverIds: Record<string, number[]> | null;
  receiptNumber: string | null;
}

export interface ReviewActionResult {
  success: boolean;
  data?: { state?: OfflineReviewItemState; status?: string; serverIds?: Record<string, number[]> };
  error?: string;
  code?: string;
}

export interface PairedDeviceView {
  id: number;
  deviceNo: number;
  name: string;
  pairedAt: string;
  lastSeenAt: string | null;
  state: string | null;
  pendingCount: number;
  appVersion: string | null;
  revokedAt: string | null;
  /** O-new-29: an open sequence conflict (the PC stopped sending), else null */
  seqConflict: { itemId: number; seq: number | null; reason: string; at: string } | null;
  /** O-new-29: the admin asked this PC to renumber its unsent work; it has not yet */
  renumberRequested: boolean;
}

/** A drawer count's two expected figures per drawer/currency (FR-032, O-new-27). */
export interface CheckpointExpectedFigure {
  drawer_name: string;
  currency_code: string;
  /** what the PC's copy expected when the count was taken */
  pc_expected: number;
  /** the server's drawer as of the count's time — what Apply books */
  server_expected: number;
  physical: number;
}

/** What Apply would book, shown before the admin confirms. */
export type OfflineReviewPreview = { kind: "drawer_count"; figures: CheckpointExpectedFigure[] } | { kind: "none" };
