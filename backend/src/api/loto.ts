/**
 * Loto REST routes — HTTP twin of electron-app/handlers/lotoHandlers.ts.
 *
 * Contract-parity rules (deliberate deviations from the other route files):
 * - Response envelopes are IPC-IDENTICAL: `{ success: true, <key> }` on
 *   success, HTTP 200 + `{ success: false, error }` on failure — the frontend
 *   adapter (backendApi.ts loto* functions) unwraps the same keys for both
 *   transports, and pages branch on `result.success`, not on HTTP status.
 * - Paths reproduce the adapter's exactly, INCLUDING the historical
 *   `unssettled` misspellings — the adapter is the deployed contract.
 * - Validation uses the SAME core schemas the IPC handlers use
 *   (packages/core/src/validators/loto.ts, CLAUDE.md rule 14).
 * - All endpoints are admin-only, matching the IPC handlers' requireRole.
 *
 * Money invariants (drawers, legs, supplier ledger sign, profit stamping) are
 * enforced inside the shared core LotoService/repositories — both transports
 * call the identical methods.
 */
import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { auditRest } from "../middleware/audit.js";
import {
  getLotoService,
  lotoLogger,
  lotoSellSchema,
  lotoCashPrizeSchema,
  lotoTicketUpdateSchema,
  lotoFeeSchema,
  lotoCheckpointCreateSchema,
  lotoCheckpointSettleSchema,
  lotoCheckpointsSettleBatchSchema,
  type LotoSellInput,
  type LotoCashPrizeInput,
  type LotoTicketUpdateInput,
  type LotoFeeInput,
  type LotoCheckpointCreateInput,
  type LotoCheckpointSettleInput,
  type LotoCheckpointsSettleBatchInput,
} from "@liratek/core";

const router = express.Router();

router.use(authenticateJWT);
router.use(requireRole(["admin"]));

// ---------------------------------------------------------------------------
// Local validation helper — safeParse against the shared core schemas.
// (Typed structurally to bridge the zod-major mismatch between core's types
// and this workspace's zod; the runtime API is identical.)
// ---------------------------------------------------------------------------
type SafeParseable<T> = {
  safeParse: (data: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: {
          issues: Array<{ path: (string | number)[]; message: string }>;
        };
      };
};

function parse<T>(
  schema: SafeParseable<T>,
  data: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Validation failed: ${messages}` };
  }
  return { ok: true, data: result.data };
}

const sellSchema = lotoSellSchema as unknown as SafeParseable<LotoSellInput>;
const cashPrizeSchema =
  lotoCashPrizeSchema as unknown as SafeParseable<LotoCashPrizeInput>;
const ticketUpdateSchema =
  lotoTicketUpdateSchema as unknown as SafeParseable<LotoTicketUpdateInput>;
const feeSchema = lotoFeeSchema as unknown as SafeParseable<LotoFeeInput>;
const checkpointCreateSchema =
  lotoCheckpointCreateSchema as unknown as SafeParseable<LotoCheckpointCreateInput>;
const checkpointSettleSchema =
  lotoCheckpointSettleSchema as unknown as SafeParseable<LotoCheckpointSettleInput>;
const checkpointsSettleBatchSchema =
  lotoCheckpointsSettleBatchSchema as unknown as SafeParseable<LotoCheckpointsSettleBatchInput>;

function fail(res: express.Response, error: unknown, fallback: string): void {
  lotoLogger.error({ error }, `loto REST: ${fallback}`);
  res.json({
    success: false,
    error: error instanceof Error ? error.message : fallback,
  });
}

function intParam(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

router.get("/settings", (_req, res) => {
  try {
    const settings = getLotoService().getSettings();
    const settingsObj: Record<string, string> = {};
    settings.forEach((value: string, key: string) => {
      settingsObj[key] = value;
    });
    res.json({ success: true, settings: settingsObj });
  } catch (error) {
    fail(res, error, "Failed to get settings");
  }
});

router.put("/settings/:key", (req, res) => {
  try {
    const value = (req.body as { value?: unknown })?.value;
    if (typeof value !== "string") {
      res.json({ success: false, error: "value must be a string" });
      return;
    }
    const setting = getLotoService().updateSetting(req.params.key, value);
    // Mirrors lotoHandlers.ts's loto:settings:update audit.
    auditRest(req, {
      action: "update",
      entity_type: "loto_setting",
      entity_id: req.params.key,
      summary: `Updated loto setting "${req.params.key}"`,
      new_values: { value },
    });
    res.json({ success: true, setting });
  } catch (error) {
    fail(res, error, "Failed to update setting");
  }
});

// ---------------------------------------------------------------------------
// Report & settlement math
// ---------------------------------------------------------------------------

router.get("/report", (req, res) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      res.json({ success: false, error: "from and to are required" });
      return;
    }
    const reportData = getLotoService().getReportData(from, to);
    res.json({ success: true, reportData });
  } catch (error) {
    fail(res, error, "Failed to get report data");
  }
});

router.get("/settlement", (req, res) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      res.json({ success: false, error: "from and to are required" });
      return;
    }
    const settlement = getLotoService().calculateSettlement(from, to);
    res.json({ success: true, settlement });
  } catch (error) {
    fail(res, error, "Failed to calculate settlement");
  }
});

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

router.post("/sell", (req, res) => {
  try {
    const v = parse(sellSchema, req.body);
    if (!v.ok) {
      res.json({ success: false, error: v.error });
      return;
    }
    const ticket = getLotoService().sellTicket({
      ...v.data,
      userId: req.user!.userId,
    });
    // Mirrors lotoHandlers.ts's loto:sell audit.
    auditRest(req, {
      action: "create",
      entity_type: "loto_ticket",
      entity_id: String(ticket?.id ?? ""),
      summary: "Sold loto ticket",
      metadata: v.data as Record<string, unknown>,
    });
    res.json({ success: true, ticket });
  } catch (error) {
    fail(res, error, "Failed to sell ticket");
  }
});

router.get("/uncheckpointed", (_req, res) => {
  try {
    const tickets = getLotoService().getUncheckpointedTickets();
    res.json({ success: true, tickets });
  } catch (error) {
    fail(res, error, "Failed to get uncheckpointed tickets");
  }
});

// ---------------------------------------------------------------------------
// Monthly fees
// ---------------------------------------------------------------------------

router.get("/fees", (req, res) => {
  try {
    const year = Number((req.query as { year?: string }).year);
    if (!Number.isInteger(year)) {
      res.json({ success: false, error: "year is required" });
      return;
    }
    const fees = getLotoService().getMonthlyFees(year);
    res.json({ success: true, fees });
  } catch (error) {
    fail(res, error, "Failed to get monthly fees");
  }
});

router.post("/fees", (req, res) => {
  try {
    const v = parse(feeSchema, req.body);
    if (!v.ok) {
      res.json({ success: false, error: v.error });
      return;
    }
    const fee = getLotoService().recordMonthlyFee(v.data);
    // Mirrors lotoHandlers.ts's loto:fees:create audit.
    auditRest(req, {
      action: "create",
      entity_type: "loto_fee",
      entity_id: String(fee?.id ?? ""),
      summary: "Recorded loto monthly fee",
    });
    res.json({ success: true, fee });
  } catch (error) {
    fail(res, error, "Failed to create monthly fee");
  }
});

router.post("/fees/:id/pay", (req, res) => {
  try {
    const id = intParam(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    const fee = getLotoService().markFeePaid(id, req.user!.userId);
    // Mirrors lotoHandlers.ts's loto:fees:pay audit.
    auditRest(req, {
      action: "update",
      entity_type: "loto_fee",
      entity_id: String(id),
      summary: `Marked loto fee #${id} as paid`,
    });
    res.json({ success: true, fee });
  } catch (error) {
    fail(res, error, "Failed to mark fee as paid");
  }
});

// ---------------------------------------------------------------------------
// Cash prizes (static paths before parameterized ones)
// ---------------------------------------------------------------------------

router.get("/cash-prizes/unreimbursed", (_req, res) => {
  try {
    const prizes = getLotoService().getUnreimbursedCashPrizes();
    res.json({ success: true, prizes });
  } catch (error) {
    fail(res, error, "Failed to get unreimbursed cash prizes");
  }
});

router.get("/cash-prizes/total-unreimbursed", (_req, res) => {
  try {
    const total = getLotoService().getTotalUnreimbursedCashPrizes();
    res.json({ success: true, total });
  } catch (error) {
    fail(res, error, "Failed to get total unreimbursed cash prizes");
  }
});

router.get("/cash-prizes", (req, res) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      res.json({ success: false, error: "from and to are required" });
      return;
    }
    const prizes = getLotoService().getCashPrizes(from, to);
    res.json({ success: true, prizes });
  } catch (error) {
    fail(res, error, "Failed to get cash prizes");
  }
});

router.post("/cash-prizes", (req, res) => {
  try {
    const v = parse(cashPrizeSchema, req.body);
    if (!v.ok) {
      res.json({ success: false, error: v.error });
      return;
    }
    const prize = getLotoService().recordCashPrize({
      ...v.data,
      userId: req.user!.userId,
    });
    // Mirrors lotoHandlers.ts's loto:cash-prize:create audit.
    auditRest(req, {
      action: "create",
      entity_type: "loto_cash_prize",
      entity_id: String(prize?.id ?? ""),
      summary: "Recorded loto cash prize",
    });
    res.json({ success: true, prize });
  } catch (error) {
    fail(res, error, "Failed to record cash prize");
  }
});

router.post("/cash-prizes/:id/reimburse", (req, res) => {
  try {
    const id = intParam(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    const body = req.body as { reimbursedDate?: string; settlementId?: number };
    const prize = getLotoService().markCashPrizeReimbursed(
      id,
      body?.reimbursedDate,
      body?.settlementId,
    );
    // Mirrors lotoHandlers.ts's loto:cash-prize:mark-reimbursed audit.
    auditRest(req, {
      action: "update",
      entity_type: "loto_cash_prize",
      entity_id: String(id),
      summary: `Marked loto cash prize #${id} as reimbursed`,
    });
    res.json({ success: true, prize });
  } catch (error) {
    fail(res, error, "Failed to mark cash prize as reimbursed");
  }
});

// ---------------------------------------------------------------------------
// Checkpoints (static paths before /:id)
// ---------------------------------------------------------------------------

router.get("/checkpoints/last", (_req, res) => {
  try {
    const checkpoint = getLotoService().getLastCheckpoint();
    res.json({ success: true, checkpoint });
  } catch (error) {
    fail(res, error, "Failed to get last checkpoint");
  }
});

// NOTE: "unssettled" spelling is the deployed adapter contract — keep as-is.
router.get("/checkpoints/unssettled", (_req, res) => {
  try {
    const checkpoints = getLotoService().getUnsettledCheckpoints();
    res.json({ success: true, checkpoints });
  } catch (error) {
    fail(res, error, "Failed to get unsettled checkpoints");
  }
});

router.get("/checkpoints/total-sales-unssettled", (_req, res) => {
  try {
    const totalSales = getLotoService().getTotalSalesFromUnsettledCheckpoints();
    res.json({ success: true, totalSales });
  } catch (error) {
    fail(res, error, "Failed to get total sales from unsettled checkpoints");
  }
});

router.get("/checkpoints/total-commission-unssettled", (_req, res) => {
  try {
    const totalCommission =
      getLotoService().getTotalCommissionFromUnsettledCheckpoints();
    res.json({ success: true, totalCommission });
  } catch (error) {
    fail(
      res,
      error,
      "Failed to get total commission from unsettled checkpoints",
    );
  }
});

// A create exposed over GET — mirrors the adapter's existing contract.
router.get("/checkpoints/scheduled", (req, res) => {
  try {
    const date = (req.query as { date?: string }).date;
    const checkpoint = getLotoService().createScheduledCheckpoint(date);
    res.json({ success: true, checkpoint });
  } catch (error) {
    fail(res, error, "Failed to create scheduled checkpoint");
  }
});

router.get("/checkpoints/date/:date", (req, res) => {
  try {
    const checkpoint = getLotoService().getCheckpointByDate(req.params.date);
    res.json({ success: true, checkpoint });
  } catch (error) {
    fail(res, error, "Failed to get checkpoint by date");
  }
});

router.get("/checkpoints", (req, res) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      res.json({ success: false, error: "from and to are required" });
      return;
    }
    const checkpoints = getLotoService().getCheckpointsByDateRange(from, to);
    res.json({ success: true, checkpoints });
  } catch (error) {
    fail(res, error, "Failed to get checkpoints by date range");
  }
});

router.post("/checkpoints", (req, res) => {
  try {
    const v = parse(checkpointCreateSchema, req.body);
    if (!v.ok) {
      res.json({ success: false, error: v.error });
      return;
    }
    const checkpoint = getLotoService().createCheckpoint(v.data);
    // Mirrors lotoHandlers.ts's loto:checkpoint:create audit.
    auditRest(req, {
      action: "create",
      entity_type: "loto_checkpoint",
      entity_id: String(checkpoint?.id ?? ""),
      summary: "Created loto checkpoint",
    });
    res.json({ success: true, checkpoint });
  } catch (error) {
    fail(res, error, "Failed to create checkpoint");
  }
});

router.post("/checkpoints/settle-batch", (req, res) => {
  try {
    const v = parse(checkpointsSettleBatchSchema, req.body);
    if (!v.ok) {
      res.json({ success: false, error: v.error });
      return;
    }
    const checkpoints = getLotoService().settleCheckpoints(
      v.data.checkpointIds,
      v.data.totalSales,
      v.data.totalCommission,
      v.data.settledAt,
      req.user!.userId,
      v.data.payment,
    );
    // Mirrors lotoHandlers.ts's loto:checkpoints:settle-batch audit.
    auditRest(req, {
      action: "settle",
      entity_type: "loto_checkpoint",
      entity_id: v.data.checkpointIds.join(","),
      summary: `Batch settled ${v.data.checkpointIds.length} loto checkpoint(s)`,
      metadata: {
        checkpointIds: v.data.checkpointIds,
        totalSales: v.data.totalSales,
        totalCommission: v.data.totalCommission,
      },
    });
    res.json({ success: true, checkpoints });
  } catch (error) {
    fail(res, error, "Failed to settle checkpoints");
  }
});

// Two adapter functions share this path with different bodies:
//  - lotoCheckpointSettle sends the full LotoCheckpointSettle payload
//    (totalSales/totalCommission/totalPrizes) → settleCheckpoint (money move);
//  - lotoCheckpointMarkSettled sends only { settledAt?, settlementId? }
//    → markCheckpointAsSettled (flag only, no drawer movement).
router.post("/checkpoints/:id/settle", (req, res) => {
  try {
    const id = intParam(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body.totalSales === undefined && body.totalCommission === undefined) {
      const checkpoint = getLotoService().markCheckpointAsSettled(
        id,
        body.settledAt as string | undefined,
        body.settlementId as number | undefined,
      );
      // Mirrors lotoHandlers.ts's loto:checkpoint:mark-settled audit.
      auditRest(req, {
        action: "settle",
        entity_type: "loto_checkpoint",
        entity_id: String(id),
        summary: `Marked loto checkpoint #${id} as settled`,
      });
      res.json({ success: true, checkpoint });
      return;
    }
    const v = parse(checkpointSettleSchema, { ...body, id });
    if (!v.ok) {
      res.json({ success: false, error: v.error });
      return;
    }
    const checkpoint = getLotoService().settleCheckpoint(
      v.data.id,
      v.data.totalSales,
      v.data.totalCommission,
      v.data.totalPrizes,
      0, // deprecated — checkpoint reads its own total_cash_prizes
      v.data.settledAt,
      req.user!.userId,
      v.data.payments,
    );
    // Mirrors lotoHandlers.ts's loto:checkpoint:settle audit.
    auditRest(req, {
      action: "settle",
      entity_type: "loto_checkpoint",
      entity_id: String(v.data.id),
      summary: `Settled loto checkpoint #${v.data.id}`,
      metadata: {
        totalSales: v.data.totalSales,
        totalCommission: v.data.totalCommission,
      },
    });
    res.json({ success: true, checkpoint });
  } catch (error) {
    fail(res, error, "Failed to settle checkpoint");
  }
});

router.put("/checkpoints/:id", (req, res) => {
  try {
    const id = intParam(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    const checkpoint = getLotoService().updateCheckpoint(id, req.body);
    // Mirrors lotoHandlers.ts's loto:checkpoint:update audit.
    auditRest(req, {
      action: "update",
      entity_type: "loto_checkpoint",
      entity_id: String(id),
      summary: `Updated loto checkpoint #${id}`,
    });
    res.json({ success: true, checkpoint });
  } catch (error) {
    fail(res, error, "Failed to update checkpoint");
  }
});

router.delete("/checkpoints/:id", (req, res) => {
  try {
    const id = intParam(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    const deleted = getLotoService().deleteCheckpoint(id);
    if (!deleted) {
      res.json({
        success: false,
        error: "Checkpoint not found or already settled",
      });
      return;
    }
    // Mirrors lotoHandlers.ts's loto:checkpoint:delete audit.
    auditRest(req, {
      action: "delete",
      entity_type: "loto_checkpoint",
      entity_id: String(id),
      summary: `Deleted unsettled loto checkpoint #${id}`,
    });
    res.json({ success: true });
  } catch (error) {
    fail(res, error, "Failed to delete checkpoint");
  }
});

router.get("/checkpoints/:id", (req, res) => {
  try {
    const id = intParam(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    const checkpoint = getLotoService().getCheckpoint(id);
    res.json({ success: true, checkpoint });
  } catch (error) {
    fail(res, error, "Failed to get checkpoint");
  }
});

// ---------------------------------------------------------------------------
// Ticket by id / list (catch-alls — keep LAST)
// ---------------------------------------------------------------------------

router.get("/", (req, res) => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to) {
      res.json({ success: false, error: "from and to are required" });
      return;
    }
    const tickets = getLotoService().getTicketsByDateRange(from, to);
    res.json({ success: true, tickets });
  } catch (error) {
    fail(res, error, "Failed to get tickets");
  }
});

router.put("/:id", (req, res) => {
  try {
    const id = intParam(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    const v = parse(ticketUpdateSchema, req.body);
    if (!v.ok) {
      res.json({ success: false, error: v.error });
      return;
    }
    // Metadata-only passthrough — sale_amount/commission_rate/
    // commission_amount/is_winner/prize_amount are no longer accepted here
    // (see lotoTicketUpdateSchema's doc comment); void/refund is the
    // sanctioned correction path for those now. Mirrors the loto:update IPC
    // handler exactly.
    const ticket = getLotoService().updateTicket(id, v.data);
    // Mirrors lotoHandlers.ts's loto:update audit.
    auditRest(req, {
      action: "update",
      entity_type: "loto_ticket",
      entity_id: String(id),
      summary: `Updated loto ticket #${id}`,
    });
    res.json({ success: true, ticket });
  } catch (error) {
    fail(res, error, "Failed to update ticket");
  }
});

router.get("/:id", (req, res) => {
  try {
    const id = intParam(req.params.id);
    if (id == null) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    const ticket = getLotoService().getTicket(id);
    res.json({ success: true, ticket });
  } catch (error) {
    fail(res, error, "Failed to get ticket");
  }
});

export default router;
