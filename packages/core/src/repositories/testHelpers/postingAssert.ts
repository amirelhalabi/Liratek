/**
 * Posting assertions for multi-ledger transactions (POSTING_INTEGRITY_PLAN.md §3 item 1.1).
 *
 * One shop action writes records into several ledgers at once (drawers,
 * supplier ledger, partner ledger, customer account). A branch that forgets
 * one of them fails no test unless the test checks EVERY ledger — which is
 * what this helper does:
 *
 *   const before = snapshotLedgers(db);
 *   repo.createTransaction(...);
 *   expectPostings(before, snapshotLedgers(db), {
 *     supplier: { [`${omtId}|USD`]: 105 },
 *     partner: { [`${partnerId}|USD`]: 105 },
 *   });
 *
 * `expectPostings` compares the FULL delta: a ledger left out of `expected`
 * must not move at all, so a missing posting and an unexpected extra posting
 * both fail. Pair it with a void and `expectPostings(before, after, {})` to
 * prove rule 20 (every ledger nets back to zero, per currency).
 *
 * Balance definitions mirror the repositories (docs/POSTING_MAP.md §2):
 *   - drawers:  drawer_balances.balance, keyed "drawer|currency"
 *   - supplier: Σ amount_usd / amount_lbp over non-refunded supplier_ledger
 *               rows, keyed "supplierId|USD" / "supplierId|LBP" (> 0 = shop owes)
 *   - partner:  Σ DEBIT − Σ CREDIT per currency, keyed "partnerId|currency"
 *               (> 0 = partner owes the shop)
 *   - debt:     Σ amount_usd / amount_lbp per client, keyed "clientId|USD" /
 *               "clientId|LBP" (> 0 = client owes the shop)
 * A table missing from a hand-rolled test schema contributes nothing.
 */
import type Database from "better-sqlite3";

export type LedgerName = "drawers" | "supplier" | "partner" | "debt";
export type LedgerBalances = Record<string, number>;
export type LedgerSnapshot = Record<LedgerName, LedgerBalances>;
export type ExpectedPostings = Partial<Record<LedgerName, LedgerBalances>>;

const LEDGERS: LedgerName[] = ["drawers", "supplier", "partner", "debt"];

function hasTable(db: Database.Database, table: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
}

function hasColumn(
  db: Database.Database,
  table: string,
  column: string,
): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  return cols.some((c) => c.name === column);
}

function usdLbpRows(
  rows: { id: number; usd: number; lbp: number }[],
): LedgerBalances {
  const out: LedgerBalances = {};
  for (const r of rows) {
    if (r.usd) out[`${r.id}|USD`] = r.usd;
    if (r.lbp) out[`${r.id}|LBP`] = r.lbp;
  }
  return out;
}

export function snapshotLedgers(db: Database.Database): LedgerSnapshot {
  const drawers: LedgerBalances = {};
  if (hasTable(db, "drawer_balances")) {
    const rows = db
      /* tenant-exempt: test-only helper — sums whole in-memory test databases to compare ledger snapshots */
      .prepare(
        "SELECT drawer_name, currency_code, balance FROM drawer_balances",
      )
      .all() as {
      drawer_name: string;
      currency_code: string;
      balance: number;
    }[];
    for (const r of rows) {
      drawers[`${r.drawer_name}|${r.currency_code}`] = r.balance;
    }
  }

  let supplier: LedgerBalances = {};
  if (hasTable(db, "supplier_ledger")) {
    const notRefunded = hasColumn(db, "supplier_ledger", "is_refunded")
      ? "WHERE COALESCE(is_refunded, 0) = 0"
      : "";
    supplier = usdLbpRows(
      db
        /* tenant-exempt: test-only helper — sums whole in-memory test databases to compare ledger snapshots */
        .prepare(
          `SELECT supplier_id AS id, SUM(amount_usd) AS usd, SUM(amount_lbp) AS lbp
             FROM supplier_ledger ${notRefunded}
            GROUP BY supplier_id`,
        )
        .all() as { id: number; usd: number; lbp: number }[],
    );
  }

  const partner: LedgerBalances = {};
  if (hasTable(db, "partner_ledger")) {
    const rows = db
      /* tenant-exempt: test-only helper — sums whole in-memory test databases to compare ledger snapshots */
      .prepare(
        `SELECT partner_id, currency,
                SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) AS balance
           FROM partner_ledger
          GROUP BY partner_id, currency`,
      )
      .all() as { partner_id: number; currency: string; balance: number }[];
    for (const r of rows) {
      if (r.balance) partner[`${r.partner_id}|${r.currency}`] = r.balance;
    }
  }

  let debt: LedgerBalances = {};
  if (hasTable(db, "debt_ledger")) {
    debt = usdLbpRows(
      db
        /* tenant-exempt: test-only helper — sums whole in-memory test databases to compare ledger snapshots */
        .prepare(
          `SELECT client_id AS id, SUM(amount_usd) AS usd, SUM(amount_lbp) AS lbp
             FROM debt_ledger
            GROUP BY client_id`,
        )
        .all() as { id: number; usd: number; lbp: number }[],
    );
  }

  return { drawers, supplier, partner, debt };
}

/** Non-zero per-key deltas, rounded to 6 decimals (money is never finer). */
export function ledgerDeltas(
  before: LedgerSnapshot,
  after: LedgerSnapshot,
): LedgerSnapshot {
  const out = {} as LedgerSnapshot;
  for (const ledger of LEDGERS) {
    const keys = new Set([
      ...Object.keys(before[ledger]),
      ...Object.keys(after[ledger]),
    ]);
    const delta: LedgerBalances = {};
    for (const k of keys) {
      const d =
        Math.round(
          ((after[ledger][k] ?? 0) - (before[ledger][k] ?? 0)) * 1e6,
        ) / 1e6;
      if (d !== 0) delta[k] = d;
    }
    out[ledger] = delta;
  }
  return out;
}

/**
 * Asserts the EXACT set of postings between two snapshots. Every ledger not
 * named in `expected` must be unchanged.
 */
export function expectPostings(
  before: LedgerSnapshot,
  after: LedgerSnapshot,
  expected: ExpectedPostings,
): void {
  const want = {} as LedgerSnapshot;
  for (const ledger of LEDGERS) want[ledger] = expected[ledger] ?? {};
  expect(ledgerDeltas(before, after)).toEqual(want);
}
