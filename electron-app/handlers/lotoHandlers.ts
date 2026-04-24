/**
 * Loto IPC Handlers
 */

import { ipcMain } from "electron";
import { getLotoService, lotoLogger } from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  LotoSellSchema,
  LotoCashPrizeSchema,
  LotoFeeSchema,
  LotoCheckpointCreateSchema,
  LotoCheckpointSettleSchema,
  validatePayload,
} from "../schemas/index.js";

let lotoService: ReturnType<typeof getLotoService> | null = null;

function getLotoServiceInstance() {
  if (!lotoService) {
    lotoService = getLotoService();
  }
  return lotoService;
}

export function registerLotoHandlers(): void {
  lotoLogger.info("Registering Loto IPC handlers");

  ipcMain.handle("loto:sell", async (e, data: unknown) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const v = validatePayload(LotoSellSchema, data);
      if (!v.ok) throw new Error(v.error);

      const service = getLotoServiceInstance();
      const ticket = service.sellTicket({ ...v.data, userId: auth.userId });
      audit(e.sender.id, {
        action: "create",
        entity_type: "loto_ticket",
        entity_id: String(ticket?.id ?? ""),
        summary: "Sold loto ticket",
        metadata: v.data as Record<string, unknown>,
      });
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

  ipcMain.handle("loto:get-uncheckpointed", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const tickets = service.getUncheckpointedTickets();
      return { success: true, tickets };
    } catch (error) {
      lotoLogger.error({ error }, "loto:get-uncheckpointed failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get uncheckpointed tickets",
      };
    }
  });

  ipcMain.handle("loto:update", async (e, id: number, data: any) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const ticket = service.updateTicket(id, data);
      audit(e.sender.id, {
        action: "update",
        entity_type: "loto_ticket",
        entity_id: String(id),
        summary: `Updated loto ticket #${id}`,
      });
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

  ipcMain.handle("loto:fees:create", async (e, data: unknown) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const v = validatePayload(LotoFeeSchema, data);
      if (!v.ok) throw new Error(v.error);

      const service = getLotoServiceInstance();
      const fee = service.recordMonthlyFee(v.data);
      audit(e.sender.id, {
        action: "create",
        entity_type: "loto_fee",
        entity_id: String(fee?.id ?? ""),
        summary: "Recorded loto monthly fee",
      });
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
      const fee = service.markFeePaid(id, auth.userId);
      audit(e.sender.id, {
        action: "update",
        entity_type: "loto_fee",
        entity_id: String(id),
        summary: `Marked loto fee #${id} as paid`,
      });
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
        audit(e.sender.id, {
          action: "update",
          entity_type: "loto_setting",
          entity_id: key,
          summary: `Updated loto setting "${key}"`,
          new_values: { value },
        });
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

  // Checkpoint handlers
  ipcMain.handle("loto:checkpoint:create", async (e, data: unknown) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const v = validatePayload(LotoCheckpointCreateSchema, data);
      if (!v.ok) throw new Error(v.error);

      const service = getLotoServiceInstance();
      const checkpoint = service.createCheckpoint(v.data);
      audit(e.sender.id, {
        action: "create",
        entity_type: "loto_checkpoint",
        entity_id: String(checkpoint?.id ?? ""),
        summary: "Created loto checkpoint",
      });
      return { success: true, checkpoint };
    } catch (error) {
      lotoLogger.error({ error }, "loto:checkpoint:create failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to create checkpoint",
      };
    }
  });

  ipcMain.handle("loto:checkpoint:get", async (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const checkpoint = service.getCheckpoint(id);
      return { success: true, checkpoint };
    } catch (error) {
      lotoLogger.error({ error }, "loto:checkpoint:get failed");
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to get checkpoint",
      };
    }
  });

  ipcMain.handle("loto:checkpoint:get-by-date", async (e, date: string) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const checkpoint = service.getCheckpointByDate(date);
      return { success: true, checkpoint };
    } catch (error) {
      lotoLogger.error({ error }, "loto:checkpoint:get-by-date failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get checkpoint by date",
      };
    }
  });

  ipcMain.handle(
    "loto:checkpoint:get-by-date-range",
    async (e, from: string, to: string) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

        const service = getLotoServiceInstance();
        const checkpoints = service.getCheckpointsByDateRange(from, to);
        return { success: true, checkpoints };
      } catch (error) {
        lotoLogger.error({ error }, "loto:checkpoint:get-by-date-range failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to get checkpoints by date range",
        };
      }
    },
  );

  ipcMain.handle("loto:checkpoint:get-unsettled", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const checkpoints = service.getUnsettledCheckpoints();
      return { success: true, checkpoints };
    } catch (error) {
      lotoLogger.error({ error }, "loto:checkpoint:get-unsettled failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get unsettled checkpoints",
      };
    }
  });

  ipcMain.handle("loto:checkpoint:update", async (e, id: number, data: any) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const checkpoint = service.updateCheckpoint(id, data);
      audit(e.sender.id, {
        action: "update",
        entity_type: "loto_checkpoint",
        entity_id: String(id),
        summary: `Updated loto checkpoint #${id}`,
      });
      return { success: true, checkpoint };
    } catch (error) {
      lotoLogger.error({ error }, "loto:checkpoint:update failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update checkpoint",
      };
    }
  });

  ipcMain.handle(
    "loto:checkpoint:mark-settled",
    async (e, id: number, settledAt?: string, settlementId?: number) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

        const service = getLotoServiceInstance();
        const checkpoint = service.markCheckpointAsSettled(
          id,
          settledAt,
          settlementId,
        );
        audit(e.sender.id, {
          action: "settle",
          entity_type: "loto_checkpoint",
          entity_id: String(id),
          summary: `Marked loto checkpoint #${id} as settled`,
        });
        return { success: true, checkpoint };
      } catch (error) {
        lotoLogger.error({ error }, "loto:checkpoint:mark-settled failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to mark checkpoint as settled",
        };
      }
    },
  );

  ipcMain.handle("loto:checkpoint:settle", async (e, data: unknown) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const v = validatePayload(LotoCheckpointSettleSchema, data);
      if (!v.ok) throw new Error(v.error);

      const service = getLotoServiceInstance();
      const checkpoint = service.settleCheckpoint(
        v.data.id,
        v.data.totalSales,
        v.data.totalCommission,
        v.data.totalPrizes,
        0, // deprecated — checkpoint reads its own total_cash_prizes
        v.data.settledAt,
        auth.userId,
        v.data.payments,
      );
      audit(e.sender.id, {
        action: "settle",
        entity_type: "loto_checkpoint",
        entity_id: String(v.data.id),
        summary: `Settled loto checkpoint #${v.data.id}`,
        metadata: {
          totalSales: v.data.totalSales,
          totalCommission: v.data.totalCommission,
        },
      });
      return { success: true, checkpoint };
    } catch (error) {
      lotoLogger.error({ error }, "loto:checkpoint:settle failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to settle checkpoint",
      };
    }
  });

  ipcMain.handle("loto:checkpoint:get-total-sales-unsettled", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const totalSales = service.getTotalSalesFromUnsettledCheckpoints();
      return { success: true, totalSales };
    } catch (error) {
      lotoLogger.error(
        { error },
        "loto:checkpoint:get-total-sales-unsettled failed",
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get total sales from unsettled checkpoints",
      };
    }
  });

  ipcMain.handle(
    "loto:checkpoint:get-total-commission-unsettled",
    async (e) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

        const service = getLotoServiceInstance();
        const totalCommission =
          service.getTotalCommissionFromUnsettledCheckpoints();
        return { success: true, totalCommission };
      } catch (error) {
        lotoLogger.error(
          { error },
          "loto:checkpoint:get-total-commission-unsettled failed",
        );
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to get total commission from unsettled checkpoints",
        };
      }
    },
  );

  ipcMain.handle("loto:checkpoint:get-last", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const checkpoint = service.getLastCheckpoint();
      return { success: true, checkpoint };
    } catch (error) {
      lotoLogger.error({ error }, "loto:checkpoint:get-last failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get last checkpoint",
      };
    }
  });

  ipcMain.handle(
    "loto:checkpoint:create-scheduled",
    async (e, checkpointDate?: string) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

        const service = getLotoServiceInstance();
        const checkpoint = service.createScheduledCheckpoint(checkpointDate);
        audit(e.sender.id, {
          action: "create",
          entity_type: "loto_checkpoint",
          entity_id: String(checkpoint?.id ?? ""),
          summary: "Created scheduled loto checkpoint",
        });
        return { success: true, checkpoint };
      } catch (error) {
        lotoLogger.error({ error }, "loto:checkpoint:create-scheduled failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to create scheduled checkpoint",
        };
      }
    },
  );

  // Cash prize handlers
  ipcMain.handle("loto:checkpoint:delete", async (e, id: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const deleted = service.deleteCheckpoint(id);
      if (!deleted) {
        return {
          success: false,
          error: "Checkpoint not found or already settled",
        };
      }
      audit(e.sender.id, {
        action: "delete",
        entity_type: "loto_checkpoint",
        entity_id: String(id),
        summary: `Deleted unsettled loto checkpoint #${id}`,
      });
      return { success: true };
    } catch (error) {
      lotoLogger.error({ error }, "loto:checkpoint:delete failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to delete checkpoint",
      };
    }
  });

  // Cash prize handlers
  ipcMain.handle("loto:cash-prize:create", async (e, data: unknown) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const v = validatePayload(LotoCashPrizeSchema, data);
      if (!v.ok) throw new Error(v.error);

      const service = getLotoServiceInstance();
      const prize = service.recordCashPrize({ ...v.data, userId: auth.userId });
      audit(e.sender.id, {
        action: "create",
        entity_type: "loto_cash_prize",
        entity_id: String(prize?.id ?? ""),
        summary: "Recorded loto cash prize",
      });
      return { success: true, prize };
    } catch (error) {
      lotoLogger.error({ error }, "loto:cash-prize:create failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to record cash prize",
      };
    }
  });

  ipcMain.handle(
    "loto:cash-prize:get-by-date-range",
    async (e, from: string, to: string) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

        const service = getLotoServiceInstance();
        const prizes = service.getCashPrizes(from, to);
        return { success: true, prizes };
      } catch (error) {
        lotoLogger.error({ error }, "loto:cash-prize:get-by-date-range failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to get cash prizes",
        };
      }
    },
  );

  ipcMain.handle("loto:cash-prize:get-unreimbursed", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const prizes = service.getUnreimbursedCashPrizes();
      return { success: true, prizes };
    } catch (error) {
      lotoLogger.error({ error }, "loto:cash-prize:get-unreimbursed failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get unreimbursed cash prizes",
      };
    }
  });

  ipcMain.handle(
    "loto:cash-prize:mark-reimbursed",
    async (e, id: number, reimbursedDate?: string, settlementId?: number) => {
      try {
        const auth = requireRole(e.sender.id, ["admin"]);
        if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

        const service = getLotoServiceInstance();
        const prize = service.markCashPrizeReimbursed(
          id,
          reimbursedDate,
          settlementId,
        );
        audit(e.sender.id, {
          action: "update",
          entity_type: "loto_cash_prize",
          entity_id: String(id),
          summary: `Marked loto cash prize #${id} as reimbursed`,
        });
        return { success: true, prize };
      } catch (error) {
        lotoLogger.error({ error }, "loto:cash-prize:mark-reimbursed failed");
        return {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : "Failed to mark cash prize as reimbursed",
        };
      }
    },
  );

  ipcMain.handle("loto:cash-prize:get-total-unreimbursed", async (e) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const total = service.getTotalUnreimbursedCashPrizes();
      return { success: true, total };
    } catch (error) {
      lotoLogger.error(
        { error },
        "loto:cash-prize:get-total-unreimbursed failed",
      );
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get total unreimbursed cash prizes",
      };
    }
  });

  ipcMain.handle("loto:settlement:get-history", async (e, limit?: number) => {
    try {
      const auth = requireRole(e.sender.id, ["admin"]);
      if (!auth.ok) throw new Error(auth.error ?? "Admin access required");

      const service = getLotoServiceInstance();
      const settlements = service.getSettlementHistory(limit);
      return { success: true, settlements };
    } catch (error) {
      lotoLogger.error({ error }, "loto:settlement:get-history failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to get settlement history",
      };
    }
  });

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
