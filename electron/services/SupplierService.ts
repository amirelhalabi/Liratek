import {
  getSupplierRepository,
  type CreateSupplierData,
  type CreateSupplierLedgerEntryData,
  type SupplierEntity,
  type SupplierLedgerEntryEntity,
  type SupplierBalance,
} from "../database/repositories";
import { toErrorString } from "../utils/errors";

export interface SupplierResult {
  success: boolean;
  id?: number;
  error?: string;
}

export class SupplierService {
  private repo = getSupplierRepository();

  listSuppliers(search?: string): SupplierEntity[] {
    return this.repo.listSuppliers(search);
  }

  getSupplierBalances(): SupplierBalance[] {
    return this.repo.getSupplierBalances();
  }

  getSupplierLedger(supplierId: number, limit?: number): SupplierLedgerEntryEntity[] {
    return this.repo.getSupplierLedger(supplierId, limit);
  }

  createSupplier(data: CreateSupplierData): SupplierResult {
    try {
      if (!data.name?.trim()) return { success: false, error: "Supplier name is required" };
      const res = this.repo.createSupplier(data);
      return { success: true, id: res.id };
    } catch (e) {
      return { success: false, error: toErrorString(e) };
    }
  }

  addLedgerEntry(data: CreateSupplierLedgerEntryData): SupplierResult {
    try {
      if (!data.supplier_id) return { success: false, error: "supplier_id is required" };
      const res = this.repo.addLedgerEntry(data);
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
