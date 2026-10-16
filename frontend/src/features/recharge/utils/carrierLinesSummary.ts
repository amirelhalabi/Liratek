/**
 * Pure summary rules for the Mobile Recharge shop-lines chip and its modal
 * (`CarrierLinesPanel`). One definition each (rule 14): the top-row chip and
 * the modal body colour and flag lines with the SAME predicates, so the chip's
 * warning dot can never light up while nothing inside the modal is
 * highlighted (or the reverse).
 */

import type { CarrierLineEntity } from "@liratek/ui";
import { classifyLineValidity } from "@liratek/core";
import { daysRemaining } from "@/shared/utils/daysRemaining";

/** A line with this many days left or fewer is shown amber ("expiring"). */
export const LINE_EXPIRING_SOON_DAYS = 3;

/** Drift below half a cent is float noise, not a mismatch. */
export const DRAWER_MISMATCH_TOLERANCE_USD = 0.005;

/** The line the chip shows: the carrier's primary line, else the first
 *  active line (the server already returns active lines only). */
export function pickMainLine(
  lines: readonly CarrierLineEntity[],
): CarrierLineEntity | null {
  return lines.find((l) => l.is_primary === 1) ?? lines[0] ?? null;
}

export type LineValidityTone = "expired" | "expiring" | "ok" | "none";

/** How a line's validity reads — the same rule the modal colours by:
 *  already past → red, within {@link LINE_EXPIRING_SOON_DAYS} → amber. */
export function lineValidityTone(line: CarrierLineEntity): LineValidityTone {
  if (line.validity_expires_at == null) return "none";
  const remaining = daysRemaining(line.validity_expires_at);
  if (remaining < 0) return "expired";
  if (remaining <= LINE_EXPIRING_SOON_DAYS) return "expiring";
  return "ok";
}

/** LIRA-157 — past the revival window: a charge will be refused. Same rule the
 *  write path enforces, never a local day-count comparison. */
export function isLineBurned(line: CarrierLineEntity): boolean {
  return classifyLineValidity(line.validity_expires_at).state === "BURNED";
}

export function sumLineCredits(lines: readonly CarrierLineEntity[]): number {
  return lines.reduce((sum, l) => sum + (Number(l.credits) || 0), 0);
}

/** LIRA-252 E — the carrier drawer no longer equals the sum of its active
 *  lines' credits. An unknown drawer balance is never a mismatch. */
export function isDrawerMismatch(
  drawerUsd: number | undefined,
  lines: readonly CarrierLineEntity[],
): drawerUsd is number {
  return (
    drawerUsd !== undefined &&
    Number.isFinite(drawerUsd) &&
    Math.abs(drawerUsd - sumLineCredits(lines)) > DRAWER_MISMATCH_TOLERANCE_USD
  );
}

/** The chip's warning dot: any line expiring / expired / burned, the drawer
 *  disagreeing with the lines, or days still owed to customers. */
export function carrierLinesNeedAttention(args: {
  lines: readonly CarrierLineEntity[];
  drawerUsd: number | undefined;
  owedDeliveryCount: number;
}): boolean {
  const { lines, drawerUsd, owedDeliveryCount } = args;
  return (
    owedDeliveryCount > 0 ||
    isDrawerMismatch(drawerUsd, lines) ||
    lines.some(
      (l) =>
        isLineBurned(l) ||
        lineValidityTone(l) === "expired" ||
        lineValidityTone(l) === "expiring",
    )
  );
}

/** Semantic colour for a USD credit balance: red below zero. */
export function lineBalanceClass(credits: number): string {
  return credits < 0 ? "text-red-400" : "text-emerald-400";
}
