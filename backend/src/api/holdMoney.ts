/**
 * Hold-money REST routes — HTTP twin of electron-app/handlers/holdMoneyHandlers.ts.
 *
 * Parity rules (same as loto.ts / sessions.ts): IPC-identical envelopes
 * (`{ success, data }` for reads, the service result verbatim for writes;
 * HTTP 200 even on failure so the adapter branches on `result.success`).
 * Both transports call the same core HoldMoneyService — holding cash credits
 * the General drawer, collecting debits it; profit is zero (FEATURE_GUIDE §10).
 * Tenant-scoped by construction: authenticateJWT establishes the tenant
 * context and HoldMoneyRepository scopes by getCurrentTenantId().
 */
import express from "express";
import {
  getHoldMoneyService,
  holdMoneyCreateSchema,
  type HoldMoneyCreateInput,
  type HoldMoneyStatus,
} from "@liratek/core";
import { authenticateJWT, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(authenticateJWT);

const writeGate = requireRole(["admin", "staff"]);

// safeParse against the core schema, bridging the zod-major type gap.
type SafeParseable<T> = {
  safeParse: (data: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: Array<{ path: (string | number)[]; message: string }> };
      };
};
const createSchema =
  holdMoneyCreateSchema as unknown as SafeParseable<HoldMoneyCreateInput>;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

// GET /api/hold-money?status=held|collected — all holds (optional filter)
router.get("/", (req, res) => {
  try {
    const status = req.query.status as HoldMoneyStatus | undefined;
    const filter = status ? { status } : undefined;
    res.json({ success: true, data: getHoldMoneyService().getHolds(filter) });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/hold-money/active — uncollected holds (Dashboard cards + Services)
router.get("/active", (_req, res) => {
  try {
    res.json({ success: true, data: getHoldMoneyService().getActiveHolds() });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/hold-money — create a hold (cash in → General)
router.post("/", writeGate, (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      res.json({ success: false, error: `Validation failed: ${msg}` });
      return;
    }
    const userId = req.user!.userId;
    res.json(getHoldMoneyService().createHold(parsed.data, userId));
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/hold-money/:id/collect — return a hold (cash out ← General)
router.post("/:id/collect", writeGate, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    res.json(getHoldMoneyService().collectHold(id, req.user!.userId));
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

export default router;
