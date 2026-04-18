import { ipcMain } from "electron";
import { getSupplierService, getFinancialService } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";

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

      const result = service.createSupplier(data);
      audit(e.sender.id, {
        action: "create",
        entity_type: "supplier",
        summary: `Created supplier "${data.name}"`,
        metadata: {
          name: data.name,
          module_key: data.module_key,
          provider: data.provider,
        },
      });
      return result;
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
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const result = service.addLedgerEntry({
        ...data,
        created_by: auth.userId,
      });
      audit(e.sender.id, {
        action: "create",
        entity_type: "supplier_ledger",
        summary: `Supplier ledger ${data.entry_type}: $${data.amount_usd} + ${data.amount_lbp} LBP`,
        metadata: {
          supplier_id: data.supplier_id,
          entry_type: data.entry_type,
        },
      });
      return result;
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
        payments?: Array<{
          method: string;
          currency_code: string;
          amount: number;
        }>;
      },
    ) => {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const result = service.settleTransactions({
        ...data,
        created_by: auth.userId,
      });
      audit(e.sender.id, {
        action: "settle",
        entity_type: "supplier_settlement",
        summary: `Settled ${data.financial_service_ids.length} transactions for supplier #${data.supplier_id}`,
        metadata: {
          supplier_id: data.supplier_id,
          count: data.financial_service_ids.length,
        },
      });
      return result;
    },
  );
}
