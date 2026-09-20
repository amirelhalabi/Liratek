import {
  getSupplierRepository,
  getProductSupplierRepository,
  getSupplierPurchaseRepository,
  getStockBatchRepository,
  type CreateSupplierData,
  type CreateSupplierLedgerEntryData,
  type SettleTransactionsData,
  type SupplierCashflowData,
  type SupplierEntity,
  type SupplierLedgerEntryEntity,
  type SupplierBalance,
  type ProductSupplierItem,
  type SupplierPurchase,
  type CreateSupplierPurchaseData,
} from "../repositories/index.js";
// OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187/188) — imported directly from
// SupplierRepository.js rather than the repositories/index.js barrel: this
// lane owns SupplierRepository.ts/SupplierService.ts only, not the shared
// barrel (see CROSS_LANE_REQUESTS in this ticket's build report) — it should
// still re-export these for other callers (e.g. IPC/REST handlers) to import
// the conventional way.
import type {
  AccountBalance,
  AccountLedgerEntry,
  AccountUnsettledRow,
  SettleAccountData,
  UpdateSupplierAccountLinkData,
} from "../repositories/SupplierRepository.js";
import { toErrorString } from "../utils/errors.js";

export interface SupplierResult {
  success: boolean;
  id?: number;
  error?: string;
}

export class SupplierService {
  private repo = getSupplierRepository();

  listSuppliers(search?: string, includeInactive?: boolean): SupplierEntity[] {
    return this.repo.listSuppliers(search, includeInactive);
  }

  getSupplierBalances(includeInactive?: boolean): SupplierBalance[] {
    return this.repo.getSupplierBalances(includeInactive);
  }

  getProductSupplierBalances(): SupplierBalance[] {
    return this.repo.getProductSupplierBalances();
  }

  // OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-187/188) — thin pass-throughs
  // (rule 13: no SQL here, the repository owns every query).
  getAccountBalances(): AccountBalance[] {
    return this.repo.getAccountBalances();
  }

  getAccountLedger(
    accountSupplierId: number,
    limit?: number,
  ): AccountLedgerEntry[] {
    return this.repo.getAccountLedger(accountSupplierId, limit);
  }

  getAccountUnsettled(accountSupplierId: number): AccountUnsettledRow[] {
    return this.repo.getAccountUnsettled(accountSupplierId);
  }

  /**
   * SUPPLIER_STOCK_INTAKE_PLAN.md — informational "Stock on hand" line on the
   * Suppliers page: SUM(quantity_remaining * unit_cost_usd) per supplier,
   * from the cost-batch ledger. Deliberately NOT part of the debt balance
   * (getProductSupplierBalances) — that money question was already answered
   * and settled at intake time; this is display-only current stock value.
   * Rule 13: delegates straight to the repository, no SQL here.
   */
  getProductSupplierStockValue(): {
    supplier_id: number;
    stock_value_usd: number;
  }[] {
    return getStockBatchRepository().getStockValueBySupplier();
  }

  getProductItems(supplierId: number): ProductSupplierItem[] {
    return getProductSupplierRepository().getProductItems(supplierId);
  }

  getSupplierLedger(
    supplierId: number,
    limit?: number,
  ): SupplierLedgerEntryEntity[] {
    return this.repo.getSupplierLedger(supplierId, limit);
  }

  getByProvider(provider: string): SupplierEntity | undefined {
    return this.repo.getByProvider(provider);
  }

  getByModuleKey(moduleKey: string): SupplierEntity[] {
    return this.repo.getByModuleKey(moduleKey);
  }

  createSupplier(data: CreateSupplierData): SupplierResult {
    try {
      if (!data.name?.trim())
        return { success: false, error: "Supplier name is required" };
      const res = this.repo.createSupplier(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /**
   * LIRA-191 (OMT_OPEN_CREDIT_ACCOUNT_PLAN.md §5) — thin pass-through (rule
   * 13): every data-dependent invariant (self-parent, chain depth, parent
   * existence/tenant/active, orphaned unsettled rows) lives in the
   * repository, next to the SQL it protects. Only presence-checked here.
   */
  updateSupplierAccountLink(
    data: UpdateSupplierAccountLinkData,
  ): SupplierResult {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      if (data.account_supplier_id === undefined)
        return { success: false, error: "account_supplier_id is required" };
      const res = this.repo.updateAccountLink(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  addLedgerEntry(
    data: CreateSupplierLedgerEntryData & { drawer_name?: string },
  ): SupplierResult {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      const res = this.repo.addLedgerEntry(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /**
   * Atomically settle a batch of financial_services transactions with a supplier.
   * Marks transactions as settled, credits commission to General, debits net payment from drawer.
   */
  settleTransactions(data: SettleTransactionsData): SupplierResult {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      if (!data.financial_service_ids?.length)
        return {
          success: false,
          error: "No transactions selected for settlement",
        };
      if (data.amount_usd < 0 || data.amount_lbp < 0)
        return {
          success: false,
          error: "Settlement amounts cannot be negative",
        };
      const res = this.repo.settleTransactions(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  /**
   * OMT_OPEN_CREDIT_ACCOUNT_PLAN.md (LIRA-189, CONTRACT_W2.md §2.1) — thin
   * pass-through (rule 13): validation of the money fields themselves
   * (direction cross-check, per-member commission scoping, etc.) lives in
   * the repository, next to the SQL it protects.
   */
  settleAccount(data: SettleAccountData): SupplierResult {
    try {
      if (!data.account_supplier_id)
        return { success: false, error: "account_supplier_id is required" };
      if (!data.selections?.length)
        return {
          success: false,
          error: "No rows selected for account settlement",
        };
      if (data.amount_usd < 0 || data.amount_lbp < 0)
        return {
          success: false,
          error: "Settlement amounts cannot be negative",
        };
      const res = this.repo.settleAccount(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  createPurchase(
    data: CreateSupplierPurchaseData,
  ): SupplierPurchase | { success: false; error: string } {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      if (data.total_usd <= 0)
        return { success: false, error: "Amount must be greater than 0" };
      return getSupplierPurchaseRepository().create(data);
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  getSupplierPurchases(supplierId: number): SupplierPurchase[] {
    return getSupplierPurchaseRepository().getBySupplier(supplierId);
  }

  /**
   * Pay a supplier down / record a supplier paying us, via payment-method legs.
   * Routes cash to the correct drawer and works with zero pending transactions.
   */
  recordSupplierCashflow(data: SupplierCashflowData): SupplierResult {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      if (!data.payments?.length)
        return {
          success: false,
          error: "At least one payment leg is required",
        };
      const res = this.repo.recordSupplierCashflow(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  // D8 (owner decision, SUPPLIER_STOCK_INTAKE_PLAN.md): writeOffSupplierDebt
  // (standalone write-off with no cashflow attached) was REMOVED. The
  // bundled Pay-form discount (recordSupplierCashflow's PAY-direction
  // branch → _postSupplierDiscount) is the only supported forgive-a-payable
  // path now. See BUILD_CONTRACT.md handoffs for every caller that still
  // references the removed method.
}

let supplierServiceInstance: SupplierService | null = null;
export function getSupplierService(): SupplierService {
  if (!supplierServiceInstance) supplierServiceInstance = new SupplierService();
  return supplierServiceInstance;
}
export function resetSupplierService(): void {
  supplierServiceInstance = null;
}
