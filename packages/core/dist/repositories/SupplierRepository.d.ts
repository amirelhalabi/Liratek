import { BaseRepository } from "./BaseRepository.js";
export interface SupplierEntity {
    id: number;
    name: string;
    contact_name: string | null;
    phone: string | null;
    note: string | null;
    is_active: number;
    created_at: string;
}
export type SupplierLedgerEntryType = "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
export interface SupplierLedgerEntryEntity {
    id: number;
    supplier_id: number;
    entry_type: SupplierLedgerEntryType;
    amount_usd: number;
    amount_lbp: number;
    note: string | null;
    created_by: number | null;
    created_at: string;
}
export interface CreateSupplierData {
    name: string;
    contact_name?: string;
    phone?: string;
    note?: string;
}
export interface CreateSupplierLedgerEntryData {
    supplier_id: number;
    entry_type: SupplierLedgerEntryType;
    amount_usd: number;
    amount_lbp: number;
    note?: string;
    created_by?: number;
    drawer_name?: string;
}
export interface SupplierBalance {
    supplier_id: number;
    total_usd: number;
    total_lbp: number;
}
export declare class SupplierRepository extends BaseRepository<SupplierEntity> {
    constructor();
    listSuppliers(search?: string): SupplierEntity[];
    createSupplier(data: CreateSupplierData): {
        id: number;
    };
    addLedgerEntry(data: CreateSupplierLedgerEntryData): {
        id: number;
    };
    getSupplierLedger(supplierId: number, limit?: number): SupplierLedgerEntryEntity[];
    getSupplierBalances(): SupplierBalance[];
}
export declare function getSupplierRepository(): SupplierRepository;
export declare function resetSupplierRepository(): void;
