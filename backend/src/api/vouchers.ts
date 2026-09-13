import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  getVoucherService,
  voucherCreateSchema,
  type VoucherFilters,
} from "@liratek/core";
import type { AuthRequest } from "../middleware/auth.js";
import { auditRest } from "../middleware/audit.js";

const VOUCHER_STATUSES = [
  "pending",
  "redeemed",
  "expired",
  "cancelled",
] as const;

const router = express.Router();

// All voucher routes require auth (also establishes tenant context).
router.use(authenticateJWT);

const writeGate = requireRole(["admin", "staff"]);
const adminGate = requireRole(["admin"]);

// GET /api/vouchers?status=&clientId=&day=  — list vouchers (admin+staff,
// mirrors IPC). `day` is the CLIENT's own local calendar day (`YYYY-MM-DD`) —
// the server can't be trusted to know the shop's timezone (web runs on a UTC
// Fly machine, the shop is Beirut UTC+3), so an expired-today voucher would
// otherwise read pending/expired up to 3h out of step with the shop. Falls
// back to the server's own `localDay()` when omitted.
router.get("/", writeGate, (req, res) => {
  const filters: VoucherFilters = {};
  const status = req.query.status;
  if (
    typeof status === "string" &&
    (VOUCHER_STATUSES as readonly string[]).includes(status)
  ) {
    filters.status = status as VoucherFilters["status"];
  }
  const clientId = Number(req.query.clientId);
  if (Number.isFinite(clientId)) filters.clientId = clientId;
  const day =
    typeof req.query.day === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(req.query.day)
      ? req.query.day
      : undefined;
  const result = getVoucherService().getVouchers(filters, day);
  res.json(result);
});

// POST /api/vouchers — create a gift card (userId injected from JWT)
router.post(
  "/",
  writeGate,
  validateRequest(voucherCreateSchema),
  (req, res) => {
    const userId = (req as AuthRequest).user!.userId;
    const result = getVoucherService().createVoucher(req.body, userId);

    // Only on success: a rejected create changed nothing, and an audit row for
    // it would misrepresent the trail.
    if (result.success && result.voucher) {
      auditRest(req, {
        action: "create",
        entity_type: "voucher",
        entity_id: String(result.voucher.id),
        summary: `Created voucher ${result.voucher.code}`,
        new_values: {
          code: result.voucher.code,
          amount: result.voucher.amount,
        },
      });
    }

    res.json(result);
  },
);

// POST /api/vouchers/validate  { code, day? } — look up a voucher by code
// (static, before /:id). `day` is the CLIENT's own local calendar day — see
// the GET / route above for why. Deliberately NOT audited: this is a READ
// that uses POST only to carry the code in a body. Nothing changes, so an
// audit row would be noise.
router.post("/validate", writeGate, (req, res) => {
  const body = req.body as { code?: unknown; day?: unknown } | undefined;
  const code = typeof body?.code === "string" ? body.code : "";
  const day =
    typeof body?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day)
      ? body.day
      : undefined;
  const result = getVoucherService().validateVoucher(code, day);
  res.json(result);
});

// POST /api/vouchers/:id/cancel — cancel a voucher (admin-only, userId injected)
router.post("/:id/cancel", adminGate, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ success: false, error: "Invalid voucher id" });
    return;
  }
  const userId = (req as AuthRequest).user!.userId;
  const result = getVoucherService().cancelVoucher(id, userId);

  // Cancelling voids stored value, so this is the voucher event most worth
  // being able to attribute later.
  if (result.success) {
    auditRest(req, {
      action: "cancel",
      entity_type: "voucher",
      entity_id: String(id),
      summary: result.voucher
        ? `Cancelled voucher ${result.voucher.code}`
        : `Cancelled voucher #${id}`,
    });
  }

  res.json(result);
});

export default router;
