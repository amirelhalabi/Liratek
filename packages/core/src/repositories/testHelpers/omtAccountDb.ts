/**
 * LIRA-322 — shared fixture for the OMT account settlement tests: a full
 * database (create_db.sql + migrations, so `supplier_settlement_coverage`
 * exists) with the seeded OMT account (OMT counter parent, OMT App and
 * iPick children, linked by create_db.sql's own v176 seed).
 *
 * Rows are seeded directly, the way the real writers book them: an OMT
 * SEND `financial_services` row plus its auto TOP_UP `supplier_ledger`
 * sibling (`source_ref_table = 'financial_services'`).
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetFinancialServiceRepository } from "../FinancialServiceRepository";
import { resetSupplierRepository } from "../SupplierRepository";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

export const USER_ID = 1;

export function buildDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
  initDatabase(db);
  runMigrations(db);
  return db;
}

export function resetAll(): void {
  resetTransactionRepository();
  resetFinancialServiceRepository();
  resetSupplierRepository();
}

export interface OmtAccount {
  omtId: number;
  appId: number;
  ipickId: number;
}

function supplierId(db: Database.Database, provider: string): number {
  const row = db
    .prepare(`SELECT id FROM suppliers WHERE tenant_id = 1 AND provider = ?`)
    .get(provider) as { id: number } | undefined;
  if (!row) throw new Error(`fixture: no ${provider} supplier`);
  return row.id;
}

export function omtAccount(db: Database.Database): OmtAccount {
  const acc = {
    omtId: supplierId(db, "OMT"),
    appId: supplierId(db, "OMT_APP"),
    ipickId: supplierId(db, "iPick"),
  };
  const linked = db
    .prepare(
      `SELECT COUNT(*) AS n FROM suppliers WHERE tenant_id = 1 AND account_supplier_id = ? AND id IN (?, ?)`,
    )
    .get(acc.omtId, acc.appId, acc.ipickId) as { n: number };
  if (linked.n !== 2) throw new Error("fixture: OMT account is not linked");
  return acc;
}

/** A pending OMT SEND plus the TOP_UP ledger sibling its writer books
 *  (model 1: gross = amount + fee). Returns the financial_services id. */
export function seedOmtSend(
  db: Database.Database,
  omtId: number,
  data: {
    amount: number;
    fee?: number;
    currency?: "USD" | "LBP";
    model?: 0 | 1;
    commission?: number;
    type?: string;
    created_at?: string;
    /** LIRA-345 — another transfer provider (e.g. 'WHISH'); default 'OMT'.
     *  The ledger sibling goes on `omtId`, so pass that provider's supplier. */
    provider?: string;
  },
): number {
  const fee = data.fee ?? 0;
  const model = data.model ?? 1;
  const currency = data.currency ?? "USD";
  const commission = data.commission ?? 0;
  const createdAt = data.created_at ?? "2026-10-01 09:00:00";
  const id = Number(
    db
      .prepare(
        `INSERT INTO financial_services
           (tenant_id, provider, service_type, amount, currency, commission, omt_fee,
            omt_service_type, commission_model, is_settled, created_by, created_at)
         VALUES (1, ?, 'SEND', ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
      )
      .run(
        data.provider ?? "OMT",
        data.amount,
        currency,
        commission,
        fee,
        data.type ?? "INTRA",
        model,
        createdAt,
      ).lastInsertRowid,
  );
  const owed = data.amount + fee - (model === 0 ? commission : 0);
  db.prepare(
    `INSERT INTO supplier_ledger
       (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, is_auto,
        source_ref_table, source_ref_id, created_by, created_at)
     VALUES (1, ?, 'TOP_UP', ?, ?, 1, 'financial_services', ?, 1, ?)`,
  ).run(
    omtId,
    currency === "USD" ? owed : 0,
    currency === "LBP" ? owed : 0,
    id,
    createdAt,
  );
  return id;
}

/** A raw open ledger row on an account member (e.g. an OMT App cash-out
 *  credit: negative). Returns the supplier_ledger id. */
export function seedLedgerRow(
  db: Database.Database,
  supplierIdValue: number,
  data: {
    entry_type: string;
    amount_usd?: number;
    amount_lbp?: number;
    created_at?: string;
  },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO supplier_ledger
           (tenant_id, supplier_id, entry_type, amount_usd, amount_lbp, created_by, created_at)
         VALUES (1, ?, ?, ?, ?, 1, ?)`,
      )
      .run(
        supplierIdValue,
        data.entry_type,
        data.amount_usd ?? 0,
        data.amount_lbp ?? 0,
        data.created_at ?? "2026-10-01 08:00:00",
      ).lastInsertRowid,
  );
}

/** Give a drawer enough money for the settlement's legs. */
export function fundDrawer(
  db: Database.Database,
  drawerName: string,
  currency: "USD" | "LBP",
  balance: number,
): void {
  db.prepare(
    `INSERT INTO drawer_balances (tenant_id, drawer_name, currency_code, balance)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(tenant_id, drawer_name, currency_code) DO UPDATE SET balance = excluded.balance`,
  ).run(drawerName, currency, balance);
}

// ── LIRA-322 Phase 3+ — snapshots for delta assertions (rule 15) ──────────

export interface CurrencyPair {
  usd: number;
  lbp: number;
}

/** Ledger balance of one member, non-voided rows, per currency. */
export function memberBalance(
  db: Database.Database,
  supplierIdValue: number,
): CurrencyPair {
  return db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS usd, COALESCE(SUM(amount_lbp), 0) AS lbp
         FROM supplier_ledger
        WHERE tenant_id = 1 AND supplier_id = ? AND COALESCE(is_refunded, 0) = 0`,
    )
    .get(supplierIdValue) as CurrencyPair;
}

/** Sum of every drawer, per currency. */
export function drawerTotals(db: Database.Database): CurrencyPair {
  const rows = db
    .prepare(
      `SELECT currency_code AS c, COALESCE(SUM(balance), 0) AS b
         FROM drawer_balances WHERE tenant_id = 1 GROUP BY currency_code`,
    )
    .all() as Array<{ c: string; b: number }>;
  return {
    usd: rows.find((r) => r.c === "USD")?.b ?? 0,
    lbp: rows.find((r) => r.c === "LBP")?.b ?? 0,
  };
}

/** ACTIVE profit stamped on transactions, per currency. */
export function profitTotals(db: Database.Database): CurrencyPair {
  return db
    .prepare(
      `SELECT COALESCE(SUM(profit_usd), 0) AS usd, COALESCE(SUM(profit_lbp), 0) AS lbp
         FROM transactions WHERE tenant_id = 1 AND status = 'ACTIVE'`,
    )
    .get() as CurrencyPair;
}

export interface CoverageRow {
  transaction_id: number;
  anchor_ledger_id: number;
  row_kind: string;
  row_id: number;
  member_supplier_id: number;
  currency: string;
  amount: number;
  source: string;
  closes_row: number;
  is_reversed: number;
}

export function coverageRows(db: Database.Database): CoverageRow[] {
  return db
    .prepare(
      `SELECT transaction_id, anchor_ledger_id, row_kind, row_id, member_supplier_id,
              currency, amount, source, closes_row, is_reversed
         FROM supplier_settlement_coverage WHERE tenant_id = 1 ORDER BY id`,
    )
    .all() as CoverageRow[];
}

/** Row counts of every table a settlement writes (for "nothing written"). */
export function writeCounts(db: Database.Database): Record<string, number> {
  const tables = [
    "supplier_ledger",
    "transactions",
    "payments",
    "supplier_settlement_coverage",
    "supplier_settlements",
    "settlement_commission_allocations",
  ];
  const out: Record<string, number> = {};
  for (const t of tables) {
    out[t] = (
      db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE tenant_id = 1`).get() as { n: number }
    ).n;
  }
  return out;
}

/** The SUPPLIER_SETTLEMENT transaction a settle call returned the anchor of. */
export function settlementTxn(
  db: Database.Database,
  anchorLedgerId: number,
): {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  metadata_json: string;
  status: string;
} {
  const row = db
    .prepare(
      `SELECT id, amount_usd, amount_lbp, profit_usd, profit_lbp, metadata_json, status
         FROM transactions
        WHERE tenant_id = 1 AND type = 'SUPPLIER_SETTLEMENT'
          AND source_table = 'supplier_ledger' AND source_id = ? AND reverses_id IS NULL`,
    )
    .get(anchorLedgerId) as ReturnType<typeof settlementTxn> | undefined;
  if (!row) throw new Error(`no settlement transaction for anchor ${anchorLedgerId}`);
  return row;
}
