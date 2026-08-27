/**
 * Exchange Lot IPC Handlers (EXCHANGE_LOT_SETTLEMENT.md Phase 4a).
 *
 * Thin wrapper over `ExchangeLotService` — the read/admin API surface over
 * the FIFO lot engine (`ExchangeLotRepository`, Phase 2). Does NOT wire the
 * engine into the exchange create/void/refund write path (Phase 3, a
 * concurrent change to `ExchangeRepository.ts`/`ExchangeService.ts`/
 * `exchangeHandlers.ts` — deliberately untouched here).
 *
 * Auth mirrors `exchangeHandlers.ts`/`walletExchangeHandlers.ts`: reads
 * (`preview`, `positions`, `breakdown`) have NO `requireRole` gate, same as
 * `exchange:get-history`/`wallet-exchange:history` — they carry no
 * write-side risk and every renderer that can reach the IPC bridge is
 * already an authenticated app session. `adjust` (Q15) is admin-ONLY.
 */

import { ipcMain } from "electron";
import {
  getExchangeLotService,
  getUserRepository,
  exchangeLogger,
} from "@liratek/core";
import { requireRole } from "../session.js";
import { audit } from "./auditHelper.js";
import {
  validatePayload,
  PreviewLotSettlementSchema,
  LotBreakdownSchema,
  AdjustLotPositionSchema,
} from "../schemas/index.js";

let _exchangeLotService: ReturnType<typeof getExchangeLotService> | null = null;

function getExchangeLotServiceInstance() {
  if (!_exchangeLotService) {
    _exchangeLotService = getExchangeLotService();
  }
  return _exchangeLotService;
}

/**
 * Resolve the acting user's username for `exchange_position_adjustments
 * .created_by` (a TEXT column, not a user-id FK) — same lookup-with-fallback
 * pattern as `exchangeHandlers.ts`'s `exchange:update-metadata` handler.
 * Never trusts a client-sent actor (rule 19).
 */
function resolveActingUsername(userId: number): string {
  let username = `user-${userId}`;
  try {
    const userRepo = getUserRepository();
    const user = userRepo.findById(userId);
    if (user) username = user.username;
  } catch {
    // fallback to user-{id}
  }
  return username;
}

export function registerExchangeLotHandlers(): void {
  // FIFO dry-run preview (Q10) — feeds the exchange form's live
  // realized-profit display and the loss-confirm dialog before submit.
  ipcMain.handle("exchange-lots:preview", (_event, data: unknown) => {
    try {
      const validation = validatePayload(PreviewLotSettlementSchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      return getExchangeLotServiceInstance().previewSettlement(validation.data);
    } catch (error) {
      exchangeLogger.error({ error }, "exchange-lots:preview failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to preview exchange lot settlement",
      };
    }
  });

  // Per-currency open positions + Q11 indicative unrealized P&L.
  ipcMain.handle("exchange-lots:positions", () => {
    try {
      const data = getExchangeLotServiceInstance().getPositions();
      return { success: true, data };
    } catch (error) {
      exchangeLogger.error({ error }, "exchange-lots:positions failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load exchange lot positions",
      };
    }
  });

  // Per-exchange settlement breakdown (expandable history row), fetched
  // lazily on expand.
  ipcMain.handle("exchange-lots:breakdown", (_event, data: unknown) => {
    try {
      const validation = validatePayload(LotBreakdownSchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      const result = getExchangeLotServiceInstance().getBreakdown(
        validation.data.exchangeId,
      );
      return { success: true, data: result };
    } catch (error) {
      exchangeLogger.error({ error }, "exchange-lots:breakdown failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load exchange lot breakdown",
      };
    }
  });

  // Q15 admin-only manual position adjustment (drift correction).
  ipcMain.handle("exchange-lots:adjust", (event, data: unknown) => {
    try {
      const auth = requireRole(event.sender.id, ["admin"]);
      if (!auth.ok) return { success: false, error: auth.error };

      const validation = validatePayload(AdjustLotPositionSchema, data);
      if (!validation.ok) return { success: false, error: validation.error };

      const createdBy = resolveActingUsername(auth.userId);
      const result = getExchangeLotServiceInstance().adjustPosition(
        validation.data,
        createdBy,
      );

      if (result.success) {
        audit(event.sender.id, {
          action: "create",
          entity_type: "exchange_position_adjustment",
          summary: `Exchange lot adjustment: ${validation.data.qty > 0 ? "+" : ""}${validation.data.qty} ${validation.data.currencyCode}`,
          metadata: {
            currency_code: validation.data.currencyCode,
            qty: validation.data.qty,
            unit_cost_usd: validation.data.unitCostUsd,
            note: validation.data.note,
          },
        });
      }

      return result;
    } catch (error) {
      exchangeLogger.error({ error }, "exchange-lots:adjust failed");
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to adjust exchange lot position",
      };
    }
  });
}
