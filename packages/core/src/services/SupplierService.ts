import {
  getSupplierRepository,
  getProductSupplierRepository,
  getSupplierPurchaseRepository,
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

  /**
   * CQ-10 (D4: admin-only, enforced by the caller) — standalone write-off:
   * forgive part of what the shop owes a supplier, with NO cashflow attached.
   * amount_usd/amount_lbp are validated PER CURRENCY against the OUTSTANDING
   * balance (mirrors DebtService.cashOut's per-currency guard, applied to the
   * supplier's "we owe them" balance instead of a client credit).
   */
  writeOffSupplierDebt(data: {
    supplier_id: number;
    amount_usd: number;
    amount_lbp: number;
    reason?: string;
    created_by: number;
  }): SupplierResult {
    try {
      if (!data.supplier_id)
        return { success: false, error: "supplier_id is required" };
      if ((data.amount_usd ?? 0) <= 0 && (data.amount_lbp ?? 0) <= 0)
        return {
          success: false,
          error: "Write-off amount must be greater than zero",
        };

      const balance = this.repo.getSupplierBalance(data.supplier_id);
      const owedUsd = Math.max(0, balance.balance_usd);
      const owedLbp = Math.max(0, balance.balance_lbp);
      if (owedUsd <= 0 && owedLbp <= 0) {
        return {
          success: false,
          error: "Supplier has no outstanding balance to write off",
        };
      }
      if (data.amount_usd > owedUsd + 0.05) {
        return {
          success: false,
          error: `Write-off ($${data.amount_usd.toFixed(2)}) exceeds what the shop owes the supplier ($${owedUsd.toFixed(2)})`,
        };
      }
      if ((data.amount_lbp ?? 0) > owedLbp + 1000) {
        return {
          success: false,
          error: `Write-off (${(data.amount_lbp ?? 0).toLocaleString()} LBP) exceeds what the shop owes the supplier (${owedLbp.toLocaleString()} LBP)`,
        };
      }

      const res = this.repo.writeOffSupplierDebt(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }
}

let supplierServiceInstance: SupplierService | null = null;
export function getSupplierService(): SupplierService {
  if (!supplierServiceInstance) supplierServiceInstance = new SupplierService();
  return supplierServiceInstance;
}
export function resetSupplierService(): void {
  supplierServiceInstance = null;
}
