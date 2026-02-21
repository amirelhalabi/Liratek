import { ipcMain } from "electron";
import { getSupplierService } from "@liratek/core";
/* eslint-disable @typescript-eslint/no-require-imports */

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
        const { requireRole } = require("../session");
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
        const { requireRole } = require("../session");
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) return { success: false, error: auth.error };
      } catch {}

      return service.addLedgerEntry({ ...data, created_by: 1 });
    },
  );
}
