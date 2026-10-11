/**
 * PC clock correction (LIRA-306, FR-022, R5, O-new-15) — PURE.
 *
 * `skew = server receipt − PC clock`, measured on the upload that carried the
 * event (the only moment the right skew exists — later check-ins overwrite
 * it). Above the tolerance (default 2 min) the event's instant is shifted by
 * the skew. The result — corrected or not — is clamped to no later than the
 * server's receipt and no earlier than 5 minutes before the copy the PC was
 * working on was built. A note explains every correction and every clamp,
 * says when the skew moved by more than the tolerance since the last online
 * check-in ("the clock changed"), and flags an event earlier than the PC's
 * previous event (a clock reset that network time later fixed).
 *
 * Exported from `index.ts` only (it has no browser use).
 */

export const DEFAULT_SKEW_TOLERANCE_MS = 120_000;
export const COPY_CLAMP_MS = 5 * 60_000;

export interface SkewInput {
  occurredAt: string;
  uploadSkewMs: number;
  /** skew of the last check-in while the PC was on standby (pre-outage) */
  onlineSkewMs: number | null;
  receivedAt: string;
  copyBuiltAt: string | null;
  previousOccurredAt: string | null;
  toleranceMs?: number;
}

export interface SkewNote {
  text: string;
  occurredAt: string;
  correctedAt: string;
  skewMs: number;
  clamped: "receipt" | "copy" | null;
  clockChanged: boolean;
  backwards: boolean;
}

export interface SkewResult {
  correctedAt: string;
  corrected: boolean;
  clamped: "receipt" | "copy" | null;
  clockChanged: boolean;
  backwards: boolean;
  note: SkewNote | null;
}

function minutes(ms: number): number {
  return Math.round(Math.abs(ms) / 60_000);
}

export function correctEventTime(i: SkewInput): SkewResult {
  const tolerance = i.toleranceMs ?? DEFAULT_SKEW_TOLERANCE_MS;
  const occurred = Date.parse(i.occurredAt);
  const corrected = Math.abs(i.uploadSkewMs) > tolerance;
  let t = corrected ? occurred + i.uploadSkewMs : occurred;

  let clamped: SkewResult["clamped"] = null;
  const receipt = Date.parse(i.receivedAt);
  if (Number.isFinite(receipt) && t > receipt) {
    t = receipt;
    clamped = "receipt";
  }
  const built = i.copyBuiltAt ? Date.parse(i.copyBuiltAt) : NaN;
  if (Number.isFinite(built) && t < built - COPY_CLAMP_MS) {
    t = built - COPY_CLAMP_MS;
    clamped = "copy";
  }

  const clockChanged =
    corrected && i.onlineSkewMs !== null && Math.abs(i.uploadSkewMs - i.onlineSkewMs) > tolerance;
  const prev = i.previousOccurredAt ? Date.parse(i.previousOccurredAt) : NaN;
  const backwards = Number.isFinite(prev) && occurred < prev;

  const correctedAt = t === occurred ? i.occurredAt : new Date(t).toISOString();
  const parts: string[] = [];
  if (corrected) {
    parts.push(
      `The PC clock was ${minutes(i.uploadSkewMs)} min ${i.uploadSkewMs > 0 ? "slow" : "fast"} — time corrected`,
    );
  }
  if (clockChanged) parts.push("the PC's clock changed during the outage, so the time measured when it sent its work was used");
  if (clamped === "receipt") parts.push("time limited to when the server received it");
  if (clamped === "copy") parts.push("time limited to 5 minutes before the copy the PC worked on");
  if (backwards) parts.push("this item's time is earlier than the PC's previous item");

  return {
    correctedAt,
    corrected,
    clamped,
    clockChanged,
    backwards,
    note:
      parts.length === 0
        ? null
        : {
            text: parts.join("; "),
            occurredAt: i.occurredAt,
            correctedAt,
            skewMs: i.uploadSkewMs,
            clamped,
            clockChanged,
            backwards,
          },
  };
}

/** The calendar day (`YYYY-MM-DD`) of an instant at a UTC offset in minutes. */
export function dayAt(instantIso: string, offsetMinutes: number): string {
  return new Date(Date.parse(instantIso) + offsetMinutes * 60_000).toISOString().slice(0, 10);
}
