/**
 * Service-presets REST routes — HTTP twin of the service-presets:* IPC handlers
 * in electron-app/handlers/customServiceHandlers.ts.
 *
 * Config CRUD (preset templates for custom services) — no money movement.
 * Validates against the core schemas already in
 * packages/core/src/validators/servicePreset.ts (rule 14). Envelopes mirror
 * IPC: reads/writes return `{ success, data }` (or `{ success:false, error }`),
 * HTTP 200 even on failure. Tenant-scoped via authenticateJWT → runWithTenant
 * (ServicePresetRepository scopes by getCurrentTenantId).
 */
import express from "express";
import {
  getServicePresetService,
  createServicePresetSchema,
  updateServicePresetSchema,
  type CreateServicePresetInput,
  type UpdateServicePresetInput,
} from "@liratek/core";
import { authenticateJWT, requireRole } from "../middleware/auth.js";

const router = express.Router();

router.use(authenticateJWT);
const adminGate = requireRole(["admin"]);

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
  createServicePresetSchema as unknown as SafeParseable<CreateServicePresetInput>;
const updateSchema =
  updateServicePresetSchema as unknown as SafeParseable<UpdateServicePresetInput>;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

function validationError(
  issues: Array<{ path: (string | number)[]; message: string }>,
): string {
  return `Validation failed: ${issues
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ")}`;
}

// GET /api/service-presets?category=&includeInactive=
router.get("/", (req, res) => {
  try {
    const { category } = req.query as { category?: string };
    const includeInactive = req.query.includeInactive === "true";
    const filter: { category?: string; includeInactive?: boolean } = {
      includeInactive,
    };
    if (category) filter.category = category;
    res.json({
      success: true,
      data: getServicePresetService().getPresets(filter),
    });
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// POST /api/service-presets (admin)
router.post("/", adminGate, (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.json({ success: false, error: validationError(parsed.error.issues) });
      return;
    }
    const result = getServicePresetService().createPreset(parsed.data);
    res.json(
      result.success
        ? { success: true, data: result.preset }
        : { success: false, error: result.error },
    );
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// PUT /api/service-presets/:id (admin) — body is the update fields
router.put("/:id", adminGate, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.json({ success: false, error: validationError(parsed.error.issues) });
      return;
    }
    const result = getServicePresetService().updatePreset(id, parsed.data);
    res.json(
      result.success
        ? { success: true, data: result.preset }
        : { success: false, error: result.error },
    );
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

// DELETE /api/service-presets/:id (admin)
router.delete("/:id", adminGate, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.json({ success: false, error: "Invalid id" });
      return;
    }
    res.json(getServicePresetService().deletePreset(id));
  } catch (err) {
    res.json({ success: false, error: errMessage(err) });
  }
});

export default router;
