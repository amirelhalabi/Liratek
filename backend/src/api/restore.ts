/**
 * LIRA-377 web shop restore — `/api/restore/*` (`specs/377-shop-restore/contracts/rest.md`).
 *
 * Every route: authenticateJWT (→ runWithTenant: the shop is the JWT's,
 * never a request field) → requireRole(["admin"]) → the restore service
 * (null outside per-tenant mode → "Restore is only available on the web
 * app") → the core Zod schema. The actor (user id, name, role) comes from
 * `req.user`; "now" is taken ONCE per request and passed down (rule 27).
 *
 * Envelopes, HTTP 200 (rule 19c):
 *   { success: true, data }
 *   { success: false, code: "<CODE>", error: "<plain text>", shopName? }
 * Schema failures are the shared `validateRequest` envelope (no `code`).
 * One exception the frontend relies on: a body over 64 MB is HTTP 413 with
 * `{ success:false, code:"FILE_TOO_LARGE", error }`.
 *
 * POST /file takes the raw backup file (application/octet-stream, optional
 * Content-Encoding: gzip). The raw parser is mounted on THAT route only and
 * AFTER the auth/role checks, so an unauthenticated caller can never make the
 * server buffer 64 MB. body-parser inflates gzip itself and applies the limit
 * to the INFLATED size (a small gzip bomb is refused the same way).
 */
import express, { type NextFunction, type Response } from "express";
import fs from "node:fs";
import {
  cancelRestoreSchema,
  confirmRestoreSchema,
  prepareRestoreSchema,
  restoreFileQuerySchema,
  type CancelRestoreInput,
  type ConfirmRestoreInput,
  type PrepareRestoreInput,
  type RestoreActor,
  type RestoreFileQuery,
  type RestoreOutcome,
  type ShopRestoreService,
} from "@liratek/core";
import { authenticateJWT, requireRole, type AuthRequest } from "../middleware/auth.js";
import { validateQuery, validateRequest } from "../middleware/validation.js";
import { shopRestoreService } from "../restore/restoreService.js";
import { logger } from "../server.js";

const router = express.Router();

export const RESTORE_WEB_ONLY_ERROR = "Restore is only available on the web app";
const UPLOAD_LIMIT = "64mb";

interface RestoreLocals {
  restore: ShopRestoreService;
}

function actorOf(req: AuthRequest): RestoreActor {
  const u = req.user!;
  return {
    tenantId: u.tenantId ?? 0,
    userId: u.userId,
    username: u.username,
    role: u.role,
    now: new Date().toISOString(),
  };
}

function send<T>(res: Response, outcome: RestoreOutcome<T>): void {
  if (outcome.ok) {
    res.json({ success: true, data: outcome.data });
    return;
  }
  res.json({
    success: false,
    code: outcome.code,
    error: outcome.message,
    ...(outcome.shopName !== undefined ? { shopName: outcome.shopName } : {}),
  });
}

function withService(_req: AuthRequest, res: Response, next: NextFunction): void {
  const svc = shopRestoreService();
  if (!svc || !_req.user?.tenantId) {
    res.json({ success: false, error: RESTORE_WEB_ONLY_ERROR });
    return;
  }
  (res.locals as RestoreLocals).restore = svc;
  next();
}

const svcOf = (res: Response): ShopRestoreService => (res.locals as RestoreLocals).restore;

router.use(authenticateJWT, requireRole(["admin"]), withService);

router.get("/points", (req: AuthRequest, res) => {
  try {
    res.json({ success: true, data: svcOf(res).points(actorOf(req)) });
  } catch (error) {
    logger.error({ error }, "restore points failed");
    res.json({ success: false, error: "Could not load the restore points" });
  }
});

router.post("/prepare", validateRequest(prepareRestoreSchema), async (req: AuthRequest, res) => {
  try {
    send(res, await svcOf(res).prepare(actorOf(req), req.body as PrepareRestoreInput));
  } catch (error) {
    logger.error({ error }, "restore prepare failed");
    res.json({ success: false, code: "PREPARE_FAILED", error: "Could not prepare the restore. Nothing was changed." });
  }
});

/** Route-level raw body; an oversize body becomes the JSON 413 the panel maps. */
const rawUpload = express.raw({ type: "application/octet-stream", limit: UPLOAD_LIMIT, inflate: true });
function readUpload(req: AuthRequest, res: Response, next: NextFunction): void {
  rawUpload(req, res, (err?: unknown) => {
    if (!err) {
      next();
      return;
    }
    const type = (err as { type?: string }).type;
    if (type === "entity.too.large") {
      res.status(413).json({ success: false, code: "FILE_TOO_LARGE", error: "The file is larger than 64 MB" });
      return;
    }
    logger.warn({ error: err }, "restore upload could not be read");
    res.json({ success: false, code: "NOT_A_SHOP_FILE", error: "This is not a LiraTek shop backup file" });
  });
}

router.post("/file", validateQuery(restoreFileQuerySchema), readUpload, async (req: AuthRequest, res) => {
  const body: unknown = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    res.json({ success: false, code: "NOT_A_SHOP_FILE", error: "This is not a LiraTek shop backup file" });
    return;
  }
  const svc = svcOf(res);
  const actor = actorOf(req);
  const uploadPath = svc.newUploadPath(actor);
  try {
    fs.writeFileSync(uploadPath, body);
    const query = req.query as unknown as RestoreFileQuery;
    // prepareFile owns the staged file from here: it moves or deletes it.
    send(res, await svc.prepareFile(actor, { uploadPath, clientTzOffsetMin: query.clientTzOffsetMin }));
  } catch (error) {
    fs.rmSync(uploadPath, { force: true });
    logger.error({ error }, "restore file upload failed");
    res.json({ success: false, code: "PREPARE_FAILED", error: "Could not prepare the restore. Nothing was changed." });
  }
});

router.post("/confirm", validateRequest(confirmRestoreSchema), async (req: AuthRequest, res) => {
  try {
    send(res, await svcOf(res).confirm(actorOf(req), req.body as ConfirmRestoreInput));
  } catch (error) {
    logger.error({ error }, "restore confirm failed");
    res.json({ success: false, code: "RESTORE_FAILED", error: "The restore failed. The shop was not changed." });
  }
});

router.post("/cancel", validateRequest(cancelRestoreSchema), (req: AuthRequest, res) => {
  try {
    send(res, svcOf(res).cancel(actorOf(req), req.body as CancelRestoreInput));
  } catch (error) {
    logger.error({ error }, "restore cancel failed");
    res.json({ success: false, error: "Could not cancel the restore" });
  }
});

export default router;
