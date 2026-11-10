/**
 * LIRA-370 — settle the OMT account from the amount on OMT's SMS.
 * Contract: specs/370-omt-sms-amount-settle/contracts/settle-account-sms.md
 * (research R3/R4).
 *
 * THE formula (rule 14) the Settle Account sheet's prefill, the statement
 * panel and the server's recompute all use, so the three agree to the cent.
 *
 * Every amount is in OMT's sign, per currency: + the shop owes OMT, − OMT
 * owes the shop. OMT's SMS uses the same sign, so the shop's commission
 * always moves the figure DOWN (we pay less, or OMT pays us more):
 *
 *   expected   = owed − expected commission − owed shares included
 *   commission = max(0, owed − SMS)
 *
 * The expected commission counts, for each commission-carrying OMT transfer
 * (`commission_model = 1`) of a ticked type, only what is still
 * OUTSTANDING: its creation-time estimate minus what earlier settlements
 * already booked for it or left owed (`commission_accounted_*`). So a
 * transfer part-paid by one settlement and closed by another is never
 * counted twice (R3).
 *
 * An SMS worse for the shop than what is owed (pay more, or receive less)
 * is not negative commission: commission is 0 and `omtAsksMore` is set, the
 * caller warns and keeps the difference on OMT's account (owner 2026-11-03).
 *
 * All arithmetic runs in integer minor units (USD cents, whole LBP).
 *
 * PURE and a LEAF (rule 29): reachable from `browser.ts`, so it imports
 * only other pure utils and no Node built-in, at any depth.
 */
import { isOmtRowCovered, type OmtCoveredType } from "./omtCoveredTypes.js";

export type SmsCurrency = "USD" | "LBP";

/** The fields of an account settle row this formula reads. */
export interface SmsScopeRow {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  remaining_usd: number;
  remaining_lbp: number;
  commission_model?: number | null | undefined;
  source_provider?: string | null | undefined;
  omt_service_type?: string | null | undefined;
  /** The transfer's creation-time commission estimate. */
  expected_commission_usd?: number | null;
  expected_commission_lbp?: number | null;
  /** Already booked by earlier settlements, plus any of it left owed. */
  commission_accounted_usd?: number | null;
  commission_accounted_lbp?: number | null;
}

/** One live share OMT still owes us (`omt_owed_shares`). */
export interface OwedShareView {
  omt_service_type: string;
  currency: SmsCurrency;
  amount: number;
}

export interface ExpectedSmsFigure {
  /** Signed remaining of the rows in scope. */
  owed: number;
  /** Outstanding commission of ticked-type transfers in scope. */
  expectedCommission: number;
  /** Live owed shares of ticked types. */
  owedSharesIncluded: number;
  /** What OMT's SMS should say. */
  expected: number;
}

export interface SmsDerivation {
  commission: number;
  /** The part of the commission that was expected (transfers + shares). */
  expectedPart: number;
  /** The part beyond the expected commission. */
  extraPart: number;
  /** The commission is below what was expected. */
  lessThanExpected: boolean;
  /** Expected commission (transfers + shares) not covered by this SMS. */
  shortOfExpected: number;
  /** The SMS is worse for the shop than what is owed. */
  omtAsksMore: boolean;
  /** How much worse (0 unless `omtAsksMore`). */
  difference: number;
}

const FACTOR: Record<SmsCurrency, number> = { USD: 100, LBP: 1 };

const toMinor = (v: number | null | undefined, c: SmsCurrency): number =>
  Math.round((v ?? 0) * FACTOR[c]);

const fromMinor = (m: number, c: SmsCurrency): number => m / FACTOR[c] + 0;

const pick = (
  usd: number | null | undefined,
  lbp: number | null | undefined,
  c: SmsCurrency,
): number | null | undefined => (c === "USD" ? usd : lbp);

function outstandingMinor(row: SmsScopeRow, c: SmsCurrency): number {
  if (row.kind !== "FINANCIAL_SERVICE" || row.commission_model !== 1) return 0;
  const estimate = toMinor(
    pick(row.expected_commission_usd, row.expected_commission_lbp, c),
    c,
  );
  const accounted = toMinor(
    pick(row.commission_accounted_usd, row.commission_accounted_lbp, c),
    c,
  );
  return Math.max(0, estimate - accounted);
}

/** A transfer's commission still to come: estimate − already accounted for,
 *  never below 0. Only commission-model-1 transfers carry one. */
export function outstandingEstimate(row: SmsScopeRow, c: SmsCurrency): number {
  return fromMinor(outstandingMinor(row, c), c);
}

/** Is this row's commission part of an SMS that includes `covered`? */
function rowCovered(
  row: SmsScopeRow,
  covered: readonly OmtCoveredType[] | undefined,
): boolean {
  return isOmtRowCovered(
    { provider: row.source_provider, omt_service_type: row.omt_service_type },
    covered,
  );
}

/** What OMT's SMS should say for these rows and ticked types. */
export function expectedSmsFigure(args: {
  rows: readonly SmsScopeRow[];
  currency: SmsCurrency;
  coveredTypes?: readonly OmtCoveredType[] | undefined;
  owedShares?: readonly OwedShareView[];
}): ExpectedSmsFigure {
  const { rows, currency: c, coveredTypes, owedShares = [] } = args;
  let owed = 0;
  let commission = 0;
  for (const r of rows) {
    owed += toMinor(pick(r.remaining_usd, r.remaining_lbp, c), c);
    if (rowCovered(r, coveredTypes)) commission += outstandingMinor(r, c);
  }
  let shares = 0;
  for (const s of owedShares) {
    if (s.currency !== c) continue;
    const covered =
      coveredTypes === undefined ||
      coveredTypes.includes(s.omt_service_type as OmtCoveredType);
    if (covered) shares += toMinor(s.amount, c);
  }
  return {
    owed: fromMinor(owed, c),
    expectedCommission: fromMinor(commission, c),
    owedSharesIncluded: fromMinor(shares, c),
    expected: fromMinor(owed - commission - shares, c),
  };
}

/**
 * LIRA-378 (owner 2026-11-09) — nothing ticked says "this SMS includes no
 * commission"; an SMS figure that still implies commission contradicts it,
 * so the cashier must tick the types it includes. The sheet blocks Settle
 * and the server refuses on this ONE rule (rule 14). `undefined` (all
 * types, the other screens) is never blocked.
 */
export function smsNeedsTickedTypes(
  coveredTypes: readonly OmtCoveredType[] | undefined,
  commission: number,
  currency: SmsCurrency,
): boolean {
  return (
    coveredTypes !== undefined &&
    coveredTypes.length === 0 &&
    toMinor(commission, currency) > 0
  );
}

/** The commission an SMS figure implies, split into expected and extra. */
export function deriveSmsCommission(args: {
  owed: number;
  expectedCommission: number;
  owedSharesIncluded: number;
  sms: number;
  currency: SmsCurrency;
}): SmsDerivation {
  const c = args.currency;
  const raw = toMinor(args.owed, c) - toMinor(args.sms, c);
  const expectedTotal =
    toMinor(args.expectedCommission, c) + toMinor(args.owedSharesIncluded, c);
  const commission = Math.max(0, raw);
  const expectedPart = Math.min(commission, expectedTotal);
  return {
    commission: fromMinor(commission, c),
    expectedPart: fromMinor(expectedPart, c),
    extraPart: fromMinor(commission - expectedPart, c),
    lessThanExpected: commission < expectedTotal,
    shortOfExpected: fromMinor(expectedTotal - expectedPart, c),
    omtAsksMore: raw < 0,
    difference: fromMinor(Math.max(0, -raw), c),
  };
}

/**
 * The allocator's per-row commission fields for an SMS settlement: is the
 * row's type one the SMS includes, and its outstanding commission when it
 * is (0 when not). ONE definition for the server and the sheet (rule 14).
 */
export function smsCommissionWeight(
  row: SmsScopeRow,
  currency: SmsCurrency,
  coveredTypes: readonly OmtCoveredType[] | undefined,
): { commission_ticked: boolean; commission_estimate: number } {
  const ticked = rowCovered(row, coveredTypes);
  return {
    commission_ticked: ticked,
    commission_estimate: ticked ? outstandingEstimate(row, currency) : 0,
  };
}

/** The live owed shares of the ticked types, in one currency, oldest first
 *  as given. */
export function tickedOwedShares<T extends OwedShareView>(
  shares: readonly T[],
  currency: SmsCurrency,
  coveredTypes: readonly OmtCoveredType[] | undefined,
): T[] {
  return shares.filter(
    (s) =>
      s.currency === currency &&
      (coveredTypes === undefined ||
        coveredTypes.includes(s.omt_service_type as OmtCoveredType)),
  );
}

/**
 * Which owed shares an SMS commission collects: whole shares, oldest first,
 * while they fit; the rest of the commission (`split`) is the transfers'
 * profit. The whole commission still closes rows — OMT took the shares off
 * what we pay (or added them to what it pays).
 */
export function owedSharesCollected<T extends OwedShareView>(
  ticked: readonly T[],
  commission: number,
  currency: SmsCurrency,
): { collected: T[]; split: number } {
  let left = toMinor(commission, currency);
  const collected: T[] = [];
  for (const s of ticked) {
    const m = toMinor(s.amount, currency);
    if (m > left) break;
    collected.push(s);
    left -= m;
  }
  return { collected, split: fromMinor(Math.max(0, left), currency) };
}
