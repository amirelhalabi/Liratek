/**
 * LIRA-360 — insurance renewal reminders, the ONE definition shared by the
 * Dashboard card and the top-bar bell on both transports.
 *
 * Owner rules 2026-10-29: an insurance expires one calendar year after its
 * sale day; it is listed from 7 days before expiry and stays listed, once
 * expired, until the customer renews or staff mark "Won't renew". A renewal
 * is a LATER live insurance for the same customer (same saved client, or the
 * same phone in any format) of the same type; an untyped older sale (sold
 * before types existed) is renewed by any type.
 *
 * Pure, no I/O, reachable from `browser.ts` (rule 29). `today` and every
 * `sale_day` are shop calendar days (`YYYY-MM-DD`, rule 27) — the repository
 * shifts `created_at` to the shop's day before it gets here.
 */
import { daysBetweenDateStrings } from "./calendarDate.js";
import { addMonthsIso } from "./dates.js";
import { normalizeLebanesePhone } from "./phoneNumber.js";

/** The Custom Services category an insurance sale is stored under. */
export const INSURANCE_CATEGORY = "insurance";

export const INSURANCE_TYPES = [
  "COMPULSORY",
  "THIRD_PARTY",
  "DOMESTIC_WORKER",
  "ALL_RISK",
  "LIFE",
] as const;

export type InsuranceType = (typeof INSURANCE_TYPES)[number];

/** Listed once the expiry is this many days away or less. */
export const INSURANCE_RENEWAL_WARNING_DAYS = 7;

/** A live (not refunded, not voided) insurance sale, as the repository reads it. */
export interface InsuranceRenewalCandidate {
  id: number;
  client_id: number | null;
  client_name: string | null;
  phone_number: string | null;
  description: string;
  insurance_type: InsuranceType | null;
  /** Shop calendar day of the sale. */
  sale_day: string;
  renewal_dismissed_at: string | null;
}

export interface InsuranceRenewal {
  id: number;
  client_id: number | null;
  client_name: string | null;
  phone_number: string | null;
  description: string;
  insurance_type: InsuranceType | null;
  sale_day: string;
  expiry_day: string;
  /** `expiry_day − today`; negative once expired. */
  days_left: number;
}

/** Sale day + one calendar year (29 February → 28 February). */
export function insuranceExpiryDay(saleDay: string): string {
  return addMonthsIso(saleDay, 12);
}

function sameCustomer(
  a: InsuranceRenewalCandidate,
  b: InsuranceRenewalCandidate,
): boolean {
  if (a.client_id != null && a.client_id === b.client_id) return true;
  const phone = normalizeLebanesePhone(a.phone_number);
  return phone !== "" && phone === normalizeLebanesePhone(b.phone_number);
}

function isLater(
  later: InsuranceRenewalCandidate,
  than: InsuranceRenewalCandidate,
): boolean {
  if (later.sale_day !== than.sale_day) return later.sale_day > than.sale_day;
  return later.id > than.id;
}

function isRenewedBy(
  old: InsuranceRenewalCandidate,
  other: InsuranceRenewalCandidate,
): boolean {
  return (
    other.id !== old.id &&
    isLater(other, old) &&
    sameCustomer(old, other) &&
    (old.insurance_type === null ||
      other.insurance_type === old.insurance_type)
  );
}

/**
 * The insurances to remind about on `today`: not dismissed, not renewed by
 * any later candidate (a dismissed later sale still proves the renewal), and
 * expiring within {@link INSURANCE_RENEWAL_WARNING_DAYS} or already expired.
 * Most overdue first, then soonest.
 */
export function selectInsuranceRenewals(
  candidates: readonly InsuranceRenewalCandidate[],
  today: string,
): InsuranceRenewal[] {
  const out: InsuranceRenewal[] = [];
  for (const c of candidates) {
    if (c.renewal_dismissed_at) continue;
    if (candidates.some((other) => isRenewedBy(c, other))) continue;
    const expiry_day = insuranceExpiryDay(c.sale_day);
    const days_left = daysBetweenDateStrings(today, expiry_day);
    if (days_left > INSURANCE_RENEWAL_WARNING_DAYS) continue;
    out.push({
      id: c.id,
      client_id: c.client_id,
      client_name: c.client_name,
      phone_number: c.phone_number,
      description: c.description,
      insurance_type: c.insurance_type,
      sale_day: c.sale_day,
      expiry_day,
      days_left,
    });
  }
  return out.sort((a, b) => a.days_left - b.days_left || a.id - b.id);
}
