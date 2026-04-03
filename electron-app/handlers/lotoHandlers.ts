/**
 * Loto IPC Handlers
 */

import { ipcMain } from "electron";
import { getLotoService, lotoLogger } from "@liratek/core";
import { requireRole } from "../session.js";

let lotoService: ReturnType<typeof getLotoService> | null = null;

function getLotoServiceInstance() {
  if (!lotoService) {
    lotoService = getLotoService();
  }
  return lotoService;
}

export function registerLotoHandlers(): void {
  lotoLogger.info("Registering Loto IPC handlers");

  ipcMain.handle("loto:sell", async (e, data: any) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const ticket = service.sellTicket(data);
      return { success: true, ticket };
    } catch (error) {
      lotoLogger.error({ error }, "loto:sell failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to sell ticket",
      };
    }
  });

  ipcMain.handle("loto:get", async (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const ticket = service.getTicket(id);
      return { success: true, ticket };
    } catch (error) {
      lotoLogger.error({ error }, "loto:get failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get ticket",
      };
    }
  });

  ipcMain.handle(
    "loto:get-by-date-range",
    async (e, from: string, to: string) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

        const service = getLotoServiceInstance();
        const tickets = service.getTicketsByDateRange(from, to);
        return { success: true, tickets };
      } catch (error) {
        lotoLogger.error({ error }, "loto:get-by-date-range failed");
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to get tickets",
        };
      }
    },
  );

  ipcMain.handle("loto:update", async (e, id: number, data: any) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const repo = (service as any).repo;
      const ticket = repo.updateTicket(id, data);
      return { success: true, ticket };
    } catch (error) {
      lotoLogger.error({ error }, "loto:update failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update ticket",
      };
    }
  });

  ipcMain.handle("loto:report", async (e, from: string, to: string) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const reportData = service.getReportData(from, to);
      return { success: true, reportData };
    } catch (error) {
      lotoLogger.error({ error }, "loto:report failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get report data",
      };
    }
  });

  ipcMain.handle("loto:settlement", async (e, from: string, to: string) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const settlement = service.calculateSettlement(from, to);
      return { success: true, settlement };
    } catch (error) {
      lotoLogger.error({ error }, "loto:settlement failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to calculate settlement",
      };
    }
  });

  ipcMain.handle("loto:fees:create", async (e, data: any) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const fee = service.recordMonthlyFee(data);
      return { success: true, fee };
    } catch (error) {
      lotoLogger.error({ error }, "loto:fees:create failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create monthly fee",
      };
    }
  });

  ipcMain.handle("loto:fees:get", async (e, year: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const fees = service.getMonthlyFees(year);
      return { success: true, fees };
    } catch (error) {
      lotoLogger.error({ error }, "loto:fees:get failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get monthly fees",
      };
    }
  });

  ipcMain.handle("loto:fees:pay", async (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const fee = service.markFeePaid(id);
      return { success: true, fee };
    } catch (error) {
      lotoLogger.error({ error }, "loto:fees:pay failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to mark fee as paid",
      };
    }
  });

  ipcMain.handle("loto:settings:get", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const settings = service.getSettings();
      const settingsObj: Record<string, string> = {};
      settings.forEach((value: string, key: string) => {
        settingsObj[key] = value;
      });
      return { success: true, settings: settingsObj };
    } catch (error) {
      lotoLogger.error({ error }, "loto:settings:get failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get settings",
      };
    }
  });

  ipcMain.handle(
    "loto:settings:update",
    async (e, key: string, value: string) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

        const service = getLotoServiceInstance();
        const setting = service.updateSetting(key, value);
        return { success: true, setting };
      } catch (error) {
        lotoLogger.error({ error }, "loto:settings:update failed");
        return {
          success: false,
          error:
            error instanceof Error ? error.message : "Failed to update setting",
        };
      }
    },
  );

  lotoLogger.info("Loto IPC handlers registered");
}

export async function checkLotoMonthlyFee(): Promise<void> {
  try {
    const service = getLotoServiceInstance();
    const result = service.checkAndRecordMonthlyFee();
    if (result.recorded) {
      lotoLogger.info({ fee: result.fee }, "Loto monthly fee auto-recorded");
    }
  } catch (error) {
    lotoLogger.error({ error }, "checkLotoMonthlyFee failed");
  }
}
