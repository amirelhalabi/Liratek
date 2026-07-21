/**
 * Custom Service Repository
 *
 * Handles CRUD for standalone custom services.
 * Integrates with payments, drawer_balances, and debt_ledger
 * following the same transactional pattern as RechargeRepository.
 */

import { BaseRepository } from "./BaseRepository.js";
import { getCurrentTenantId } from "../db/tenantContext.js";
import { customServiceLogger } from "../utils/logger.js";
import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
} from "../utils/payments.js";
import type { CreateCustomServiceInput } from "../validators/customService.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { getVoucherRepository } from "./VoucherRepository.js";
import { getDebtService } from "../services/DebtService.js";
import { getPartnerRepository } from "./PartnerRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  applyDrawerDelta,
  insertPaymentRow,
  bookClientDebtCharge,
  assertPartnerIdRequired,
  assertNoCounterPayment,
} from "./moneyPosting.js";

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
  category: string | null;
  created_by: number | null;
  created_at: string;
  edited_by: string | null;
  edited_at: string | null;
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
    return "id, description, cost_usd, cost_lbp, price_usd, price_lbp, profit_usd, profit_lbp, paid_by, status, client_id, client_name, phone_number, note, category, created_by, created_at, edited_by, edited_at";
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
      const tenantId = getCurrentTenantId();
      const result = this.db.transaction(() => {
        // 1. Insert the custom service record
        const insertService = this.db.prepare(`
          INSERT INTO custom_services (
            tenant_id, description, cost_usd, cost_lbp, price_usd, price_lbp,
            paid_by, status, client_id, client_name, phone_number, note, category, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        `);
        const serviceResult = insertService.run(
          tenantId,
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
          data.category ?? null,
          createdBy,
          data.transaction_time ?? null,
        );
        const serviceId = Number(serviceResult.lastInsertRowid);

        // LIRA-081 (PFT-R): a "for partner" custom service takes no counter
        // payment at all — the FULL price books to the partner's tab.
        // Computed before the unified transaction row so the client_name
        // stamp below can label it, mirroring Recharge/Loto.
        const isForPartner = data.partnerMode === "FOR";

        // 1b. Create unified transaction row
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.CUSTOM_SERVICE,
          source_table: "custom_services",
          source_id: serviceId,
          user_id: createdBy,
          amount_usd: data.price_usd ?? 0,
          amount_lbp: data.price_lbp ?? 0,
          // Margin plus any change the operator kept as profit (T3 KC-3).
          profit_usd:
            (data.price_usd ?? 0) -
            (data.cost_usd ?? 0) +
            (data.kept_change_usd ?? 0),
          profit_lbp:
            (data.price_lbp ?? 0) -
            (data.cost_lbp ?? 0) +
            (data.kept_change_lbp ?? 0),
          exchange_rate: data.exchange_rate,
          client_id: data.client_id ?? null,
          // Rule 11: the name/phone must reach the unified row too — a walk-in
          // (name+phone, no clients row) otherwise shows "—" in the
          // transactions table and session sweeps (lira-094).
          // For-partner services label the row with the partner (owner ask,
          // matches Recharge/Loto: "<partner> [partner]").
          client_name:
            isForPartner && data.partnerId
              ? `${getPartnerRepository().getById(data.partnerId)?.name ?? `#${data.partnerId}`} [partner]`
              : (data.client_name ?? null),
          client_phone: data.phone_number ?? null,
          summary: `Custom Service: ${data.description}`,
          metadata_json: {
            cost_usd: data.cost_usd ?? 0,
            cost_lbp: data.cost_lbp ?? 0,
            price_usd: data.price_usd ?? 0,
            price_lbp: data.price_lbp ?? 0,
            paid_by: data.paid_by ?? "CASH",
          },
          transaction_time: data.transaction_time,
        });

        // 2. Payment & drawer logic
        const paidBy = data.paid_by ?? "CASH";
        const methodDrawerName = paymentMethodToDrawerName(paidBy);
        const noteText = `Custom Service: ${data.description}`;

        // Payment-row + drawer-balance posting via the shared moneyPosting
        // helpers (CQ-3). Kept as `.run(...)`-shaped wrapper objects so every
        // existing call site below (14 pairs) stays byte-identical.
        const insertPayment = {
          run: (
            tenant: number,
            transactionId: number,
            method: string,
            drawerName: string,
            currencyCode: string,
            amount: number,
            note: string | null,
            createdByUser: number,
          ) =>
            insertPaymentRow(this.db, {
              transactionId,
              method,
              drawerName,
              currencyCode,
              amount,
              note,
              createdBy: createdByUser,
              tenantId: tenant,
            }),
        };
        const upsertBalance = {
          run: (
            tenant: number,
            drawerName: string,
            currencyCode: string,
            delta: number,
          ) =>
            applyDrawerDelta(this.db, {
              drawerName,
              currencyCode,
              delta,
              tenantId: tenant,
            }),
        };

        if (isForPartner) {
          // LIRA-081 (PFT-R, mirrors FOR_RECHARGE/FOR_IPICK/FOR_KATSH): the
          // shop's own cost still posts for real (a genuine resource the shop
          // spends regardless of who the counterparty is); only the PRICE
          // collection from a walk-in customer is diverted to the partner's
          // tab. No counter payment at all — reject any leaked leg (defense
          // in depth; the frontend never sends one in this mode).
          assertPartnerIdRequired(data.partnerId);
          assertNoCounterPayment(
            (data.payments?.length ?? 0) > 0,
            "custom service",
          );

          if ((data.cost_usd ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
            );
          }
          if ((data.cost_lbp ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
            );
          }

          // The FULL price books to partner_ledger (FOR_CUSTOM_SERVICE DEBIT)
          // against data.partnerId — per currency component, never a converted
          // sum (mirrors RechargeRepository's S7 per-leg-currency booking).
          // Once the partner settles, the shop's net position (cost spent now,
          // price collected later) matches a normal walk-in service exactly,
          // realizing the profit_usd/profit_lbp already stamped above.
          if ((data.price_usd ?? 0) > 0) {
            getPartnerRepository().addLedgerEntry({
              partner_id: data.partnerId as number,
              transaction_type: "FOR_CUSTOM_SERVICE",
              reference_table: "custom_services",
              reference_id: serviceId,
              amount: data.price_usd!,
              currency: "USD",
              direction: "DEBIT",
              user_id: createdBy,
              notes: noteText,
            });
          }
          if ((data.price_lbp ?? 0) > 0) {
            getPartnerRepository().addLedgerEntry({
              partner_id: data.partnerId as number,
              transaction_type: "FOR_CUSTOM_SERVICE",
              reference_table: "custom_services",
              reference_id: serviceId,
              amount: data.price_lbp!,
              currency: "LBP",
              direction: "DEBIT",
              user_id: createdBy,
              notes: noteText,
            });
          }
        } else if (data.deferPayment) {
          // Session-basket deferred mode: the basket owns the customer-cash price
          // inflow + any on-account debt. The shop's own cost is still spent
          // out-of-pocket from the General drawer, so book ONLY the cost outflow.
          if ((data.cost_usd ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
            );
          }
          if ((data.cost_lbp ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
            );
          }
        } else if (data.payments && data.payments.length > 0) {
          // Structured payment legs (rule 16): book what the customer ACTUALLY
          // handed over — split payments, pay-in-another-currency, and change.
          // Pre-fix these legs were sent by the form and silently IGNORED: the
          // repo booked paid_by × price only, so a $-paid LBP service or any
          // change never reached the books.
          let debtUsd = 0;
          let debtLbp = 0;
          for (const leg of data.payments) {
            const amt = Math.abs(leg.amount);
            if (amt <= 0) continue;
            const isOut = leg.direction === "OUT";

            if (!isOut && leg.method === "GIFT_CARD") {
              // Voucher pays: deposit its value to the owner's account and
              // charge this leg's share against that account as debt.
              getVoucherRepository().redeemByCode({
                code: (leg.voucher_code ?? "").trim().toUpperCase(),
                context: "custom_service",
                transactionId: txnId,
                userId: createdBy,
              });
              if (leg.currency_code === "USD") debtUsd += amt;
              else debtLbp += amt;
              continue;
            }

            if (!isDrawerAffectingMethod(leg.method)) {
              if (isOut) {
                // Change kept on the customer's account → store credit.
                if (!data.client_id) {
                  throw new Error(
                    "Client is required to return change as store credit",
                  );
                }
                getDebtService().addCredit({
                  clientId: data.client_id,
                  amountUsd: leg.currency_code === "USD" ? amt : 0,
                  amountLbp: leg.currency_code === "LBP" ? amt : 0,
                  note: "Change returned",
                  userId: createdBy,
                });
              } else {
                // On-account (CUSTOMER_ACCOUNT) share → debt.
                if (leg.currency_code === "USD") debtUsd += amt;
                else debtLbp += amt;
              }
              continue;
            }

            const drawer = paymentMethodToDrawerName(leg.method);
            const signed = isOut ? -amt : amt;
            insertPayment.run(
              tenantId,
              txnId,
              leg.method,
              drawer,
              leg.currency_code,
              signed,
              isOut ? "Change returned" : noteText,
              createdBy,
            );
            upsertBalance.run(tenantId, drawer, leg.currency_code, signed);
          }

          if (debtUsd > 0 || debtLbp > 0) {
            if (!data.client_id) {
              throw new Error("Cannot create debt without a client");
            }
            bookClientDebtCharge(this.db, {
              clientId: data.client_id,
              transactionType: "Custom Service Debt",
              amountUsd: debtUsd,
              amountLbp: debtLbp,
              transactionId: txnId,
              note: noteText,
              createdBy,
              tenantId,
            });
          }

          // Cost outflow — shop pays the cost out-of-pocket, same as all paths.
          if ((data.cost_usd ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
            );
          }
          if ((data.cost_lbp ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
            );
          }
        } else if (paidBy === "CUSTOMER_ACCOUNT") {
          // CUSTOMER_ACCOUNT: customer pays from their credit balance
          // But the shop still spent the cost out-of-pocket (from CASH/General drawer)
          if (!data.client_id) {
            throw new Error("Cannot create debt without a client");
          }

          // Cost outflow from General drawer (USD)
          if ((data.cost_usd ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
            );
          }

          // Cost outflow from General drawer (LBP)
          if ((data.cost_lbp ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
            );
          }

          // Debt ledger entry: customer owes the price
          bookClientDebtCharge(this.db, {
            clientId: data.client_id,
            transactionType: "Custom Service Debt",
            amountUsd: data.price_usd ?? 0,
            amountLbp: data.price_lbp ?? 0,
            transactionId: txnId,
            note: noteText,
            createdBy,
            tenantId,
          });
        } else if (paidBy === "GIFT_CARD") {
          // Voucher payment: deposit the voucher's full value to the owner's
          // account, then charge the service price as a debt against that same
          // account (so any leftover stays as credit). The shop still spends the
          // cost out-of-pocket (General drawer).
          const voucher = getVoucherRepository().redeemByCode({
            code: (data.voucher_code ?? "").trim().toUpperCase(),
            context: "custom_service",
            transactionId: txnId,
            userId: createdBy,
          });

          if ((data.cost_usd ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
            );
          }
          if ((data.cost_lbp ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
            );
          }

          // Charge the price to the voucher owner's account
          bookClientDebtCharge(this.db, {
            clientId: voucher.client_id,
            transactionType: "Custom Service Debt",
            amountUsd: data.price_usd ?? 0,
            amountLbp: data.price_lbp ?? 0,
            transactionId: txnId,
            note: noteText,
            createdBy,
            tenantId,
          });
        } else if (isDrawerAffectingMethod(paidBy)) {
          // Non-DEBT: customer pays now
          // Price inflow (USD)
          if ((data.price_usd ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              paidBy,
              methodDrawerName,
              "USD",
              Math.abs(data.price_usd!),
              `${noteText} (price inflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              methodDrawerName,
              "USD",
              Math.abs(data.price_usd!),
            );
          }

          // Price inflow (LBP)
          if ((data.price_lbp ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              paidBy,
              methodDrawerName,
              "LBP",
              Math.abs(data.price_lbp!),
              `${noteText} (price inflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              methodDrawerName,
              "LBP",
              Math.abs(data.price_lbp!),
            );
          }

          // Cost outflow (USD) — always from General
          if ((data.cost_usd ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "USD",
              -Math.abs(data.cost_usd!),
            );
          }

          // Cost outflow (LBP) — always from General
          if ((data.cost_lbp ?? 0) > 0) {
            insertPayment.run(
              tenantId,
              txnId,
              "CASH",
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
              `${noteText} (cost outflow)`,
              createdBy,
            );
            upsertBalance.run(
              tenantId,
              "General",
              "LBP",
              -Math.abs(data.cost_lbp!),
            );
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
    let query = `SELECT ${this.getColumns()} FROM custom_services WHERE status != 'voided' AND tenant_id = ?`;
    const params: any[] = [getCurrentTenantId()];

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
          `SELECT ${this.getColumns()} FROM custom_services WHERE id = ? AND tenant_id = ?`,
        )
        .get(id, getCurrentTenantId()) as CustomServiceEntity) ?? null
    );
  }

  /**
   * Delete a custom service and reverse all associated payments/debts.
   */
  deleteService(id: number): { success: boolean; error?: string } {
    try {
      const tenantId = getCurrentTenantId();
      this.db.transaction(() => {
        const service = this.getById(id);
        if (!service) throw new Error("Service not found");

        // Void the unified transaction (if exists)
        const txnRepo = getTransactionRepository();
        const originalTxn = txnRepo.getBySourceId("custom_services", id);
        if (originalTxn) {
          txnRepo.voidTransaction(originalTxn.id, service.created_by ?? 1);
        }

        // Reverse payments — get all related payments and reverse drawer
        // balances. Both the outer `payments` scan and the inner
        // `transactions` subquery must carry tenant_id — source_id alone
        // can't cross tenants (it's from one table's own AUTOINCREMENT
        // sequence), but every tenant-scoped table gets scoped per the
        // recipe regardless.
        const payments = this.db
          .prepare(
            `SELECT drawer_name, currency_code, amount FROM payments
             WHERE tenant_id = ? AND transaction_id IN (
               SELECT id FROM transactions WHERE source_table = 'custom_services' AND source_id = ? AND tenant_id = ?
             )`,
          )
          .all(tenantId, id, tenantId) as Array<{
          drawer_name: string;
          currency_code: string;
          amount: number;
        }>;

        for (const pmt of payments) {
          // Reverse the balance effect. CQ-3 survey note: intentionally NOT
          // `applyDrawerDelta` — a plain UPDATE that must NOT create a row
          // for a missing drawer (this only ever reverses a drawer that
          // already received the original payment, one query above).
          this.db
            .prepare(
              `UPDATE drawer_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
               WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?`,
            )
            .run(pmt.amount, pmt.drawer_name, pmt.currency_code, tenantId);
        }

        // Delete payments
        this.db
          .prepare(
            `DELETE FROM payments WHERE tenant_id = ? AND transaction_id IN (
              SELECT id FROM transactions WHERE source_table = 'custom_services' AND source_id = ? AND tenant_id = ?
            )`,
          )
          .run(tenantId, id, tenantId);

        // Debt reversal is owned by voidTransaction above: its _cancelDebt
        // books a 'Refund Reversal' row against every 'Custom Service Debt'
        // charge (journal pattern — never row deletion). A local DELETE here
        // would remove the +charge while the reversal survives, over-crediting
        // the client by the full on-account amount.

        // Soft-delete: mark as voided instead of removing the record
        this.db
          .prepare(
            `UPDATE custom_services SET status = 'voided' WHERE id = ? AND tenant_id = ?`,
          )
          .run(id, tenantId);
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
         WHERE DATE(created_at) = DATE('now', 'localtime') AND tenant_id = ?`,
      )
      .get(getCurrentTenantId()) as CustomServiceSummary;

    return row;
  }

  /**
   * Update non-financial metadata on a custom service record.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: {
      description?: string;
      client_name?: string;
      phone_number?: string;
      note?: string;
      category?: string;
    },
    editedBy: string,
  ): CustomServiceEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.description !== undefined) {
      fields.push("description = ?");
      values.push(data.description);
    }
    if (data.client_name !== undefined) {
      fields.push("client_name = ?");
      values.push(data.client_name);
    }
    if (data.phone_number !== undefined) {
      fields.push("phone_number = ?");
      values.push(data.phone_number);
    }
    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }
    if (data.category !== undefined) {
      fields.push("category = ?");
      values.push(data.category);
    }

    if (fields.length === 0) return existing;

    fields.push("edited_by = ?", "edited_at = CURRENT_TIMESTAMP");
    values.push(editedBy);
    values.push(id, getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE custom_services SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.findById(id);
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
