import { getSupplierRepository, } from "../repositories/index.js";
import { toErrorString } from "../utils/errors.js";
export class SupplierService {
    repo = getSupplierRepository();
    listSuppliers(search) {
        return this.repo.listSuppliers(search);
    }
    getSupplierBalances() {
        return this.repo.getSupplierBalances();
    }
    getSupplierLedger(supplierId, limit) {
        return this.repo.getSupplierLedger(supplierId, limit);
    }
    createSupplier(data) {
        try {
            if (!data.name?.trim())
                return { success: false, error: "Supplier name is required" };
            const res = this.repo.createSupplier(data);
            return { success: true, id: res.id };
        }
        catch (e) {
            return { success: false, error: toErrorString(e) };
        }
    }
    addLedgerEntry(data) {
        try {
            if (!data.supplier_id)
                return { success: false, error: "supplier_id is required" };
            const res = this.repo.addLedgerEntry(data);
            return { success: true, id: res.id };
        }
        catch (e) {
            return { success: false, error: toErrorString(e) };
        }
    }
}
let supplierServiceInstance = null;
export function getSupplierService() {
    if (!supplierServiceInstance)
        supplierServiceInstance = new SupplierService();
    return supplierServiceInstance;
}
export function resetSupplierService() {
    supplierServiceInstance = null;
}
