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
  holdMoneyCollectSchema,
  holdMoneyVoidPickupSchema,
  type HoldMoneyCreateInput,
  type HoldMoneyCollectInput,
  type HoldMoneyVoidPickupInput,
  type HoldMoneyStatus,
} from "@liratek/core";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { auditRest } from "../middleware/audit.js";

const router = express.Router();

router.use(authenticateJWT);

const writeGate = requireRole(["admin", "staff"]);

// safeParse against the core schema, bridging the zod-major type gap.
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
const createSchema =
  holdMoneyCreateSchema as unknown as SafeParseable<HoldMoneyCreateInput>;
// LIRA-214 (migration v183) — pickup (collect) and pickup-void.
const collectSchema =
  holdMoneyCollectSchema as unknown as SafeParseable<HoldMoneyCollectInput>;
const voidPickupSchema =
  holdMoneyVoidPickupSchema as unknown as SafeParseable<HoldMoneyVoidPickupInput>;

function parseOrFail<T>(
  schema: SafeParseable<T>,
  body: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Validation failed: ${msg}` };
  }
  return { ok: true, data: parsed.data };
}

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
    const result = getHoldMoneyService().createHold(parsed.data, userId);
    if (result.success) {
      // Mirrors holdMoneyHandlers.ts's hold-money:create audit.
      auditRest(req, {
        action: "create",
        entity_type: "hold_money",
        entity_id: result.id ? String(result.id) : undefined,
        summary: `Held money for ${parsed.data.client_name}`,
        metadata: {
          client_name: parsed.data.client_name,
          usd_amount: parsed.data.usd_amount,
          lbp_amount: parsed.data.lbp_amount,
        },
      });
    }
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// GET /api/hold-money/:id/pickups — every pickup event (voided or not) for
// one hold (detail view + void action source list).
router.get("/:id/pickups", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    res.json({ success: true, data: getHoldMoneyService().getPickups(id) });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/hold-money/:id/collect — return part or all of a hold
// (LIRA-214, migration v183: now a validated body — payment legs + optional
// partial amounts — not a bare id).
router.post("/:id/collect", writeGate, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    const parsed = parseOrFail(collectSchema, { ...req.body, id });
    if (!parsed.ok) {
      res.json({ success: false, error: parsed.error });
      return;
    }
    const result = getHoldMoneyService().collectHold(
      parsed.data,
      req.user!.userId,
    );
    if (result.success) {
      // Mirrors holdMoneyHandlers.ts's hold-money:collect audit.
      auditRest(req, {
        action: "collect",
        entity_type: "hold_money",
        entity_id: String(id),
        summary: `Collected hold #${id}`,
        metadata: {
          usd_amount: parsed.data.usd_amount,
          lbp_amount: parsed.data.lbp_amount,
        },
      });
    }
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/hold-money/pickups/:pickupId/void — rule-20 reversal owner for
// one pickup event recorded in error.
router.post("/pickups/:pickupId/void", writeGate, (req, res) => {
  try {
    const pickupId = Number(req.params.pickupId);
    const parsed = parseOrFail(voidPickupSchema, { pickup_id: pickupId });
    if (!parsed.ok) {
      res.json({ success: false, error: parsed.error });
      return;
    }
    const result = getHoldMoneyService().voidPickup(
      parsed.data.pickup_id,
      req.user!.userId,
    );
    if (result.success) {
      auditRest(req, {
        action: "void",
        entity_type: "hold_money_pickup",
        entity_id: String(pickupId),
        summary: `Voided hold pickup #${pickupId}`,
      });
    }
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

export default router;
