import { type CreateSupplierData, type CreateSupplierLedgerEntryData, type SupplierEntity, type SupplierLedgerEntryEntity, type SupplierBalance } from "../repositories/index.js";
export interface SupplierResult {
    success: boolean;
    id?: number;
    error?: string;
}
export declare class SupplierService {
    private repo;
    listSuppliers(search?: string): SupplierEntity[];
    getSupplierBalances(): SupplierBalance[];
    getSupplierLedger(supplierId: number, limit?: number): SupplierLedgerEntryEntity[];
    createSupplier(data: CreateSupplierData): SupplierResult;
    addLedgerEntry(data: CreateSupplierLedgerEntryData & {
        drawer_name?: string;
    }): SupplierResult;
}
export declare function getSupplierService(): SupplierService;
export declare function resetSupplierService(): void;
