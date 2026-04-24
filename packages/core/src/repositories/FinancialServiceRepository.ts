/**
 * Financial Service Repository
 *
 * Handles all financial_services table operations (OMT, WHISH, BOB, etc.).
 * Uses BaseRepository for common functionality.
 */

import { BaseRepository } from "./BaseRepository.js";
import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
  isNonCashDrawerMethod,
} from "../utils/payments.js";
import { getSupplierRepository } from "./SupplierRepository.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  calculateCommission,
  calculateOnlineBrokerageProfit,
  lookupOmtFee,
  ONLINE_BROKERAGE_DEFAULT_RATE,
  type OmtServiceType,
} from "../utils/omtFees.js";
import {
  calculateWhishCommission,
  lookupWhishFee,
} from "../utils/whishFees.js";

// =============================================================================
// Entity Types
// =============================================================================

export interface FinancialServiceEntity {
  id: number;
  provider:
    | "OMT"
    | "WHISH"
    | "BOB"
    | "OTHER"
    | "iPick"
    | "KATCH"
    | "WISH_APP"
    | "OMT_APP"
    | "BINANCE";
  service_type: "SEND" | "RECEIVE";
  amount: number;
  currency: string;
  commission: number;
  cost: number;
  price: number;
  paid_by: string | null;
  client_id: number | null;
  client_name: string | null;
  reference_number: string | null;
  phone_number: string | null;
  sender_name: string | null;
  sender_phone: string | null;
  receiver_name: string | null;
  receiver_phone: string | null;
  sender_client_id: number | null;
  receiver_client_id: number | null;
  omt_service_type: string | null;
  omt_fee: number | null;
  whish_fee: number | null;
  profit_rate: number | null;
  pay_fee: number | null;
  item_key: string | null;
  note: string | null;
  /** 1 = commission already realized (SEND or zero-commission RECEIVE); 0 = pending settlement */
  is_settled: number;
  settled_at: string | null;
  settlement_id: number | null;
  /** Surcharge collected from customer for paying via non-cash method (immediately realized profit) */
  payment_method_fee: number;
  /** Rate used to calculate payment_method_fee (e.g. 0.01 = 1%) */
  payment_method_fee_rate: number | null;
  created_at: string;
  created_by: number | null;
}

export interface UnsettledSummary {
  provider: string;
  count: number;
  pending_commission_usd: number;
  pending_commission_lbp: number;
  total_owed_usd: number;
  total_owed_lbp: number;
}

export interface CreateFinancialServiceData {
  provider:
    | "OMT"
    | "WHISH"
    | "BOB"
    | "OTHER"
    | "iPick"
    | "Katsh"
    | "WISH_APP"
    | "OMT_APP"
    | "BINANCE";
  serviceType: "SEND" | "RECEIVE";
  amount: number;
  currency?: string;
  commission: number;
  cost?: number;
  price?: number;
  paidByMethod?: string;
  /** Multi-payment support: when provided, overrides paidByMethod */
  payments?: Array<{
    method: string;
    currencyCode: string;
    amount: number;
  }>;
  clientId?: number;
  clientName?: string;
  referenceNumber?: string;
  phoneNumber?: string;
  senderName?: string;
  senderPhone?: string;
  receiverName?: string;
  receiverPhone?: string;
  senderClientId?: number;
  receiverClientId?: number;
  omtServiceType?: string;
  omtFee?: number;
  /** WHISH fee (user-entered or auto-looked-up from WHISH_FEE_TIERS) */
  whishFee?: number;
  profitRate?: number;
  payFee?: boolean;
  itemKey?: string;
  itemCategory?: string;
  note?: string;
  /** For SEND transactions: whether the entered amount already includes the fee.
   *  - true  → sentAmount = amount (already deducted by frontend), System drawer gets amount + fee
   *  - false → fee is on top, System drawer gets amount + fee
   */
  includingFees?: boolean;
  /**
   * Surcharge collected from the customer for paying via a non-cash payment method
   * (e.g. WHISH Wallet, OMT Wallet, Binance). This is the shop's immediately realized profit.
   * Only applies to SEND transactions where paidByMethod is non-cash.
   * Default: 0 (no surcharge for cash payments).
   */
  paymentMethodFee?: number;
  /**
   * Rate used to calculate paymentMethodFee (e.g. 0.01 = 1%).
   * Stored for audit/reporting purposes.
   */
  paymentMethodFeeRate?: number;
}

export interface ProviderStats {
  provider: string;
  commission: number;
  currency: string;
  count: number;
}

export interface CurrencyStats {
  currency: string;
  commission: number;
  count: number;
}

export interface FinancialServiceAnalytics {
  today: {
    commission: number;
    pending_commission: number;
    count: number;
    byCurrency: CurrencyStats[];
  };
  month: {
    commission: number;
    pending_commission: number;
    count: number;
    byCurrency: CurrencyStats[];
  };
  byProvider: ProviderStats[];
}

// =============================================================================
// Financial Service Repository Class
// =============================================================================

export class FinancialServiceRepository extends BaseRepository<FinancialServiceEntity> {
  constructor() {
    super("financial_services", { softDelete: false });
  }

  // Override getColumns() to use explicit columns instead of SELECT *
  protected getColumns(): string {
    return "id, provider, service_type, amount, currency, commission, cost, price, paid_by, client_id, client_name, reference_number, phone_number, sender_name, sender_phone, receiver_name, receiver_phone, sender_client_id, receiver_client_id, omt_service_type, omt_fee, whish_fee, profit_rate, pay_fee, item_key, note, is_settled, settled_at, settlement_id, payment_method_fee, payment_method_fee_rate, created_at, created_by";
  }

  // ---------------------------------------------------------------------------
  // Transaction Operations
  // ---------------------------------------------------------------------------

  /**
   * Map provider to its system drawer name
   */
  private mapDrawerName(
    provider: CreateFinancialServiceData["provider"],
  ): string {
    switch (provider) {
      case "OMT":
        return "OMT_System";
      case "WHISH":
        return "Whish_System";
      case "iPick":
        return "iPick";
      case "Katsh":
        return "Katsh";
      case "WISH_APP":
        return "Whish_App";
      case "OMT_APP":
        return "OMT_App";
      case "BINANCE":
        return "Binance";
      case "BOB":
      case "OTHER":
      default:
        return "General";
    }
  }

  /**
   * Create a new financial service transaction.
   *
   * Two modes:
   * - **Cost/Price mode** (cost > 0): iPick/Katsh/WishApp/OMT_App with cost outflow,
   *   price inflow, optional DEBT, and real profit tracking.
   * - **Legacy mode** (no cost): OMT/WHISH/BOB/OTHER with signed amount + commission.
   */
  createTransaction(data: CreateFinancialServiceData): {
    id: number;
    drawer: string;
  } {
    const legacyDrawerLabel = this.mapDrawerName(data.provider);

    const useCostPriceFlow = data.cost !== undefined && data.cost > 0;

    return this.db.transaction(() => {
      const currency = data.currency ?? "USD";
      const cost = data.cost ?? 0;
      const price = data.price ?? (useCostPriceFlow ? data.amount : 0);
      const paidBy = data.paidByMethod || "CASH";

      // ═══════════════════════════════════════════════════════════════════════
      // AUTO-CALCULATE COMMISSION FOR OMT SERVICES
      // ═══════════════════════════════════════════════════════════════════════
      let calculatedCommission = data.commission || 0;

      if (data.provider === "OMT" && data.omtServiceType) {
        const serviceType = data.omtServiceType as OmtServiceType;

        if (serviceType === "OMT_WALLET") {
          // OMT Wallet has no fees
          calculatedCommission = 0;
        } else if (serviceType === "ONLINE_BROKERAGE") {
          // Online Brokerage: profit = amount × profitRate
          const rate = data.profitRate || ONLINE_BROKERAGE_DEFAULT_RATE;
          calculatedCommission = calculateOnlineBrokerageProfit(
            data.amount,
            rate,
          );
        } else {
          // Standard OMT services: resolve fee from table or user-entered value,
          // then commission = resolvedFee × commissionRate
          const resolvedFee =
            data.omtFee && data.omtFee > 0
              ? data.omtFee
              : (lookupOmtFee(serviceType, data.amount) ?? 0);

          if (resolvedFee > 0) {
            calculatedCommission = calculateCommission(
              serviceType,
              resolvedFee,
            );
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // AUTO-CALCULATE COMMISSION FOR WHISH
      // ═══════════════════════════════════════════════════════════════════════
      if (data.provider === "WHISH" && data.serviceType === "SEND") {
        // Resolve WHISH fee: user-entered or auto-looked-up from WHISH_FEE_TIERS
        const resolvedWhishFee =
          data.whishFee && data.whishFee > 0
            ? data.whishFee
            : (lookupWhishFee(data.amount) ?? 0);

        if (resolvedWhishFee > 0) {
          calculatedCommission = calculateWhishCommission(resolvedWhishFee);
        }
      } else if (data.provider === "WHISH" && data.serviceType === "RECEIVE") {
        // RECEIVE: auto-lookup fee from table based on amount (same table)
        const resolvedWhishFee =
          data.whishFee && data.whishFee > 0
            ? data.whishFee
            : (lookupWhishFee(data.amount) ?? 0);

        if (resolvedWhishFee > 0) {
          calculatedCommission = calculateWhishCommission(resolvedWhishFee);
        }
      }

      // For BINANCE with payFee=true, calculate commission if omtFee and omtServiceType provided
      if (
        data.provider === "BINANCE" &&
        data.payFee &&
        data.omtFee &&
        data.omtServiceType
      ) {
        const serviceType = data.omtServiceType as OmtServiceType;
        if (
          serviceType !== "OMT_WALLET" &&
          serviceType !== "ONLINE_BROKERAGE"
        ) {
          calculatedCommission = calculateCommission(serviceType, data.omtFee);
        }
      }

      const commission = useCostPriceFlow ? price - cost : calculatedCommission;

      // Determine settlement status at creation time:
      // OMT/WHISH SEND with commission → is_settled = 0 (OMT owes commission at settlement)
      // OMT/WHISH RECEIVE with commission → is_settled = 0 (pending OMT settlement)
      // Any transaction with commission = 0 → is_settled = 1 (nothing to settle)
      // Other providers (BINANCE, BOB, etc.) SEND → is_settled = 1 (direct profit)
      const isOmtOrWhish = data.provider === "OMT" || data.provider === "WHISH";
      const isPendingSettlement = isOmtOrWhish && commission > 0;
      const isSettled = isPendingSettlement ? 0 : 1;
      const settledAt = isSettled ? new Date().toISOString() : null;

      // 1. Insert the financial_services row
      // Resolve the stored whish_fee: user-entered or auto-looked-up
      const storedWhishFee =
        data.provider === "WHISH"
          ? data.whishFee && data.whishFee > 0
            ? data.whishFee
            : (lookupWhishFee(data.amount) ?? null)
          : null;

      const pmFee = data.paymentMethodFee ?? 0;
      const pmFeeRate = data.paymentMethodFeeRate ?? null;

      // Determine primary client info for backward compatibility
      // For SEND: primary client is sender; for RECEIVE: primary client is receiver
      const primaryClientId =
        data.serviceType === "SEND"
          ? data.senderClientId || data.clientId
          : data.receiverClientId || data.clientId;
      const primaryClientName =
        data.serviceType === "SEND"
          ? data.senderName || data.clientName
          : data.receiverName || data.clientName;
      const primaryClientPhone =
        data.serviceType === "SEND"
          ? data.senderPhone || data.phoneNumber
          : data.receiverPhone || data.phoneNumber;

      const stmt = this.db.prepare(`
        INSERT INTO financial_services (
          provider, service_type, amount, currency,
          commission, cost, price, paid_by, client_id,
          client_name, reference_number, phone_number,
          sender_name, sender_phone, receiver_name, receiver_phone,
          sender_client_id, receiver_client_id,
          omt_service_type, omt_fee, whish_fee, profit_rate, pay_fee,
          item_key, note, is_settled, settled_at,
          payment_method_fee, payment_method_fee_rate
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        data.provider,
        data.serviceType,
        data.amount,
        currency,
        commission,
        cost,
        price,
        paidBy,
        primaryClientId || null,
        primaryClientName || null,
        data.referenceNumber || null,
        primaryClientPhone || null,
        data.senderName || null,
        data.senderPhone || null,
        data.receiverName || null,
        data.receiverPhone || null,
        data.senderClientId || null,
        data.receiverClientId || null,
        data.omtServiceType || null,
        data.omtFee || null,
        storedWhishFee,
        data.profitRate || null,
        data.payFee ? 1 : 0,
        data.itemKey || null,
        data.note || null,
        isSettled,
        settledAt,
        pmFee,
        pmFeeRate,
      );

      const id = Number(result.lastInsertRowid);
      const createdBy = 1;
      const note = data.note || null;

      // Resolve primary client ID: look up by phone number if not provided
      let resolvedPrimaryClientId = primaryClientId;
      const primaryPhone =
        data.serviceType === "SEND"
          ? data.senderPhone || data.phoneNumber
          : data.receiverPhone || data.phoneNumber;
      const primaryName =
        data.serviceType === "SEND"
          ? data.senderName || data.clientName
          : data.receiverName || data.clientName;

      if (!resolvedPrimaryClientId && primaryPhone && primaryName) {
        // Try to find existing client by phone number
        const existing = this.db
          .prepare(`SELECT id FROM clients WHERE phone_number = ? LIMIT 1`)
          .get(primaryPhone) as { id: number } | undefined;
        if (existing) {
          resolvedPrimaryClientId = existing.id;
        } else {
          // Auto-create client
          const insertResult = this.db
            .prepare(
              `INSERT INTO clients (full_name, phone_number, notes)
                      VALUES (?, ?, ?)`,
            )
            .run(
              primaryName,
              primaryPhone,
              "Auto-created from OMT/WHISH service",
            );
          resolvedPrimaryClientId = Number(insertResult.lastInsertRowid);
        }
      }

      // Create unified transaction row
      const txnId = getTransactionRepository().createTransaction({
        type: TRANSACTION_TYPES.FINANCIAL_SERVICE,
        source_table: "financial_services",
        source_id: id,
        user_id: createdBy,
        amount_usd: useCostPriceFlow
          ? currency === "USD"
            ? price
            : 0
          : currency === "USD"
            ? data.amount
            : 0,
        amount_lbp: useCostPriceFlow
          ? currency === "LBP"
            ? price
            : 0
          : currency === "LBP"
            ? data.amount
            : 0,
        client_id: resolvedPrimaryClientId ?? null,
        summary: `${data.provider} ${data.serviceType}: ${data.amount} ${currency}`,
        metadata_json: {
          provider: data.provider,
          service_type: data.serviceType,
          amount: data.amount,
          currency,
          commission,
          cost,
          price,
          paid_by: paidBy,
          item_key: data.itemKey,
        },
      });

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

      if (useCostPriceFlow) {
        // ─── COST/PRICE FLOW (iPick, Katsh, WISH_APP, OMT_APP, BINANCE) ───
        const providerDrawer = this.mapDrawerName(data.provider);

        // Cost outflow: shop pays the provider
        if (cost > 0) {
          insertPayment.run(
            txnId,
            data.provider,
            providerDrawer,
            currency,
            -Math.abs(cost),
            `Cost: ${data.provider}`,
            createdBy,
          );
          upsertBalanceDelta.run(providerDrawer, currency, -Math.abs(cost));
        }

        // Price inflow: customer pays the shop
        if (data.payments && data.payments.length > 0) {
          // Multi-payment: iterate each payment leg
          let hasDebt = false;
          for (const p of data.payments) {
            if (!isDrawerAffectingMethod(p.method)) {
              hasDebt = true;
              continue;
            }
            const paidByDrawer = paymentMethodToDrawerName(p.method);
            insertPayment.run(
              txnId,
              p.method,
              paidByDrawer,
              p.currencyCode,
              Math.abs(p.amount),
              note,
              createdBy,
            );
            upsertBalanceDelta.run(
              paidByDrawer,
              p.currencyCode,
              Math.abs(p.amount),
            );
          }
          // Create debt for any DEBT payment legs
          if (hasDebt) {
            if (!data.clientId) {
              throw new Error("Cannot create debt without a client");
            }
            const debtAmount = data.payments
              .filter((p) => !isDrawerAffectingMethod(p.method))
              .reduce((sum, p) => sum + Math.abs(p.amount), 0);
            this.db
              .prepare(
                `INSERT INTO debt_ledger (
                  client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, due_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
              )
              .run(
                data.clientId,
                "Service Debt",
                currency === "USD" ? debtAmount : 0,
                currency === "LBP" ? debtAmount : 0,
                txnId,
                `${data.provider} service${data.itemKey ? ` [${data.itemKey}]` : ""}`,
                createdBy,
              );
          }
        } else {
          // Single payment (backwards-compatible)
          if (price > 0 && isDrawerAffectingMethod(paidBy)) {
            const paidByDrawer = paymentMethodToDrawerName(paidBy);
            insertPayment.run(
              txnId,
              paidBy,
              paidByDrawer,
              currency,
              Math.abs(price),
              note,
              createdBy,
            );
            upsertBalanceDelta.run(paidByDrawer, currency, Math.abs(price));
          }

          // DEBT: create debt_ledger entry
          if (paidBy === "DEBT") {
            if (!data.clientId) {
              throw new Error("Cannot create debt without a client");
            }
            this.db
              .prepare(
                `INSERT INTO debt_ledger (
                  client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, due_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
              )
              .run(
                data.clientId,
                "Service Debt",
                currency === "USD" ? price : 0,
                currency === "LBP" ? price : 0,
                txnId,
                `${data.provider} service${data.itemKey ? ` [${data.itemKey}]` : ""}`,
                createdBy,
              );
          }
        }
      } else {
        // ─── LEGACY FLOW (OMT, WHISH, BOB, OTHER, BINANCE without cost) ───
        // OMT uses 3-drawer cash-reserve: payment +amount, General -amount, OMT_System +amount
        // WHISH uses 2-drawer: payment +amount, Whish_System +amount (no General)
        // Other providers: single drawer movement (backwards-compatible)

        const systemDrawer = this.mapDrawerName(data.provider);
        const isOMT = data.provider === "OMT";
        const isWHISH = data.provider === "WHISH";
        const useSystemDrawerFlow = isOMT || isWHISH;
        const isBINANCE = data.provider === "BINANCE";

        if (isBINANCE) {
          // ─── BINANCE: crypto sent/received from shop's Binance account ───
          //
          // SEND: shop sends crypto from Binance account to a customer's wallet.
          //   - Binance drawer: -sentAmount (crypto leaves the account)
          //   - Fee (commission): customer pays via payment method → credit to that drawer
          //
          // RECEIVE: someone sends crypto to shop's Binance account.
          //   - Binance drawer: +receivedAmount (crypto arrives in the account)
          //   - Fee (commission): customer pays via payment method → credit to that drawer
          const cryptoAmount = Math.abs(data.amount);
          const fee = Math.abs(calculatedCommission);

          if (data.serviceType === "SEND") {
            // Debit Binance drawer: crypto leaves the shop's account
            insertPayment.run(
              txnId,
              "BINANCE",
              systemDrawer, // "Binance"
              currency,
              -cryptoAmount,
              `Crypto sent to customer`,
              createdBy,
            );
            upsertBalanceDelta.run(systemDrawer, currency, -cryptoAmount);
          } else {
            // Credit Binance drawer: crypto arrives in the shop's account
            insertPayment.run(
              txnId,
              "BINANCE",
              systemDrawer, // "Binance"
              currency,
              cryptoAmount,
              `Crypto received from customer`,
              createdBy,
            );
            upsertBalanceDelta.run(systemDrawer, currency, cryptoAmount);
          }

          // Fee payment: customer pays the fee via their chosen payment method
          if (fee > 0) {
            if (data.payments && data.payments.length > 0) {
              // Multi-payment: each leg goes to its respective drawer
              for (const p of data.payments) {
                if (p.method === "DEBT") continue;
                if (!isDrawerAffectingMethod(p.method)) continue;
                const drawerName = paymentMethodToDrawerName(p.method);
                insertPayment.run(
                  txnId,
                  p.method,
                  drawerName,
                  p.currencyCode,
                  Math.abs(p.amount),
                  `Binance fee payment`,
                  createdBy,
                );
                upsertBalanceDelta.run(
                  drawerName,
                  p.currencyCode,
                  Math.abs(p.amount),
                );
              }

              // Handle DEBT legs
              const debtLegs = data.payments.filter((p) => p.method === "DEBT");
              if (debtLegs.length > 0) {
                if (!data.clientName?.trim()) {
                  throw new Error(
                    "Client name is required when paying by debt",
                  );
                }
                if (!data.phoneNumber?.trim()) {
                  throw new Error(
                    "Phone number is required when paying by debt",
                  );
                }
                let resolvedClientId = data.clientId;
                if (!resolvedClientId && data.clientName && data.phoneNumber) {
                  const existing = this.db
                    .prepare(
                      `SELECT id FROM clients WHERE phone_number = ? LIMIT 1`,
                    )
                    .get(data.phoneNumber) as { id: number } | undefined;
                  if (existing) {
                    resolvedClientId = existing.id;
                  } else {
                    const insertResult = this.db
                      .prepare(
                        `INSERT INTO clients (full_name, phone_number, notes)
                         VALUES (?, ?, ?)`,
                      )
                      .run(
                        data.clientName,
                        data.phoneNumber,
                        "Auto-created from Binance fee debt",
                      );
                    resolvedClientId = Number(insertResult.lastInsertRowid);
                  }
                }
                if (resolvedClientId) {
                  this.db
                    .prepare(
                      `UPDATE transactions SET client_id = ? WHERE id = ?`,
                    )
                    .run(resolvedClientId, txnId);
                  for (const debtLeg of debtLegs) {
                    this.db
                      .prepare(
                        `INSERT INTO debt_ledger (
                          client_id, transaction_type, amount_usd, amount_lbp,
                          transaction_id, note, created_by, due_date
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
                      )
                      .run(
                        resolvedClientId,
                        "Service Debt",
                        debtLeg.currencyCode === "USD"
                          ? Math.abs(debtLeg.amount)
                          : 0,
                        debtLeg.currencyCode === "LBP"
                          ? Math.abs(debtLeg.amount)
                          : 0,
                        txnId,
                        `Binance ${data.serviceType} fee — $${data.amount} USDT`,
                        createdBy,
                      );
                  }
                }
              }
            } else {
              // Single payment for fee
              if (paidBy === "DEBT") {
                if (!data.clientName?.trim()) {
                  throw new Error(
                    "Client name is required when paying by debt",
                  );
                }
                if (!data.phoneNumber?.trim()) {
                  throw new Error(
                    "Phone number is required when paying by debt",
                  );
                }
                const existingClient = this.db
                  .prepare(
                    `SELECT id FROM clients WHERE phone_number = ? LIMIT 1`,
                  )
                  .get(data.phoneNumber) as { id: number } | undefined;
                const debtClientId = existingClient
                  ? existingClient.id
                  : Number(
                      this.db
                        .prepare(
                          `INSERT INTO clients (full_name, phone_number, notes)
                           VALUES (?, ?, ?)`,
                        )
                        .run(
                          data.clientName,
                          data.phoneNumber,
                          "Auto-created from Binance fee debt",
                        ).lastInsertRowid,
                    );
                this.db
                  .prepare(`UPDATE transactions SET client_id = ? WHERE id = ?`)
                  .run(debtClientId, txnId);
                this.db
                  .prepare(
                    `INSERT INTO debt_ledger (
                      client_id, transaction_type, amount_usd, amount_lbp,
                      transaction_id, note, created_by, due_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
                  )
                  .run(
                    debtClientId,
                    "Service Debt",
                    currency === "USD" ? fee : 0,
                    currency === "LBP" ? fee : 0,
                    txnId,
                    `Binance ${data.serviceType} fee — $${data.amount} USDT`,
                    createdBy,
                  );
              } else {
                // Cash or other payment method
                const feeDrawer = paymentMethodToDrawerName(paidBy);
                if (isDrawerAffectingMethod(paidBy)) {
                  insertPayment.run(
                    txnId,
                    paidBy,
                    feeDrawer,
                    currency,
                    fee,
                    `Binance fee`,
                    createdBy,
                  );
                  upsertBalanceDelta.run(feeDrawer, currency, fee);
                }
              }
            }

            // Commission row for profit reporting (fee = commission for Binance)
            // The fee amount is the shop's profit, already credited to the payment drawer above.
            // This COMMISSION row is for reporting only — no extra drawer delta.
            if (fee > 0) {
              const commDrawer =
                data.payments && data.payments.length > 0
                  ? paymentMethodToDrawerName(data.payments[0].method)
                  : paidBy
                    ? paymentMethodToDrawerName(paidBy)
                    : systemDrawer;
              insertPayment.run(
                txnId,
                "COMMISSION",
                commDrawer,
                currency,
                0, // No extra delta — fee already credited above
                `Commission (Binance fee: $${fee})`,
                createdBy,
              );
              // No upsertBalanceDelta — already handled above
            }
          }
        } else if (data.serviceType === "SEND") {
          // ─── SEND: customer gives money to shop, shop sends via provider ───
          //
          // Fee handling:
          //   includingFees=true  → data.amount is already the net sent amount (fee deducted by frontend).
          //                         Customer paid (data.amount + omtFee). Payment drawer gets (amount + fee).
          //                         OMT_System gets (amount + fee) = total OMT outflow.
          //   includingFees=false → data.amount is the full sent amount. Fee is charged on top.
          //                         Customer paid (data.amount + omtFee). Payment drawer gets (amount + fee).
          //                         OMT_System gets (amount + fee).
          // In both cases: OMT_System = sentAmount + omtFee.
          const sentAmount = Math.abs(data.amount);
          // Resolve the fee for this provider (OMT uses omtFee, WHISH uses whishFee/auto-lookup)
          const providerFeeAmt =
            data.provider === "OMT"
              ? (data.omtFee ?? 0)
              : data.provider === "WHISH"
                ? (storedWhishFee ?? 0)
                : 0;
          // Total collected from customer = sent amount + provider fee (regardless of includingFees mode,
          // because the frontend already adjusted data.amount to be the net sent amount when includingFees=true)
          const totalCollected = sentAmount + providerFeeAmt;

          // Amount the customer physically hands over = totalCollected + pmFee.
          // The pmFee stays in the payment method's wallet drawer as immediate shop profit.
          // Only totalCollected is transferred onward to the system drawer.
          const totalCustomerPays = totalCollected + pmFee;

          // Per-leg PM fee helper — defined here so it's available in both
          // the payment crediting block and the TRANSFER block below.
          // Distributes the total pmFee proportionally across non-cash legs.
          const totalNonCashPaid = data.payments
            ? data.payments
                .filter((p) => isNonCashDrawerMethod(p.method))
                .reduce((s, p) => s + Math.abs(p.amount), 0)
            : 0;
          const perLegPmFee = (leg: { method: string; amount: number }) => {
            if (
              !data.payments ||
              !isNonCashDrawerMethod(leg.method) ||
              totalNonCashPaid === 0
            )
              return 0;
            return (Math.abs(leg.amount) / totalNonCashPaid) * pmFee;
          };

          if (data.payments && data.payments.length > 0) {
            // Validate: DEBT leg requires client name + phone (for debt_ledger client_id)
            const hasDebtLeg = data.payments.some((p) => p.method === "DEBT");
            if (hasDebtLeg && !data.clientId) {
              if (!data.clientName?.trim()) {
                throw new Error("Client name is required when paying by debt");
              }
              if (!data.phoneNumber?.trim()) {
                throw new Error("Phone number is required when paying by debt");
              }
            }

            // Multi-payment mode:
            // The frontend bakes PM fee INTO the non-cash leg amounts before sending.
            // e.g. WHISH wallet $49.50 + $0.50 PM fee → sent as $50.00
            // We need to:
            //   1. Credit the FULL leg amount to the wallet drawer (customer payment in)
            //   2. Insert a PM_FEE row for the pm fee portion (for profit reporting)
            //   3. Transfer only (leg.amount - pmFee) to the system drawer

            for (const p of data.payments) {
              if (p.method === "DEBT") continue; // Debt handled separately below
              if (!isDrawerAffectingMethod(p.method)) continue;
              const drawerName = paymentMethodToDrawerName(p.method);
              const legPmFee = perLegPmFee(p);
              // Credit FULL amount (incl. PM fee) to wallet drawer
              insertPayment.run(
                txnId,
                p.method,
                drawerName,
                p.currencyCode,
                Math.abs(p.amount),
                note,
                createdBy,
              );
              upsertBalanceDelta.run(
                drawerName,
                p.currencyCode,
                Math.abs(p.amount),
              );
              // Insert PM_FEE audit row for non-cash legs (for profit page reporting)
              if (legPmFee > 0) {
                insertPayment.run(
                  txnId,
                  "PM_FEE",
                  drawerName,
                  p.currencyCode,
                  legPmFee,
                  `Payment method fee (${pmFeeRate ? `${(pmFeeRate * 100).toFixed(2)}%` : "flat"})`,
                  createdBy,
                );
                // Note: no extra balance delta — PM_FEE is already in the credited amount above
              }
            }

            // Handle DEBT legs: insert into debt_ledger linked to this transaction
            const debtLegs = data.payments.filter((p) => p.method === "DEBT");
            if (debtLegs.length > 0) {
              // Resolve clientId — use existing or find/create from name+phone
              let resolvedClientId = data.clientId;
              if (!resolvedClientId && data.clientName && data.phoneNumber) {
                // Try to find existing client by phone number
                const existing = this.db
                  .prepare(
                    `SELECT id FROM clients WHERE phone_number = ? LIMIT 1`,
                  )
                  .get(data.phoneNumber) as { id: number } | undefined;
                if (existing) {
                  resolvedClientId = existing.id;
                } else {
                  // Auto-create client — use the DB directly to get lastInsertRowid
                  const insertResult = this.db
                    .prepare(
                      `INSERT INTO clients (full_name, phone_number, notes)
                       VALUES (?, ?, ?)`,
                    )
                    .run(
                      data.clientName,
                      data.phoneNumber,
                      "Auto-created from service debt payment",
                    );
                  resolvedClientId = Number(insertResult.lastInsertRowid);
                }
              }

              if (!resolvedClientId) {
                throw new Error(
                  "Could not resolve client for debt — name and phone are required",
                );
              }

              // Update the unified transaction's client_id so it appears correctly
              // in profits by-client, activity logs, and debt detail eye button
              this.db
                .prepare(`UPDATE transactions SET client_id = ? WHERE id = ?`)
                .run(resolvedClientId, txnId);

              for (const debtLeg of debtLegs) {
                const debtAmtUsd =
                  debtLeg.currencyCode === "USD" ? Math.abs(debtLeg.amount) : 0;
                const debtAmtLbp =
                  debtLeg.currencyCode === "LBP" ? Math.abs(debtLeg.amount) : 0;
                const debtNote = `${data.provider} ${data.serviceType}${data.omtServiceType ? ` (${data.omtServiceType})` : ""} — $${data.amount}`;

                this.db
                  .prepare(
                    `INSERT INTO debt_ledger (
                      client_id, transaction_type, amount_usd, amount_lbp,
                      transaction_id, note, created_by, due_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
                  )
                  .run(
                    resolvedClientId,
                    "Service Debt",
                    debtAmtUsd,
                    debtAmtLbp,
                    txnId,
                    debtNote,
                    createdBy,
                  );
              }
            }
          } else {
            // Single payment: customer hands over totalCustomerPays (includes PM fee)
            if (paidBy === "DEBT") {
              // DEBT single payment: validate + find/create client + insert debt_ledger
              if (!data.clientName?.trim()) {
                throw new Error("Client name is required when paying by debt");
              }
              if (!data.phoneNumber?.trim()) {
                throw new Error("Phone number is required when paying by debt");
              }
              // Find or auto-create client
              const existingClient = this.db
                .prepare(
                  `SELECT id FROM clients WHERE phone_number = ? LIMIT 1`,
                )
                .get(data.phoneNumber) as { id: number } | undefined;
              const debtClientId = existingClient
                ? existingClient.id
                : Number(
                    this.db
                      .prepare(
                        `INSERT INTO clients (full_name, phone_number, notes)
                         VALUES (?, ?, ?)`,
                      )
                      .run(
                        data.clientName,
                        data.phoneNumber,
                        "Auto-created from service debt payment",
                      ).lastInsertRowid,
                  );

              // Update the unified transaction's client_id so it appears
              // correctly in profits by-client, activity logs, and debt detail
              this.db
                .prepare(`UPDATE transactions SET client_id = ? WHERE id = ?`)
                .run(debtClientId, txnId);

              this.db
                .prepare(
                  `INSERT INTO debt_ledger (
                    client_id, transaction_type, amount_usd, amount_lbp,
                    transaction_id, note, created_by, due_date
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
                )
                .run(
                  debtClientId,
                  "Service Debt",
                  currency === "USD" ? totalCollected : 0,
                  currency === "LBP" ? totalCollected : 0,
                  txnId,
                  `${data.provider} ${data.serviceType}${data.omtServiceType ? ` (${data.omtServiceType})` : ""} — $${data.amount}`,
                  createdBy,
                );
            } else {
              // Non-debt single payment: credit to drawer
              const paidByDrawer = paymentMethodToDrawerName(paidBy);
              if (isDrawerAffectingMethod(paidBy)) {
                insertPayment.run(
                  txnId,
                  paidBy,
                  paidByDrawer,
                  currency,
                  totalCustomerPays,
                  note,
                  createdBy,
                );
                upsertBalanceDelta.run(
                  paidByDrawer,
                  currency,
                  totalCustomerPays,
                );
              }
            }
          }

          // Record PM_FEE payment row for immediate profit tracking (single non-cash only;
          // for multi-payment the frontend already baked it into each leg's amount)
          if (pmFee > 0 && !(data.payments && data.payments.length > 0)) {
            const walletDrawer = paymentMethodToDrawerName(paidBy);
            insertPayment.run(
              txnId,
              "PM_FEE",
              walletDrawer,
              currency,
              pmFee,
              `Payment method fee (${pmFeeRate ? `${(pmFeeRate * 100).toFixed(2)}%` : "flat"})`,
              createdBy,
            );
            // Note: no extra upsertBalanceDelta here — the PM fee is already included
            // in the totalCustomerPays credited to the wallet drawer above.
            // This row is purely for reporting/profit visibility.
          }

          if (useSystemDrawerFlow) {
            // Reserve / transfer logic:
            //
            // CASH payment: General received the money (+totalCollected above).
            //   We reserve it back out of General (-totalCollected) so General nets to 0,
            //   and OMT_System / Whish_System tracks the full outflow.
            //
            // NON-CASH payment (OMT Wallet, WHISH Wallet, Binance, …):
            //   The payment method wallet received the money (+totalCollected above).
            //   We do NOT touch General at all — the shop has no cash, only wallet funds.
            //   Instead we transfer (amount + providerFee) from the wallet drawer to the
            //   system drawer directly, leaving any PM fee profit in the wallet naturally.
            //
            // In both cases the system drawer ends up with +totalCollected representing
            // the full amount owed to / by the provider.

            const isSystemProvider = isOMT || data.provider === "WHISH";
            if (isSystemProvider) {
              const isPaidByNonCash = data.payments
                ? // multi-payment: non-cash if ANY leg is non-cash
                  data.payments.some((p) => isNonCashDrawerMethod(p.method))
                : isNonCashDrawerMethod(paidBy);

              if (isPaidByNonCash) {
                // Non-cash: transfer from each wallet drawer to system drawer
                if (data.payments && data.payments.length > 0) {
                  // Multi-payment: transfer each non-cash leg proportionally
                  // IMPORTANT: only transfer (leg.amount - legPmFee) to system drawer.
                  // The pmFee portion stays in the wallet drawer as immediate shop profit.
                  for (const p of data.payments) {
                    if (!isNonCashDrawerMethod(p.method)) continue;
                    const walletDrawer = paymentMethodToDrawerName(p.method);
                    const legPmFee = perLegPmFee(p);
                    const transferAmt = Math.abs(p.amount) - legPmFee;
                    if (transferAmt <= 0) continue;
                    insertPayment.run(
                      txnId,
                      "TRANSFER",
                      walletDrawer,
                      p.currencyCode,
                      -transferAmt,
                      `Transfer to ${systemDrawer}`,
                      createdBy,
                    );
                    upsertBalanceDelta.run(
                      walletDrawer,
                      p.currencyCode,
                      -transferAmt,
                    );
                    // Net in wallet: +p.amount (customer in) - transferAmt (out) = +legPmFee ✓
                  }
                } else {
                  // Single non-cash payment: transfer only totalCollected (amount + providerFee)
                  // from wallet to system drawer. The pmFee stays in the wallet as shop profit.
                  const walletDrawer = paymentMethodToDrawerName(paidBy);
                  insertPayment.run(
                    txnId,
                    "TRANSFER",
                    walletDrawer,
                    currency,
                    -totalCollected,
                    `Transfer to ${systemDrawer}`,
                    createdBy,
                  );
                  upsertBalanceDelta.run(
                    walletDrawer,
                    currency,
                    -totalCollected,
                  );
                  // Net in wallet drawer: +totalCustomerPays (customer in) - totalCollected (transfer out) = +pmFee ✓
                }
              } else if (paidBy !== "DEBT") {
                // Cash payment: reserve from General (net 0 for General)
                // Skip for DEBT single payment — no cash was received, nothing to reserve
                insertPayment.run(
                  txnId,
                  "RESERVE",
                  "General",
                  currency,
                  -totalCollected,
                  "Cash reserve for settlement",
                  createdBy,
                );
                upsertBalanceDelta.run("General", currency, -totalCollected);
              }
            }

            // System drawer credit:
            // For single payment: +totalCollected (amount + providerFee)
            // For multi-payment: the system drawer tracks what the shop will pay OMT.
            //   = sentAmount + providerFee, but EXCLUDING any debt leg
            //   (debt is owed by the customer, not yet funded — OMT_System only gets
            //    funded portions from wallet transfers + cash reserve)
            let systemDrawerCredit = totalCollected;
            if (paidBy === "DEBT") {
              // Single DEBT payment: no funds received yet — OMT_System not credited
              systemDrawerCredit = 0;
            } else if (data.payments && data.payments.length > 0) {
              // Multi-payment: total actually funded = totalCollected - debtTotal
              const debtTotal = data.payments
                .filter((p) => p.method === "DEBT")
                .reduce((s, p) => s + Math.abs(p.amount), 0);
              systemDrawerCredit = Math.max(0, totalCollected - debtTotal);
            }

            // System drawer +(funded amount): tracks what shop will pay to/receive from provider
            insertPayment.run(
              txnId,
              data.provider,
              systemDrawer,
              currency,
              systemDrawerCredit,
              `${data.provider} system debt`,
              createdBy,
            );
            upsertBalanceDelta.run(systemDrawer, currency, systemDrawerCredit);
          }
        } else {
          // ─── RECEIVE: provider sends money to customer, shop pays cash out ───
          //
          // ONLY the system drawer is affected — the shop does NOT touch General here.
          //
          // OMT owes the shop: amount + commission
          //   - amount:     what the shop physically paid out to the customer
          //   - commission: the shop's cut (to be realized at settlement)
          //
          // So OMT_System decreases by (amount + commission):
          //   → tracks the full debt OMT has to repay the shop
          //
          // Example: $100 INTRA receive
          //   - Shop pays customer: $100
          //   - OMT owes shop: $100 + $0.10 = $100.10
          //   - OMT_System: -$100.10
          const receiveAmount = Math.abs(data.amount);
          const totalOwed = receiveAmount + Math.abs(calculatedCommission);

          if (useSystemDrawerFlow) {
            // System drawer -(amount + commission): OMT owes us this total
            insertPayment.run(
              txnId,
              data.provider,
              systemDrawer,
              currency,
              -totalOwed,
              `${data.provider} cash paid to customer (incl. commission)`,
              createdBy,
            );
            upsertBalanceDelta.run(systemDrawer, currency, -totalOwed);
          } else {
            // Other providers: single drawer, positive (money coming in)
            const drawerName = data.paidByMethod
              ? paymentMethodToDrawerName(data.paidByMethod)
              : systemDrawer;
            const paymentMethod = data.paidByMethod || data.provider;
            insertPayment.run(
              txnId,
              paymentMethod,
              drawerName,
              currency,
              receiveAmount,
              note,
              createdBy,
            );
            upsertBalanceDelta.run(drawerName, currency, receiveAmount);
          }
        }

        // Commission inflow:
        // - OMT/WHISH (SEND or RECEIVE): commission is pending settlement → NO drawer movement
        //   The commission will be credited to General when the shop settles with OMT/WHISH.
        // - BINANCE: handled in the BINANCE-specific block above
        // - Other providers (BOB, etc.) SEND: commission earned immediately → General
        if (calculatedCommission && calculatedCommission !== 0 && !isBINANCE) {
          const isOmtWhishProvider =
            data.provider === "OMT" || data.provider === "WHISH";
          if (!isOmtWhishProvider) {
            // Non-OMT/WHISH: immediate commission inflow to drawer
            const commDrawer = useSystemDrawerFlow
              ? "General"
              : data.paidByMethod
                ? paymentMethodToDrawerName(data.paidByMethod)
                : systemDrawer;
            const delta = Math.abs(calculatedCommission);
            insertPayment.run(
              txnId,
              "COMMISSION",
              commDrawer,
              currency,
              delta,
              "Commission",
              createdBy,
            );
            upsertBalanceDelta.run(commDrawer, currency, delta);
          }
          // OMT/WHISH: commission stored on financial_services row for reporting only.
          // No drawer movement until settlement (SupplierRepository.settleTransactions).
        }
      }

      // Auto-record supplier debt (both flows)
      try {
        const supplierRepo = getSupplierRepository();
        const supplier = supplierRepo.getByProvider(data.provider);
        if (supplier) {
          // Ledger amount:
          // SEND:    shop owes supplier (amount + fee) — total OMT outflow
          // RECEIVE: supplier owes shop (amount + commission) — total OMT debt to shop
          const omtFeeForLedger =
            !useCostPriceFlow &&
            data.serviceType === "SEND" &&
            (data.omtFee ?? 0) > 0
              ? (data.omtFee ?? 0)
              : 0;
          const receiveCommissionForLedger =
            !useCostPriceFlow && data.serviceType === "RECEIVE"
              ? Math.abs(commission)
              : 0;
          const ledgerAmount =
            useCostPriceFlow && cost > 0
              ? cost
              : Math.abs(data.amount) +
                omtFeeForLedger +
                receiveCommissionForLedger;

          // SEND = shop owes supplier (TOP_UP increases debt)
          // RECEIVE = supplier settles with shop (reduces debt)
          const isReceive = data.serviceType === "RECEIVE";
          supplierRepo.addLedgerEntry({
            supplier_id: supplier.id,
            entry_type: isReceive ? "PAYMENT" : "TOP_UP",
            amount_usd: currency === "USD" ? ledgerAmount : 0,
            amount_lbp: currency === "LBP" ? ledgerAmount : 0,
            note: `Auto: ${data.serviceType} via ${data.provider}${data.itemKey ? ` [${data.itemKey}]` : ""}`,
            created_by: createdBy,
          });
        }
      } catch {
        // Supplier auto-record is non-critical; don't fail the transaction
      }

      return { id, drawer: legacyDrawerLabel };
    })();
  }

  // ---------------------------------------------------------------------------
  // Query Operations
  // ---------------------------------------------------------------------------

  /**
   * Get transaction history, optionally filtered by provider
   */
  getHistory(provider?: string, limit: number = 50): FinancialServiceEntity[] {
    let query = `SELECT ${this.getColumns()} FROM financial_services`;
    const params: (string | number)[] = [];

    if (provider) {
      query += " WHERE provider = ?";
      params.push(provider);
    }

    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);

    return this.db.prepare(query).all(...params) as FinancialServiceEntity[];
  }

  // ---------------------------------------------------------------------------
  // Settlement Queries
  // ---------------------------------------------------------------------------

  /**
   * Get all unsettled financial_services rows for a given supplier (by provider name).
   * Only RECEIVE rows with commission > 0 and is_settled = 0 are returned.
   */
  getUnsettledBySupplier(provider: string): FinancialServiceEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM financial_services
         WHERE provider = ?
           AND is_settled = 0
           AND commission > 0
         ORDER BY created_at ASC`,
      )
      .all(provider) as FinancialServiceEntity[];
  }

  /**
   * Get a per-provider summary of unsettled commissions and total amounts owed.
   * Used by the Dashboard pending note and Profits pending tab.
   */
  getUnsettledSummaryByProvider(): UnsettledSummary[] {
    return this.db
      .prepare(
        `SELECT
           provider,
           COUNT(*) as count,
           COALESCE(SUM(CASE WHEN currency != 'LBP' THEN commission ELSE 0 END), 0) as pending_commission_usd,
           COALESCE(SUM(CASE WHEN currency  = 'LBP' THEN commission ELSE 0 END), 0) as pending_commission_lbp,
           -- total_owed = amount + commission (OMT owes the shop the full amount plus its commission)
           COALESCE(SUM(CASE WHEN currency != 'LBP' THEN ABS(amount) + commission ELSE 0 END), 0) as total_owed_usd,
           COALESCE(SUM(CASE WHEN currency  = 'LBP' THEN ABS(amount) + commission ELSE 0 END), 0) as total_owed_lbp
         FROM financial_services
         WHERE is_settled = 0
           AND commission > 0
         GROUP BY provider`,
      )
      .all() as UnsettledSummary[];
  }

  // ---------------------------------------------------------------------------
  // Analytics
  // ---------------------------------------------------------------------------

  /**
   * Get comprehensive analytics for financial services (all currencies)
   */
  getAnalytics(): FinancialServiceAnalytics {
    // Today's totals — split realized (settled) vs pending
    const todayStats = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as today_commission,
          COALESCE(SUM(CASE WHEN is_settled = 0 THEN commission ELSE 0 END), 0) as today_pending,
          COUNT(*) as today_count
        FROM financial_services
        WHERE DATE(created_at) = DATE('now', 'localtime')`,
      )
      .get() as {
      today_commission: number;
      today_pending: number;
      today_count: number;
    };

    // Today's breakdown by currency (realized only)
    const todayByCurrency = this.db
      .prepare(
        `SELECT
          currency,
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as commission,
          COUNT(*) as count
        FROM financial_services
        WHERE DATE(created_at) = DATE('now', 'localtime')
        GROUP BY currency`,
      )
      .all() as CurrencyStats[];

    // This month's totals — split realized vs pending
    const monthStats = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as month_commission,
          COALESCE(SUM(CASE WHEN is_settled = 0 THEN commission ELSE 0 END), 0) as month_pending,
          COUNT(*) as month_count
        FROM financial_services
        WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')`,
      )
      .get() as {
      month_commission: number;
      month_pending: number;
      month_count: number;
    };

    // This month's breakdown by currency (realized only)
    const monthByCurrency = this.db
      .prepare(
        `SELECT
          currency,
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as commission,
          COUNT(*) as count
        FROM financial_services
        WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
        GROUP BY currency`,
      )
      .all() as CurrencyStats[];

    // By Provider Today (all currencies, realized only)
    const byProvider = this.db
      .prepare(
        `SELECT
          provider,
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as commission,
          currency,
          COUNT(*) as count
        FROM financial_services
        WHERE DATE(created_at) = DATE('now', 'localtime')
        GROUP BY provider, currency`,
      )
      .all() as ProviderStats[];

    return {
      today: {
        commission: todayStats.today_commission,
        pending_commission: todayStats.today_pending,
        count: todayStats.today_count,
        byCurrency: todayByCurrency,
      },
      month: {
        commission: monthStats.month_commission,
        pending_commission: monthStats.month_pending,
        count: monthStats.month_count,
        byCurrency: monthByCurrency,
      },
      byProvider,
    };
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let financialServiceRepositoryInstance: FinancialServiceRepository | null =
  null;

export function getFinancialServiceRepository(): FinancialServiceRepository {
  if (!financialServiceRepositoryInstance) {
    financialServiceRepositoryInstance = new FinancialServiceRepository();
  }
  return financialServiceRepositoryInstance;
}

/** Reset the singleton (for testing) */
export function resetFinancialServiceRepository(): void {
  financialServiceRepositoryInstance = null;
}
