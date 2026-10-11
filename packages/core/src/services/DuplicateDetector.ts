/**
 * LIRA-306 — duplicate detection (R8, FR-025–FR-027, N7, O-new-18).
 * Server-only (exported from `index.ts`).
 *
 * The replay books an event inside `SAVEPOINT offline_dup`; this hook then
 * fingerprints the rows the booking made (`DuplicateFingerprintRepository`,
 * the ONE definition) and compares them with rows of the same family that
 * were created during THIS PC's outage by anyone else:
 *   - rows above the high-water mark of the copy the event was made on
 *     (online rows and other PCs' rows),
 *   - minus every row this PC's booked/applied events created (their stored
 *     results) and the rows of the trial booking itself.
 * Unknown copy (no `offline_snapshots` row): business time within ±24 h of
 * the event instead of the high-water mark (O-impl-A2-1).
 *
 *   certain (same non-empty OMT/Whish reference; recharge carrier + phone +
 *   amount within 10 minutes) → the engine rolls back to the savepoint, the
 *   event is `skipped`, note `certain_duplicate`;
 *   likely (every N7 field equal within ±5 minutes, user and seconds
 *   ignored) → rolled back, `held`, item `possible_duplicate`;
 *   else none → booked.
 */
import type { OfflineEventRow } from "../repositories/OfflineEventRepository.js";
import { getOfflineEventRepository, type OfflineEventRepository } from "../repositories/OfflineEventRepository.js";
import {
  getOfflineSnapshotRepository,
  type OfflineSnapshotRepository,
} from "../repositories/OfflineSnapshotRepository.js";
import {
  getDuplicateFingerprintRepository,
  type DuplicateFingerprint,
  type DuplicateFingerprintRepository,
} from "../repositories/DuplicateFingerprintRepository.js";
import type { BindingResult } from "../offline/bindings/types.js";
import type { OfflineReviewKind } from "../offline/reviewKinds.js";

export const LIKELY_WINDOW_MINUTES = 5;
export const CERTAIN_RECHARGE_WINDOW_SECONDS = 600;
const FALLBACK_WINDOW_MS = 24 * 3600_000;
const SCAN_WINDOW_MS = 11 * 60_000;

export interface DuplicateVerdict {
  outcome: "certain" | "likely" | "none";
  match?: DuplicateFingerprint;
}

/** SQLite UTC text (or ISO) → epoch ms. */
function epoch(at: string): number {
  return Date.parse(at.includes("T") ? at : `${at.replace(" ", "T")}Z`);
}
const minuteOf = (at: string): number => Math.floor(epoch(at) / 60_000);

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The N7 rules (pure). Certain beats likely; the first match wins. */
export function classifyDuplicate(event: DuplicateFingerprint, candidates: readonly DuplicateFingerprint[]): DuplicateVerdict {
  for (const c of candidates) {
    if (c.family !== event.family) continue;
    if (event.family === "transfer" && event.reference && c.reference && event.reference.toLowerCase() === c.reference.toLowerCase()) {
      return { outcome: "certain", match: c };
    }
    if (
      event.family === "recharge" &&
      event.recharge &&
      c.recharge &&
      event.recharge.carrier === c.recharge.carrier &&
      event.recharge.phone !== "" &&
      event.recharge.phone === c.recharge.phone &&
      event.recharge.amount === c.recharge.amount &&
      Math.abs(epoch(event.at) - epoch(c.at)) <= CERTAIN_RECHARGE_WINDOW_SECONDS * 1000
    ) {
      return { outcome: "certain", match: c };
    }
  }
  for (const c of candidates) {
    if (c.family !== event.family) continue;
    if (Math.abs(minuteOf(event.at) - minuteOf(c.at)) > LIKELY_WINDOW_MINUTES) continue;
    if (deepEqual(event.fields, c.fields)) return { outcome: "likely", match: c };
  }
  return { outcome: "none" };
}

export type DuplicateHookResult =
  | { outcome: "none" }
  | { outcome: "skipped" | "held"; note: { kind: OfflineReviewKind; details: Record<string, unknown> } };

export interface DuplicateDetectorDeps {
  fingerprints?: DuplicateFingerprintRepository;
  snapshots?: OfflineSnapshotRepository;
  events?: OfflineEventRepository;
}

export class DuplicateDetector {
  private readonly fingerprints: DuplicateFingerprintRepository;
  private readonly snapshots: OfflineSnapshotRepository;
  private readonly events: OfflineEventRepository;

  constructor(deps: DuplicateDetectorDeps = {}) {
    this.fingerprints = deps.fingerprints ?? getDuplicateFingerprintRepository();
    this.snapshots = deps.snapshots ?? getOfflineSnapshotRepository();
    this.events = deps.events ?? getOfflineEventRepository();
  }

  /** The ReplayEngine's duplicate hook (inside the event's transaction). */
  check = (input: { event: OfflineEventRow; created: Record<string, number[]>; result: BindingResult }): DuplicateHookResult => {
    const own = input.created.transactions ?? [];
    const fp = this.fingerprints.fingerprint(own);
    if (!fp) return { outcome: "none" };

    const copy = this.snapshots.findByCopyId(input.event.copy_id);
    const above = copy ? (copy.highWater.transactions ?? 0) : null;
    const t = epoch(fp.at);
    const sqlAt = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);
    // Bounded scans inside the never-yielding replay transaction: the time
    // rules need ±5 min (likely, seconds ignored) / ±10 min (recharge), so
    // read ±11 min; the transfer reference rule reads by reference instead
    // (any time since the copy). Unknown copy → ±24 h (O-impl-A2-1).
    const windowMs = above === null ? FALLBACK_WINDOW_MS : SCAN_WINDOW_MS;
    const exclude = [...own, ...this.ownBookedTransactions(input.event.device_id)];
    const base = { family: fp.family, aboveTransactionId: above, excludeTransactionIds: exclude };
    const near = this.fingerprints.candidates({ ...base, from: sqlAt(t - windowMs), to: sqlAt(t + windowMs) });
    const byRef =
      fp.family === "transfer" && fp.reference
        ? this.fingerprints.candidates({
            ...base,
            from: above === null ? sqlAt(t - FALLBACK_WINDOW_MS) : null,
            to: above === null ? sqlAt(t + FALLBACK_WINDOW_MS) : null,
            reference: fp.reference,
          })
        : [];
    const seen = new Set<number>();
    const candidates = [...byRef, ...near].filter((c) => (seen.has(c.transactionId) ? false : (seen.add(c.transactionId), true)));
    const verdict = classifyDuplicate(fp, candidates);
    if (verdict.outcome === "none" || !verdict.match) return { outcome: "none" };
    const m = verdict.match;
    const details = {
      reason:
        verdict.outcome === "certain"
          ? fp.family === "transfer"
            ? `Same transfer reference (${fp.reference}) is already booked`
            : "The same recharge (carrier, phone, amount) was booked within 10 minutes"
          : "Everything matches a row booked within 5 minutes",
      family: fp.family,
      match: { transactionId: m.transactionId, table: m.sourceTable ?? "transactions", id: m.sourceId ?? m.transactionId, at: m.at },
      mainTable: fp.sourceTable ?? "transactions",
      fields: fp.fields,
    };
    return verdict.outcome === "certain"
      ? { outcome: "skipped", note: { kind: "certain_duplicate", details } }
      : { outcome: "held", note: { kind: "possible_duplicate", details } };
  };

  /** Every server transaction this PC's booked/applied events created (R8). */
  private ownBookedTransactions(deviceId: number): number[] {
    const out: number[] = [];
    for (const e of this.events.listBookedForDevice(deviceId)) {
      try {
        const ids = (JSON.parse(e.result_json ?? "{}") as { serverIds?: Record<string, number[]> }).serverIds?.transactions;
        if (Array.isArray(ids)) out.push(...ids);
      } catch {
        /* a malformed stored result excludes nothing */
      }
    }
    return out;
  }
}
