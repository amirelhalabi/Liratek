/**
 * The binding contract (LIRA-306, R1/R4). One binding per offline/checkpoint
 * channel: it books the event's (already parsed, id-rewritten) named payload
 * through the SAME core service the web route calls — never its own SQL.
 *
 * Rules for a binding:
 *   - call the service the REST route calls, with the actor from `ctx`
 *     (never from the payload);
 *   - await only promises that resolve without I/O (the replay transaction
 *     must not yield — a `setImmediate` sentinel rolls it back if it does);
 *   - return the route's envelope (`{ success, error?, code?, ... }`); a
 *     thrown error is a business refusal with its message, like an IPC handler.
 */
import type { OfflineReviewKind } from "../reviewKinds.js";

export interface OfflineBindingContext {
  tenantId: number;
  actorUserId: number;
  eventId: string;
  deviceId: number;
}

/**
 * What a binding tells the engine when a REPLAY-ONLY rule fired (R7):
 *   - `linkExisting`: the PC's new row is an EXISTING server row (a customer
 *     whose phone already exists, O-new-4) — the engine maps the PC's main
 *     row to it (`linked_existing`) and nothing else;
 *   - `mainRowOnly`: the booking's row shape differs from the PC's (ticks
 *     dropped, FR-029) — only the main row (`mainRow()`) is mapped;
 *   - `notes`: review-list notes to add to the booked event.
 */
export interface BindingReplayInfo {
  linkExisting?: { table: string; id: number };
  mainRowOnly?: boolean;
  notes?: Array<{ kind: OfflineReviewKind; details: Record<string, unknown> }>;
}

export interface BindingResult {
  success: boolean;
  error?: string;
  code?: string;
  offline?: BindingReplayInfo;
  [key: string]: unknown;
}

export interface OfflineBinding {
  channel: string;
  run(
    payload: Record<string, unknown>,
    ctx: OfflineBindingContext,
  ): BindingResult | Promise<BindingResult>;
  /**
   * The event's main row in the booking result (e.g. the sale) — used when
   * only the main row may be mapped (replay-only rules changed row shapes,
   * FR-020) and for receipt aliases.
   */
  mainRow?(result: BindingResult): { table: string; id: number } | null;
}
