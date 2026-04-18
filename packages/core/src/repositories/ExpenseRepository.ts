import { BaseRepository } from "./BaseRepository.js";
import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
} from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

export interface ExpenseEntity {
  id: number;
  description: string;
  category: string;
  paid_by_method?: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface CreateExpenseData {
  description: string;
  category: string;
  paid_by_method?: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
}

export class ExpenseRepository extends BaseRepository<ExpenseEntity> {
  constructor() {
    super("expenses");
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, description, category, amount_usd, amount_lbp, expense_date, paid_by_method, status";
  }

  /**
   * Create a new expense
   */
  createExpense(data: CreateExpenseData, userId: number): number {
    const paidBy = data.paid_by_method || "CASH";
    const drawerName = paymentMethodToDrawerName(paidBy);

    return this.db.transaction(() => {
      const stmt = this.db.prepare(`
        INSERT INTO expenses (description, category, paid_by_method, amount_usd, amount_lbp, expense_date)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        data.description,
        data.category,
        paidBy,
        data.amount_usd,
        data.amount_lbp,
        data.expense_date,
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
          category: data.category,
          paid_by: paidBy,
          expense_date: data.expense_date,
        },
      });

      // All expenses affect drawer balances (unless paid by non-drawer-affecting method)
      if (isDrawerAffectingMethod(paidBy)) {
        const upsertBalance = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);

        const insertPayment = this.db.prepare(`
          INSERT INTO payments (
            transaction_id, method, drawer_name, currency_code, amount, note, created_by
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?
          )
        `);

        const note = `${data.category}: ${data.description}`;
        const createdBy = userId;

        // USD outflow
        if (data.amount_usd && data.amount_usd !== 0) {
          const delta = -Math.abs(data.amount_usd);
          insertPayment.run(
            txnId,
            paidBy,
            drawerName,
            "USD",
            delta,
            note,
            createdBy,
          );
          upsertBalance.run(drawerName, "USD", delta);
        }

        // LBP outflow
        if (data.amount_lbp && data.amount_lbp !== 0) {
          const delta = -Math.abs(data.amount_lbp);
          insertPayment.run(
            txnId,
            paidBy,
            drawerName,
            "LBP",
            delta,
            note,
            createdBy,
          );
          upsertBalance.run(drawerName, "LBP", delta);
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
         WHERE DATE(expense_date) = DATE('now') AND status != 'voided'
         ORDER BY expense_date DESC`,
      )
      .all() as ExpenseEntity[];
  }

  /**
   * Get expense by ID
   */
  getExpenseById(id: number): ExpenseEntity | undefined {
    return this.db
      .prepare(`SELECT ${this.getColumns()} FROM expenses WHERE id = ?`)
      .get(id) as ExpenseEntity | undefined;
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
        .prepare("UPDATE expenses SET status = 'voided' WHERE id = ?")
        .run(id);
    })();
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
