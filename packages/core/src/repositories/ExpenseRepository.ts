import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
} from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import { applyDrawerDelta, insertPaymentRow } from "./moneyPosting.js";

export interface ExpenseEntity {
  id: number;
  description: string;
  category: string;
  paid_by_method?: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
  note: string | null;
  status?: string;
  created_at?: string;
  updated_at?: string;
  edited_by: string | null;
  edited_at: string | null;
  /** LIRA-131: set by `TransactionRepository._markSourceRefunded` when the
   *  unified transaction sourced from this row is voided/refunded —
   *  `expenses` is in its supported-tables whitelist. Was written by the
   *  reversal path but never projected here, so the Expenses history
   *  modal's existing "Refunded" badge (`expenses/pages/Expenses
   *  /components/HistoryModal.tsx`, gated on `expense.is_refunded`) stayed
   *  dormant. */
  is_refunded: number;
  refunded_at: string | null;
}

/**
 * Route this expense's single drawer leg to an EXPLICIT drawer/currency
 * instead of the one `paymentMethodToDrawerName(paid_by_method)` resolves
 * (LIRA-145 carrier-line usage).
 *
 * Exists because some expenses are paid out of a stock of value the shop
 * already holds in a PROVIDER drawer, not out of a payment method at all:
 * consuming an MTC/Alfa line's credits spends the carrier credit drawer
 * (`CARRIER_DRAWER_NAMES`), and the documented invariant
 * `drawer_balances[carrier].USD == getCarrierCreditsSum(carrier)` only holds
 * if that exact drawer is the one debited. `paid_by_method` stays the
 * audit/reporting label for HOW it was paid (`LINE_CREDIT`); this field says
 * WHERE the value left from.
 */
export interface ExpenseDrawerOverride {
  drawer_name: string;
  currency_code: "USD" | "LBP";
}

export interface CreateExpenseData {
  description: string;
  category: string;
  paid_by_method?: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
  transaction_time?: string;
  /**
   * When set, `createExpense` posts EXACTLY ONE leg — the override
   * drawer/currency, for that currency's amount, negated — and skips the
   * whole `paid_by_method` → drawer mapping (including the BINANCE/USDT
   * special case), so an override can never double-post. See
   * {@link ExpenseDrawerOverride}.
   */
  drawer_override?: ExpenseDrawerOverride;
  /**
   * Extra keys merged into the unified transaction's `metadata_json`. The
   * canonical `category`/`paid_by`/`expense_date` keys are written AFTER
   * this spread and always win — an override can add context, never rewrite
   * the row's own identity.
   */
  extra_metadata?: Record<string, unknown>;
}

export class ExpenseRepository extends BaseRepository<ExpenseEntity> {
  constructor() {
    super("expenses");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  // LIRA-131: is_refunded/refunded_at are written by
  // TransactionRepository._markSourceRefunded on void/refund but were never
  // projected here, so a refunded expense silently read back as an
  // ordinary live row. getTodayExpenses()/findById()/findAll() all share
  // this one method (used by both the IPC handlers in dbHandlers.ts and the
  // REST routes in backend/src/api/expenses.ts via ExpenseService), so this
  // one change fixes the read path identically for desktop and web (rule
  // 19).
  protected getColumns(): string {
    return "id, description, category, amount_usd, amount_lbp, expense_date, paid_by_method, note, status, edited_by, edited_at, is_refunded, refunded_at";
  }

  /**
   * Create a new expense
   */
  createExpense(data: CreateExpenseData, userId: number): number {
    const paidBy = data.paid_by_method || "CASH";
    const drawerName = paymentMethodToDrawerName(paidBy);
    const tenantId = getCurrentTenantId();

    return this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO expenses (tenant_id, description, category, paid_by_method, amount_usd, amount_lbp, expense_date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
      `);
      const result = stmt.run(
        tenantId,
        data.description,
        data.category,
        paidBy,
        data.amount_usd,
        data.amount_lbp,
        data.expense_date,
        data.transaction_time ?? null,
      );
      const expenseId = Number(result.lastInsertRowid);

      // Create unified transaction row
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.EXPENSE,
        source_table: "expenses",
        source_id: expenseId,
        user_id: userId,
        amount_usd: -(data.amount_usd || 0),
        amount_lbp: -(data.amount_lbp || 0),
        summary: `Expense: ${data.category} - ${data.description}`,
        metadata_json: {
          ...(data.extra_metadata ?? {}),
          category: data.category,
          paid_by: paidBy,
          expense_date: data.expense_date,
        },
        transaction_time: data.transaction_time,
      });

      const note = `${data.category}: ${data.description}`;
      const createdBy = userId;

      const postOutflow = (
        currency: string,
        amount: number,
        targetDrawer: string,
      ) => {
        const delta = -Math.abs(amount);
        insertPaymentRow(this.db, {
          transactionId: txnId,
          method: paidBy,
          drawerName: targetDrawer,
          currencyCode: currency,
          amount: delta,
          note,
          createdBy,
          tenantId,
        });
        applyDrawerDelta(this.db, {
          drawerName: targetDrawer,
          currencyCode: currency,
          delta,
          tenantId,
        });
      };

      // Explicit drawer override (LIRA-145): ONE leg, on the caller's drawer
      // and currency, and NONE of the paid-by-method mapping below — a
      // second post here would double-debit and break the carrier-credit sum
      // invariant this override exists to preserve. `isDrawerAffectingMethod`
      // is deliberately NOT consulted: the override IS the statement that a
      // drawer moves, and `LINE_CREDIT` is not a registered payment method.
      if (data.drawer_override) {
        const { drawer_name, currency_code } = data.drawer_override;
        const amount =
          currency_code === "USD" ? data.amount_usd : data.amount_lbp;
        if (amount) {
          postOutflow(currency_code, amount, drawer_name);
        }
        return expenseId;
      }

      // All expenses affect drawer balances (unless paid by non-drawer-affecting method)
      if (isDrawerAffectingMethod(paidBy)) {
        // Binance is a USDT-denominated wallet: the shop pays the expense out
        // of its USDT balance. USDT is tracked 1:1 with USD across the app
        // (see FinancialServiceRepository wallet path / lira-098), so the
        // dollar value lives in amount_usd for reporting and the drawer leg
        // moves that many USDT. The generic void restores by the leg's
        // currency_code, so the USDT balance nets back on void.
        const isUsdtWallet = paidBy === "BINANCE";

        if (isUsdtWallet) {
          if (data.amount_usd && data.amount_usd !== 0) {
            postOutflow("USDT", data.amount_usd, drawerName);
          }
        } else {
          // USD outflow
          if (data.amount_usd && data.amount_usd !== 0) {
            postOutflow("USD", data.amount_usd, drawerName);
          }
          // LBP outflow
          if (data.amount_lbp && data.amount_lbp !== 0) {
            postOutflow("LBP", data.amount_lbp, drawerName);
          }
        }
      }

      return expenseId;
    })();
  }

  /**
   * Get today's expenses
   */
  getTodayExpenses(): ExpenseEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM expenses
         WHERE DATE(expense_date) = DATE('now') AND status != 'voided' AND tenant_id = ?
         ORDER BY expense_date DESC`,
      )
      .all(getCurrentTenantId()) as ExpenseEntity[];
  }

  /**
   * Get expense by ID
   */
  getExpenseById(id: number): ExpenseEntity | undefined {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM expenses WHERE id = ? AND tenant_id = ?`,
      )
      .get(id, getCurrentTenantId()) as ExpenseEntity | undefined;
  }

  /**
   * Delete an expense by ID and void its transaction
   */
  deleteExpense(id: number, userId: number): void {
    this.db.transaction(() => {
      // Void the unified transaction (if exists)
      const txnRepo = getTransactionRepository();
      const originalTxn = txnRepo.getBySourceId("expenses", id);
      if (originalTxn) {
        txnRepo.voidTransaction(originalTxn.id, userId);
      }
      // Soft-delete: mark as voided instead of removing the record
      this.db
        .prepare(
          "UPDATE expenses SET status = 'voided' WHERE id = ? AND tenant_id = ?",
        )
        .run(id, getCurrentTenantId());
    })();
  }

  /**
   * Update non-financial metadata on an expense record.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: { description?: string; category?: string; note?: string },
    editedBy: string,
  ): ExpenseEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.description !== undefined) {
      fields.push("description = ?");
      values.push(data.description);
    }
    if (data.category !== undefined) {
      fields.push("category = ?");
      values.push(data.category);
    }
    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) return existing;

    fields.push("edited_by = ?", "edited_at = CURRENT_TIMESTAMP");
    values.push(editedBy);
    values.push(id);
    values.push(getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE expenses SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.findById(id);
  }
}

// Singleton instance
let expenseRepositoryInstance: ExpenseRepository | null = null;

export function getExpenseRepository(): ExpenseRepository {
  if (!expenseRepositoryInstance) {
    expenseRepositoryInstance = new ExpenseRepository();
  }
  return expenseRepositoryInstance;
}

export function resetExpenseRepository(): void {
  expenseRepositoryInstance = null;
}
