/**
 * LIRA-304 test helper — the real schema (`electron-app/create_db.sql`, the
 * same file every fresh desktop install runs) installed as the process test
 * database, plus seeding helpers for customer debts in the two shapes the
 * shop creates them:
 *
 *   - separate visits: one charge row per item (`'Service Debt'`, `'Loto
 *     Debt'`, …) or an unpaid sale, each linked to its own transaction;
 *   - a session basket checked out on Customer Account, booked by the REAL
 *     `SessionPaymentService.recordBasketPayment` (one `'Session Debt'` row
 *     for the whole basket).
 *
 * Not a test file (lives outside `__tests__`), so jest never runs it alone.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

type TestGlobal = typeof globalThis & {
  __LIRATEK_TEST_DB__?: Database.Database;
};

const CREATE_DB_SQL = fs.readFileSync(
  path.join(__dirname, "../../../../../electron-app/create_db.sql"),
  "utf8",
);

/** Fixed rate used by every LIRA-304 test (sell = buy = market). */
export const RATE = 89_000;

/** A fresh in-memory database with the full schema, installed as
 *  `getDatabase()`. Exchange rates are pinned to `RATE`; the shop's primary
 *  system defaults to OMT (create_db.sql seed). */
export function installDebtItemTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(CREATE_DB_SQL);
  db.prepare(
    `UPDATE exchange_rates SET market_rate = ?, buy_rate = ?, sell_rate = ? WHERE to_code = 'LBP' AND tenant_id = 1`,
  ).run(RATE, RATE, RATE);
  (globalThis as TestGlobal).__LIRATEK_TEST_DB__ = db;
  return db;
}

export function uninstallDebtItemTestDb(db: Database.Database): void {
  delete (globalThis as TestGlobal).__LIRATEK_TEST_DB__;
  db.close();
}

export function setBaseSystem(
  db: Database.Database,
  system: "OMT" | "WHISH",
): void {
  db.prepare(
    `UPDATE system_settings SET value = ? WHERE key_name = 'shop_base_system' AND tenant_id = 1`,
  ).run(system);
}

export function addClient(
  db: Database.Database,
  id: number,
  name = `Client ${id}`,
  phone: string | null = null,
): void {
  db.prepare(
    `INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (?, 1, ?, ?)`,
  ).run(id, name, phone);
}

export function drawer(
  db: Database.Database,
  name: string,
  currency: "USD" | "LBP",
): number {
  const row = db
    .prepare(
      `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = 1`,
    )
    .get(name, currency) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/** Every drawer's balance, keyed "drawer|currency" (zero rows omitted). */
export function drawers(db: Database.Database): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT drawer_name, currency_code, balance FROM drawer_balances WHERE tenant_id = 1`,
    )
    .all() as Array<{
    drawer_name: string;
    currency_code: string;
    balance: number;
  }>;
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (Math.abs(r.balance) > 1e-9) {
      out[`${r.drawer_name}|${r.currency_code}`] = r.balance;
    }
  }
  return out;
}

/** Drawer deltas between two `drawers()` snapshots (unchanged keys omitted). */
export function drawerDelta(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: Record<string, number> = {};
  for (const k of keys) {
    const d = (after[k] ?? 0) - (before[k] ?? 0);
    if (Math.abs(d) > 1e-6) out[k] = Math.round(d * 100) / 100;
  }
  return out;
}

let clock = 0;
/** Strictly increasing timestamps so "oldest first" is deterministic. */
export function nextTime(): string {
  clock += 1;
  const d = new Date(Date.UTC(2026, 9, 1, 8, 0, clock));
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function insertTxn(
  db: Database.Database,
  t: {
    type: string;
    sourceTable: string;
    sourceId: number;
    clientId: number | null;
    usd: number;
    lbp: number;
    profitUsd?: number;
    profitLbp?: number;
    createdAt: string;
  },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id,
           amount_usd, amount_lbp, profit_usd, profit_lbp, exchange_rate, client_id, created_at)
         VALUES (1, ?, 'ACTIVE', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.type,
        t.sourceTable,
        t.sourceId,
        t.usd,
        t.lbp,
        t.profitUsd ?? 0,
        t.profitLbp ?? 0,
        RATE,
        t.clientId,
        t.createdAt,
      ).lastInsertRowid,
  );
}

export interface SeededTransfer {
  fsId: number;
  txnId: number;
  debtRowId: number;
}

/** A standalone OMT/WHISH/wallet SEND put on the customer's account: a
 *  `financial_services` row, its FINANCIAL_SERVICE transaction and a
 *  `'Service Debt'` row linked to that transaction (the shape
 *  `bookClientDebtCharge` writes). */
export function seedTransferDebt(
  db: Database.Database,
  o: {
    clientId: number;
    provider: "OMT" | "WHISH" | "OMT_APP" | "WHISH_APP" | "BINANCE";
    usd?: number;
    lbp?: number;
    profitUsd?: number;
  },
): SeededTransfer {
  const createdAt = nextTime();
  const usd = o.usd ?? 0;
  const lbp = o.lbp ?? 0;
  const fsId = Number(
    db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, created_at)
         VALUES (1, ?, 'SEND', ?, ?, ?)`,
      )
      .run(o.provider, usd || lbp, usd ? "USD" : "LBP", createdAt)
      .lastInsertRowid,
  );
  const txnId = insertTxn(db, {
    type: "FINANCIAL_SERVICE",
    sourceTable: "financial_services",
    sourceId: fsId,
    clientId: o.clientId,
    usd,
    lbp,
    profitUsd: o.profitUsd ?? 0,
    createdAt,
  });
  const debtRowId = Number(
    db
      .prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp,
           transaction_id, created_by, created_at)
         VALUES (1, ?, 'Service Debt', ?, ?, ?, 1, ?)`,
      )
      .run(o.clientId, usd, lbp, txnId, createdAt).lastInsertRowid,
  );
  return { fsId, txnId, debtRowId };
}

/** A standalone module charge on account other than a transfer (Loto,
 *  Recharge, …): a transaction plus its `'<Module> Debt'` row. */
export function seedChargeDebt(
  db: Database.Database,
  o: {
    clientId: number;
    debtType: "Loto Debt" | "Recharge Debt" | "Custom Service Debt";
    txnType: string;
    usd?: number;
    lbp?: number;
    profitUsd?: number;
    profitLbp?: number;
  },
): { txnId: number; debtRowId: number } {
  const createdAt = nextTime();
  const txnId = insertTxn(db, {
    type: o.txnType,
    sourceTable: "manual_test_source",
    sourceId: 1,
    clientId: o.clientId,
    usd: o.usd ?? 0,
    lbp: o.lbp ?? 0,
    profitUsd: o.profitUsd,
    profitLbp: o.profitLbp,
    createdAt,
  });
  const debtRowId = Number(
    db
      .prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp,
           transaction_id, created_by, created_at)
         VALUES (1, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(o.clientId, o.debtType, o.usd ?? 0, o.lbp ?? 0, txnId, createdAt)
      .lastInsertRowid,
  );
  return { txnId, debtRowId };
}

/** A standalone POS sale left unpaid on the account: a `sales` row with
 *  `paid_usd = 0`, its SALE transaction and the `'Sale Debt'` row. */
export function seedSaleDebt(
  db: Database.Database,
  o: { clientId: number; usd: number; profitUsd?: number },
): { saleId: number; txnId: number; debtRowId: number } {
  const createdAt = nextTime();
  const saleId = Number(
    db
      .prepare(
        `INSERT INTO sales (tenant_id, client_id, total_amount_usd, final_amount_usd, paid_usd,
           exchange_rate_snapshot, status, created_at)
         VALUES (1, ?, ?, ?, 0, ?, 'completed', ?)`,
      )
      .run(o.clientId, o.usd, o.usd, RATE, createdAt).lastInsertRowid,
  );
  const txnId = insertTxn(db, {
    type: "SALE",
    sourceTable: "sales",
    sourceId: saleId,
    clientId: o.clientId,
    usd: o.usd,
    lbp: 0,
    profitUsd: o.profitUsd ?? 0,
    createdAt,
  });
  const debtRowId = Number(
    db
      .prepare(
        `INSERT INTO debt_ledger (tenant_id, client_id, transaction_type, amount_usd, amount_lbp,
           transaction_id, created_by, created_at)
         VALUES (1, ?, 'Sale Debt', ?, 0, ?, 1, ?)`,
      )
      .run(o.clientId, o.usd, txnId, createdAt).lastInsertRowid,
  );
  return { saleId, txnId, debtRowId };
}

export type BasketItem =
  | {
      kind: "transfer";
      provider: "OMT" | "WHISH" | "OMT_APP" | "WHISH_APP" | "BINANCE";
      usd?: number;
      lbp?: number;
      profitUsd?: number;
    }
  | { kind: "sale"; usd: number; profitUsd?: number }
  | { kind: "loto"; lbp: number; profitLbp?: number }
  /** LIRA-349 — an MTC/Alfa recharge priced in LBP (the session cart links
   *  recharges in LBP). */
  | { kind: "recharge"; lbp: number; profitLbp?: number };

export interface SeededBasket {
  sessionId: number;
  /** One per item, in the order given: the member link row id and its
   *  unified transaction id. */
  members: Array<{ cstId: number; txnId: number }>;
}

/** Create a session with the given items as deferred members (the shape
 *  `SessionCheckoutService` leaves them in before the pooled payment), ready
 *  for `SessionPaymentService.recordBasketPayment`. */
export function seedBasketMembers(
  db: Database.Database,
  clientId: number,
  items: BasketItem[],
): SeededBasket {
  const client = db
    .prepare(`SELECT full_name, phone_number FROM clients WHERE id = ? AND tenant_id = 1`)
    .get(clientId) as { full_name: string; phone_number: string | null };
  const sessionId = Number(
    db
      .prepare(
        `INSERT INTO customer_sessions (tenant_id, customer_name, customer_phone, started_by, is_active)
         VALUES (1, ?, ?, 'admin', 1)`,
      )
      .run(client.full_name, client.phone_number).lastInsertRowid,
  );
  const members: SeededBasket["members"] = [];
  for (const item of items) {
    const createdAt = nextTime();
    let txnId: number;
    let sourceId: number;
    let cstType: string;
    let usd = 0;
    let lbp = 0;
    if (item.kind === "transfer") {
      usd = item.usd ?? 0;
      lbp = item.lbp ?? 0;
      sourceId = Number(
        db
          .prepare(
            `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, created_at)
             VALUES (1, ?, 'SEND', ?, ?, ?)`,
          )
          .run(item.provider, usd || lbp, usd ? "USD" : "LBP", createdAt)
          .lastInsertRowid,
      );
      txnId = insertTxn(db, {
        type: "FINANCIAL_SERVICE",
        sourceTable: "financial_services",
        sourceId,
        clientId,
        usd,
        lbp,
        profitUsd: item.profitUsd ?? 0,
        createdAt,
      });
      cstType = item.provider.toLowerCase();
    } else if (item.kind === "sale") {
      usd = item.usd;
      sourceId = Number(
        db
          .prepare(
            `INSERT INTO sales (tenant_id, client_id, total_amount_usd, final_amount_usd, paid_usd,
               exchange_rate_snapshot, status, created_at)
             VALUES (1, ?, ?, ?, 0, ?, 'completed', ?)`,
          )
          .run(clientId, usd, usd, RATE, createdAt).lastInsertRowid,
      );
      txnId = insertTxn(db, {
        type: "SALE",
        sourceTable: "sales",
        sourceId,
        clientId,
        usd,
        lbp: 0,
        profitUsd: item.profitUsd ?? 0,
        createdAt,
      });
      cstType = "sale";
    } else if (item.kind === "recharge") {
      lbp = item.lbp;
      sourceId = 1;
      txnId = insertTxn(db, {
        type: "RECHARGE",
        sourceTable: "recharges",
        sourceId,
        clientId,
        usd: 0,
        lbp,
        profitLbp: item.profitLbp ?? 0,
        createdAt,
      });
      cstType = "recharge_mtc";
    } else {
      lbp = item.lbp;
      sourceId = 1;
      txnId = insertTxn(db, {
        type: "LOTO",
        sourceTable: "loto_tickets",
        sourceId,
        clientId,
        usd: 0,
        lbp,
        profitLbp: item.profitLbp ?? 0,
        createdAt,
      });
      cstType = "loto";
    }
    const cstId = Number(
      db
        .prepare(
          `INSERT INTO customer_session_transactions (tenant_id, session_id, transaction_type,
             transaction_id, unified_transaction_id, amount_usd, amount_lbp, created_at)
           VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(sessionId, cstType, sourceId, txnId, usd, lbp, createdAt)
        .lastInsertRowid,
    );
    members.push({ cstId, txnId });
  }
  return { sessionId, members };
}

/** The basket's `'Session Debt'` row (the original charge). */
export function sessionDebtRow(
  db: Database.Database,
  sessionId: number,
): {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  covered_usd: number;
  covered_lbp: number;
} {
  return db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, covered_usd, covered_lbp FROM debt_ledger
       WHERE session_id = ? AND tenant_id = 1 AND transaction_type = 'Session Debt' AND transaction_id IS NULL`,
    )
    .get(sessionId) as {
    id: number;
    amount_usd: number;
    amount_lbp: number;
    covered_usd: number;
    covered_lbp: number;
  };
}
