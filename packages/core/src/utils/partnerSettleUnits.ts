/**
 * LIRA-346 — partner settle units (specs/346-partner-settle-by-day/spec.md
 * D1–D7). The ONE definition of "what is still open on a partner account,
 * row by row", shared by the calendar reads, the settle-picked-days write,
 * the old balance-based settle and the balance invariant test (rule 14).
 *
 * A UNIT is a group of partner_ledger rows: the original booking (its
 * HEAD, lowest id) plus the rows that reverse or refund it. Two rows are in
 * one group when they have the same `transaction_type` and currency and the
 * same source — the rule `constants/partnerObligation.ts`
 * `sameObligationGroupSql` uses for profit (an item refund reaches the sale
 * through its `transactions` row), extended to rows with NO source: a row
 * with no `reference_*` is its own source `('partner_ledger', id)`, which is
 * exactly what `TransactionRepository._reversePartnerSettlementLedger`
 * writes on the reversal of a settlement or a cash-moved entry.
 *
 * Sign (D1): + = the partner owes the shop (DEBIT), − = the shop owes the
 * partner (CREDIT) — the partner balance's own sign.
 *
 * Coverage (D4): a coverage row consumes `amount` of its `side`: side DEBIT
 * has effect +amount, side CREDIT −amount; remaining = net − Σ effects. The
 * legacy part (pre-v225 `legacy_covered_amount`, D7) is a coverage of the
 * head's own side on obligation heads, matched oldest first against old
 * payer units (settlements, forgives, cash-moved entries) of the other side.
 *
 * Scope: ACCOUNT units are payer units (SETTLEMENT, DISCOUNT, cash-moved
 * manual entries); every other unit is a DAY unit on its head's shop day. A
 * DAY unit covered beyond its net (a void or refund after it was paid) shows
 * its day closed and the excess as an ACCOUNT row, origin VOID; a payer unit
 * left beyond its net by an undo shows origin UNDO. Both sit on the shop day
 * of their latest reversal row (the ↺ mark).
 *
 * Money runs in integer minor units (cents / whole LBP). Pure, no I/O.
 */

export type PartnerCurrency = "USD" | "LBP";
export type PartnerSide = "DEBIT" | "CREDIT";

/** One partner_ledger row as the repository loads it. */
export interface PartnerUnitLedgerRow {
  id: number;
  partner_id: number;
  transaction_type: string | null;
  reference_table: string | null;
  reference_id: number | null;
  /** When `reference_table = 'transactions'`: that transaction's source. */
  tx_source_table: string | null;
  tx_source_id: number | null;
  amount: number;
  currency: string;
  direction: PartnerSide;
  created_at: string;
  /** Normalised `YYYY-MM-DD HH:MM:SS` (UTC) — both stored formats sort right. */
  sort_at: string;
  /** The shop's day of `created_at` (`localDayExpr`, rule 27). */
  shop_day: string;
  /** A manual entry with "Cash moved" (a PARTNER_PAYMENT links to it). */
  is_cash_moved: boolean;
  /** Passes `partnerObligationHeadRowSql` (profit rows). */
  is_obligation_head: boolean;
  legacy_covered_amount: number;
  notes: string | null;
  /** The first unified transaction of the row's source (for labels / ↺). */
  source_txn_id: number | null;
}

/** Active coverage summed per ledger row, currency and side. */
export interface PartnerUnitCoverage {
  partner_ledger_id: number;
  currency: PartnerCurrency;
  side: PartnerSide;
  amount: number;
}

export type PartnerUnitClass = "DAY" | "PAYER";

export interface PartnerSettleUnit {
  /** Head row id: the unit's key everywhere (selections, coverage). */
  id: number;
  partner_id: number;
  currency: PartnerCurrency;
  transaction_type: string | null;
  /** Head's direction. */
  direction: PartnerSide;
  unit_class: PartnerUnitClass;
  reference_table: string | null;
  reference_id: number | null;
  notes: string | null;
  source_txn_id: number | null;
  created_at: string;
  sort_at: string;
  shop_day: string;
  member_ids: number[];
  /** Signed (+ partner owes). */
  net: number;
  /** Signed Σ effects (table + legacy). */
  covered_effect: number;
  /** Signed: net − covered_effect. */
  remaining: number;
  /** Remaining points the other way than the head: a relief (↺). */
  flipped: boolean;
  /** Shop day of the latest reversal row, else the head's. */
  last_reversal_day: string | null;
  /** Σ legacy coverage on its obligation heads (magnitude). */
  legacy_obligation: number;
  /** Σ legacy attributed to this payer unit (magnitude). */
  legacy_attributed: number;
  has_obligation_head: boolean;
}

const minorFactor = (c: PartnerCurrency): number => (c === "USD" ? 100 : 1);
const toMinor = (x: number, c: PartnerCurrency): number =>
  Math.round((x || 0) * minorFactor(c));
const fromMinor = (m: number, c: PartnerCurrency): number =>
  m === 0 ? 0 : m / minorFactor(c);
const sideSign = (side: PartnerSide): 1 | -1 => (side === "DEBIT" ? 1 : -1);

/** The partner_ledger types that PAY (D3): never a day row. */
export const PARTNER_PAYER_TYPES = ["SETTLEMENT", "DISCOUNT"] as const;

/** Is this row a payer row (ACCOUNT): a settlement, a forgive / write-off,
 *  or a manual entry with "Cash moved"? The ONE classification (rule 14). */
export function isPartnerPayerRow(
  row: Pick<PartnerUnitLedgerRow, "transaction_type" | "is_cash_moved">,
): boolean {
  return (
    row.is_cash_moved ||
    (PARTNER_PAYER_TYPES as readonly string[]).includes(
      row.transaction_type ?? "",
    )
  );
}

/** The group key (see the file doc). */
export function partnerUnitGroupKey(row: PartnerUnitLedgerRow): string {
  const type = row.transaction_type ?? "";
  if (row.reference_table === "transactions" && row.tx_source_table) {
    return `${type}|${row.currency}|${row.tx_source_table}|${row.tx_source_id}`;
  }
  if (row.reference_table != null && row.reference_id != null) {
    return `${type}|${row.currency}|${row.reference_table}|${row.reference_id}`;
  }
  return `${type}|${row.currency}|partner_ledger|${row.id}`;
}

function cmp(
  a: { sort_at: string; id: number },
  b: { sort_at: string; id: number },
): number {
  if (a.sort_at !== b.sort_at) return a.sort_at < b.sort_at ? -1 : 1;
  return a.id - b.id;
}

/**
 * Build every USD / LBP unit of the given rows (any partner mix; legacy
 * attribution runs per partner and currency). Rows in other currencies
 * (USDT) are ignored. `payersWithCoverage` = payer head/member ids that
 * wrote at least one coverage row (`settlement_ledger_id`) — they are not
 * legacy payers.
 */
export function buildPartnerSettleUnits(
  rows: readonly PartnerUnitLedgerRow[],
  coverage: readonly PartnerUnitCoverage[],
  payersWithCoverage: ReadonlySet<number> = new Set(),
): PartnerSettleUnit[] {
  const groups = new Map<string, PartnerUnitLedgerRow[]>();
  for (const r of rows) {
    if (r.currency !== "USD" && r.currency !== "LBP") continue;
    const key = `${r.partner_id}#${partnerUnitGroupKey(r)}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const effectByRow = new Map<number, number>(); // minor, signed
  for (const c of coverage) {
    const m = toMinor(c.amount, c.currency) * sideSign(c.side);
    effectByRow.set(
      c.partner_ledger_id,
      (effectByRow.get(c.partner_ledger_id) ?? 0) + m,
    );
  }

  type Work = PartnerSettleUnit & {
    netMinor: number;
    effectMinor: number;
    legacyMinor: number;
    attrMinor: number;
    legacyPayer: boolean;
  };
  const units: Work[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => a.id - b.id);
    const head = members[0];
    const currency = head.currency as PartnerCurrency;
    let netMinor = 0;
    let effectMinor = 0;
    let legacyMinor = 0;
    let lastReversal: PartnerUnitLedgerRow | null = null;
    let hasObligationHead = false;
    for (const m of members) {
      netMinor += toMinor(m.amount, currency) * sideSign(m.direction);
      effectMinor += effectByRow.get(m.id) ?? 0;
      if (m.is_obligation_head) {
        hasObligationHead = true;
        legacyMinor += Math.abs(toMinor(m.legacy_covered_amount, currency));
      }
      if (m.direction !== head.direction) lastReversal = m;
    }
    const payer = isPartnerPayerRow(head);
    units.push({
      id: head.id,
      partner_id: head.partner_id,
      currency,
      transaction_type: head.transaction_type,
      direction: head.direction,
      unit_class: payer ? "PAYER" : "DAY",
      reference_table: head.reference_table,
      reference_id: head.reference_id,
      notes: head.notes,
      source_txn_id: head.source_txn_id,
      created_at: head.created_at,
      sort_at: head.sort_at,
      shop_day: head.shop_day,
      member_ids: members.map((m) => m.id),
      net: 0,
      covered_effect: 0,
      remaining: 0,
      flipped: false,
      last_reversal_day: lastReversal ? lastReversal.shop_day : null,
      legacy_obligation: 0,
      legacy_attributed: 0,
      has_obligation_head: hasObligationHead,
      netMinor,
      effectMinor,
      legacyMinor,
      attrMinor: 0,
      legacyPayer: payer && !members.some((m) => payersWithCoverage.has(m.id)),
    });
  }

  // Legacy (D7): Σ legacy on obligation heads of side S, per partner and
  // currency, is matched oldest first against legacy payer units of the
  // other side, each up to its own net in its own direction.
  const pools = new Map<string, number>();
  for (const u of units) {
    if (u.legacyMinor === 0) continue;
    const key = `${u.partner_id}|${u.currency}|${u.direction}`;
    pools.set(key, (pools.get(key) ?? 0) + u.legacyMinor);
  }
  if (pools.size > 0) {
    const payers = units.filter((u) => u.legacyPayer).sort(cmp);
    for (const p of payers) {
      const other: PartnerSide = p.direction === "DEBIT" ? "CREDIT" : "DEBIT";
      const key = `${p.partner_id}|${p.currency}|${other}`;
      const pool = pools.get(key) ?? 0;
      if (pool <= 0) continue;
      const own = Math.max(0, p.netMinor * sideSign(p.direction));
      const take = Math.min(pool, own);
      p.attrMinor = take;
      pools.set(key, pool - take);
    }
  }

  return units.map((u) => {
    const legacyEffect =
      (u.legacyMinor + u.attrMinor) * sideSign(u.direction);
    const effect = u.effectMinor + legacyEffect;
    const remaining = u.netMinor - effect;
    const headSign = sideSign(u.direction);
    const {
      netMinor,
      effectMinor: _e,
      legacyMinor,
      attrMinor,
      legacyPayer: _l,
      ...rest
    } = u;
    void _e;
    void _l;
    return {
      ...rest,
      net: fromMinor(netMinor, u.currency),
      covered_effect: fromMinor(effect, u.currency),
      remaining: fromMinor(remaining, u.currency),
      flipped: remaining !== 0 && Math.sign(remaining) !== headSign,
      legacy_obligation: fromMinor(legacyMinor, u.currency),
      legacy_attributed: fromMinor(attrMinor, u.currency),
    };
  });
}

/** Is the unit open (remaining ≠ 0 in minor units)? */
export function isPartnerUnitOpen(u: PartnerSettleUnit): boolean {
  return toMinor(u.remaining, u.currency) !== 0;
}

/** Where an open unit sits: a DAY unit on its day unless it flipped. */
export function partnerUnitScope(u: PartnerSettleUnit): "DAY" | "ACCOUNT" {
  return u.unit_class === "DAY" && !u.flipped ? "DAY" : "ACCOUNT";
}

/** The coverage side that consumes this unit's current remaining. */
export function partnerCoverSide(remaining: number): PartnerSide {
  return remaining > 0 ? "DEBIT" : "CREDIT";
}

/** Signed effect of a coverage row (D4). */
export function partnerCoverageEffect(side: PartnerSide, amount: number): number {
  return sideSign(side) * amount;
}
