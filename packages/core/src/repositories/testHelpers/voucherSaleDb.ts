/**
 * LIRA-339 test helper — the real schema (create_db.sql, via debtItemDb) with
 * the voucher flow's singletons reset, plus readers for the rows a voucher
 * sale / cancel writes. Not a test file (lives outside `__tests__`).
 */
import type Database from "better-sqlite3";
import {
  installDebtItemTestDb,
  uninstallDebtItemTestDb,
  addClient,
  RATE,
} from "./debtItemDb";
import { resetTransactionRepository } from "../TransactionRepository";
import { resetVoucherRepository } from "../VoucherRepository";
import { resetClientRepository } from "../ClientRepository";
import { resetDebtRepository } from "../DebtRepository";
import { resetPaymentMethodRepository } from "../PaymentMethodRepository";
import { resetProfitRepository } from "../ProfitRepository";
import { resetVoucherService } from "../../services/VoucherService";
import { resetProfitService } from "../../services/ProfitService";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";

export { RATE };

/** Client 7 has a name and a phone (may buy on account); client 8 has no
 *  phone (an account leg is refused). */
export const OWNER = 7;
export const OWNER_NO_PHONE = 8;

export function resetVoucherSingletons(): void {
  resetTransactionRepository();
  resetVoucherRepository();
  resetClientRepository();
  resetDebtRepository();
  resetPaymentMethodRepository();
  resetProfitRepository();
  resetProfitService();
  resetVoucherService();
}

export function installVoucherSaleDb(): Database.Database {
  const db = installDebtItemTestDb();
  initFixedTenantContext(1);
  resetVoucherSingletons();
  addClient(db, OWNER, "Jane Owner", "70111222");
  addClient(db, OWNER_NO_PHONE, "No Phone", null);
  return db;
}

export function uninstallVoucherSaleDb(db: Database.Database): void {
  resetVoucherSingletons();
  resetTenantContext();
  uninstallDebtItemTestDb(db);
}

export interface VoucherTxnRow {
  id: number;
  type: string;
  source_table: string;
  source_id: number;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  client_id: number | null;
  client_name: string | null;
  client_phone: string | null;
  metadata_json: string | null;
}

/** Every transaction of `type` written for this voucher (identity match,
 *  rule 15 — never "the newest row"). */
export function voucherTxns(
  db: Database.Database,
  voucherId: number,
  type: "VOUCHER_SALE" | "VOUCHER_CANCEL",
): VoucherTxnRow[] {
  return db
    .prepare(
      `SELECT id, type, source_table, source_id, amount_usd, amount_lbp, profit_usd, profit_lbp,
              client_id, client_name, client_phone, metadata_json
         FROM transactions
        WHERE type = ? AND source_table = 'vouchers' AND source_id = ? AND tenant_id = 1
        ORDER BY id`,
    )
    .all(type, voucherId) as VoucherTxnRow[];
}

export interface PaymentRow {
  method: string;
  drawer_name: string;
  currency_code: string;
  amount: number;
}

export function paymentsOf(
  db: Database.Database,
  transactionId: number,
): PaymentRow[] {
  return db
    .prepare(
      `SELECT method, drawer_name, currency_code, amount FROM payments
        WHERE transaction_id = ? AND tenant_id = 1 ORDER BY id`,
    )
    .all(transactionId) as PaymentRow[];
}

export interface DebtRow {
  client_id: number;
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  transaction_id: number | null;
}

export function debtRowsOf(
  db: Database.Database,
  transactionId: number,
): DebtRow[] {
  return db
    .prepare(
      `SELECT client_id, transaction_type, amount_usd, amount_lbp, transaction_id FROM debt_ledger
        WHERE transaction_id = ? AND tenant_id = 1 ORDER BY id`,
    )
    .all(transactionId) as DebtRow[];
}

const COUNT_SQL = {
  vouchers: "SELECT COUNT(*) AS n FROM vouchers WHERE tenant_id = 1",
  payments: "SELECT COUNT(*) AS n FROM payments WHERE tenant_id = 1",
  debt_ledger: "SELECT COUNT(*) AS n FROM debt_ledger WHERE tenant_id = 1",
} as const;

export function countRows(
  db: Database.Database,
  table: keyof typeof COUNT_SQL,
): number {
  return (db.prepare(COUNT_SQL[table]).get() as { n: number }).n;
}
