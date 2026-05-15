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
      });
      partnerLogger.info(
        {
          partnerId: data.partnerId,
          entryId: entry.id,
          direction: data.direction,
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
   */
  settle(data: {
    partnerId: number;
    amount: number;
    currency: string;
    settlementMethod: string;
    notes?: string;
    userId: number;
  }): PartnerLedgerEntry {
    try {
      const balance = this.repo.getBalance(data.partnerId);
      const currencyBalance =
        data.currency === "LBP" ? balance.lbp : balance.usd;

      // Positive balance = partner owes us → CREDIT to reduce it
      // Negative balance = we owe partner → DEBIT to reduce it
      const direction: "DEBIT" | "CREDIT" =
        currencyBalance >= 0 ? "CREDIT" : "DEBIT";

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

      partnerLogger.info(
        {
          partnerId: data.partnerId,
          entryId: entry.id,
          direction,
          settlementMethod: data.settlementMethod,
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

  // ── Reports ───────────────────────────────────────────────────────────────

  getPartnerStatement(
    partnerId: number,
    dateRange?: { start: string; end: string },
  ): {
    partner: Partner;
    balance: PartnerBalance;
    entries: PartnerLedgerEntry[];
  } {
    try {
      const partner = this.getPartnerById(partnerId);
      const balance = this.repo.getBalance(partnerId);
      const entries = this.repo.getLedgerEntries(partnerId, {
        startDate: dateRange?.start,
        endDate: dateRange?.end,
      });
      return { partner, balance, entries };
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
