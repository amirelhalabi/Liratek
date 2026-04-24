import { ipcMain } from "electron";
import { getSupplierService, getFinancialService } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  SupplierCreateSchema,
  SupplierLedgerEntrySchema,
  SupplierSettleSchema,
  validatePayload,
} from "../schemas/index.js";

export function registerSupplierHandlers(): void {
  const service = getSupplierService();

  ipcMain.handle("suppliers:list", (_e, search?: string) => {
    return service.listSuppliers(search);
  });

  ipcMain.handle("suppliers:balances", () => {
    return service.getSupplierBalances();
  });

  ipcMain.handle(
    "suppliers:ledger",
    (_e, supplierId: number, limit?: number) => {
      return service.getSupplierLedger(supplierId, limit);
    },
  );

  ipcMain.handle("suppliers:create", (e, data: unknown) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };
    } catch {}

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
}
