/**
 * Recharge Repository
 *
 * Handles recharge-specific queries (virtual stock).
 * Uses recharges and drawer_balances tables.
 */

import { BaseRepository } from "./BaseRepository.js";
import { rechargeLogger } from "../utils/logger.js";

import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
} from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface VirtualStock {
  mtc: number;
  alfa: number;
}

export type RechargePaidByMethod = string;

export interface RechargeData {
  provider: "MTC" | "Alfa";
  type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";
  amount: number;
  cost: number;
  price: number;
  currency?: string; // Defaults to "USD"
  paid_by_method?: RechargePaidByMethod;
  /** Multi-payment support: when provided, overrides paid_by_method */
  payments?: Array<{
    method: string;
    currencyCode: string;
    amount: number;
  }>;
  phoneNumber?: string;
  clientId?: number;
}

export interface RechargeEntity {
  id: number;
  carrier: string;
  recharge_type: string;
  amount: number;
  cost: number;
  price: number;
  currency_code: string;
  paid_by: string;
  phone_number: string | null;
  client_id: number | null;
  client_name: string | null;
  note: string | null;
  created_at: string;
  created_by: number;
}

// =============================================================================
// Recharge Repository Class
// =============================================================================

export class RechargeRepository extends BaseRepository<RechargeEntity> {
  constructor() {
    super("recharges", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, carrier, recharge_type, amount, cost, price, currency_code, paid_by, phone_number, client_id, client_name, note, created_at, created_by";
  }

  /**
   * Get virtual stock totals for MTC and Alfa from drawer balances
   * This reads from the drawer_balances table instead of products table
   */
  getVirtualStock(currency = "USD"): VirtualStock {
    const mtc = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'MTC' AND currency_code = ?",
      )
      .get(currency) as { balance: number | null };

    const alfa = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Alfa' AND currency_code = ?",
      )
      .get(currency) as { balance: number | null };

    return {
      mtc: mtc?.balance || 0,
      alfa: alfa?.balance || 0,
    };
  }

  /**
   * Top up the MTC or Alfa drawer balance.
   * This is used when the shop owner loads credits onto their telecom account.
   * Records a TOP_UP entry in the recharges table.
   */
  topUp(data: {
    provider: "MTC" | "Alfa";
    amount: number;
    currency?: string;
  }): { success: boolean; error?: string } {
    try {
      const drawerName = data.provider === "MTC" ? "MTC" : "Alfa";
      const currency = data.currency ?? "USD";

      this.db.transaction(() => {
        // Record the top-up in recharges table
        this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, 'CASH', ?, 1)`,
          )
          .run(
            data.provider,
            Math.abs(data.amount),
            currency,
            `${data.provider} top-up: +${data.amount} ${currency}`,
          );

        // Increase the provider drawer balance
        this.db
          .prepare(
            `INSERT INTO drawer_balances (drawer_name, currency_code, balance)
             VALUES (?, ?, ?)
             ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
               balance = drawer_balances.balance + excluded.balance,
               updated_at = CURRENT_TIMESTAMP`,
          )
          .run(drawerName, currency, Math.abs(data.amount));
      })();

      rechargeLogger.info(
        { provider: data.provider, amount: data.amount, currency },
        `${data.provider} top-up: +${data.amount} ${currency}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Process a recharge transaction (creates recharges row, updates drawers, logs activity)
   */
  processRecharge(data: RechargeData): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    try {
      const result = this.db.transaction(() => {
        const note = `${data.provider} ${data.type} - ${data.phoneNumber || "No Number"}`;
        const paidBy = data.paid_by_method || "CASH";
        const currency = data.currency ?? "USD";
        const createdBy = 1;

        // 1. Create Recharge Record (goes into recharges table, not sales)
        const clientName = data.clientId
          ? ((
              this.db
                .prepare("SELECT name FROM clients WHERE id = ?")
                .get(data.clientId) as { name: string } | undefined
            )?.name ?? null)
          : null;

        const insertRecharge = this.db.prepare(`
          INSERT INTO recharges (
            carrier, recharge_type, amount, cost, price, currency_code,
            paid_by, phone_number, client_id, client_name, note, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const rechargeResult = insertRecharge.run(
          data.provider,
          data.type,
          data.amount,
          data.cost,
          data.price,
          currency,
          paidBy,
          data.phoneNumber || null,
          data.clientId || null,
          clientName,
          note,
          createdBy,
        );
        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // 2. Create unified transaction row
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: createdBy,
          amount_usd: data.price,
          client_id: data.clientId ?? null,
          summary: `Recharge: ${data.provider} ${data.type} $${data.price}`,
          metadata_json: {
            provider: data.provider,
            type: data.type,
            amount: data.amount,
            cost: data.cost,
            price: data.price,
            paid_by: paidBy,
            phone: data.phoneNumber,
          },
        });

        // 3. Update running balances
        const methodDrawerName = paymentMethodToDrawerName(paidBy);
        const providerDrawerName = data.provider === "MTC" ? "MTC" : "Alfa";

        const insertPayment = this.db.prepare(`
          INSERT INTO payments (
            transaction_id, method, drawer_name, currency_code, amount, note, created_by
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?
          )
        `);

        const upsertBalanceDelta = this.db.prepare(`
          INSERT INTO drawer_balances (drawer_name, currency_code, balance)
          VALUES (?, ?, ?)
          ON CONFLICT(drawer_name, currency_code) DO UPDATE SET
            balance = drawer_balances.balance + excluded.balance,
            updated_at = CURRENT_TIMESTAMP
        `);

        // Customer payment (cash-like inflow)
        let hasDebt = false;
        if (data.payments && data.payments.length > 0) {
          // Multi-payment mode
          for (const p of data.payments) {
            if (!isDrawerAffectingMethod(p.method)) {
              hasDebt = true;
              continue;
            }
            const drawer = paymentMethodToDrawerName(p.method);
            insertPayment.run(
              txnId,
              p.method,
              drawer,
              p.currencyCode,
              Math.abs(p.amount),
              note,
              createdBy,
            );
            upsertBalanceDelta.run(drawer, p.currencyCode, Math.abs(p.amount));
          }
        } else if (isDrawerAffectingMethod(paidBy)) {
          // Single payment (backwards-compatible)
          insertPayment.run(
            txnId,
            paidBy,
            methodDrawerName,
            currency,
            Math.abs(data.price),
            note,
            createdBy,
          );
          upsertBalanceDelta.run(
            methodDrawerName,
            currency,
            Math.abs(data.price),
          );
        } else {
          hasDebt = true;
        }

        // Telecom balance consumed (shop number stock)
        const stockDelta = -Math.abs(data.amount);
        insertPayment.run(
          txnId,
          data.provider === "MTC" ? "MTC" : "Alfa",
          providerDrawerName,
          currency,
          stockDelta,
          "Telecom balance sent",
          createdBy,
        );
        upsertBalanceDelta.run(providerDrawerName, currency, stockDelta);

        // Debt: create ledger entry when paid by DEBT
        if (hasDebt) {
          if (!data.clientId) {
            throw new Error("Cannot create debt without a client");
          }
          const debtAmount =
            data.payments && data.payments.length > 0
              ? data.payments
                  .filter((p) => !isDrawerAffectingMethod(p.method))
                  .reduce((sum, p) => sum + Math.abs(p.amount), 0)
              : data.price;
          this.db
            .prepare(
              `INSERT INTO debt_ledger (
                client_id, transaction_type, amount_usd, transaction_id, note, created_by, due_date
              ) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
            )
            .run(
              data.clientId,
              "Recharge Debt",
              debtAmount,
              txnId,
              note,
              createdBy,
            );
        }

        return rechargeId;
      })();

      rechargeLogger.info(
        {
          id: result,
          provider: data.provider,
          type: data.type,
          amount: data.amount,
          price: data.price,
          paidBy: data.paid_by_method || "CASH",
        },
        `${data.provider} ${data.type}: ${data.amount} @ $${data.price}`,
      );

      return { success: true, id: result };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Recharge failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let rechargeRepositoryInstance: RechargeRepository | null = null;

export function getRechargeRepository(): RechargeRepository {
  if (!rechargeRepositoryInstance) {
    rechargeRepositoryInstance = new RechargeRepository();
  }
  return rechargeRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetRechargeRepository(): void {
  rechargeRepositoryInstance = null;
}
