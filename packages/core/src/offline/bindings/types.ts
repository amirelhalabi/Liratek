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
export interface OfflineBindingContext {
  tenantId: number;
  actorUserId: number;
  eventId: string;
  deviceId: number;
}

export interface BindingResult {
  success: boolean;
  error?: string;
  code?: string;
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
