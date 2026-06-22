import { ipcMain } from "electron";
import { getSupplierService, getFinancialService } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  SupplierCreateSchema,
  SupplierLedgerEntrySchema,
  SupplierSettleSchema,
  SupplierCashflowSchema,
  SupplierPurchaseCreateSchema,
  validatePayload,
} from "../schemas/index.js";

export function registerSupplierHandlers(): void {
  const service = getSupplierService();

  ipcMain.handle(
    "suppliers:list",
    (_e, search?: string, includeInactive?: boolean) => {
      return service.listSuppliers(search, includeInactive);
    },
  );

  ipcMain.handle("suppliers:balances", (_e, includeInactive?: boolean) => {
    return service.getSupplierBalances(includeInactive);
  });

  ipcMain.handle(
    "suppliers:ledger",
    (_e, supplierId: number, limit?: number) => {
      return service.getSupplierLedger(supplierId, limit);
    },
  );

  ipcMain.handle("suppliers:create", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierCreateSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.createSupplier(v.data);
    audit(e.sender.id, {
      action: "create",
      entity_type: "supplier",
      summary: `Created supplier "${v.data.name}"`,
      metadata: {
        name: v.data.name,
        module_key: v.data.module_key,
        provider: v.data.provider,
      },
    });
    return result;
  });

  ipcMain.handle("suppliers:add-ledger-entry", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierLedgerEntrySchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.addLedgerEntry({
      ...v.data,
      created_by: auth.userId,
    });
    audit(e.sender.id, {
      action: "create",
      entity_type: "supplier_ledger",
      summary: `Supplier ledger ${v.data.entry_type}: $${v.data.amount_usd} + ${v.data.amount_lbp} LBP`,
      metadata: {
        supplier_id: v.data.supplier_id,
        entry_type: v.data.entry_type,
      },
    });
    return result;
  });

  // ── Settlement handlers ────────────────────────────────────────────────────

  /** Get unsettled transactions for a provider (e.g. "OMT") */
  ipcMain.handle("suppliers:unsettled-transactions", (_e, provider: string) => {
    return getFinancialService().getUnsettledByProvider(provider);
  });

  /** Get all transactions for a provider (history tab) */
  ipcMain.handle(
    "suppliers:all-transactions",
    (_e, provider: string, limit?: number) => {
      return getFinancialService().getAllByProvider(provider, limit);
    },
  );

  /** Get per-provider unsettled summary (for dashboard + profits page) */
  ipcMain.handle("suppliers:unsettled-summary", () => {
    return getFinancialService().getUnsettledSummary();
  });

  /** Settle a batch of transactions with a supplier (admin only) */
  ipcMain.handle("suppliers:settle-transactions", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierSettleSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.settleTransactions({
      ...v.data,
      created_by: auth.userId,
    });
    audit(e.sender.id, {
      action: "settle",
      entity_type: "supplier_settlement",
      summary: `Settled ${v.data.financial_service_ids.length} transactions for supplier #${v.data.supplier_id}`,
      metadata: {
        supplier_id: v.data.supplier_id,
        count: v.data.financial_service_ids.length,
      },
    });
    return result;
  });

  /** Product supplier balances: inventory cost minus payments */
  ipcMain.handle("suppliers:product-balances", () => {
    return service.getProductSupplierBalances();
  });

  /** Inventory items for a product supplier (name, qty, cost, total) */
  ipcMain.handle("suppliers:product-items", (_e, supplierId: number) => {
    return service.getProductItems(supplierId);
  });

  /** Get all purchase records for a product supplier */
  ipcMain.handle("suppliers:purchases", (_e, supplierId: number) => {
    return service.getSupplierPurchases(supplierId);
  });

  /** Log a delivery batch for a product supplier (admin only) */
  ipcMain.handle("suppliers:purchase-create", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierPurchaseCreateSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.createPurchase({ ...v.data, created_by: auth.userId });
    audit(e.sender.id, {
      action: "create",
      entity_type: "supplier_purchase",
      summary: `Logged purchase of $${v.data.total_usd.toFixed(2)} for supplier #${v.data.supplier_id}`,
      metadata: { supplier_id: v.data.supplier_id, total_usd: v.data.total_usd },
    });
    return result;
  });

  /** Pay a supplier / record a supplier paying us, via payment-method legs (admin only) */
  ipcMain.handle("suppliers:record-cashflow", (e, data: unknown) => {
    const auth = requireRole(e.sender.id, ["admin"]);
    if (!auth.ok) return { success: false, error: auth.error };

    const v = validatePayload(SupplierCashflowSchema, data);
    if (!v.ok) return { success: false, error: v.error };

    const result = service.recordSupplierCashflow({
      ...v.data,
      created_by: auth.userId,
    });
    audit(e.sender.id, {
      action: v.data.direction === "PAY" ? "pay" : "receive",
      entity_type: "supplier_cashflow",
      summary: `Supplier #${v.data.supplier_id} ${v.data.direction === "PAY" ? "paid" : "paid us"} (${v.data.payments.length} leg${v.data.payments.length === 1 ? "" : "s"})`,
      metadata: {
        supplier_id: v.data.supplier_id,
        direction: v.data.direction,
      },
    });
    return result;
  });
}
