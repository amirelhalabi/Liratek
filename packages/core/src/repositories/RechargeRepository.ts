/**
 * Recharge Repository
 *
 * Handles recharge-specific queries (virtual stock).
 * Uses recharges and drawer_balances tables.
 */

import type Database from "better-sqlite3";
import { BaseRepository } from "./BaseRepository.js";
import { rechargeLogger } from "../utils/logger.js";
import { getCurrentTenantId } from "../db/tenantContext.js";

import {
  paymentMethodToDrawerName,
  isDrawerAffectingMethod,
  partitionLegs,
} from "../utils/payments.js";
import { getTransactionRepository } from "./TransactionRepository.js";
import { getVoucherRepository } from "./VoucherRepository.js";
import {
  reconcileLegs,
  expectedTotalIn,
  applyDrawerDelta,
  insertPaymentRow,
  bookClientDebtCharge,
  assertPartnerIdRequired,
  assertNoCounterPayment,
  postPayoutLegs,
  usdEquivalent,
  resolveStampedExchangeRate,
} from "./moneyPosting.js";
import { getDebtService } from "../services/DebtService.js";
import { getUsdLbpSellRate } from "../utils/exchangeRate.js";
import {
  SMS_TRANSFER_FEE_USD,
  planSmsTransfer,
} from "../utils/telecomCredit.js";
import { getSupplierRepository } from "./SupplierRepository.js";
import { getPartnerRepository } from "./PartnerRepository.js";
import { TRANSACTION_TYPES } from "../constants/transactionTypes.js";
import {
  type TopUpProvider,
  TOP_UP_PROVIDER_DRAWERS,
  TOP_UP_PROVIDER_LABELS,
} from "../constants/index.js";
import {
  getCarrierLineRepository,
  type CarrierKey,
} from "./CarrierLineRepository.js";
import { getCarrierLineService } from "../services/CarrierLineService.js";
import { isSameLebanesePhone } from "../utils/phoneNumber.js";

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
  /**
   * `"CREDIT_BUYBACK"` (CARRIER_LINES_VALIDITY_PLAN.md Phase 6, D7/D8): the
   * operator detected the shop's OWN carrier line in the Credit tab's phone
   * field and flipped the form to a reversible buy-back — the customer hands
   * the shop credits, the shop pays cash out. Routed to
   * {@link RechargeRepository.processCreditBuyback} at the very top of
   * {@link RechargeRepository.processRecharge}, so it never reaches this
   * method's normal sale body; `amount` is reused as the credits gained
   * (USD face value) and `price` as the total cash paid out (in `currency`).
   */
  type:
    | "CREDIT_TRANSFER"
    | "VOUCHER"
    | "DAYS"
    | "TOP_UP"
    | "ALFA_GIFT"
    | "CREDIT_BUYBACK";
  amount: number;
  cost: number;
  price: number;
  default_price_to_client?: number;
  currency?: string; // Defaults to "USD"
  paid_by_method?: RechargePaidByMethod;
  /** Multi-payment support: when provided, overrides paid_by_method */
  payments?: Array<{
    method: string;
    currencyCode: string;
    amount: number;
    /** Set when method === 'GIFT_CARD' — the voucher code being redeemed. */
    voucherCode?: string;
    /** IN (customer pays, default) or OUT (shop returns change to customer). */
    direction?: "IN" | "OUT";
  }>;
  phoneNumber?: string;
  clientId?: number;
  clientName?: string;
  userId?: number;
  transaction_time?: string;
  /** T3 keep-change (KC-3): kept (not returned) change per currency —
   *  added to the transaction's profit stamp (tender-native amounts). */
  kept_change_usd?: number;
  kept_change_lbp?: number;
  /**
   * Payment-Legs Integrity plan (false-reject fix, 2026-07-2x): the USD→LBP
   * rate the caller's own till/MultiPaymentInput actually converted the
   * customer's tender at (e.g. the buy rate — the owner's 2026-07-06
   * MPI-buy-rate decision — which can differ from the sell-side rate this
   * repository stamps on `transactions.exchange_rate`). When present, leg
   * reconciliation (`reconcileLegs`) converts cross-currency legs at THIS
   * rate instead of the stamped rate — comparing at the SAME rate the till
   * used, so a legitimate buy/sell-spread checkout with change doesn't
   * false-reject (the owner's MTC CREDIT_TRANSFER repro: 720,000 LBP price,
   * $10 IN, 170,000 LBP OUT, till rate 89,000 vs. stamped sell rate 90,000).
   * `reconcileLegs` bands this against the stamped rate (±10%) and throws a
   * distinct error if it's implausibly far off. Omitted → current behavior,
   * reconciles at the stamped sell rate alone.
   *
   * Owner decision (2026-08-08, same repro): ALSO used to stamp
   * `transactions.exchange_rate` — via `resolveStampedExchangeRate`
   * (moneyPosting.ts), a non-throwing sibling of the reconciliation
   * band-check that falls back to the server (sell) rate silently outside
   * the band or when absent. This does NOT change what `reconcileLegs`/
   * `postPayoutLegs` reconcile against — they keep anchoring at the server
   * sell rate, unchanged.
   */
  tender_exchange_rate?: number;
  /**
   * Session-basket deferred payment mode. When true, the customer-cash inflow,
   * its debt, and any returned change are owned by the basket recorder; only the
   * telecom stock leg (and SMS cost) is written here. Non-session callers leave
   * this falsy → behavior is unchanged.
   */
  deferPayment?: boolean;
  /**
   * PFT-R (Partner FOR-Transactions, full-amount model): when set together
   * with `partnerMode === "FOR"`, this is NOT a walk-in customer sale — no
   * counter cash is taken at all. The FULL `price` books to `partner_ledger`
   * (FOR_RECHARGE DEBIT) against this partner, settled later on the Partners
   * page. The normal provider drawer consumption, stock, and SMS-cost flow
   * are unchanged; only the customer-payment step is replaced.
   */
  partnerId?: number;
  /** Only "FOR" is valid for recharges — the partner analog of CUSTOMER_ACCOUNT. */
  partnerMode?: "FOR";
}

export interface RechargeEntity {
  id: number;
  carrier: string;
  recharge_type: string;
  amount: number;
  cost: number;
  price: number;
  default_price_to_client: number | null;
  currency_code: string;
  paid_by: string;
  phone_number: string | null;
  client_id: number | null;
  client_name: string | null;
  note: string | null;
  created_at: string;
  created_by: number;
  edited_by: string | null;
  edited_at: string | null;
}

// =============================================================================
// Summary/note formatting
// =============================================================================

const RECHARGE_TYPE_LABELS: Record<RechargeData["type"], string> = {
  CREDIT_TRANSFER: "Credits",
  VOUCHER: "Voucher",
  DAYS: "Days",
  TOP_UP: "Top-up",
  ALFA_GIFT: "Gift",
  CREDIT_BUYBACK: "Credit Buy-back",
};

/**
 * Human-readable "what was actually recharged" detail, distinct from `price`
 * (what the customer was charged): DAYS is denominated in days, every other
 * type in the recharge's own dollar face value. Shown alongside price on the
 * unified transaction summary and the recharge/debt notes so an operator can
 * see both the quantity sold and the amount collected at a glance.
 */
function describeRechargeAmount(
  type: RechargeData["type"],
  amount: number,
): string {
  if (type === "DAYS") return `${amount} days`;
  if (type === "TOP_UP") return "";
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function rechargeDetailLabel(
  type: RechargeData["type"],
  amount: number,
): string {
  const label = RECHARGE_TYPE_LABELS[type] ?? type;
  const amountDetail = describeRechargeAmount(type, amount);
  return amountDetail ? `${label} ${amountDetail}` : label;
}

// =============================================================================
// Provider credit-stock consumption (CARRIER_LINES_VALIDITY_PLAN.md Phase 0)
// =============================================================================

/**
 * The setting key the Days tab's LBP conversion actually uses. Settings → Shop
 * Config writes it (`ShopConfig.tsx`) and both telecom submit paths read it
 * (`Recharge/index.tsx`, `TelecomForm.tsx` — `alfaCreditCostRate`).
 *
 * **Not `telecom_credit_cost_rate_lbp`.** Those two keys hold the same number
 * today and that is deliberate, not redundant — see the note on
 * `TELECOM_CREDIT_COST_RATE_LBP` in utils/telecomCredit.ts. One is the cost of
 * credit bought DIRECTLY as a top-up (this one), the other the cost of credit
 * that arrives EMBEDDED in a prepaid card. Nothing keeps them in sync, so
 * inverting at the wrong one silently breaks the moment an owner edits Shop
 * Config.
 */
// NOTE the key: `alfa_credit_cost_lbp`, NOT `telecom_credit_cost_rate_lbp`.
// Both exist, both sit near 85,000, and they are deliberately separate — see
// migration v141's note ("named distinctly from the existing
// alfa_credit_sell_rate_lbp / alfa_credit_cost_rate_lbp / alfa_credit_cost_lbp
// keys"). `telecom_credit_cost_rate_lbp` is the card-embedded credit rate (R)
// used to split an Only-Days item's cost; this one is the Alfa/MTC direct
// credit rate the Days tab multiplies by. Inverting at the wrong one is
// lossless only while the two happen to hold equal values, and silently wrong
// the moment an owner edits Shop Config.
const ALFA_CREDIT_COST_RATE_SETTING = "alfa_credit_cost_lbp";

/**
 * The frontend's own hardcoded fallback when the setting is unset
 * (`alfaCreditCostRate || 85000` / `useState(85000)`). Duplicated here on
 * purpose rather than aliased to `TELECOM_CREDIT_COST_RATE_LBP`: that
 * constant has been re-anchored before (migration v146 moved it from 93,333.33
 * to 85,000) and re-anchoring it again must NOT silently make this inversion
 * disagree with what the form multiplied by.
 */
const ALFA_CREDIT_COST_RATE_FALLBACK_LBP = 85_000;

/**
 * The tenant's cost of $1 of telecom credit in LBP, resolved through the SAME
 * chain the Recharge page uses before it multiplies the Days tab's `Cost ($)`
 * field by it (`cost = parseFloat(telecomDaysCostUsd) * (alfaCreditCostRate ||
 * 85000)`).
 *
 * Dividing by this exact rate is what makes the LBP→USD inversion below
 * lossless. The USD/LBP *sell* rate is a different number, so inverting at it
 * would debit the provider drawer an amount the operator never saw on screen —
 * which is precisely what plan §0.3 forbids, since the Cost field is editable.
 *
 * Defensive in the same style as `getUsdLbpSellRate`: a missing table/row or an
 * unusable value falls back to the named default rather than throwing inside a
 * money transaction.
 */
function getAlfaCreditCostRateLbp(
  db: Database.Database,
  tenantId: number,
): number {
  try {
    const row = db
      .prepare(
        `SELECT value FROM system_settings
         WHERE key_name = ? AND tenant_id = ?`,
      )
      .get(ALFA_CREDIT_COST_RATE_SETTING, tenantId) as
      | { value?: string | null }
      | undefined;
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : ALFA_CREDIT_COST_RATE_FALLBACK_LBP;
  } catch {
    return ALFA_CREDIT_COST_RATE_FALLBACK_LBP;
  }
}

/** One negative USD movement against the provider (MTC/Alfa) credit drawer. */
interface TelecomStockLeg {
  /** `payments.method` — the carrier for a credit send, a distinct marker
   *  otherwise (mirrors the `SMS_COST` leg's labelling). */
  method: string;
  /** Signed USD delta (always ≤ 0 here). */
  amountUsd: number;
  note: string;
}

/**
 * Which USD figure leaves the provider credit drawer for a given recharge type,
 * and how that leg is labelled. Returns `null` when the type consumes nothing.
 *
 * **`data.amount` is not always dollars.** It is the USD face value of the
 * credit sent for every type EXCEPT `DAYS`, where it is a **day count** (see
 * `describeRechargeAmount` above). The pre-fix code applied
 * `-Math.abs(data.amount)` unconditionally, so selling 30 days debited the MTC
 * drawer $30.00 instead of the $0.90 the three SMSes actually cost — a 33x
 * over-deduction (owner ruling 2026-08-06: each SMS adds 10 days and costs the
 * shop $0.30; the shop's own validity never moves).
 *
 * The days figure comes from the operator-submitted cost, already converted to
 * USD by the caller — never recomputed from the day count, because the Days
 * tab's `Cost ($)` field is editable and a recomputed drawer debit would
 * disagree with the profit stamp on the same sale (plan §0.3).
 *
 * Exhaustive by construction: every member of `RechargeData["type"]` has its
 * own arm and there is deliberately no `default`, so adding a type fails the
 * build here (missing return) instead of silently inheriting the wrong unit.
 */
function telecomStockLeg(args: {
  type: RechargeData["type"];
  /** Carrier label used as the `method` on a credit-send leg. */
  carrier: string;
  /** `data.amount` — USD face value, or a DAY COUNT when type is `DAYS`. */
  amount: number;
  /** The DAYS cost in USD (already inverted from the submitted cost). */
  daysCostUsd: number;
}): TelecomStockLeg | null {
  switch (args.type) {
    case "CREDIT_TRANSFER":
    case "VOUCHER":
    case "TOP_UP":
    case "ALFA_GIFT":
      // `amount` is USD face value — consumed from the credit stock 1:1.
      return {
        method: args.carrier,
        amountUsd: -Math.abs(args.amount),
        note: "Telecom balance sent",
      };
    case "DAYS": {
      // The day count contributes ZERO. Only the days cost moves the drawer.
      const cost = Math.abs(args.daysCostUsd);
      if (!Number.isFinite(cost) || cost <= 0) return null;
      return {
        method: "VALIDITY_DAYS_COST",
        amountUsd: -cost,
        note: `Validity days cost: ${args.amount} days`,
      };
    }
    case "CREDIT_BUYBACK":
      // Unreachable in practice: `processRecharge` dispatches a
      // CREDIT_BUYBACK payload to `processCreditBuyback` before this
      // function is ever called (see the type's own doc comment). Kept as
      // an explicit arm — not folded under a `default` — so the exhaustive-
      // switch contract this function documents keeps holding if that
      // dispatch is ever removed.
      return null;
  }
}

// =============================================================================
// Recharge Repository Class
// =============================================================================

export class RechargeRepository extends BaseRepository<RechargeEntity> {
  constructor() {
    super("recharges", { softDelete: false });
  }

  protected getColumns(): string {
    return "id, carrier, recharge_type, amount, cost, price, default_price_to_client, currency_code, paid_by, phone_number, client_id, client_name, note, created_at, created_by, edited_by, edited_at";
  }

  /**
   * Get recharge history for a specific provider
   */
  getHistory(provider: "MTC" | "Alfa"): RechargeEntity[] {
    const rows = this.db
      .prepare(
        `SELECT ${this.getColumns()}
         FROM recharges
         WHERE carrier = ? AND tenant_id = ?
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all(provider, getCurrentTenantId()) as RechargeEntity[];

    return rows;
  }

  /**
   * Get virtual stock totals for MTC and Alfa from drawer balances
   * This reads from the drawer_balances table instead of products table
   */
  getVirtualStock(currency = "USD"): VirtualStock {
    const tenantId = getCurrentTenantId();
    const mtc = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'MTC' AND currency_code = ? AND tenant_id = ?",
      )
      .get(currency, tenantId) as { balance: number | null };

    const alfa = this.db
      .prepare(
        "SELECT balance FROM drawer_balances WHERE drawer_name = 'Alfa' AND currency_code = ? AND tenant_id = ?",
      )
      .get(currency, tenantId) as { balance: number | null };

    return {
      mtc: mtc?.balance || 0,
      alfa: alfa?.balance || 0,
    };
  }

  /**
   * Top up provider drawer from another drawer.
   * This is a drawer-to-drawer transfer with no fees or commission.
   * Records a TOP_UP entry in the recharges table.
   */
  topUpApp(data: {
    provider: TopUpProvider;
    amount: number;
    currency: string;
    sourceDrawer: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const tenantId = getCurrentTenantId();

      // Validate source drawer has sufficient balance
      const sourceBalanceRow = this.db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?",
        )
        .get(data.sourceDrawer, currency, tenantId) as {
        balance: number | null;
      };

      const sourceBalance = sourceBalanceRow?.balance ?? 0;
      if (sourceBalance < amount) {
        return {
          success: false,
          error: `Insufficient balance in ${data.sourceDrawer}. Available: ${sourceBalance} ${currency}`,
        };
      }

      this.db.transaction(() => {
        // Record the top-up in recharges table
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, ?, ?, ?, ?)`,
          )
          .run(
            data.provider,
            amount,
            currency,
            data.sourceDrawer,
            `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up from ${data.sourceDrawer}: +${amount} ${currency}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          summary: `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up: ${data.sourceDrawer} → ${destDrawer}: ${amount} ${currency}`,
          metadata_json: {
            provider: data.provider,
            amount,
            currency,
            sourceDrawer: data.sourceDrawer,
            destDrawer,
          },
        });

        // Deduct from source drawer. CQ-3 survey note: intentionally NOT
        // `applyDrawerDelta` — a plain UPDATE that must NOT create a row for
        // a missing source drawer (a typo'd/missing source must no-op, not
        // silently create a phantom negative-balance drawer).
        this.db
          .prepare(
            `UPDATE drawer_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
             WHERE drawer_name = ? AND currency_code = ? AND tenant_id = ?`,
          )
          .run(amount, data.sourceDrawer, currency, tenantId);

        // Add to destination drawer
        applyDrawerDelta(this.db, {
          drawerName: destDrawer,
          currencyCode: currency,
          delta: amount,
          tenantId,
        });
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          amount: data.amount,
          currency,
          sourceDrawer: data.sourceDrawer,
          destDrawer,
        },
        `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up: ${data.sourceDrawer} → ${destDrawer}: ${amount} ${currency}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "App top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get all drawer balances
   */
  getDrawerBalances(): Array<{
    name: string;
    usdBalance: number;
    lbpBalance: number;
    usdtBalance: number;
  }> {
    try {
      const rows = this.db
        .prepare(
          `SELECT drawer_name, currency_code, balance
           FROM drawer_balances
           WHERE currency_code IN ('USD', 'LBP', 'USDT') AND tenant_id = ?
           ORDER BY drawer_name`,
        )
        .all(getCurrentTenantId()) as Array<{
        drawer_name: string;
        currency_code: string;
        balance: number;
      }>;

      const drawerMap = new Map<
        string,
        { usdBalance: number; lbpBalance: number; usdtBalance: number }
      >();

      for (const row of rows) {
        if (!drawerMap.has(row.drawer_name)) {
          drawerMap.set(row.drawer_name, {
            usdBalance: 0,
            lbpBalance: 0,
            usdtBalance: 0,
          });
        }
        const drawer = drawerMap.get(row.drawer_name)!;
        if (row.currency_code === "USD") drawer.usdBalance = row.balance;
        else if (row.currency_code === "LBP") drawer.lbpBalance = row.balance;
        else if (row.currency_code === "USDT") drawer.usdtBalance = row.balance;
      }

      return Array.from(drawerMap.entries()).map(([name, balances]) => ({
        name,
        usdBalance: balances.usdBalance,
        lbpBalance: balances.lbpBalance,
        usdtBalance: balances.usdtBalance,
      }));
    } catch (error) {
      rechargeLogger.error({ error }, "Failed to get drawer balances");
      return [];
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
    // CARRIER_LINES_VALIDITY_PLAN.md Phase 6 (D7/D8): a credit buy-back is a
    // fundamentally different money direction (payout, not a sale) — routed
    // to its own method before any of this method's sale-shaped logic runs.
    if (data.type === "CREDIT_BUYBACK") {
      return this.processCreditBuyback(data);
    }

    try {
      const result = this.db.transaction(() => {
        const detail = rechargeDetailLabel(data.type, data.amount);
        const note = `${data.provider} ${detail}${data.phoneNumber ? ` - ${data.phoneNumber}` : ""}`;
        const paidBy = data.paid_by_method || "CASH";
        const currency = data.currency ?? "USD";
        const createdBy = data.userId ?? 1;
        const tenantId = getCurrentTenantId();

        // 1. Create Recharge Record (goes into recharges table, not sales)
        const clientName = data.clientId
          ? ((
              this.db
                .prepare(
                  "SELECT full_name FROM clients WHERE id = ? AND tenant_id = ?",
                )
                .get(data.clientId, tenantId) as
                | { full_name: string }
                | undefined
            )?.full_name ??
            data.clientName ??
            null)
          : (data.clientName ?? null);

        const insertRecharge = this.db.prepare(`
          INSERT INTO recharges (
            carrier, recharge_type, amount, cost, price, default_price_to_client, currency_code,
            paid_by, phone_number, client_id, client_name, note, created_by, tenant_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        `);
        const rechargeResult = insertRecharge.run(
          data.provider,
          data.type,
          data.amount,
          data.cost,
          data.price,
          data.default_price_to_client ?? null,
          currency,
          paidBy,
          data.phoneNumber || null,
          data.clientId || null,
          clientName,
          note,
          createdBy,
          tenantId,
          data.transaction_time ?? null,
        );
        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // 2. Create unified transaction row
        // rechargeCommission is denominated in the SALE currency (price and
        // cost share it), but the SMS cost is a USD figure — for LBP-priced
        // transfers it must be converted before subtracting, otherwise ~$0.32
        // is shaved off an LBP amount (currency mixing).
        const rechargeCommission = data.price - data.cost;
        // Carrier SMS rules live in ONE place (rule 14, LIRA-090 spec §2.1) —
        // utils/telecomCredit.ts. This now goes through the one SMS transfer
        // function (planSmsTransfer, TELECOM_DAYS_COST_PLAN.md §9/§6) shared
        // with the resale decision table's deliveredCostLbp; same ceil(amount
        // / 3) messages count as before, so this is behaviour-preserving.
        const smsCount =
          data.type === "CREDIT_TRANSFER"
            ? planSmsTransfer(data.amount).messages
            : 0;
        const smsCostUsd = smsCount * SMS_TRANSFER_FEE_USD;
        const sellRate = getUsdLbpSellRate(this.db);
        // Owner decision (2026-08-08, repro: buy 89,000 vs. sell 90,000):
        // the `transactions.exchange_rate` stamp reflects the operator's
        // tendered rate when it's within the reconciliation band of `sellRate`
        // (see `resolveStampedExchangeRate`'s doc on `RechargeData.
        // tender_exchange_rate`); falls back to `sellRate` silently otherwise.
        // `reconcileLegs` below keeps anchoring at `sellRate` — unaffected.
        const recordExchangeRate = resolveStampedExchangeRate(
          sellRate,
          data.tender_exchange_rate,
        );
        const smsCostInSaleCurrency =
          currency === "LBP" ? smsCostUsd * sellRate : smsCostUsd;
        const netRechargeCommission =
          rechargeCommission - smsCostInSaleCurrency;
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: createdBy,
          amount_usd: currency === "USD" ? data.price : 0,
          amount_lbp: currency === "LBP" ? data.price : 0,
          // Net commission (sale currency) + kept change (T3, tender-native).
          profit_usd:
            (currency === "USD" ? netRechargeCommission : 0) +
            (data.kept_change_usd ?? 0),
          profit_lbp:
            (currency === "LBP" ? netRechargeCommission : 0) +
            (data.kept_change_lbp ?? 0),
          client_id: data.clientId ?? null,
          // For-partner recharges label the row with the partner (owner ask:
          // the transactions table shows "<partner> [partner]").
          client_name:
            data.partnerMode === "FOR" && data.partnerId
              ? `${getPartnerRepository().getById(data.partnerId)?.name ?? `#${data.partnerId}`} [partner]`
              : (clientName ?? null),
          summary: `Recharge: ${data.provider} ${detail} — ${currency === "LBP" ? "" : "$"}${data.price.toLocaleString()} ${currency}`,
          metadata_json: {
            provider: data.provider,
            type: data.type,
            amount: data.amount,
            cost: data.cost,
            price: data.price,
            currency,
            paid_by: paidBy,
            phone: data.phoneNumber,
          },
          exchange_rate: recordExchangeRate,
          transaction_time: data.transaction_time,
        });

        // 3. Update running balances
        const methodDrawerName = paymentMethodToDrawerName(paidBy);
        const providerDrawerName = data.provider === "MTC" ? "MTC" : "Alfa";

        // insertPayment / upsertBalanceDelta are shared wrapper objects used
        // by several call sites below. Wrapped (rather than threading
        // tenant_id through every call site) so the existing `.run(...)`
        // call sites — all money-flow control logic, untouched — transparently
        // carry the current tenant. CQ-3: the SQL itself now lives in the
        // shared moneyPosting helpers, called from inside these wrappers —
        // every call site below is unchanged.
        const insertPayment = {
          run: (
            transactionId: number,
            method: string,
            drawerName: string,
            currencyCode: string,
            amount: number,
            note: string | null,
            createdBy: number,
          ) =>
            insertPaymentRow(this.db, {
              transactionId,
              method,
              drawerName,
              currencyCode,
              amount,
              note,
              createdBy,
              tenantId,
            }),
        };

        const upsertBalanceDelta = {
          run: (drawerName: string, currencyCode: string, balance: number) =>
            applyDrawerDelta(this.db, {
              drawerName,
              currencyCode,
              delta: balance,
              tenantId,
            }),
        };

        // PFT-R (Partner FOR-Transactions, full-amount model): a "for
        // partner" recharge has NO walk-in customer and takes NO counter
        // cash — the partner owes the FULL price, settled later on the
        // Partners page. Computed before touching any payment legs so the
        // customer-cash step below can be skipped entirely in partner mode.
        const isForPartner = data.partnerMode === "FOR";
        if (isForPartner) {
          assertPartnerIdRequired(data.partnerId);
        }

        // Customer payment (cash-like inflow). Split returned-change (OUT) legs
        // out so the inflow loop and debt calc only see customer-paid (IN) legs.
        const { inLegs: inPayments, outLegs: returnLegs } = partitionLegs(
          data.payments,
        );
        if (isForPartner) {
          // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §3 slice 2: wire the
          // REAL legacy field. `data.paid_by_method` is read independently
          // by the walk-in single-payment fallback (the `paidBy` local,
          // line ~597) — nothing folds it into `inPayments`, so a stale
          // non-CASH value (e.g. a leftover "CUSTOMER_ACCOUNT" from before
          // the operator ticked the partner checkbox) used to sail through
          // and still get stamped into `metadata_json.paid_by`/
          // `recharges.paid_by` (line ~702) even though nothing executed —
          // the same audit-trail gap LIRA-114 reported for Custom Services.
          // Safe to pass unconditionally: no FOR-partner recharge caller
          // (TelecomForm.tsx's `handleForPartnerSubmit`) ever sends
          // `paid_by_method` at all — this branch takes the full price
          // straight to `partner_ledger` with no drawer leg of any kind, so
          // there is no legitimate disbursement-source concept here (unlike
          // Financial Services' transfer SEND); any non-CASH value reaching
          // this point is dead data.
          assertNoCounterPayment(
            inPayments.length > 0,
            data.paid_by_method,
            "recharge",
          );
        }
        const deferPayment = data.deferPayment === true;

        // CARRIER_LINES_VALIDITY_PLAN.md Phase 7 — backend guard, not
        // frontend inspection. `paid_by_method: "MULTI"` is ONLY ever a
        // truthful value when the caller actually split the payment into
        // 2+ legs (Recharge/index.tsx's `derivePaidByMethod`, mirroring the
        // crypto/FinancialForm/KatchForm pattern) — it is never a real
        // payment method. If `inPayments` is empty despite `paidBy ===
        // "MULTI"` (a REST caller whose `payments[]` got stripped/omitted,
        // or any other caller that lies about having split), the legacy
        // single-method fallback below would post the WHOLE `data.price`
        // into whatever drawer `paymentMethodToDrawerName("MULTI")`
        // resolves to (General, via the unknown-method fallback) instead of
        // across the real legs — silently wrong, not merely stale. Excludes
        // isForPartner/deferPayment: both legitimately carry zero inPayments
        // by contract (the partner ledger / session basket owns the
        // customer-cash side there), so `paidBy` is irrelevant in those
        // branches regardless of its value.
        if (
          !isForPartner &&
          !deferPayment &&
          paidBy === "MULTI" &&
          inPayments.length === 0
        ) {
          throw new Error(
            "Payment legs are required when paid_by_method is MULTI",
          );
        }

        // S2 hard-reject reconciliation (Payment-Legs Integrity plan): the
        // customer's legs must cover `data.price` — the same total this
        // flow credits to drawers/debt below. No-ops on an empty
        // `data.payments` (legacy single-payment fallback via paid_by_method)
        // or under deferPayment/FOR-partner (neither owns the customer-cash
        // side here — the session basket or the partner ledger does).
        if (!isForPartner && !deferPayment) {
          reconcileLegs({
            inLegs: inPayments,
            outLegs: returnLegs,
            keptChange: {
              usd: data.kept_change_usd,
              lbp: data.kept_change_lbp,
            },
            expectedTotals: expectedTotalIn(data.price, currency),
            exchangeRate: sellRate,
            tenderExchangeRate: data.tender_exchange_rate,
            context: `${data.provider} ${data.type} recharge`,
          });
        }

        let hasDebt = false;
        if (isForPartner) {
          // No customer cash and no debt — the FULL price is booked to the
          // partner below (after the stock/SMS legs), replacing both the
          // cash step and the client debt_ledger step for this transaction.
        } else if (deferPayment) {
          // Session basket owns the customer-cash inflow + debt + change.
          // Only the telecom stock leg (below) is recorded on this transaction.
        } else if (inPayments.length > 0) {
          // Multi-payment mode
          for (const p of inPayments) {
            if (p.method === "GIFT_CARD") {
              // Voucher leg — deposit the voucher's full value to the owner's
              // account; the charge is then consumed from that account as debt.
              getVoucherRepository().redeemByCode({
                code: (p.voucherCode ?? "").trim().toUpperCase(),
                context: "recharge",
                transactionId: txnId,
                userId: createdBy,
              });
              hasDebt = true;
              continue;
            }
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

        // Telecom balance consumed (shop number stock — always in USD credits).
        // WHICH figure leaves the drawer depends on the type: `data.amount` is
        // USD face value for a credit send, but a DAY COUNT for DAYS — see
        // telecomStockLeg. For DAYS the debit is the operator-submitted cost,
        // inverted to USD at the SAME telecom credit-cost rate the Days tab
        // multiplied by (plan §0.3), never at the USD/LBP sell rate.
        const daysCostUsd =
          data.type === "DAYS"
            ? currency === "LBP"
              ? Math.abs(data.cost) /
                getAlfaCreditCostRateLbp(this.db, tenantId)
              : Math.abs(data.cost)
            : 0;
        const stockLeg = telecomStockLeg({
          type: data.type,
          // Same string as the drawer — the credit-send leg has always been
          // labelled with the carrier (one derivation, not two).
          carrier: providerDrawerName,
          amount: data.amount,
          daysCostUsd,
        });
        if (stockLeg) {
          insertPayment.run(
            txnId,
            stockLeg.method,
            providerDrawerName,
            "USD",
            stockLeg.amountUsd,
            stockLeg.note,
            createdBy,
          );
          upsertBalanceDelta.run(providerDrawerName, "USD", stockLeg.amountUsd);
        }

        // SMS cost deduction: each CREDIT_TRANSFER requires SMSes to send credits
        if (data.type === "CREDIT_TRANSFER" && smsCostUsd > 0) {
          insertPayment.run(
            txnId,
            "SMS_COST",
            providerDrawerName,
            "USD",
            -smsCostUsd,
            `SMS cost: ${smsCount} × $${SMS_TRANSFER_FEE_USD}`,
            createdBy,
          );
          upsertBalanceDelta.run(providerDrawerName, "USD", -smsCostUsd);
        }

        // PFT-R (Partner FOR-Transactions, full-amount model): routing is
        // mutually exclusive. In partner mode the FULL price books to
        // partner_ledger (FOR_RECHARGE DEBIT) against data.partnerId — never
        // a remainder, and never the client's debt_ledger.
        if (isForPartner) {
          getPartnerRepository().addLedgerEntry({
            partner_id: data.partnerId as number,
            transaction_type: "FOR_RECHARGE",
            reference_table: "recharges",
            reference_id: rechargeId,
            amount: Math.abs(data.price),
            currency,
            direction: "DEBIT",
            user_id: createdBy,
            notes: note,
          });
        } else if (hasDebt) {
          // Debt: create ledger entry when paid by DEBT
          if (!data.clientId) {
            throw new Error("Cannot create debt without a client");
          }
          // S7 (Payment-Legs Integrity plan): book PER LEG CURRENCY, never
          // summed across currencies into one column. The pre-fix code
          // summed every non-drawer-affecting leg's `amount` regardless of
          // `currencyCode` into a single `debtAmount`, then booked the WHOLE
          // sum under whichever currency column matched the service
          // `currency` — a USD account leg + an LBP account leg (e.g. $5 +
          // 450,000) collapsed into "450,005" and landed entirely in ONE
          // column. Mirrors FinancialServiceRepository's multi-leg Service
          // Debt booking (debtUsd/debtLbp accumulated separately, per leg's
          // OWN currencyCode).
          let debtUsd = 0;
          let debtLbp = 0;
          if (inPayments.length > 0) {
            for (const p of inPayments) {
              if (isDrawerAffectingMethod(p.method)) continue;
              if (p.currencyCode === "USD") debtUsd += Math.abs(p.amount);
              else if (p.currencyCode === "LBP") debtLbp += Math.abs(p.amount);
            }
          } else {
            // Single payment (backwards-compatible): the whole price is on
            // account, in the recharge's own service currency.
            if (currency === "USD") debtUsd = data.price;
            else if (currency === "LBP") debtLbp = data.price;
          }
          bookClientDebtCharge(this.db, {
            clientId: data.clientId,
            transactionType: "Recharge Debt",
            amountUsd: debtUsd,
            amountLbp: debtLbp,
            transactionId: txnId,
            note,
            createdBy,
            tenantId,
          });
        }

        // Return (OUT) legs: change handed back via a chosen method or kept as
        // store credit. Debits the method's drawer, or deposits client credit.
        // Deferred (session basket): change is owned by the basket recorder.
        // Partner mode: no counter cash was ever taken, so there is no
        // change to return either.
        for (const r of deferPayment || isForPartner ? [] : returnLegs) {
          const amt = Math.abs(r.amount);
          if (amt <= 0) continue;
          if (r.method === "CUSTOMER_ACCOUNT") {
            if (!data.clientId) {
              throw new Error(
                "Client is required to return change as store credit",
              );
            }
            getDebtService().addCredit({
              clientId: data.clientId,
              amountUsd: r.currencyCode === "USD" ? amt : 0,
              amountLbp: r.currencyCode === "LBP" ? amt : 0,
              note: "Change returned",
              userId: createdBy,
              transactionId: txnId,
            });
          } else if (isDrawerAffectingMethod(r.method)) {
            const drawer = paymentMethodToDrawerName(r.method);
            insertPayment.run(
              txnId,
              r.method,
              drawer,
              r.currencyCode,
              -amt,
              "Change returned",
              createdBy,
            );
            upsertBalanceDelta.run(drawer, r.currencyCode, -amt);
          }
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
        `${data.provider} ${data.type}: ${data.amount} credits @ ${data.price.toLocaleString()} ${data.currency ?? "USD"}`,
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

  /**
   * Telecom credit buy-back (CARRIER_LINES_VALIDITY_PLAN.md Phase 6, D7/D8):
   * a customer hands the shop MTC/Alfa credits — detected because they typed
   * the shop's OWN carrier line's phone number into the Credit tab — and the
   * shop pays them cash. The reverse of a normal sale: credits IN (to the
   * shop's line), cash OUT (from a real drawer, via ordinary payout legs).
   *
   * `data.amount` is reused as the credits gained (USD face value, matching
   * every other type's convention — see {@link telecomStockLeg}'s doc).
   * `data.price` is reused as the total cash paid out, in `data.currency`.
   * Neither `data.cost` nor `data.default_price_to_client` is meaningful
   * here.
   *
   * Money movement (mirrors the retired `topUpFromCustomer` modal arm's
   * profit shape — profit = credits gained − cash paid — but routes the cash
   * leg through plain `paymentMethodToDrawerName` rather than always
   * debiting General: MTC/Alfa are never the shop's primary cash system, so
   * `resolveServiceCashDrawer`'s PCD rerouting never applies here):
   *   - `getPrimary(carrier)` gains `credits` — a `carrier_line_movements`
   *     row, reason `CREDIT_BUYBACK`, `validityDaysDelta: 0` (D9 — a
   *     buy-back never touches validity; that only happens via an iPick/
   *     Katsh self-charge).
   *   - The provider drawer is then set to `getCarrierCreditsSum(carrier)`
   *     (§0.1) — posted as the DIFFERENCE from its current balance, as an
   *     ordinary auditable `payments` row, so §0.6's "a NEW path does not
   *     get the grandfather exemption" holds from day one, even if the
   *     drawer had already drifted from the line sum before this ran.
   *   - Cash pays out via the shared `postPayoutLegs` (moneyPosting.ts) —
   *     ordinary IN legs with no `direction` key (D7): a payout is NOT the
   *     `direction: "OUT"` change-leg marker (this method has no
   *     end-of-transaction return-leg loop for it to collide with).
   *
   * Reversible (D8, deliberately NOT in `NON_REVERSIBLE_TRANSACTION_TYPES`):
   * `_reversePayments` (the drawer-delta leg and every payout leg),
   * `_reverseCarrierLineMovements` (the credits gain), and `_cancelDebt`'s
   * widened `CREDIT_DEPOSIT` scan (a CUSTOMER_ACCOUNT payout leg) between
   * them net every ledger back to its pre-transaction value.
   */
  processCreditBuyback(data: RechargeData): {
    success: boolean;
    id?: number;
    error?: string;
  } {
    try {
      if (!data.payments || data.payments.length === 0) {
        return {
          success: false,
          error: "Payment legs are required for a credit buy-back payout",
        };
      }

      const { inLegs: payoutLegs, outLegs } = partitionLegs(data.payments);
      if (outLegs.length > 0) {
        return {
          success: false,
          error:
            "A credit buy-back accepts payout legs only — direction:'OUT' legs are not supported here",
        };
      }

      const credits = Math.abs(data.amount);
      if (!(credits > 0)) {
        return {
          success: false,
          error: "Credits amount must be greater than 0",
        };
      }

      const carrier: CarrierKey = data.provider === "MTC" ? "mtc" : "alfa";
      const providerDrawerName = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const carrierLineRepo = getCarrierLineRepository();
      const primaryLine = carrierLineRepo.getPrimary(carrier);
      if (!primaryLine) {
        return {
          success: false,
          error: `No active ${data.provider} line to buy back credits into`,
        };
      }
      // Backend re-validation (rule 14 — the REST route is directly
      // callable, so a client-computed "this is a buy-back" flag alone
      // cannot be trusted): if a phone number was submitted, it must
      // actually be the shop's own line. Omitted entirely → the explicit
      // `type: "CREDIT_BUYBACK"` the operator chose is the authoritative
      // signal, same as every other recharge type.
      if (
        data.phoneNumber &&
        !isSameLebanesePhone(data.phoneNumber, primaryLine.phone_number)
      ) {
        return {
          success: false,
          error: `Phone number does not match the shop's own ${data.provider} line — a buy-back must be against the shop's own line`,
        };
      }

      const payoutAmount = Math.abs(data.price);
      const currency = data.currency ?? "USD";
      const createdBy = data.userId ?? 1;
      const tenantId = getCurrentTenantId();
      const sellRate = getUsdLbpSellRate(this.db);
      // Owner decision (2026-08-08, repro: buy 89,000 vs. sell 90,000): the
      // `transactions.exchange_rate` stamp reflects the operator's tendered
      // rate when it's within the reconciliation band of `sellRate` (see
      // `resolveStampedExchangeRate`'s doc on `RechargeData.
      // tender_exchange_rate`); falls back to `sellRate` silently otherwise.
      // `postPayoutLegs` below keeps anchoring at `sellRate` — unaffected.
      const recordExchangeRate = resolveStampedExchangeRate(
        sellRate,
        data.tender_exchange_rate,
      );
      const paidByLabel =
        payoutLegs.length > 1 ? "MULTI" : payoutLegs[0]?.method || "CASH";

      const result = this.db.transaction(() => {
        const clientName = data.clientId
          ? ((
              this.db
                .prepare(
                  "SELECT full_name FROM clients WHERE id = ? AND tenant_id = ?",
                )
                .get(data.clientId, tenantId) as
                | { full_name: string }
                | undefined
            )?.full_name ??
            data.clientName ??
            null)
          : (data.clientName ?? null);

        const note = `${data.provider} credit buy-back${data.phoneNumber ? ` - ${data.phoneNumber}` : ""}`;

        const insertRecharge = this.db.prepare(`
          INSERT INTO recharges (
            carrier, recharge_type, amount, cost, price, default_price_to_client, currency_code,
            paid_by, phone_number, client_id, client_name, note, created_by, tenant_id, created_at
          ) VALUES (?, 'CREDIT_BUYBACK', ?, 0, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
        `);
        const rechargeResult = insertRecharge.run(
          data.provider,
          credits,
          payoutAmount,
          currency,
          paidByLabel,
          data.phoneNumber || null,
          data.clientId || null,
          clientName,
          note,
          createdBy,
          tenantId,
          data.transaction_time ?? null,
        );
        const rechargeId = Number(rechargeResult.lastInsertRowid);

        const payoutUsd = usdEquivalent(
          currency === "USD" ? payoutAmount : 0,
          currency === "LBP" ? payoutAmount : 0,
          sellRate,
        );

        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.TELECOM_CREDIT_BUYBACK,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: createdBy,
          amount_usd: currency === "USD" ? payoutAmount : 0,
          amount_lbp: currency === "LBP" ? payoutAmount : 0,
          // Profit = credits gained − cash paid (USD-equivalent) — the same
          // spread the retired topUpFromCustomer modal arm booked. Tracked
          // in USD only (credits are always a USD figure), mirroring that
          // arm's own convention.
          profit_usd: credits - payoutUsd,
          profit_lbp: 0,
          client_id: data.clientId ?? null,
          client_name: clientName,
          summary: `Credit buy-back: ${data.provider} +$${credits} credits — ${currency === "LBP" ? "" : "$"}${payoutAmount.toLocaleString()} ${currency} paid out`,
          metadata_json: {
            provider: data.provider,
            type: "CREDIT_BUYBACK",
            credits,
            payoutAmount,
            currency,
            phone: data.phoneNumber,
          },
          exchange_rate: recordExchangeRate,
          transaction_time: data.transaction_time,
        });

        // Cash payout — ordinary IN legs, no `direction` key (D7). No
        // drawer-sufficiency guard, by design (FEATURE_GUIDE §7 / plan
        // Phase 6) — the PCD/General may go negative.
        postPayoutLegs({
          db: this.db,
          legs: payoutLegs,
          payoutAmount,
          currency,
          exchangeRate: sellRate,
          tenderExchangeRate: data.tender_exchange_rate,
          context: `${data.provider} credit buy-back`,
          txnId,
          tenantId,
          createdBy,
          resolveDrawer: (method) => paymentMethodToDrawerName(method),
          note: `Cash paid to customer (${data.provider} credit buy-back)`,
          onCustomerAccountLeg: (usd, lbp) => {
            if (!data.clientId) {
              throw new Error(
                "Client is required for CUSTOMER_ACCOUNT cashout",
              );
            }
            getDebtService().addCredit({
              clientId: data.clientId,
              amountUsd: usd,
              amountLbp: lbp,
              note: `${data.provider} credit buy-back — credited to account`,
              userId: createdBy,
              transactionId: txnId,
            });
          },
        });

        // Credit the shop's own line — D9: credits only, validity never
        // moves. Established call convention (mirrors
        // FinancialServiceRepository.selfChargeTelecomItem): repository for
        // reads (getPrimary, above), service for the paired write.
        const movement = getCarrierLineService().applyMovement({
          carrierLineId: primaryLine.id,
          creditsDelta: credits,
          validityDaysDelta: 0,
          reason: "CREDIT_BUYBACK",
          transactionId: txnId,
        });
        if (!movement.success) {
          throw new Error(
            `Failed to apply carrier line movement: ${movement.error}`,
          );
        }

        // §0.1/§0.6: the drawer follows the line SUM, never the reverse — a
        // NEW path (this one) does not get the grandfather exemption. Post
        // the DIFFERENCE from the drawer's CURRENT balance as an ordinary
        // leg, so drawer == Σ(active lines) holds after this transaction
        // even if the drawer had already drifted from it beforehand.
        const currentDrawerRow = this.db
          .prepare(
            `SELECT balance FROM drawer_balances WHERE drawer_name = ? AND currency_code = 'USD' AND tenant_id = ?`,
          )
          .get(providerDrawerName, tenantId) as { balance: number } | undefined;
        const currentDrawerBalance = currentDrawerRow?.balance ?? 0;
        const targetSum = carrierLineRepo.getCarrierCreditsSum(carrier);
        const drawerDelta = targetSum - currentDrawerBalance;
        if (drawerDelta !== 0) {
          insertPaymentRow(this.db, {
            transactionId: txnId,
            method: providerDrawerName,
            drawerName: providerDrawerName,
            currencyCode: "USD",
            amount: drawerDelta,
            note: `Credits received (buy-back): +${credits}`,
            createdBy,
            tenantId,
          });
          applyDrawerDelta(this.db, {
            drawerName: providerDrawerName,
            currencyCode: "USD",
            delta: drawerDelta,
            tenantId,
          });
        }

        return rechargeId;
      })();

      rechargeLogger.info(
        {
          id: result,
          provider: data.provider,
          credits,
          payoutAmount,
          currency,
        },
        `${data.provider} credit buy-back: +${credits} credits, -${payoutAmount} ${currency} cash`,
      );

      return { success: true, id: result };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Credit buy-back failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up a Katsh or iPick provider drawer via supplier credit.
   * The supplier extends credit — no source drawer is deducted.
   * Records a TOP_UP entry in supplier_ledger (we now owe the supplier).
   */
  topUpFromSupplier(data: {
    provider: "iPick" | "Katsh";
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const tenantId = getCurrentTenantId();

      // Find matching active supplier for this provider
      const supplier = getSupplierRepository().getByProvider(data.provider);

      this.db.transaction(() => {
        // Insert TOP_UP recharge record (no paid_by drawer — funded by supplier)
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES (?, 'TOP_UP', ?, 0, 0, ?, 'SUPPLIER', ?, ?, ?)`,
          )
          .run(
            data.provider,
            amount,
            currency,
            `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up: +${amount} ${currency}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        const txnId = getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          summary: `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up → ${destDrawer}: ${amount} ${currency}`,
          metadata_json: {
            provider: data.provider,
            amount,
            currency,
            sourceDrawer: "SUPPLIER",
            destDrawer,
          },
        });

        // Record supplier ledger TOP_UP entry (liability — we now owe the
        // supplier). CQ-7: routed through addLedgerEntry's link-mode instead
        // of a raw INSERT — same entry_type/amounts/note/is_auto(=0) as
        // before, plus the RECHARGE_TOPUP transaction_id link the raw INSERT
        // never stamped.
        if (supplier) {
          getSupplierRepository().addLedgerEntry({
            supplier_id: supplier.id,
            entry_type: "TOP_UP",
            amount_usd: currency === "USD" ? amount : 0,
            amount_lbp: currency === "LBP" ? amount : 0,
            note: `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up: +${amount} ${currency}`,
            created_by: data.userId,
            transaction_id: txnId,
          });
        }

        // Increase the provider drawer balance
        applyDrawerDelta(this.db, {
          drawerName: destDrawer,
          currencyCode: currency,
          delta: amount,
          tenantId,
        });
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          amount,
          currency,
          destDrawer,
          supplierId: supplier?.id ?? null,
        },
        `${TOP_UP_PROVIDER_LABELS[data.provider]} supplier top-up → ${destDrawer}: ${amount} ${currency}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Supplier top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up the Whish App drawer via a partner.
   * The partner extends credit — no source drawer is deducted.
   * Records a WHISH_TOPUP partner_ledger entry with direction CREDIT
   * (we now owe the partner).
   */
  topUpFromPartner(data: {
    provider: "WHISH_APP";
    partnerId: number;
    amount: number;
    currency: string;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS[data.provider];
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const tenantId = getCurrentTenantId();

      // Validate the partner exists and is active
      const partner = this.db
        .prepare(
          "SELECT id FROM partners WHERE id = ? AND is_active = 1 AND tenant_id = ?",
        )
        .get(data.partnerId, tenantId) as { id: number } | undefined;
      if (!partner) {
        return { success: false, error: "Partner not found" };
      }

      this.db.transaction(() => {
        // Insert TOP_UP recharge record (funded by partner)
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES ('WHISH_APP', 'TOP_UP', ?, 0, 0, ?, 'PARTNER', ?, ?, ?)`,
          )
          .run(
            amount,
            currency,
            `${TOP_UP_PROVIDER_LABELS[data.provider]} top-up via partner: +${amount} ${currency}`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Record partner ledger CREDIT entry (we now owe the partner). CQ-7:
        // routed through PartnerRepository.addLedgerEntry instead of a raw
        // INSERT — same transaction_type/reference/amount/currency/direction
        // as before (notes stays unset/NULL, matching the prior column list;
        // no created_at override — the raw INSERT always used
        // CURRENT_TIMESTAMP and this flow has no backdate field). WHISH_TOPUP
        // is neither "SETTLEMENT" nor applyCoverage:true, so addLedgerEntry
        // applies no FIFO coverage here — identical to before.
        getPartnerRepository().addLedgerEntry({
          partner_id: data.partnerId,
          transaction_type: "WHISH_TOPUP",
          reference_table: "recharges",
          reference_id: rechargeId,
          amount,
          currency,
          direction: "CREDIT",
          user_id: data.userId,
        });

        // Create unified transaction record
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          summary: `Whish App top-up via partner: +${amount} ${currency}`,
          metadata_json: {
            provider: data.provider,
            partnerId: data.partnerId,
            amount,
            currency,
            destDrawer,
          },
        });

        // Increase the Whish App drawer balance
        applyDrawerDelta(this.db, {
          drawerName: destDrawer,
          currencyCode: currency,
          delta: amount,
          tenantId,
        });
      })();

      rechargeLogger.info(
        {
          provider: data.provider,
          partnerId: data.partnerId,
          amount,
          currency,
          destDrawer,
        },
        `Whish App top-up via partner: +${amount} ${currency}`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Partner top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Top up the Whish App drawer with credits transferred by a client.
   * The client transfers Whish credits to the shop and is paid cash out of
   * the General drawer. Both legs share the same currency. The shop's cut
   * (credits received − cash paid) is booked as profit at acquisition time.
   */
  topUpFromClient(data: {
    amount: number;
    cashPaid: number;
    currency: string;
    clientName?: string;
    clientId?: number;
    userId: number;
  }): { success: boolean; error?: string } {
    try {
      const destDrawer = TOP_UP_PROVIDER_DRAWERS.WHISH_APP;
      const currency = data.currency;
      const amount = Math.abs(data.amount);
      const cashPaid = Math.abs(data.cashPaid);
      const tenantId = getCurrentTenantId();

      if (amount <= 0) {
        return { success: false, error: "Amount must be greater than 0" };
      }

      // Validate the General drawer can cover the cash paid to the client
      const generalRow = this.db
        .prepare(
          "SELECT balance FROM drawer_balances WHERE drawer_name = 'General' AND currency_code = ? AND tenant_id = ?",
        )
        .get(currency, tenantId) as { balance: number | null } | undefined;

      const generalBalance = generalRow?.balance ?? 0;
      if (generalBalance < cashPaid) {
        return {
          success: false,
          error: `Insufficient balance in General drawer. Available: ${generalBalance} ${currency}`,
        };
      }

      const profit = amount - cashPaid;

      this.db.transaction(() => {
        // Record the top-up in recharges table
        const rechargeResult = this.db
          .prepare(
            `INSERT INTO recharges (carrier, recharge_type, amount, cost, price, currency_code, paid_by, note, created_by, tenant_id)
             VALUES ('WHISH_APP', 'TOP_UP', ?, ?, ?, ?, 'CLIENT', ?, ?, ?)`,
          )
          .run(
            amount,
            cashPaid,
            amount,
            currency,
            `Whish App top-up from client: +${amount} credits, paid ${cashPaid} ${currency} cash`,
            data.userId,
            tenantId,
          );

        const rechargeId = Number(rechargeResult.lastInsertRowid);

        // Create unified transaction record
        getTransactionRepository().createTransaction({
          type: TRANSACTION_TYPES.RECHARGE_TOPUP,
          source_table: "recharges",
          source_id: rechargeId,
          user_id: data.userId,
          amount_usd: currency === "USD" ? amount : 0,
          amount_lbp: currency === "LBP" ? amount : 0,
          profit_usd: currency === "USD" ? profit : 0,
          profit_lbp: currency === "LBP" ? profit : 0,
          client_id: data.clientId ?? null,
          client_name: data.clientName ?? null,
          summary: `Whish App top-up from client: +${amount} credits, -${cashPaid} ${currency} cash`,
          metadata_json: {
            provider: "WHISH_APP",
            amount,
            cashPaid,
            currency,
            clientId: data.clientId ?? null,
            clientName: data.clientName ?? null,
            sourceDrawer: "General",
            destDrawer,
          },
        });

        // Pay the client from the General drawer (same currency). CQ-3
        // survey note: intentionally NOT `applyDrawerDelta` — a plain UPDATE
        // that must NOT create a row for a missing General drawer.
        if (cashPaid > 0) {
          this.db
            .prepare(
              `UPDATE drawer_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
               WHERE drawer_name = 'General' AND currency_code = ? AND tenant_id = ?`,
            )
            .run(cashPaid, currency, tenantId);
        }

        // Add the received credits to the Whish App drawer
        applyDrawerDelta(this.db, {
          drawerName: destDrawer,
          currencyCode: currency,
          delta: amount,
          tenantId,
        });
      })();

      rechargeLogger.info(
        {
          amount,
          cashPaid,
          currency,
          clientId: data.clientId ?? null,
          destDrawer,
        },
        `Whish App top-up from client: +${amount} credits, -${cashPaid} ${currency} cash`,
      );

      return { success: true };
    } catch (error) {
      rechargeLogger.error({ error, data }, "Client top-up failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Update non-financial metadata on a recharge record.
   * Only metadata fields are allowed — financial data is immutable.
   */
  updateMetadata(
    id: number,
    data: { phone_number?: string; client_name?: string; note?: string },
    editedBy: string,
  ): RechargeEntity | null {
    const existing = this.findById(id);
    if (!existing) return null;

    const fields: string[] = [];
    const values: unknown[] = [];

    if (data.phone_number !== undefined) {
      fields.push("phone_number = ?");
      values.push(data.phone_number);
    }
    if (data.client_name !== undefined) {
      fields.push("client_name = ?");
      values.push(data.client_name);
    }
    if (data.note !== undefined) {
      fields.push("note = ?");
      values.push(data.note);
    }

    if (fields.length === 0) return existing;

    fields.push("edited_by = ?", "edited_at = CURRENT_TIMESTAMP");
    values.push(editedBy);
    values.push(id, getCurrentTenantId());

    this.db
      .prepare(
        `UPDATE recharges SET ${fields.join(", ")} WHERE id = ? AND tenant_id = ?`,
      )
      .run(...values);

    return this.findById(id);
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
