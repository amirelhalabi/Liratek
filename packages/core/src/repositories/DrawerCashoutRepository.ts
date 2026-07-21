import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";

export interface DrawerCashoutEntity {
  id: number;
  amount_usd: number;
  amount_lbp: number;
  notes: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDrawerCashoutData {
  amount_usd: number;
  amount_lbp: number;
  notes: string;
  transaction_time?: string;
}

export const GENERAL_DRAWER = "General";
const CASHOUT_METHOD = "CASH";

export class DrawerCashoutRepository extends BaseRepository<DrawerCashoutEntity> {
  constructor() {
    super("drawer_cashouts");
  }

  protected getColumns(): string {
    return "id, amount_usd, amount_lbp, notes, created_by, created_at, updated_at";
  }

  /**
   * Current General-drawer balance for one currency. A missing
   * drawer_balances row (drawer never funded in that currency) is treated as
   * 0 — never fabricated as a phantom negative balance.
   */
  private getGeneralBalance(currencyCode: string, tenantId: number): number {
    const row = this.db
      .prepare(
        `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?`,
      )
      .get(GENERAL_DRAWER, currencyCode, tenantId) as
      | { balance: number }
      | undefined;
    return row?.balance ?? 0;
  }

  /**
   * Create a drawer cash-out in a single transaction.
   * Mirrors DrawerTopUpRepository.createTopUp with the sign flipped
   * (ExpenseRepository's outflow sign convention: negative amount_usd/
   * amount_lbp on the unified transaction row, negative payments leg,
   * negative applyDrawerDelta).
   *
   * The insufficient-funds guard runs FIRST, inside the same db transaction,
   * before any row is written — and checks BOTH currencies before writing
   * anything, so a USD-OK/LBP-short request writes nothing at all.
   */
  createCashout(
    data: CreateDrawerCashoutData,
    userId: number,
    transactionTime?: string,
  ): number {
    const txTime = transactionTime ?? data.transaction_time;
    const tenantId = getCurrentTenantId();
    return this.db.transaction(() => {
      // 1. Insufficient-funds guard — before any write, both currencies.
      if (data.amount_usd && data.amount_usd > 0) {
        const balance = this.getGeneralBalance("USD", tenantId);
        if (data.amount_usd > balance) {
          throw new Error(
            `Insufficient funds in General drawer: requested $${data.amount_usd.toFixed(2)} USD, available $${balance.toFixed(2)} USD`,
          );
        }
      }
      if (data.amount_lbp && data.amount_lbp > 0) {
        const balance = this.getGeneralBalance("LBP", tenantId);
        if (data.amount_lbp > balance) {
          throw new Error(
            `Insufficient funds in General drawer: requested ${Math.round(data.amount_lbp).toLocaleString()} LBP, available ${Math.round(balance).toLocaleString()} LBP`,
          );
        }
      }

      // 2. Insert into drawer_cashouts
      const insertCashout = this.db.prepare(`
        INSERT INTO drawer_cashouts (tenant_id, amount_usd, amount_lbp, notes, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      `);
      const result = insertCashout.run(
        tenantId,
        data.amount_usd,
        data.amount_lbp,
        data.notes,
        userId,
        txTime ?? null,
      );
      const cashoutId = Number(result.lastInsertRowid);

      // 3. Create unified transaction row — NEGATIVE amounts, per the
      // Expense outflow sign convention: cash leaving the shop.
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.DRAWER_CASHOUT,
        source_table: "drawer_cashouts",
        source_id: cashoutId,
        user_id: userId,
        amount_usd: -(data.amount_usd || 0),
        amount_lbp: -(data.amount_lbp || 0),
        summary: `Cash Out: General - ${data.notes}`,
        metadata_json: {
          drawer: GENERAL_DRAWER,
          notes: data.notes,
        },
        transaction_time: txTime,
      });

      const note = `Cash Out${data.notes ? `: ${data.notes}` : ""}`;

      // 4. USD outflow
      if (data.amount_usd && data.amount_usd > 0) {
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: CASHOUT_METHOD,
          drawerName: GENERAL_DRAWER,
          currencyCode: "USD",
          amount: -data.amount_usd,
          note,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: GENERAL_DRAWER,
          currencyCode: "USD",
          delta: -data.amount_usd,
          tenantId,
        });
      }

      // 5. LBP outflow
      if (data.amount_lbp && data.amount_lbp > 0) {
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: CASHOUT_METHOD,
          drawerName: GENERAL_DRAWER,
          currencyCode: "LBP",
          amount: -data.amount_lbp,
          note,
          createdBy: userId,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: GENERAL_DRAWER,
          currencyCode: "LBP",
          delta: -data.amount_lbp,
          tenantId,
        });
      }

      return cashoutId;
    })();
  }

  /**
   * Get recent cash-out history ordered by most recent first.
   */
  getHistory(limit: number = 50): DrawerCashoutEntity[] {
    return this.db
      .prepare(
        `SELECT id, amount_usd, amount_lbp, notes, created_by, created_at, updated_at
         FROM drawer_cashouts
         WHERE tenant_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(getCurrentTenantId(), limit) as DrawerCashoutEntity[];
  }
}

// Singleton instance
let drawerCashoutRepositoryInstance: DrawerCashoutRepository | null = null;

export function getDrawerCashoutRepository(): DrawerCashoutRepository {
  if (!drawerCashoutRepositoryInstance) {
    drawerCashoutRepositoryInstance = new DrawerCashoutRepository();
  }
  return drawerCashoutRepositoryInstance;
}

export function resetDrawerCashoutRepository(): void {
  drawerCashoutRepositoryInstance = null;
}
