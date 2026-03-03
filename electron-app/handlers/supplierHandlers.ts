import { ipcMain } from "electron";
import { getSupplierService, getFinancialService } from "@liratek/core";
import { requireRole } from "../session.js";

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

  ipcMain.handle(
    "suppliers:create",
    (
      e,
      data: {
        name: string;
        contact_name?: string;
        phone?: string;
        note?: string;
        module_key?: string;
        provider?: string;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}

      return service.createSupplier(data);
    },
  );

  ipcMain.handle(
    "suppliers:add-ledger-entry",
    (
      e,
      data: {
        supplier_id: number;
        entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
        amount_usd: number;
        amount_lbp: number;
        note?: string;
        drawer_name?: string;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}

      return service.addLedgerEntry({ ...data, created_by: 1 });
    },
  );

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
  ipcMain.handle(
    "suppliers:settle-transactions",
    (
      e,
      data: {
        supplier_id: number;
        financial_service_ids: number[];
        amount_usd: number;
        amount_lbp: number;
        commission_usd: number;
        commission_lbp: number;
        drawer_name: string;
        note?: string;
      },
    ) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}

      return service.settleTransactions({ ...data, created_by: 1 });
    },
  );
}
