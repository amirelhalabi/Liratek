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
import { BusinessRuleError } from "../utils/errors.js";
import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
} from "../utils/payments.js";
import type { CreateCustomServiceInput } from "../validators/customService.js";
import {
  TERMINAL_FULFILLMENT_STATUS,
  type FulfillmentStatus,
} from "../utils/insuranceFulfillment.js";
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
  /** §2 FINAL SPEC — the inventory item this service consumed, if any (NULL
   * for preset/free-text paths). Exactly 1 unit decremented/restored. */
  product_id: number | null;
  /** LIRA-130: set by `TransactionRepository._markSourceRefunded` when the
   * unified transaction sourced from this row is voided/refunded —
   * `custom_services` is in its supported-tables whitelist. Was written by
   * the reversal path but never projected here, so the History modal (which
   * already has the "Refunded" badge + neutralized-profit rendering wired
   * to these two fields) never received them. */
  is_refunded: number;
  refunded_at: string | null;
  /** LIRA-154 — 'FOR' (existing "For Partner": partner uses OUR system, full
   * price books to their tab) or 'VIA' (new "Via Partner": partner PERFORMS
   * the service, we owe them the cost) or NULL (ordinary walk-in). See
   * `PartnerRepository`'s doc comment above `CreateLedgerEntryData` for why
   * this column's 'VIA' value and the `THROUGH_CUSTOM_SERVICE` ledger type
   * are two deliberately different strings. */
  partner_mode: string | null;
  /** LIRA-155 — where this insurance-style service's paperwork currently
   * sits: 'ORDERED' | 'ISSUED' | 'RECEIVED' | 'DELIVERED', or NULL for a
   * non-insurance custom service (not fulfilment-tracked at all). See
   * `utils/insuranceFulfillment.ts` for the ONE definition of the status
   * list and the legal-transition rule — never re-typed here. */
  fulfillment_status: FulfillmentStatus | null;
  /** Stamped to CURRENT_TIMESTAMP only when fulfillment_status becomes
   * 'DELIVERED' (the document was physically handed to the customer);
   * cleared back to NULL for every other status. See
   * `updateFulfillmentStatus` below. */
  fulfilled_at: string | null;
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
    // LIRA-130: is_refunded/refunded_at are written by
    // TransactionRepository._markSourceRefunded on void/refund but were
    // never projected here, so a refunded service silently read back as an
    // ordinary live row (money was correct in `transactions`; the screen
    // was never told). Both transports (IPC + REST) share this method via
    // CustomServiceService.getServices -> repo.getAll(), so this one change
    // fixes the read path identically for desktop and web (rule 19).
    // LIRA-155: fulfillment_status/fulfilled_at follow the exact same
    // "add-a-nullable-column, project-it-here" shape LIRA-154 used for
    // partner_mode just above — every existing row reads NULL for both,
    // unchanged behaviour for every non-insurance custom service.
    return "id, description, cost_usd, cost_lbp, price_usd, price_lbp, profit_usd, profit_lbp, paid_by, status, client_id, client_name, phone_number, note, category, created_by, created_at, edited_by, edited_at, product_id, is_refunded, refunded_at, partner_mode, fulfillment_status, fulfilled_at";
  }

  /**
   * Create a custom service with full payment/drawer/debt integration.
   * Runs inside a single DB transaction.
   */
  createService(
    data: CreateCustomServiceInput,
    createdByParam?: number,
    opts?: { allowOutOfStock?: boolean },
  ): { success: boolean; id?: number; error?: string } {
    try {
      const tenantId = getCurrentTenantId();
      const allowOutOfStock = opts?.allowOutOfStock ?? false;
      const result = this.db.transaction(() => {
        // Resolve inside the transaction so it reads a consistent snapshot;
        // falls back to a real (admin) user id instead of the hardcoded `1`
        // that used to trip the FK on transactions.user_id / payments.created_by
        // / custom_services.created_by whenever the admin's real id isn't 1.
        const createdBy = createdByParam ?? this.resolveFallbackUserId();

        // 1. Insert the custom service record
        const insertService = this.db.prepare(`
          INSERT INTO custom_services (
            tenant_id, description, cost_usd, cost_lbp, price_usd, price_lbp,
            paid_by, status, client_id, client_name, phone_number, note, category, created_by, created_at, product_id, partner_mode, fulfillment_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?)
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
          data.product_id ?? null,
          data.partnerMode ?? null,
          // LIRA-155: NULL for every non-insurance service (unchanged
          // behaviour). `fulfilled_at` is never set on create — it is only
          // ever stamped by updateFulfillmentStatus, on reaching DELIVERED.
          data.fulfillment_status ?? null,
        );
        const serviceId = Number(serviceResult.lastInsertRowid);

        // 1a. §2 FINAL SPEC — an inventory-backed service behaves like a POS
        // sale: the cost was already paid when the stock was bought, so this
        // decrements the linked product's stock exactly once. Mirrors
        // SalesRepository.processSale's guarded conditional write (including
        // its allowOutOfStock escape hatch) verbatim — same WHERE-clause
        // guard, same rows-affected check, same error shape. Preset/free-text
        // paths never send product_id, so this is a no-op for them (Section
        // A of the characterization matrix proved those three paths were
        // byte-identical at this layer; product_id is what makes them
        // diverge). Gated on status === "completed" — a "pending" custom
        // service reserves nothing, same as POS ("Update Stock: ONLY IF
        // COMPLETED."). Always exactly 1 unit — see the migration's doc
        // comment for why no `quantity` column exists.
        if (
          data.product_id != null &&
          (data.status ?? "completed") === "completed"
        ) {
          const stockStmt = this.db.prepare(
            allowOutOfStock
              ? `UPDATE products SET stock_quantity = stock_quantity - 1
                 WHERE id = ? AND tenant_id = ?`
              : `UPDATE products SET stock_quantity = stock_quantity - 1
                 WHERE id = ? AND tenant_id = ? AND stock_quantity >= 1`,
          );
          const stockRes = stockStmt.run(data.product_id, tenantId);
          if (!allowOutOfStock && stockRes.changes === 0) {
            const p = this.db
              .prepare(
                `SELECT name, stock_quantity FROM products WHERE id = ? AND tenant_id = ?`,
              )
              .get(data.product_id, tenantId) as
              | { name?: string; stock_quantity?: number }
              | undefined;
            throw new BusinessRuleError(
              `Not enough stock for "${p?.name ?? `product #${data.product_id}`}" (${p?.stock_quantity ?? 0} available)`,
            );
          }
        }

        // LIRA-081 (PFT-R): a "for partner" custom service takes no counter
        // payment at all — the FULL price books to the partner's tab.
        // Computed before the unified transaction row so the client_name
        // stamp below can label it, mirroring Recharge/Loto.
        const isForPartner = data.partnerMode === "FOR";

        // LIRA-154 — "Via partner" (owner decision D4.1): the MIRROR of
        // "For partner". Here the PARTNER performs the service, not us: the
        // walk-in customer still pays US, now, through the completely
        // unforked normal payment path below (isForPartner is false, so none
        // of the branches change) — money moves into our drawer exactly like
        // any non-partner custom service, and shop profit is unchanged
        // (price - cost, already stamped above). The ONLY addition is that
        // we now owe the PARTNER the COST instead of it being a pure
        // profit-computation input — booked once, after the normal payment
        // branches, as a THROUGH_CUSTOM_SERVICE partner_ledger CREDIT (see
        // below). Guarded here, before any row is written, same shape as
        // `assertPartnerIdRequired` (moneyPosting.ts) — not reusing that
        // helper directly because its message is hardcoded to mention `"FOR"`
        // and widening its signature to parameterize the mode would be
        // changing a shared interface to suit this one new caller.
        const isViaPartner = data.partnerMode === "VIA";
        if (isViaPartner && !data.partnerId) {
          throw new Error('partnerId is required when partnerMode is "VIA"');
        }

        // Blank/whitespace-only descriptions must not produce a dangling
        // "Custom Service: " (colon, nothing after it) — degrade to the bare
        // label instead. Defined ONCE and reused for BOTH the unified
        // transaction summary below AND the payment/drawer notes further
        // down (rule 14 — never paste this template twice).
        const noteText =
          data.description && data.description.trim()
            ? `Custom Service: ${data.description}`
            : "Custom Service";

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
          summary: noteText,
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
          // LIRA-081 (PFT-R): the FULL price is diverted to the partner's
          // tab. The shop's cost is a profit input only — it must NOT move
          // cash (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §2 FINAL SPEC;
          // owner: "money should not leave the drawer at that moment"). No
          // counter payment at all — reject any leaked leg (defense in
          // depth; the frontend never sends one in this mode).
          assertPartnerIdRequired(data.partnerId);
          // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 (owner report
          // LIRA-114): this call used to compute `hasCounterPayment` from
          // `data.payments` ONLY, so a for-partner submission carrying a
          // stale legacy `data.paid_by` (e.g. "CUSTOMER_ACCOUNT" left over
          // from before the operator ticked "For Partner", or any other
          // single-payment-method leftover) was accepted with no money
          // moved, yet `metadata_json.paid_by` below still stamped that
          // method as if it had executed. Passing `data.paid_by` as the
          // guard's now-required `legacyPaidBy` parameter closes that hole —
          // see moneyPosting.ts's `assertNoCounterPayment` doc for the
          // CASH-is-neutral-default / CUSTOMER_ACCOUNT-is-never-valid
          // reasoning.
          assertNoCounterPayment(
            (data.payments?.length ?? 0) > 0,
            data.paid_by,
            "custom service",
          );

          // §2 FINAL SPEC: cost is a profit input only — already captured in
          // the unified transaction's profit_usd/profit_lbp above — and must
          // NOT post a drawer movement. (Was: a hardcoded CASH/General cost
          // outflow here; removed 2026-08-09.)

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
          // Session-basket deferred mode: the basket owns the customer-cash
          // price inflow + any on-account debt elsewhere. The shop's cost is
          // a profit input only (§2 FINAL SPEC) — nothing to book here at
          // all. This branch is kept (instead of falling through) purely so
          // the payments[]/drawer-affecting branches below don't try to
          // collect the price a second time.
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
                  transactionId: txnId,
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

          // §2 FINAL SPEC: cost is a profit input only — it must NOT post a
          // drawer movement. (Was: a hardcoded CASH/General cost outflow
          // here, same as every other branch; removed 2026-08-09.)
        } else if (paidBy === "CUSTOMER_ACCOUNT") {
          // CUSTOMER_ACCOUNT: customer pays from their credit balance. The
          // cost is a profit input only (§2 FINAL SPEC) — it does not post a
          // drawer movement.
          if (!data.client_id) {
            throw new Error("Cannot create debt without a client");
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
          // account (so any leftover stays as credit). The cost is a profit
          // input only (§2 FINAL SPEC) — it does not post a drawer movement.
          const voucher = getVoucherRepository().redeemByCode({
            code: (data.voucher_code ?? "").trim().toUpperCase(),
            context: "custom_service",
            transactionId: txnId,
            userId: createdBy,
          });

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

          // §2 FINAL SPEC: cost is a profit input only — it must NOT post a
          // drawer movement. (Was: a hardcoded CASH/General cost outflow
          // here, always from General; removed 2026-08-09.)
        }

        // LIRA-154 — "Via partner": the branches above already collected the
        // price from the walk-in customer exactly like an ordinary custom
        // service (isForPartner is false, so nothing above forked). The only
        // remaining step is booking what the SHOP now owes the PARTNER for
        // performing the service — the COST, per currency component, never a
        // converted sum (mirrors the FOR_CUSTOM_SERVICE per-leg-currency
        // booking above). Direction CREDIT: we owe the partner (owner
        // decision). Ledger type is `THROUGH_CUSTOM_SERVICE` — see
        // PartnerRepository's doc comment above `CreateLedgerEntryData` for
        // why that differs from this row's own `partner_mode` value ('VIA').
        if (isViaPartner) {
          if ((data.cost_usd ?? 0) > 0) {
            getPartnerRepository().addLedgerEntry({
              partner_id: data.partnerId as number,
              transaction_type: "THROUGH_CUSTOM_SERVICE",
              reference_table: "custom_services",
              reference_id: serviceId,
              amount: data.cost_usd!,
              currency: "USD",
              direction: "CREDIT",
              user_id: createdBy,
              notes: noteText,
            });
          }
          if ((data.cost_lbp ?? 0) > 0) {
            getPartnerRepository().addLedgerEntry({
              partner_id: data.partnerId as number,
              transaction_type: "THROUGH_CUSTOM_SERVICE",
              reference_table: "custom_services",
              reference_id: serviceId,
              amount: data.cost_lbp!,
              currency: "LBP",
              direction: "CREDIT",
              user_id: createdBy,
              notes: noteText,
            });
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

  /**
   * LIRA-155 — mechanically WRITE a fulfilment status. Rule 13: this method
   * carries NO transition policy — it does not check whether `from -> to` is
   * a legal step. `CustomServiceService.advanceFulfillmentStatus` is the
   * ONE caller that decides legality (via `isValidFulfillmentTransition`)
   * before ever reaching here; calling this directly bypasses that check by
   * design, the same separation `updateMetadata` above already draws
   * between "is this allowed" and "write it".
   *
   * Stamps `fulfilled_at` to the SQL clock (`CURRENT_TIMESTAMP` — never a
   * JS `new Date()` inside logic) exactly when the status being written is
   * the terminal one (`DELIVERED`), and clears it to NULL for every other
   * status — mirrors every other timestamp column in this repository
   * (`edited_at`, `refunded_at`), which all use the database's own clock,
   * not the application's.
   *
   * Moves NO money and touches NO drawer/ledger — fulfilment is tracked on
   * its own column, entirely independent of payment (see the module doc
   * comment in `utils/insuranceFulfillment.ts`).
   */
  updateFulfillmentStatus(
    id: number,
    status: FulfillmentStatus,
  ): CustomServiceEntity | null {
    const tenantId = getCurrentTenantId();
    this.db
      .prepare(
        `UPDATE custom_services
         SET fulfillment_status = ?,
             fulfilled_at = CASE WHEN ? = ? THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE id = ? AND tenant_id = ?`,
      )
      .run(status, status, TERMINAL_FULFILLMENT_STATUS, id, tenantId);
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
