import express from "express";
import { authenticateJWT, requireRole } from "../middleware/auth.js";
import { validateRequest } from "../middleware/validation.js";
import {
  getVoucherService,
  voucherCreateSchema,
  type VoucherFilters,
} from "@liratek/core";
import type { AuthRequest } from "../middleware/auth.js";

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

// GET /api/vouchers?status=&clientId=  — list vouchers (admin+staff, mirrors IPC)
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
  const result = getVoucherService().getVouchers(filters);
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
    res.json(result);
  },
);

// POST /api/vouchers/validate  { code } — look up a voucher by code (static, before /:id)
router.post("/validate", writeGate, (req, res) => {
  const code =
    typeof (req.body as { code?: unknown } | undefined)?.code === "string"
      ? (req.body as { code: string }).code
      : "";
  const result = getVoucherService().validateVoucher(code);
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
  res.json(result);
});

export default router;
