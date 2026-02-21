/**
 * Custom Service Repository
 *
 * Handles CRUD for standalone custom services.
 * Integrates with payments, drawer_balances, and debt_ledger
 * following the same transactional pattern as RechargeRepository.
 */

import { BaseRepository } from "./BaseRepository.js";
import { customServiceLogger } from "../utils/logger.js";
import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
} from "../utils/payments.js";
import type { CreateCustomServiceInput } from "../validators/customService.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface CustomServiceEntity {
  id: number;
  description: string;
  cost_usd: number;
  cost_lbp: number;
  price_usd: number;
  price_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  paid_by: string;
  status: string;
  client_id: number | null;
  client_name: string | null;
  phone_number: string | null;
  note: string | null;
  created_by: number | null;
  created_at: string;
}

export interface CustomServiceSummary {
  count: number;
  totalCostUsd: number;
  totalCostLbp: number;
  totalPriceUsd: number;
  totalPriceLbp: number;
  totalProfitUsd: number;
  totalProfitLbp: number;
}

// =============================================================================
// Custom Service Repository Class
// =============================================================================

export class CustomServiceRepository extends BaseRepository<CustomServiceEntity> {
  constructor() {
    super("custom_services", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, description, cost_usd, cost_lbp, price_usd, price_lbp, profit_usd, profit_lbp, paid_by, status, client_id, client_name, phone_number, note, created_by, created_at";
  }

  /**
   * Create a custom service with full payment/drawer/debt integration.
   * Runs inside a single DB transaction.
   */
  createService(
    data: CreateCustomServiceInput,
    createdBy: number = 1,
  ): { success: boolean; id?: number; error?: string } {
    try {
      const result = this.db.transaction(() => {
        // 1. Insert the custom service record
        const insertService = this.db.prepare(`
          INSERT INTO custom_services (
            description, cost_usd, cost_lbp, price_usd, price_lbp,
            paid_by, status, client_id, client_name, phone_number, note, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const serviceResult = insertService.run(
          data.description,
          data.cost_usd ?? 0,
          data.cost_lbp ?? 0,
          data.price_usd ?? 0,
          data.price_lbp ?? 0,
          data.paid_by ?? "CASH",
          data.status ?? "completed",
          data.client_id ?? null,
          data.client_name ?? null,
          data.phone_number ?? null,
          data.note ?? null,
          createdBy,
        );
        const serviceId = Number(serviceResult.lastInsertRowid);

        // 1b. Create unified transaction row
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.CUSTOM_SERVICE,
          source_table: "custom_services",
          source_id: serviceId,
          user_id: createdBy,
          amount_usd: data.price_usd ?? 0,
          amount_lbp: data.price_lbp ?? 0,
          client_id: data.client_id ?? null,
          summary: `Custom Service: ${data.description}`,
          metadata_json: {
            cost_usd: data.cost_usd ?? 0,
            cost_lbp: data.cost_lbp ?? 0,
            price_usd: data.price_usd ?? 0,
            price_lbp: data.price_lbp ?? 0,
            paid_by: data.paid_by ?? "CASH",
          },
        });

        // 2. Payment & drawer logic
        const paidBy = data.paid_by ?? "CASH";
        const methodDrawerName = paymentMethodToDrawerName(paidBy);
        const noteText = `Custom Service: ${data.description}`;

        const insertPayment = this.db.prepare(`
          INSERT INTO payments (
            transaction_id, method, drawer_name, currency_code, amount, note, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const upsertBalance = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);

        if (paidBy === "DEBT") {
          // DEBT: customer hasn't paid yet
          // But the shop still spent the cost out-of-pocket (from CASH/General drawer)
          if (!data.client_id) {
            throw new Error("Cannot create debt without a client");
          }

          // Cost outflow from General drawer (USD)
          if ((data.cost_usd ?? 0) > 0) {
            insertPayment.run(
              txnId,
              "CASH",
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run("General", "USD", -Math.abs(data.cost_usd!));
          }

          // Cost outflow from General drawer (LBP)
          if ((data.cost_lbp ?? 0) > 0) {
            insertPayment.run(
              txnId,
              "CASH",
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run("General", "LBP", -Math.abs(data.cost_lbp!));
          }

          // Debt ledger entry: customer owes the price
          this.db
            .prepare(
              `INSERT INTO debt_ledger (
                client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, due_date
              ) VALUES (?, 'Custom Service Debt', ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
            )
            .run(
              data.client_id,
              data.price_usd ?? 0,
              data.price_lbp ?? 0,
              txnId,
              noteText,
              createdBy,
            );
        } else if (isDrawerAffectingMethod(paidBy)) {
          // Non-DEBT: customer pays now
          // Price inflow (USD)
          if ((data.price_usd ?? 0) > 0) {
            insertPayment.run(
              txnId,
              paidBy,
              methodDrawerName,
              "USD",
              Math.abs(data.price_usd!),
              `${noteText} (price inflow)`,
              createdBy,
            );
            upsertBalance.run(
              methodDrawerName,
              "USD",
              Math.abs(data.price_usd!),
            );
          }

          // Price inflow (LBP)
          if ((data.price_lbp ?? 0) > 0) {
            insertPayment.run(
              txnId,
              paidBy,
              methodDrawerName,
              "LBP",
              Math.abs(data.price_lbp!),
              `${noteText} (price inflow)`,
              createdBy,
            );
            upsertBalance.run(
              methodDrawerName,
              "LBP",
              Math.abs(data.price_lbp!),
            );
          }

          // Cost outflow (USD) — always from General
          if ((data.cost_usd ?? 0) > 0) {
            insertPayment.run(
              txnId,
              "CASH",
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run("General", "USD", -Math.abs(data.cost_usd!));
          }

          // Cost outflow (LBP) — always from General
          if ((data.cost_lbp ?? 0) > 0) {
            insertPayment.run(
              txnId,
              "CASH",
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run("General", "LBP", -Math.abs(data.cost_lbp!));
          }
        }

        return serviceId;
      })();

      customServiceLogger.info(
        {
          id: result,
          description: data.description,
          paid_by: data.paid_by,
        },
        `Custom service created: ${data.description}`,
      );

      return { success: true, id: result };
    } catch (error) {
      customServiceLogger.error(
        { error, data },
        "Failed to create custom service",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get all custom services, optionally filtered by date.
   */
  getAll(filter?: { date?: string }): CustomServiceEntity[] {
    let query = `SELECT ${this.getColumns()} FROM custom_services WHERE status != 'voided'`;
    const params: any[] = [];

    if (filter?.date) {
      query += ` AND DATE(created_at) = ?`;
      params.push(filter.date);
    }

    query += ` ORDER BY created_at DESC`;

    return this.db.prepare(query).all(...params) as CustomServiceEntity[];
  }

  /**
   * Get a single custom service by ID.
   */
  getById(id: number): CustomServiceEntity | null {
    return (
      (this.db
        .prepare(
          `SELECT ${this.getColumns()} FROM custom_services WHERE id = ?`,
        )
        .get(id) as CustomServiceEntity) ?? null
    );
  }

  /**
   * Delete a custom service and reverse all associated payments/debts.
   */
  deleteService(id: number): { success: boolean; error?: string } {
    try {
      this.db.transaction(() => {
        const service = this.getById(id);
        if (!service) throw new Error("Service not found");

        // Void the unified transaction (if exists)
        const txnRepo = getTransactionRepository();
        const originalTxn = txnRepo.getBySourceId("custom_services", id);
        if (originalTxn) {
          txnRepo.voidTransaction(originalTxn.id, service.created_by ?? 1);
        }

        // Reverse payments — get all related payments and reverse drawer balances
        const payments = this.db
          .prepare(
            `SELECT drawer_name, currency_code, amount FROM payments
             WHERE transaction_id IN (SELECT id FROM transactions WHERE source_table = 'custom_services' AND source_id = ?)`,
          )
          .all(id) as Array<{
          drawer_name: string;
          currency_code: string;
          amount: number;
        }>;

        for (const pmt of payments) {
          // Reverse the balance effect
          this.db
            .prepare(
              `UPDATE drawer_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
               WHERE drawer_name = ? AND currency_code = ?`,
            )
            .run(pmt.amount, pmt.drawer_name, pmt.currency_code);
        }

        // Delete payments
        this.db
          .prepare(
            `DELETE FROM payments WHERE transaction_id IN (SELECT id FROM transactions WHERE source_table = 'custom_services' AND source_id = ?)`,
          )
          .run(id);

        // Reverse debt_ledger if DEBT
        if (service.paid_by === "DEBT" && service.client_id) {
          this.db
            .prepare(
              `DELETE FROM debt_ledger
               WHERE transaction_type = 'Custom Service Debt' AND transaction_id IN (SELECT id FROM transactions WHERE source_table = 'custom_services' AND source_id = ?)`,
            )
            .run(id);
        }

        // Soft-delete: mark as voided instead of removing the record
        this.db
          .prepare(`UPDATE custom_services SET status = 'voided' WHERE id = ?`)
          .run(id);
      })();

      customServiceLogger.info({ id }, `Custom service voided: #${id}`);
      return { success: true };
    } catch (error) {
      customServiceLogger.error(
        { error, id },
        "Failed to delete custom service",
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get summary statistics for today's custom services.
   */
  getTodaySummary(): CustomServiceSummary {
    const row = this.db
      .prepare(
        `SELECT
           COUNT(*) as count,
           COALESCE(SUM(cost_usd), 0) as totalCostUsd,
           COALESCE(SUM(cost_lbp), 0) as totalCostLbp,
           COALESCE(SUM(price_usd), 0) as totalPriceUsd,
           COALESCE(SUM(price_lbp), 0) as totalPriceLbp,
           COALESCE(SUM(profit_usd), 0) as totalProfitUsd,
           COALESCE(SUM(profit_lbp), 0) as totalProfitLbp
         FROM custom_services
         WHERE DATE(created_at) = DATE('now', 'localtime')`,
      )
      .get() as CustomServiceSummary;

    return row;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let customServiceRepositoryInstance: CustomServiceRepository | null = null;

export function getCustomServiceRepository(): CustomServiceRepository {
  if (!customServiceRepositoryInstance) {
    customServiceRepositoryInstance = new CustomServiceRepository();
  }
  return customServiceRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetCustomServiceRepository(): void {
  customServiceRepositoryInstance = null;
}
