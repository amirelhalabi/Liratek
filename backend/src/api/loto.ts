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
 * - Every route below the router-level `requireRole(["admin"])` gate is
 *   admin-only, matching its IPC handler's requireRole — EXCEPT
 *   `POST /update-metadata`, which is registered ABOVE that gate (right
 *   after `authenticateJWT`) with its own `requireRole(["admin", "staff"])`,
 *   because its IPC twin (`loto:update-metadata` in lotoHandlers.ts) allows
 *   staff to edit a ticket's note too (CLAUDE.md rule 19c: REST roles must
 *   match the IPC twin's, and desktop is the reference — REST widens to
 *   match it, not the other way around).
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
  lotoCheckpointUpdateSchema,
  lotoCheckpointSettleSchema,
  lotoCheckpointsSettleBatchSchema,
  lotoUpdateMetadataSchema,
  type LotoSellInput,
  type LotoCashPrizeInput,
  type LotoTicketUpdateInput,
  type LotoFeeInput,
  type LotoCheckpointCreateInput,
  type LotoCheckpointUpdateInput,
  type LotoCheckpointSettleInput,
  type LotoCheckpointsSettleBatchInput,
  type LotoUpdateMetadataInput,
} from "@liratek/core";

const router = express.Router();

router.use(authenticateJWT);

// POST /api/loto/update-metadata — edit a loto ticket's note. Mirrors
// lotoHandlers.ts's "loto:update-metadata" IPC handler, which gates on
// `requireRole(["admin", "staff"])`. Registered HERE, between
// `authenticateJWT` and the router-level `requireRole(["admin"])` below, so
// it escapes that blanket admin-only gate — a route added after that gate
// would be admin-only regardless of its own `requireRole` (CLAUDE.md rule
// 19c: REST roles must match the IPC twin's; desktop's roles are the
// reference here, so REST widens rather than narrowing the IPC handler).
// Static path, and defined before `router.use(requireRole(["admin"]))`
// registers ANY other route, so it cannot shadow or be shadowed by
// `/:id`, `/checkpoints/*`, etc. registered further down.
router.post("/update-metadata", requireRole(["admin", "staff"]), (req, res) => {
  try {
    const v = parse(updateMetadataSchema, req.body);
    if (!v.ok) {
      res.json({ success: false, error: v.error });
      return;
    }
    const editedBy = req.user!.username;
    const result = getLotoService().updateLotoMetadata(
      v.data.id,
      { note: v.data.note },
      editedBy,
    );
    if (
      result.success &&
      result.oldValues &&
      Object.keys(result.oldValues).length > 0
    ) {
      // Mirrors lotoHandlers.ts's loto:update-metadata audit
      // (edit_metadata/loto_ticket).
      auditRest(req, {
        action: "edit_metadata",
        entity_type: "loto_ticket",
        entity_id: String(v.data.id),
        summary: `Edited loto ticket #${v.data.id} metadata`,
        old_values: result.oldValues,
        new_values: v.data,
      });
    }
    res.json(
      result.success
        ? { success: true, data: result.entity }
        : { success: false, error: result.error },
    );
  } catch (error) {
    fail(res, error, "Failed to update metadata");
  }
});

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
// Closes the one checkpoint write path with no schema before this ticket —
// see lotoCheckpointUpdateSchema's doc comment
// (packages/core/src/validators/loto.ts) for the strip-trap this guards
// against (every field in LotoCheckpointUpdate must stay covered here).
const checkpointUpdateSchema =
  lotoCheckpointUpdateSchema as unknown as SafeParseable<LotoCheckpointUpdateInput>;
const checkpointSettleSchema =
  lotoCheckpointSettleSchema as unknown as SafeParseable<LotoCheckpointSettleInput>;
const checkpointsSettleBatchSchema =
  lotoCheckpointsSettleBatchSchema as unknown as SafeParseable<LotoCheckpointsSettleBatchInput>;
const updateMetadataSchema =
  lotoUpdateMetadataSchema as unknown as SafeParseable<LotoUpdateMetadataInput>;

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
    const v = parse(checkpointUpdateSchema, req.body);
    if (!v.ok) {
      res.json({ success: false, error: v.error });
      return;
    }
    const checkpoint = getLotoService().updateCheckpoint(id, v.data);
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

// POST /api/loto/update-metadata moved ABOVE the router-level
// `requireRole(["admin"])` gate (right after `router.use(authenticateJWT)`,
// near the top of this file) so it can carry its own
// `requireRole(["admin", "staff"])` matching its IPC twin. See the
// file-header comment and that route's own comment for why.

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
