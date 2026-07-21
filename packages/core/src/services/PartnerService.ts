/**
 * Partner Service
 *
 * Business logic for the Partner System (LIRA-037).
 * Handles partner management, ledger recording, settlements, and statements.
 */

import {
  getPartnerRepository,
  type PartnerRepository,
  type Partner,
  type PartnerLedgerEntry,
  type PartnerBalance,
  type PartnerBalanceBreakdown,
  type LedgerFilters,
  type CreatePartnerData,
  type UpdatePartnerData,
  type CreateLedgerEntryData,
} from "../repositories/index.js";
import { NotFoundError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

const partnerLogger = logger.child({ module: "partner" });

// =============================================================================
// Service
// =============================================================================

export class PartnerService {
  private repo: PartnerRepository;

  constructor(repo: PartnerRepository) {
    this.repo = repo;
  }

  // ── Partners ──────────────────────────────────────────────────────────────

  createPartner(data: CreatePartnerData): Partner {
    if (!data.name?.trim()) {
      throw new Error("Partner name is required");
    }
    try {
      const partner = this.repo.create(data);
      partnerLogger.info({ partnerId: partner.id }, "Partner created");
      return partner;
    } catch (e) {
      partnerLogger.error({ error: e }, "createPartner failed");
      throw e;
    }
  }

  updatePartner(id: number, data: UpdatePartnerData): Partner {
    try {
      const partner = this.repo.update(id, data);
      partnerLogger.info({ partnerId: id }, "Partner updated");
      return partner;
    } catch (e) {
      partnerLogger.error({ error: e, partnerId: id }, "updatePartner failed");
      throw e;
    }
  }

  deactivatePartner(id: number): void {
    try {
      this.repo.deactivate(id);
      partnerLogger.info({ partnerId: id }, "Partner deactivated");
    } catch (e) {
      partnerLogger.error(
        { error: e, partnerId: id },
        "deactivatePartner failed",
      );
      throw e;
    }
  }

  activatePartner(id: number): void {
    try {
      this.repo.activate(id);
      partnerLogger.info({ partnerId: id }, "Partner activated");
    } catch (e) {
      partnerLogger.error(
        { error: e, partnerId: id },
        "activatePartner failed",
      );
      throw e;
    }
  }

  getAllPartners(includeInactive = false): Partner[] {
    try {
      return this.repo.getAll(includeInactive);
    } catch (e) {
      partnerLogger.error({ error: e }, "getAllPartners failed");
      throw e;
    }
  }

  getPartnerById(id: number): Partner {
    try {
      const partner = this.repo.getById(id);
      if (!partner) {
        throw new NotFoundError(`Partner with id ${id} not found`);
      }
      return partner;
    } catch (e) {
      partnerLogger.error({ error: e, partnerId: id }, "getPartnerById failed");
      throw e;
    }
  }

  // ── Ledger ────────────────────────────────────────────────────────────────

  recordPartnerTransaction(data: {
    partnerId: number;
    transactionType?: CreateLedgerEntryData["transaction_type"];
    referenceTable?: string;
    referenceId?: number;
    amount: number;
    currency: string;
    direction: "DEBIT" | "CREDIT";
    notes?: string;
    userId: number;
    /** PFT-7b (owner-decided 2026-07-14): "cash moved" — the entry records a
     *  PHYSICAL cash event, so the drawer moves with it (add debt = cash OUT
     *  to the partner, add credit = cash IN), booked as an auditable
     *  PARTNER_PAYMENT transaction. Cash-moved entries also apply settlement
     *  FIFO coverage (profit realizes when real money moves); unticked
     *  entries stay paper-style bookkeeping. */
    moveCash?: boolean;
  }): PartnerLedgerEntry {
    try {
      const entry = this.repo.addLedgerEntry({
        partner_id: data.partnerId,
        transaction_type: data.transactionType,
        reference_table: data.referenceTable,
        reference_id: data.referenceId,
        amount: data.amount,
        currency: data.currency,
        direction: data.direction,
        notes: data.notes,
        user_id: data.userId,
        applyCoverage: data.moveCash === true,
      });
      if (data.moveCash === true) {
        this.repo.recordSettlementMoneyMovement(
          entry,
          data.userId,
          "PARTNER_PAYMENT",
        );
      } else {
        // LIRA-066: the paper path (no cash) previously wrote ONLY the
        // partner_ledger row above — invisible on the Transactions page.
        // Post the visibility-only PARTNER_ADJUSTMENT row now, so exactly
        // ONE transactions row exists either way (cash-moved or paper).
        this.repo.recordAdjustmentTransaction(entry, data.userId);
      }
      partnerLogger.info(
        {
          partnerId: data.partnerId,
          entryId: entry.id,
          direction: data.direction,
          moveCash: data.moveCash === true,
        },
        "Partner transaction recorded",
      );
      return entry;
    } catch (e) {
      partnerLogger.error(
        { error: e, partnerId: data.partnerId },
        "recordPartnerTransaction failed",
      );
      throw e;
    }
  }

  /**
   * Record a settlement entry for a partner.
   *
   * Direction logic:
   * - If current balance (DEBIT - CREDIT) is positive → partner owes us → settlement is CREDIT (reduces what they owe)
   * - If current balance is negative → we owe partner → settlement is DEBIT (reduces what we owe)
   *
   * Settlement currency is USD or LBP only — a partner never carries a USDT
   * balance (Binance partner debt is denominated in USD; the USDT leg lives
   * only in the drawer, not the partner ledger). See
   * docs/plans/done_plans/PARTNER_FOR_TRANSACTIONS_PLAN.md "VALIDATED FLOW CATALOG".
   */
  settle(data: {
    partnerId: number;
    amount: number;
    currency: string;
    settlementMethod: string;
    notes?: string;
    userId: number;
    /** CQ-10 — a forgiven remainder bundled with this settlement ("owed X,
     *  paid Y, discount Z"). partner_ledger is one-row-per-currency, so only
     *  the side matching `currency` above is honored; supplying BOTH
     *  amount_usd and amount_lbp is rejected (ambiguous which currency it
     *  belongs to) rather than silently dropping one. */
    discount?: { amount_usd: number; amount_lbp: number; reason?: string };
    /** CQ-11 — split-leg settlement (e.g. $60 CASH + $40 OMT), backing the
     *  shared MultiPaymentInput settle modal. Supersedes `settlementMethod`
     *  for money movement only; the ledger row (SETTLEMENT), coverage, and
     *  combined settle+discount balance guard below are unaffected —
     *  `amount` is still the single source of truth for how much the
     *  partner's balance moves. partnerSettleSchema already enforces the
     *  structural rules (same-currency legs, legs sum to `amount`, no
     *  CLIENT_ACCOUNT leg) — re-checked here too since the service can be
     *  (and is, in tests) called directly, bypassing Zod. */
    payments?: Array<{ method: string; currency_code: string; amount: number }>;
  }): PartnerLedgerEntry {
    try {
      if (
        data.discount &&
        (data.discount.amount_usd || 0) > 0 &&
        (data.discount.amount_lbp || 0) > 0
      ) {
        throw new Error(
          "Partner discount supports one currency at a time — split into two calls",
        );
      }

      if (data.payments && data.payments.length > 0) {
        if (data.settlementMethod === "CLIENT_ACCOUNT") {
          throw new Error(
            "A CLIENT_ACCOUNT settlement moves no money and cannot be combined with split payment legs",
          );
        }
        const clientAccountLeg = data.payments.find(
          (leg) => leg.method === "CLIENT_ACCOUNT",
        );
        if (clientAccountLeg) {
          throw new Error(
            "CLIENT_ACCOUNT settles no money — it cannot appear as a split payment leg",
          );
        }
        const badCurrencyLeg = data.payments.find(
          (leg) => leg.currency_code !== data.currency,
        );
        if (badCurrencyLeg) {
          throw new Error(
            `Every payment leg's currency_code must match the settlement currency (${data.currency})`,
          );
        }
        const legsSum = data.payments.reduce((sum, leg) => sum + leg.amount, 0);
        if (Math.abs(legsSum - data.amount) > 0.005) {
          throw new Error(
            `Payment legs (${legsSum} ${data.currency}) must sum to the settlement amount (${data.amount} ${data.currency})`,
          );
        }
      }

      const balance = this.repo.getBalance(data.partnerId);
      const currencyBalance =
        data.currency === "LBP" ? balance.lbp : balance.usd;

      // Positive balance = partner owes us → CREDIT to reduce it
      // Negative balance = we owe partner → DEBIT to reduce it
      const direction: "DEBIT" | "CREDIT" =
        currencyBalance >= 0 ? "CREDIT" : "DEBIT";

      // CQ-10 follow-up (audit finding): the settlement amount and the
      // bundled discount are two SEPARATE ledger rows in the SAME direction,
      // so a caller could settle 100 + discount 30 on a 100 balance = 130,
      // forgiving more than is actually owed. writeOff() already guards its
      // single amount against the outstanding balance (line ~333 below);
      // settle() must guard the COMBINED amount+discount the same way.
      const discountAmountForGuard = data.discount
        ? data.currency === "LBP"
          ? data.discount.amount_lbp
          : data.discount.amount_usd
        : 0;
      if (discountAmountForGuard > 0) {
        const outstanding = Math.abs(currencyBalance);
        const combined = data.amount + discountAmountForGuard;
        if (combined > outstanding + 0.05) {
          throw new Error(
            `Settlement ($${data.amount}) + discount ($${discountAmountForGuard}) in ${data.currency} exceeds the outstanding balance ($${outstanding.toFixed(2)})`,
          );
        }
      }

      const entry = this.repo.addLedgerEntry({
        partner_id: data.partnerId,
        transaction_type: "SETTLEMENT",
        amount: data.amount,
        currency: data.currency,
        direction,
        notes: data.notes,
        user_id: data.userId,
        settlement_method:
          data.settlementMethod as CreateLedgerEntryData["settlement_method"],
      });

      // PFT-6b (owner-approved 2026-07-14): a settlement moves REAL money —
      // the method's drawer is credited when the partner pays the shop and
      // debited when the shop pays the partner, with a unified
      // PARTNER_SETTLEMENT transaction for audit. CLIENT_ACCOUNT settlements
      // stay bookkeeping-only (no drawer involved) — LIRA-066 residual fix
      // (2026-07-20): this used to SKIP recordSettlementMoneyMovement
      // entirely for CLIENT_ACCOUNT, so that settlement wrote ONLY the
      // partner_ledger row above with no unified `transactions` row at all
      // (invisible on the Transactions page). Now the call always happens —
      // PartnerRepository.recordSettlementMoneyMovement itself skips the
      // payments row + drawer delta when the method is CLIENT_ACCOUNT (a
      // no-drawer variant of PARTNER_SETTLEMENT, same visibility-only
      // treatment PARTNER_ADJUSTMENT already gets), so drawers/ledgers are
      // completely unaffected — only visibility changes.
      this.repo.recordSettlementMoneyMovement(
        entry,
        data.userId,
        undefined,
        data.discount,
        data.payments,
      );

      // CQ-10 — bundled discount: ONE more partner_ledger row, SAME direction
      // as the settlement (both reduce the same obligation), which triggers
      // applySettlementCoverage (DISCOUNT is now a coverage-applying type,
      // see PartnerRepository.addLedgerEntry) — then its own
      // COUNTERPARTY_DISCOUNT audit row (signed profit, D1).
      if (data.discount) {
        const discountAmount =
          data.currency === "LBP"
            ? data.discount.amount_lbp
            : data.discount.amount_usd;
        if (discountAmount > 0) {
          // Atomic: a mid-failure between the ledger row and its audit
          // transaction must never strand one without the other.
          this.repo.transaction(() => {
            const discountEntry = this.repo.addLedgerEntry({
              partner_id: data.partnerId,
              transaction_type: "DISCOUNT",
              // LIRA-085: link the bundled discount's OWN ledger row back to
              // the settlement's ledger row (`entry.id`) it rode with — the
              // only way TransactionRepository._reversePartnerSettlementLedger
              // can find and sweep it when the settlement is voided/refunded
              // (rule 20: "bundled inside a settlement must be handled by
              // that settlement's reversal"). Previously these two rows were
              // linked only by time proximity, which a reversal method cannot
              // rely on.
              reference_table: "partner_ledger",
              reference_id: entry.id,
              amount: discountAmount,
              currency: data.currency,
              direction,
              notes: data.discount!.reason ?? data.notes,
              user_id: data.userId,
            });
            this.repo.recordDiscount(discountEntry, data.userId);
          });
        }
      }

      partnerLogger.info(
        {
          partnerId: data.partnerId,
          entryId: entry.id,
          direction,
          settlementMethod: data.settlementMethod,
          discount: data.discount,
          legs: data.payments?.length,
        },
        "Partner settlement recorded",
      );
      return entry;
    } catch (e) {
      partnerLogger.error(
        { error: e, partnerId: data.partnerId },
        "settle failed",
      );
      throw e;
    }
  }

  /**
   * CQ-10 (D4: admin-only, enforced by the caller) — standalone write-off:
   * forgive part of a partner balance with NO settlement attached.
   * partner_ledger is one-currency-per-row, so exactly ONE of amount_usd/
   * amount_lbp must be positive (mirrors settle()'s bundled-discount
   * restriction) — supplying both is rejected rather than silently dropping
   * one. The amount is validated against the OUTSTANDING balance for that
   * currency (mirrors DebtService.cashOut's per-currency guard).
   */
  writeOff(data: {
    partnerId: number;
    amount_usd: number;
    amount_lbp: number;
    reason?: string;
    userId: number;
  }): { success: boolean; id?: number; error?: string } {
    try {
      const amountUsd = data.amount_usd ?? 0;
      const amountLbp = data.amount_lbp ?? 0;
      if (amountUsd <= 0 && amountLbp <= 0) {
        return {
          success: false,
          error: "Write-off amount must be greater than zero",
        };
      }
      if (amountUsd > 0 && amountLbp > 0) {
        return {
          success: false,
          error:
            "Partner write-off supports one currency at a time — split into two calls",
        };
      }
      const currency = amountLbp > 0 ? "LBP" : "USD";
      const amount = amountLbp > 0 ? amountLbp : amountUsd;

      const balance = this.repo.getBalance(data.partnerId);
      const currencyBalance = currency === "LBP" ? balance.lbp : balance.usd;
      // Positive balance = partner owes us (a receivable) → forgiving it is a
      // CREDIT, same direction settle() would use. Negative = we owe the
      // partner (a payable) → forgiving it is a DEBIT.
      const direction: "DEBIT" | "CREDIT" =
        currencyBalance >= 0 ? "CREDIT" : "DEBIT";
      const outstanding = Math.abs(currencyBalance);
      if (amount > outstanding + 0.05) {
        return {
          success: false,
          error: `Write-off (${amount} ${currency}) exceeds the outstanding balance (${outstanding} ${currency})`,
        };
      }

      const { entryId, txnId } = this.repo.transaction(() => {
        const entry = this.repo.addLedgerEntry({
          partner_id: data.partnerId,
          transaction_type: "DISCOUNT",
          amount,
          currency,
          direction,
          notes: data.reason,
          user_id: data.userId,
        });
        return {
          entryId: entry.id,
          txnId: this.repo.recordDiscount(entry, data.userId),
        };
      });

      partnerLogger.info(
        {
          partnerId: data.partnerId,
          entryId,
          txnId,
          direction,
          currency,
          amount,
        },
        "Partner write-off recorded",
      );
      return { success: true, id: txnId };
    } catch (e) {
      partnerLogger.error(
        { error: e, partnerId: data.partnerId },
        "writeOff failed",
      );
      return {
        success: false,
        error:
          e instanceof Error
            ? e.message
            : "Failed to write off partner balance",
      };
    }
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  getPartnerStatement(
    partnerId: number,
    filters?: LedgerFilters,
  ): {
    partner: Partner;
    balance: PartnerBalance;
    breakdown: PartnerBalanceBreakdown;
    entries: PartnerLedgerEntry[];
  } {
    try {
      const partner = this.getPartnerById(partnerId);
      const balance = this.repo.getBalance(partnerId);
      const breakdown = this.repo.getBalanceBreakdown(partnerId);
      const entries = this.repo.getLedgerEntries(partnerId, filters);
      return { partner, balance, breakdown, entries };
    } catch (e) {
      partnerLogger.error(
        { error: e, partnerId },
        "getPartnerStatement failed",
      );
      throw e;
    }
  }

  getPartnerBalance(partnerId: number): PartnerBalance {
    try {
      return this.repo.getBalance(partnerId);
    } catch (e) {
      partnerLogger.error({ error: e, partnerId }, "getPartnerBalance failed");
      throw e;
    }
  }

  getAllBalances(includeInactive?: boolean): Array<Partner & PartnerBalance> {
    try {
      return this.repo.getAllBalances(includeInactive);
    } catch (e) {
      partnerLogger.error({ error: e }, "getAllBalances failed");
      throw e;
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let partnerServiceInstance: PartnerService | null = null;

export function getPartnerService(): PartnerService {
  if (!partnerServiceInstance) {
    partnerServiceInstance = new PartnerService(getPartnerRepository());
  }
  return partnerServiceInstance;
}

export function resetPartnerService(): void {
  partnerServiceInstance = null;
}
