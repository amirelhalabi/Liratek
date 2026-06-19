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
  partitionLegs,
} from "../utils/payments.js";
import { getSupplierRepository } from "./SupplierRepository.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { getVoucherRepository } from "./VoucherRepository.js";
import { getDebtService } from "../services/DebtService.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  calculateCommission,
  lookupOmtFee,
  type OmtServiceType,
} from "../utils/omtFees.js";
import { lookupWhishFee } from "../utils/whishFees.js";
import { financialLogger } from "../utils/logger.js";

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
    | "WHISH_APP"
    | "OMT_APP"
    | "BINANCE";
  service_type: "SEND" | "RECEIVE";
  amount: number;
  currency: string;
  commission: number;
  cost: number;
  price: number;
  paid_by: string | null;
  /** Amount the customer actually paid (in `paid_currency`). Null when payment legs span multiple currencies. */
  paid_amount: number | null;
  /** Currency of `paid_amount`. May differ from `currency` (the service-denominated currency). */
  paid_currency: string | null;
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
  edited_by: string | null;
  edited_at: string | null;
  partner_id: number | null;
  partner_mode: "THROUGH" | "FOR" | null;
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
    | "WHISH_APP"
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
    /** Set when method === 'GIFT_CARD' — the voucher code being redeemed. */
    voucherCode?: string;
    /** IN (customer pays, default) or OUT (shop returns change to customer). */
    direction?: "IN" | "OUT";
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
  /**
   * Returned credits in USD when a Katsh telecom voucher is sold as "only days".
   * The credits are topped-up to the Alfa or MTC drawer (based on itemCategory)
   * minus SMS sending costs (0.16 USD per SMS, max 3 USD per SMS in 0.5 USD increments).
   */
  returnedCreditsUsd?: number;
  transaction_time?: string;
  /**
   * Cashout method for RECEIVE transactions: how the shop pays the customer.
   * - 'CASH' (default): debit General drawer (current behavior)
   * - 'CUSTOMER_ACCOUNT': don't debit drawer, create credit in debt_ledger
   */
  cashoutMethod?: "CASH" | "CUSTOMER_ACCOUNT" | "OMT" | "WHISH" | "BINANCE";
  /**
   * USD→LBP rate-of-record for this transaction. When omitted, the repository
   * stamps the current configured sell rate (Money IN). Provide it to capture an
   * operator-edited rate from the payment UI.
   */
  exchangeRate?: number;
  /** Partner ID: when set, this transaction involves a partner */
  partnerId?: number;
  /** Partner Mode: specifies if we use their system ('THROUGH') or they use our system ('FOR') */
  partnerMode?: "THROUGH" | "FOR";
  /**
   * Session-basket deferred payment mode (LIRA basket payment).
   * When true, the customer-cash side of this transaction is owned by the
   * customer-session basket recorder, NOT this transaction:
   *  - Cost/price flow: KEEP the cost outflow (provider drawer −cost) + crypto
   *    USDT leg; SKIP the price/cash inflow legs and any CUSTOMER_ACCOUNT debt.
   *  - OMT/WHISH SEND: KEEP the reserve transfer (General −totalCollected /
   *    *_System +totalCollected); SKIP the customer cash-in leg, pmFee handling,
   *    change, and debt. (The basket supplies the customer cash separately.)
   *  - OMT/WHISH/BINANCE RECEIVE (cashout): SKIP the customer cash-OUT payout
   *    leg (the basket handles the net OUT); KEEP the provider/system/crypto side.
   * Internal legs, the unified transaction, profit and exchange_rate are always
   * created. Non-session callers leave this falsy → behavior is unchanged.
   */
  deferPayment?: boolean;
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
    return "id, provider, service_type, amount, currency, commission, cost, price, paid_by, paid_amount, paid_currency, client_id, client_name, reference_number, phone_number, sender_name, sender_phone, receiver_name, receiver_phone, sender_client_id, receiver_client_id, omt_service_type, omt_fee, whish_fee, profit_rate, pay_fee, item_key, note, is_settled, settled_at, settlement_id, payment_method_fee, payment_method_fee_rate, created_at, created_by, edited_by, edited_at, partner_id, partner_mode";
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
      case "WHISH_APP":
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
   * Resolve (or create) the client to debt-charge for a Binance CUSTOMER_ACCOUNT
   * payment leg, and link the unified transaction row to that client.
   *
   * Throws if name/phone are missing and no clientId is available.
   */
  private resolveBinanceDebtClient(
    data: CreateFinancialServiceData,
    txnId: number,
  ): number {
    let resolvedClientId = data.clientId;

    if (!resolvedClientId) {
      if (!data.clientName?.trim()) {
        throw new Error("Client name is required when paying by debt");
      }
      if (!data.phoneNumber?.trim()) {
        throw new Error("Phone number is required when paying by debt");
      }
      const existing = this.db
        .prepare(`SELECT id FROM clients WHERE phone_number = ? LIMIT 1`)
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
            "Auto-created from Binance debt",
          );
        resolvedClientId = Number(insertResult.lastInsertRowid);
      }
    }

    this.db
      .prepare(`UPDATE transactions SET client_id = ? WHERE id = ?`)
      .run(resolvedClientId, txnId);

    return resolvedClientId;
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
      const paidBy =
        data.serviceType === "RECEIVE" && data.cashoutMethod
          ? data.cashoutMethod
          : data.paidByMethod || "CASH";

      const isThroughPartner = !!(
        data.partnerId &&
        (!data.partnerMode || data.partnerMode === "THROUGH")
      );
      const isForPartner = !!(data.partnerId && data.partnerMode === "FOR");
      const skipGeneralDrawer = isForPartner;
      const skipSystemDrawer = isThroughPartner;

      // Session-basket deferred payment: the customer-cash side is owned by the
      // basket recorder (recordBasketPayment), so this transaction must skip its
      // own customer cash-in/out legs, pmFee handling, change, and debt. Internal
      // legs (cost outflow, crypto USDT, OMT/WHISH reserve transfer + system
      // drawer) are still written so the ledger and settlement stay correct.
      const deferPayment = data.deferPayment === true;

      // ═══════════════════════════════════════════════════════════════════════
      // AUTO-CALCULATE COMMISSION FOR OMT SERVICES
      // ═══════════════════════════════════════════════════════════════════════
      let calculatedCommission = data.commission || 0;

      if (data.provider === "OMT" && data.omtServiceType) {
        const serviceType = data.omtServiceType as OmtServiceType;

        if (serviceType === "OMT_WALLET") {
          // OMT Wallet: no fee to customer, shop earns 0.1% of transfer amount
          calculatedCommission = calculateCommission(
            serviceType,
            0,
            data.amount,
          );
        } else if (serviceType === "ONLINE_BROKERAGE") {
          // Flat $3 per transaction
          calculatedCommission = calculateCommission(serviceType, 0);
        } else {
          // Standard OMT services: resolve fee from table or user-entered value,
          // then commission = resolvedFee × commissionRate.
          // If omtFee is explicitly 0, no commission (no fee → no commission).
          const resolvedFee =
            data.omtFee != null
              ? data.omtFee
              : (lookupOmtFee(serviceType, data.amount, currency) ?? 0);

          if (resolvedFee > 0) {
            calculatedCommission = calculateCommission(
              serviceType,
              resolvedFee,
            );
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════════
      // WHISH SYSTEM: No commission (profit = $0)
      // ═══════════════════════════════════════════════════════════════════════
      if (data.provider === "WHISH") {
        calculatedCommission = 0;
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
          ? data.whishFee != null
            ? data.whishFee
            : (lookupWhishFee(data.amount) ?? null)
          : null;

      const pmFee = data.paymentMethodFee ?? 0;
      const pmFeeRate = data.paymentMethodFeeRate ?? null;

      // Derive what the customer actually paid (amount + currency).
      // - Multi-payment lines, single currency  → sum + that currency
      // - Multi-payment lines, mixed currencies → null/null (caller must read payment legs)
      // - No payments array (legacy)            → service price in service currency
      let paidAmount: number | null;
      let paidCurrency: string | null;
      if (data.payments && data.payments.length > 0) {
        const currencies = new Set(data.payments.map((p) => p.currencyCode));
        if (currencies.size === 1) {
          paidAmount = data.payments.reduce((s, p) => s + p.amount, 0);
          paidCurrency = data.payments[0].currencyCode;
        } else {
          paidAmount = null;
          paidCurrency = null;
        }
      } else {
        paidAmount = price > 0 ? price : data.amount;
        paidCurrency = currency;
      }

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
          commission, cost, price, paid_by, paid_amount, paid_currency, client_id,
          client_name, reference_number, phone_number,
          sender_name, sender_phone, receiver_name, receiver_phone,
          sender_client_id, receiver_client_id,
          omt_service_type, omt_fee, whish_fee, profit_rate, pay_fee,
          item_key, note, is_settled, settled_at,
          payment_method_fee, payment_method_fee_rate, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
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
        paidAmount,
        paidCurrency,
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
        data.transaction_time ?? null,
      );

      const id = Number(result.lastInsertRowid);

      // Store partner_id and partner_mode on the record if provided
      if (data.partnerId) {
        this.db
          .prepare(
            `UPDATE financial_services SET partner_id = ?, partner_mode = ? WHERE id = ?`,
          )
          .run(data.partnerId, data.partnerMode || "THROUGH", id);
      }

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

      if (!resolvedPrimaryClientId && primaryName) {
        if (primaryPhone) {
          // Try to find existing client by phone number
          const existing = this.db
            .prepare(`SELECT id FROM clients WHERE phone_number = ? LIMIT 1`)
            .get(primaryPhone) as { id: number } | undefined;
          if (existing) {
            resolvedPrimaryClientId = existing.id;
          } else {
            // Auto-create client with phone
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
        } else {
          // No phone — try to find existing client by name
          const existing = this.db
            .prepare(`SELECT id FROM clients WHERE full_name = ? LIMIT 1`)
            .get(primaryName) as { id: number } | undefined;
          if (existing) {
            resolvedPrimaryClientId = existing.id;
          }
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
        profit_usd: currency === "USD" ? commission : 0,
        profit_lbp: currency === "LBP" ? commission : 0,
        client_id: resolvedPrimaryClientId ?? null,
        summary: (() => {
          const head = `${data.provider} ${data.serviceType}: ${primaryName ? `${primaryName} — ` : ""}${data.amount} ${currency}`;
          // When the customer paid in a currency different from the service-denominated
          // currency, surface that on the audit row so it's visible at a glance.
          if (
            paidCurrency &&
            paidAmount != null &&
            paidCurrency !== currency
          ) {
            const fmtPaid =
              paidCurrency === "LBP"
                ? `${Math.round(paidAmount).toLocaleString()} LBP`
                : `$${paidAmount.toFixed(2)}`;
            return `${head} (paid ${fmtPaid})`;
          }
          return head;
        })(),
        metadata_json: {
          provider: data.provider,
          service_type: data.serviceType,
          amount: data.amount,
          currency,
          commission,
          cost,
          price,
          paid_by: paidBy,
          paid_amount: paidAmount,
          paid_currency: paidCurrency,
          item_key: data.itemKey,
        },
        exchange_rate: data.exchangeRate ?? getUsdLbpSellRate(this.db),
        transaction_time: data.transaction_time,
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

      // Separate shop→customer change (OUT) legs up front so every inflow branch
      // below operates on customer-paid (IN) legs only. OUT legs are processed
      // once at the end of the transaction.
      const { inLegs: inPayments, outLegs: returnLegs } = partitionLegs(
        data.payments,
      );
      if (returnLegs.length > 0) {
        data.payments = inPayments;
      }

      if (useCostPriceFlow) {
        // ─── COST/PRICE FLOW (iPick, Katsh, WHISH_APP, OMT_APP, BINANCE) ───
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

        // Price inflow: customer pays the shop.
        // Deferred (session basket): the basket recorder owns the customer-cash
        // inflow + any on-account debt, so skip the whole inflow block here.
        if (deferPayment) {
          // no-op: customer cash + debt handled by recordBasketPayment
        } else if (data.payments && data.payments.length > 0) {
          // Multi-payment: iterate each payment leg
          let hasDebt = false;
          for (const p of data.payments) {
            if (p.method === "GIFT_CARD") {
              if (!p.voucherCode) {
                throw new Error("Gift card payment requires a voucher code");
              }
              // Deposit the voucher's full value to the owner's account; the leg
              // below is non-drawer, so the charge is consumed from that account
              // as CREDIT_USED.
              getVoucherRepository().redeemByCode({
                code: p.voucherCode.trim().toUpperCase(),
                context: "financial_service",
                transactionId: txnId,
                userId: createdBy,
              });
            }
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
          // Create debt for any CUSTOMER_ACCOUNT payment legs.
          // Split by the payment leg's own currency — NOT the service currency —
          // so a USD payment debits USD credit and an LBP payment debits LBP credit.
          if (hasDebt) {
            if (!data.clientId) {
              throw new Error("Cannot create debt without a client");
            }
            let debtUsd = 0;
            let debtLbp = 0;
            for (const p of data.payments) {
              if (isDrawerAffectingMethod(p.method)) continue;
              if (p.currencyCode === "USD") debtUsd += Math.abs(p.amount);
              else if (p.currencyCode === "LBP") debtLbp += Math.abs(p.amount);
            }
            this.db
              .prepare(
                `INSERT INTO debt_ledger (
                  client_id, transaction_type, amount_usd, amount_lbp, transaction_id, note, created_by, due_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+30 days'))`,
              )
              .run(
                data.clientId,
                "CREDIT_USED",
                debtUsd,
                debtLbp,
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
          if (paidBy === "CUSTOMER_ACCOUNT") {
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
                "CREDIT_USED",
                currency === "USD" ? price : 0,
                currency === "LBP" ? price : 0,
                txnId,
                `${data.provider} service${data.itemKey ? ` [${data.itemKey}]` : ""}`,
                createdBy,
              );
          }
        }

        // ─── RETURNED CREDITS (Katsh "Only Days" telecom vouchers) ───
        // When a telecom voucher (alfa/mtc) is sold as "only days", the credit
        // portion is returned to the shop. We top-up the corresponding drawer
        // (Alfa or MTC) with the full credit amount. SMS costs are paid by the
        // customer, not the shop.
        if (
          data.provider === "Katsh" &&
          data.returnedCreditsUsd &&
          data.returnedCreditsUsd > 0
        ) {
          const credits = data.returnedCreditsUsd;
          // Determine drawer from item category
          const isAlfa =
            data.itemCategory === "alfa" || data.itemCategory === "Alfa";
          const creditDrawer = isAlfa ? "Alfa" : "MTC";

          insertPayment.run(
            txnId,
            "CREDIT_RETURN",
            creditDrawer,
            "USD",
            credits,
            `Returned credits: ${credits} USD`,
            createdBy,
          );
          upsertBalanceDelta.run(creditDrawer, "USD", credits);
        }
      } else {
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
          // The crypto leg moves in USDT against the Binance drawer; the cash
          // leg moves in the customer's payment currency (USD) against the cash /
          // wallet drawer. These are two DIFFERENT currencies — never conflate
          // `currency` (USDT, the crypto denomination) with the cash drawer.
          //
          // SEND: shop sends crypto from its Binance account to a customer.
          //   - Binance drawer (USDT): -cryptoAmount   (crypto leaves the account)
          //   - Cash drawer (USD):     +(cryptoAmount + fee)  (customer pays cash in)
          //   - Fee is shop profit, captured implicitly (cash in − crypto out).
          //
          // RECEIVE: someone sends crypto to the shop's Binance account.
          //   - Binance drawer (USDT): +cryptoAmount   (crypto arrives)
          //   - Cash drawer (USD):     -(cryptoAmount - fee)  (shop pays customer out)
          //   - Fee is shop profit, captured implicitly (crypto in − cash out).
          const cryptoAmount = Math.abs(data.amount);
          const fee = Math.abs(calculatedCommission);

          // The Binance drawer always tracks the crypto denomination (USDT),
          // regardless of what `currency` was passed. The cash side uses the
          // payment-leg currency, defaulting to USD when no legs are provided.
          const cryptoCurrency = "USDT";
          const cashCurrency =
            data.payments && data.payments.length > 0
              ? data.payments[0].currencyCode
              : "USD";

          if (data.serviceType === "SEND") {
            // 1. Debit Binance drawer (USDT): crypto leaves the shop's account
            insertPayment.run(
              txnId,
              "BINANCE",
              systemDrawer, // "Binance"
              cryptoCurrency,
              -cryptoAmount,
              `Crypto sent to customer`,
              createdBy,
            );
            upsertBalanceDelta.run(systemDrawer, cryptoCurrency, -cryptoAmount);

            // 2. Credit the cash the customer hands over (cryptoAmount + fee).
            //    Multi-payment: credit each drawer-affecting leg in full; route
            //    CUSTOMER_ACCOUNT legs to debt. Single-payment: credit the whole
            //    total to the chosen drawer, or to debt for CUSTOMER_ACCOUNT.
            //    Deferred (session basket): the basket recorder owns the cash-in
            //    side, so skip it here (crypto USDT leg above is still written).
            if (deferPayment) {
              // no-op: customer cash + debt handled by recordBasketPayment
            } else if (data.payments && data.payments.length > 0) {
              for (const p of data.payments) {
                if (p.method === "CUSTOMER_ACCOUNT") continue;
                if (!isDrawerAffectingMethod(p.method)) continue;
                const drawerName = paymentMethodToDrawerName(p.method);
                insertPayment.run(
                  txnId,
                  p.method,
                  drawerName,
                  p.currencyCode,
                  Math.abs(p.amount),
                  `Binance SEND payment`,
                  createdBy,
                );
                upsertBalanceDelta.run(
                  drawerName,
                  p.currencyCode,
                  Math.abs(p.amount),
                );
              }

              // CUSTOMER_ACCOUNT legs → debt for the full on-account amount
              const debtLegs = data.payments.filter(
                (p) => p.method === "CUSTOMER_ACCOUNT",
              );
              if (debtLegs.length > 0) {
                const debtClientId = this.resolveBinanceDebtClient(data, txnId);
                for (const debtLeg of debtLegs) {
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
                      debtLeg.currencyCode === "USD"
                        ? Math.abs(debtLeg.amount)
                        : 0,
                      debtLeg.currencyCode === "LBP"
                        ? Math.abs(debtLeg.amount)
                        : 0,
                      txnId,
                      `Binance SEND — $${data.amount} USDT`,
                      createdBy,
                    );
                }
              }
            } else {
              // Single-payment fallback: customer pays cryptoAmount + fee.
              const cashTotal = cryptoAmount + fee;
              if (paidBy === "CUSTOMER_ACCOUNT") {
                const debtClientId = this.resolveBinanceDebtClient(data, txnId);
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
                    cashCurrency === "USD" ? cashTotal : 0,
                    cashCurrency === "LBP" ? cashTotal : 0,
                    txnId,
                    `Binance SEND — $${data.amount} USDT`,
                    createdBy,
                  );
              } else if (isDrawerAffectingMethod(paidBy)) {
                const cashDrawer = paymentMethodToDrawerName(paidBy);
                insertPayment.run(
                  txnId,
                  paidBy,
                  cashDrawer,
                  cashCurrency,
                  cashTotal,
                  `Binance SEND payment`,
                  createdBy,
                );
                upsertBalanceDelta.run(cashDrawer, cashCurrency, cashTotal);
              }
            }
          } else {
            // ─── RECEIVE ─────────────────────────────────────────────────────
            // 1. Credit Binance drawer (USDT): crypto arrives in the shop's account
            insertPayment.run(
              txnId,
              "BINANCE",
              systemDrawer, // "Binance"
              cryptoCurrency,
              cryptoAmount,
              `Crypto received from customer`,
              createdBy,
            );
            upsertBalanceDelta.run(systemDrawer, cryptoCurrency, cryptoAmount);

            // 2. Cash payout: shop pays customer (cryptoAmount - fee) in cash.
            //    Always posted, including in session-basket (deferred) mode: the
            //    customer pays nothing for a RECEIVE, so the basket recorder has
            //    no leg for this — the payout must be self-posted or it is lost.
            const payoutAmount = cryptoAmount - fee;
            const cashoutMethod = data.cashoutMethod || "CASH";

            if (payoutAmount > 0) {
              if (cashoutMethod === "CUSTOMER_ACCOUNT") {
                // Credit customer's account instead of paying cash
                if (!resolvedPrimaryClientId) {
                  throw new Error(
                    "Client is required for CUSTOMER_ACCOUNT cashout",
                  );
                }
                const debtService = getDebtService();
                debtService.addCredit({
                  clientId: resolvedPrimaryClientId,
                  amountUsd: cashCurrency === "USD" ? payoutAmount : 0,
                  amountLbp: cashCurrency === "LBP" ? payoutAmount : 0,
                  note: `Binance RECEIVE cashout — credited to account`,
                  userId: createdBy,
                });
              } else {
                // Debit the appropriate cash/wallet drawer based on cashout method
                const cashoutDrawer = paymentMethodToDrawerName(cashoutMethod);
                insertPayment.run(
                  txnId,
                  cashoutMethod,
                  cashoutDrawer,
                  cashCurrency,
                  -payoutAmount,
                  `${cashoutMethod} paid to customer (Binance RECEIVE)`,
                  createdBy,
                );
                upsertBalanceDelta.run(
                  cashoutDrawer,
                  cashCurrency,
                  -payoutAmount,
                );
              }
            }
          }

          // Commission row for profit reporting (fee = commission for Binance).
          // The fee is realized implicitly via the cash-vs-crypto spread above;
          // this row is reporting-only and carries no drawer delta.
          if (fee > 0) {
            insertPayment.run(
              txnId,
              "COMMISSION",
              systemDrawer,
              cashCurrency,
              0, // No drawer delta — fee already realized in the spread above
              `Commission (Binance fee: $${fee})`,
              createdBy,
            );
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

          if (deferPayment) {
            // Deferred (session basket): skip ALL customer cash-in legs, pmFee
            // rows, and debt creation. The reserve transfer + system drawer
            // credit below still run so General −totalCollected / *_System
            // +totalCollected stays intact (the reserve stays on the transaction).
          } else if (data.payments && data.payments.length > 0) {
            // Validate: DEBT leg requires client name + phone (for debt_ledger client_id)
            const hasDebtLeg = data.payments.some((p) => p.method === "CUSTOMER_ACCOUNT");
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
              if (p.method === "CUSTOMER_ACCOUNT") continue; // Debt handled separately below
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
            const debtLegs = data.payments.filter((p) => p.method === "CUSTOMER_ACCOUNT");
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
            if (paidBy === "CUSTOMER_ACCOUNT") {
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
              // Skip for partner transactions: the partner handles their customer directly,
              // no cash flows through the shop's General drawer.
              const paidByDrawer = paymentMethodToDrawerName(paidBy);
              if (isDrawerAffectingMethod(paidBy) && !data.partnerId) {
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
          // for multi-payment the frontend already baked it into each leg's amount).
          // Deferred (session basket): pmFee is owned by the basket — skip it here.
          if (
            !deferPayment &&
            pmFee > 0 &&
            !(data.payments && data.payments.length > 0)
          ) {
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
              // Deferred (session basket): the basket owns the customer cash-in,
              // so treat this leg as a cash reserve regardless of the original
              // payment method — General −totalCollected nets against the basket's
              // separate cash-in, and the system drawer tracks the full outflow.
              const isPaidByNonCash = deferPayment
                ? false
                : data.payments
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
              } else if (deferPayment || paidBy !== "CUSTOMER_ACCOUNT") {
                // Cash payment: reserve from General (net 0 for General)
                // Skip for DEBT single payment — no cash was received, nothing to reserve
                // Skip for FOR partner transactions — no cash flows through the shop's General drawer
                // Deferred (session basket): always reserve — the basket's separate
                // cash-in funds the reserve, so General nets to 0 across both.
                if (!skipGeneralDrawer) {
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
            }

            // System drawer credit:
            // For single payment: +totalCollected (amount + providerFee)
            // For multi-payment: the system drawer tracks what the shop will pay OMT.
            //   = sentAmount + providerFee, but EXCLUDING any debt leg
            //   (debt is owed by the customer, not yet funded — OMT_System only gets
            //    funded portions from wallet transfers + cash reserve)
            let systemDrawerCredit = totalCollected;
            if (deferPayment) {
              // Deferred (session basket): the basket funds the full outflow, so
              // the system drawer always tracks the entire totalCollected.
              systemDrawerCredit = totalCollected;
            } else if (paidBy === "CUSTOMER_ACCOUNT") {
              // Single DEBT payment: no funds received yet — OMT_System not credited
              systemDrawerCredit = 0;
            } else if (data.payments && data.payments.length > 0) {
              // Multi-payment: total actually funded = totalCollected - debtTotal
              const debtTotal = data.payments
                .filter((p) => p.method === "CUSTOMER_ACCOUNT")
                .reduce((s, p) => s + Math.abs(p.amount), 0);
              systemDrawerCredit = Math.max(0, totalCollected - debtTotal);
            }

            // System drawer +(funded amount): tracks what shop will pay to/receive from provider
            if (!skipSystemDrawer) {
              insertPayment.run(
                txnId,
                data.provider,
                systemDrawer,
                currency,
                systemDrawerCredit,
                `${data.provider} system debt`,
                createdBy,
              );
              upsertBalanceDelta.run(
                systemDrawer,
                currency,
                systemDrawerCredit,
              );
            }
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
          const cashoutMethod = data.cashoutMethod || "CASH";

          if (cashoutMethod === "CUSTOMER_ACCOUNT") {
            // CUSTOMER_ACCOUNT: don't debit any drawer, create credit in debt_ledger
            // The customer gets a credit on their account instead of cash payout.
            if (!resolvedPrimaryClientId) {
              throw new Error(
                "Client is required for CUSTOMER_ACCOUNT cashout",
              );
            }

            // Track system drawer for OMT/WHISH settlement purposes.
            // Skip for THROUGH-partner transactions — the system is theirs, not ours.
            if (useSystemDrawerFlow && !skipSystemDrawer) {
              insertPayment.run(
                txnId,
                data.provider,
                systemDrawer,
                currency,
                -totalOwed,
                `${data.provider} credited to customer account (incl. commission)`,
                createdBy,
              );
              upsertBalanceDelta.run(systemDrawer, currency, -totalOwed);
            }

            // Create credit entry via DebtService
            const debtService = getDebtService();
            debtService.addCredit({
              clientId: resolvedPrimaryClientId,
              amountUsd: currency === "USD" ? receiveAmount : 0,
              amountLbp: currency === "LBP" ? receiveAmount : 0,
              note: `${data.provider} RECEIVE cashout — credited to account`,
              userId: createdBy,
            });
          } else {
            // Non-CUSTOMER_ACCOUNT: debit the appropriate drawer based on cashout method
            // For CASH → General, OMT → OMT_App, WHISH → Whish_App, BINANCE → Binance
            const cashoutDrawer = paymentMethodToDrawerName(cashoutMethod);

            // System drawer: track what provider owes the shop
            if (useSystemDrawerFlow && !skipSystemDrawer) {
              // System drawer -(amount + commission): provider owes us this total
              insertPayment.run(
                txnId,
                data.provider,
                systemDrawer,
                currency,
                -totalOwed,
                `${data.provider} ${cashoutMethod} paid to customer (incl. commission)`,
                createdBy,
              );
              upsertBalanceDelta.run(systemDrawer, currency, -totalOwed);
            } else if (useSystemDrawerFlow && skipSystemDrawer) {
              // Partner transaction: system drawer not debited — partner handles the payout
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

            // Debit the cashout drawer for the payout to customer.
            // Deferred (session basket): an OMT/WHISH RECEIVE is a NEGATIVE cart
            // item in the same cash currency, so the checkout modal already nets
            // it into the basket total and emits the net cash-OUT leg the basket
            // recorder posts. Skip the payout here to avoid double-counting it.
            // (The system-drawer side above is kept so provider settlement stays
            // correct.) Non-session callers post it normally.
            if (
              !deferPayment &&
              cashoutMethod !== "CASH" &&
              useSystemDrawerFlow &&
              !skipSystemDrawer
            ) {
              // Wallet cashouts (OMT/WHISH/BINANCE): debit the wallet drawer
              insertPayment.run(
                txnId,
                cashoutMethod,
                cashoutDrawer,
                currency,
                -receiveAmount,
                `${cashoutMethod} paid to customer (${data.provider} RECEIVE)`,
                createdBy,
              );
              upsertBalanceDelta.run(cashoutDrawer, currency, -receiveAmount);
            } else if (
              !deferPayment &&
              cashoutMethod === "CASH" &&
              useSystemDrawerFlow &&
              !skipSystemDrawer &&
              !skipGeneralDrawer
            ) {
              // CASH cashout: shop physically pays the customer from the General drawer.
              // Skipped for FOR-partner mode (partner handles the payout, not our cash).
              insertPayment.run(
                txnId,
                "CASH",
                "General",
                currency,
                -receiveAmount,
                `Cash paid to customer (${data.provider} RECEIVE)`,
                createdBy,
              );
              upsertBalanceDelta.run("General", currency, -receiveAmount);
            }
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

      // Only the shop's PRIMARY (base) system owes its provider directly. The
      // secondary OMT/WHISH system runs via a partner, whose obligation is captured
      // in partner_ledger below — recording it as a supplier debt too double-counts
      // it and pollutes the suppliers/settlement page.
      let baseSystem = "OMT";
      try {
        const baseSystemRow = this.db
          .prepare(
            "SELECT value FROM system_settings WHERE key_name = 'shop_base_system'",
          )
          .get() as { value?: string } | undefined;
        if (baseSystemRow?.value === "WHISH") baseSystem = "WHISH";
      } catch {
        // system_settings may be absent in minimal/test schemas — default to OMT.
      }
      const skipSecondarySupplierLedger =
        (data.provider === "OMT" || data.provider === "WHISH") &&
        data.provider !== baseSystem;

      // Auto-record supplier debt (both flows)
      try {
        const supplierRepo = getSupplierRepository();
        const supplier = supplierRepo.getByProvider(data.provider);
        if (!supplier) {
          financialLogger.debug(
            { provider: data.provider },
            `Skipping supplier ledger for inactive provider: ${data.provider}`,
          );
        } else {
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

          // Ledger entry_type:
          //   RECEIVE                  → PAYMENT   (supplier settles with shop, reduces debt)
          //   SEND, cost/price flow    → SALE_COST (sale cost consumed from the provider
          //                               balance — a settleable sale-cost, NOT a manual top-up)
          //   SEND, legacy flow        → TOP_UP    (manual supplier top-up semantics)
          // SALE_COST and TOP_UP both increase what the shop owes the supplier (positive
          // amount). The distinct label lets the Settle tab surface real sale costs while
          // keeping balance math identical (every balance sum treats both the same).
          const isReceive = data.serviceType === "RECEIVE";
          const entryType: "PAYMENT" | "SALE_COST" | "TOP_UP" = isReceive
            ? "PAYMENT"
            : useCostPriceFlow
              ? "SALE_COST"
              : "TOP_UP";
          if (!skipSecondarySupplierLedger) {
            supplierRepo.addLedgerEntry({
              supplier_id: supplier.id,
              entry_type: entryType,
              amount_usd: currency === "USD" ? ledgerAmount : 0,
              amount_lbp: currency === "LBP" ? ledgerAmount : 0,
              note: `Auto: ${data.serviceType} via ${data.provider}${data.itemKey ? ` [${data.itemKey}]` : ""}`,
              created_by: createdBy,
            });
          }
        }
      } catch {
        // Supplier auto-record is non-critical; don't fail the transaction
      }

      // Auto-create partner ledger entry if this is a partner transaction
      if (data.partnerId) {
        const providerKey =
          data.provider === "OMT" || data.provider === "OMT_APP"
            ? "OMT"
            : "WHISH";
        const modePrefix = isForPartner ? "FOR_" : "THROUGH_";
        const ledgerType = `${modePrefix}${providerKey}_${data.serviceType}`;

        let direction = "";
        let ledgerAmount = Math.abs(data.amount);

        if (isThroughPartner) {
          direction = data.serviceType === "SEND" ? "CREDIT" : "DEBIT";
        } else {
          // isForPartner
          if (data.serviceType === "SEND") {
            direction = "DEBIT";
            const fee =
              data.provider === "WHISH"
                ? (storedWhishFee ?? 0)
                : data.omtFee != null
                  ? data.omtFee
                  : (lookupOmtFee(
                      data.omtServiceType as OmtServiceType,
                      Math.abs(data.amount),
                      currency,
                    ) ?? 0);
            ledgerAmount = data.includingFees
              ? Math.abs(data.amount)
              : Math.abs(data.amount) + fee;
          } else {
            direction = "CREDIT";
          }
        }

        this.db
          .prepare(
            `
          INSERT INTO partner_ledger (partner_id, transaction_type, reference_table, reference_id, amount, currency, direction, user_id, created_at)
          VALUES (?, ?, 'financial_services', ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        `,
          )
          .run(
            data.partnerId,
            ledgerType,
            id,
            ledgerAmount,
            currency,
            direction,
            1,
            data.transaction_time ?? null,
          );
      }

      // Return (OUT) legs: change handed back to the customer via a chosen method,
      // or kept as store credit. Debits the method's drawer (negative delta), or
      // deposits credit to the client's account for CUSTOMER_ACCOUNT.
      // Deferred (session basket): change is owned by the basket recorder.
      for (const r of deferPayment ? [] : returnLegs) {
        const amt = Math.abs(r.amount);
        if (amt <= 0) continue;
        if (r.method === "CUSTOMER_ACCOUNT") {
          if (!resolvedPrimaryClientId) {
            throw new Error(
              "Client is required to return change as store credit",
            );
          }
          getDebtService().addCredit({
            clientId: resolvedPrimaryClientId,
            amountUsd: r.currencyCode === "USD" ? amt : 0,
            amountLbp: r.currencyCode === "LBP" ? amt : 0,
            note: "Change returned",
            userId: createdBy,
          });
        } else if (isDrawerAffectingMethod(r.method)) {
          const drawerName = paymentMethodToDrawerName(r.method);
          insertPayment.run(
            txnId,
            r.method,
            drawerName,
            r.currencyCode,
            -amt,
            "Change returned",
            createdBy,
          );
          upsertBalanceDelta.run(drawerName, r.currencyCode, -amt);
        }
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
   *
   * Two kinds of rows are returned, both shaped as FinancialServiceEntity so the
   * Settle tab's "total owed − commission = net pay" math nets correctly:
   *
   *  1. OMT/WHISH commission settlement — RECEIVE rows with commission > 0 and
   *     is_settled = 0. Here owed = amount + commission and the shop keeps the
   *     commission, so net pay = amount.
   *
   *  2. Cost/price-flow sale costs — SEND rows written through a cost/price provider
   *     (iPick / Katsh / Whish App / OMT App) where cost > 0 and the supplier debt is
   *     not yet settled (settlement_id IS NULL). The shop owes the supplier the sale
   *     `cost` (booked as a SALE_COST ledger entry, never TOP_UP), with no supplier
   *     commission. These rows are projected with amount = cost and commission = 0 so
   *     net pay = cost. Settling one writes a negative SETTLEMENT ledger entry that nets
   *     the matching positive SALE_COST entry to zero — keeping getSupplierBalances()
   *     (which sums every ledger row) mathematically correct.
   *
   * NOTE on is_settled vs settlement_id: cost-flow SEND rows are created with
   * is_settled = 1 (their price−cost profit is realized immediately, so analytics keep
   * counting it as realized). Supplier reconciliation is therefore keyed off
   * settlement_id (NULL = supplier debt still outstanding), independent of is_settled.
   * Cost-flow sale costs can also be reconciled in bulk via a cumulative-balance
   * pay-down (Manual Entry → PAYMENT), which nets the SALE_COST entries directly.
   */
  getUnsettledBySupplier(provider: string): FinancialServiceEntity[] {
    return this.db
      .prepare(
        `SELECT ${this.getColumns()} FROM financial_services
           WHERE provider = ?
             AND is_settled = 0
             AND commission > 0
         UNION ALL
         SELECT ${this.getSaleCostSettleColumns()} FROM financial_services
           WHERE provider = ?
             AND service_type = 'SEND'
             AND cost > 0
             AND settlement_id IS NULL
         ORDER BY created_at ASC`,
      )
      .all(provider, provider) as FinancialServiceEntity[];
  }

  /**
   * Column projection for cost/price-flow SEND rows in the Settle tab.
   * Identical to getColumns() except `amount` is replaced by the sale `cost`
   * (the amount actually owed to the supplier) and `commission` is forced to 0
   * (cost-flow sales carry no supplier commission — the price−cost margin is the
   * shop's own profit, not deducted from the supplier payment). This makes the
   * frontend's `owed = amount + commission`, `net = owed − commission` resolve to
   * net = cost.
   */
  private getSaleCostSettleColumns(): string {
    return "id, provider, service_type, cost AS amount, currency, 0 AS commission, cost, price, paid_by, paid_amount, paid_currency, client_id, client_name, reference_number, phone_number, sender_name, sender_phone, receiver_name, receiver_phone, sender_client_id, receiver_client_id, omt_service_type, omt_fee, whish_fee, profit_rate, pay_fee, item_key, note, is_settled, settled_at, settlement_id, payment_method_fee, payment_method_fee_rate, created_at, created_by, edited_by, edited_at, partner_id, partner_mode";
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
  getAnalytics(providers?: string[]): FinancialServiceAnalytics {
    // Build optional provider filter clause
    const providerFilter =
      providers && providers.length > 0
        ? ` AND provider IN (${providers.map(() => "?").join(",")})`
        : "";
    const providerParams = providers && providers.length > 0 ? providers : [];

    // Today's totals — split realized (settled) vs pending
    const todayStats = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as today_commission,
          COALESCE(SUM(CASE WHEN is_settled = 0 THEN commission ELSE 0 END), 0) as today_pending,
          COUNT(*) as today_count
        FROM financial_services
        WHERE DATE(created_at) = DATE('now', 'localtime')${providerFilter}`,
      )
      .get(...providerParams) as {
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
        WHERE DATE(created_at) = DATE('now', 'localtime')${providerFilter}
        GROUP BY currency`,
      )
      .all(...providerParams) as CurrencyStats[];

    // This month's totals — split realized vs pending
    const monthStats = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as month_commission,
          COALESCE(SUM(CASE WHEN is_settled = 0 THEN commission ELSE 0 END), 0) as month_pending,
          COUNT(*) as month_count
        FROM financial_services
        WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')${providerFilter}`,
      )
      .get(...providerParams) as {
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
        WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')${providerFilter}
        GROUP BY currency`,
      )
      .all(...providerParams) as CurrencyStats[];

    // By Provider Today (all currencies, realized only)
    const byProvider = this.db
      .prepare(
        `SELECT
          provider,
          COALESCE(SUM(CASE WHEN is_settled = 1 THEN commission ELSE 0 END), 0) as commission,
          currency,
          COUNT(*) as count
        FROM financial_services
        WHERE DATE(created_at) = DATE('now', 'localtime')${providerFilter}
        GROUP BY provider, currency`,
      )
      .all(...providerParams) as ProviderStats[];

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

  /**
   * Update non-financial metadata on a financial service record.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: {
      client_name?: string;
      phone_number?: string;
      sender_name?: string;
      sender_phone?: string;
      receiver_name?: string;
      receiver_phone?: string;
      note?: string;
    },
    editedBy: string,
  ): FinancialServiceEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.client_name !== undefined) {
      fields.push("client_name = ?");
      values.push(data.client_name);
    }
    if (data.phone_number !== undefined) {
      fields.push("phone_number = ?");
      values.push(data.phone_number);
    }
    if (data.sender_name !== undefined) {
      fields.push("sender_name = ?");
      values.push(data.sender_name);
    }
    if (data.sender_phone !== undefined) {
      fields.push("sender_phone = ?");
      values.push(data.sender_phone);
    }
    if (data.receiver_name !== undefined) {
      fields.push("receiver_name = ?");
      values.push(data.receiver_name);
    }
    if (data.receiver_phone !== undefined) {
      fields.push("receiver_phone = ?");
      values.push(data.receiver_phone);
    }
    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) return existing;

    fields.push("edited_by = ?", "edited_at = CURRENT_TIMESTAMP");
    values.push(editedBy);
    values.push(id);

    this.db
      .prepare(
        `UPDATE financial_services SET ${fields.join(", ")} WHERE id = ?`,
      )
      .run(...values);

    return this.findById(id);
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
