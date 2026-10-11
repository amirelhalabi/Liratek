/**
 * LIRA-256 — OMT statement commission types.
 *
 * OMT's balance SMS sometimes says which commission types ("shares") it
 * already deducted ("INCLUDES INTRA SHARES"). A *covered-types choice* is
 * the list of types one statement includes. It is never stored as a shop
 * setting: it travels with each statement check and each settlement.
 *
 * `undefined` = no choice = ALL types covered = exactly the behaviour
 * before this feature (decision S3).
 *
 * Pure leaf: imports only from `./omtFees.js` (rule 29 — reachable from
 * `browser.ts`, so no Node built-in and no db import, at any depth).
 */
import { OMT_SERVICE_TYPES, type OmtServiceType } from "./omtFees.js";

/** Every value a covered-types list may hold. `UNSPECIFIED` matches an OMT
 *  row saved without a type (`omt_service_type IS NULL`); it is never
 *  written to the database. */
export const OMT_COVERED_TYPE_VALUES = [
  ...OMT_SERVICE_TYPES,
  "UNSPECIFIED",
] as const;

export type OmtCoveredType = OmtServiceType | "UNSPECIFIED";

const LABELS: Record<OmtCoveredType, string> = {
  INTRA: "Intra",
  WESTERN_UNION: "Western Union",
  CASH_TO_BUSINESS: "Cash to Business",
  CASH_TO_GOV: "Cash to Government",
  OMT_WALLET: "OMT Wallet",
  OMT_CARD: "OMT Card",
  OGERO_MECANIQUE: "Ogero/Mécanique",
  ONLINE_BROKERAGE: "Online Brokerage",
  UNSPECIFIED: "Type not recorded",
};

/** Human label for a covered type ("Type not recorded" for UNSPECIFIED). */
export function coveredTypeLabel(type: OmtCoveredType | string): string {
  return LABELS[type as OmtCoveredType] ?? type;
}

/** The type key a row falls under: its own type, or UNSPECIFIED when none. */
export function omtRowCoveredType(row: {
  omt_service_type: string | null | undefined;
}): OmtCoveredType {
  return (row.omt_service_type ?? "UNSPECIFIED") as OmtCoveredType;
}

/**
 * THE predicate (rule 14): is this row included in a statement that covers
 * `covered`?
 *
 *   covered === undefined        → true  (all types — today's behaviour)
 *   row.provider !== "OMT"       → true  (only OMT counter rows have types)
 *   row.omt_service_type == null → covered includes "UNSPECIFIED"
 *   otherwise                    → covered includes row.omt_service_type
 */
export function isOmtRowCovered(
  row: {
    provider: string | null | undefined;
    omt_service_type: string | null | undefined;
  },
  covered: readonly OmtCoveredType[] | undefined,
): boolean {
  if (covered === undefined) return true;
  if (row.provider !== "OMT") return true;
  return covered.includes(omtRowCoveredType(row));
}

/** De-duplicates and orders by {@link OMT_COVERED_TYPE_VALUES}, so the
 *  same choice always prints (and caches) the same way. */
export function normaliseCoveredTypes(
  covered: readonly OmtCoveredType[],
): OmtCoveredType[] {
  const set = new Set<string>(covered);
  return OMT_COVERED_TYPE_VALUES.filter((v) => set.has(v));
}
