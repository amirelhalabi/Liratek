/**
 * Web "Download backup" (Settings › Backup) — GET /api/backup/download.
 *
 * A shop admin downloads a SQLite file of THEIR OWN shop. Web-only by nature
 * (the desktop keeps its local backups on Settings › Diagnostics): the
 * adapter's desktop branch answers "Available on the web app".
 *
 * authenticateJWT (→ runWithTenant: the shop is the JWT's, never a request
 * field) → requireRole(["admin"]) → validateQuery(shopBackupQuerySchema).
 * The copy is made by core (`ShopBackupService` → `ShopBackupRepository` →
 * the single-shop builder shared with the offline copy), written to a fresh
 * temp directory under os.tmpdir(), streamed with
 * `Content-Disposition: attachment`, and the directory is removed exactly
 * once — when the response finishes, fails, or the browser goes away.
 *
 * Failures before the file is sent are the IPC-identical envelope, HTTP 200
 * (rule 19c), so the adapter can tell them from the file by Content-Type.
 */
import express from "express";
import {
  getShopBackupService,
  shopBackupQuerySchema,
  type ShopBackupFile,
  type ShopBackupQuery,
  type ShopBackupService,
} from "@liratek/core";
import { authenticateJWT, requireRole, type AuthRequest } from "../middleware/auth.js";
import { validateQuery } from "../middleware/validation.js";
import { auditRest } from "../middleware/audit.js";
import { logger } from "../server.js";

const router = express.Router();

// Lazy so backend jest can inject a service whose builder uses the real
// better-sqlite3 constructor (jest maps the module to a mock) — same seam as
// `setOfflineSnapshotServiceForTests` in offline.ts.
let serviceOverride: ShopBackupService | null = null;
function backupService(): ShopBackupService {
  return serviceOverride ?? getShopBackupService();
}
/** Test seam only. */
export function setShopBackupServiceForTests(svc: ShopBackupService | null): void {
  serviceOverride = svc;
}

// One build per shop per minute. The build is synchronous on the one Fly
// machine, so a double-click or a reload during "Preparing" would otherwise
// freeze every shop for several build times. Reserved BEFORE the build so a
// request queued behind it is refused, not built again.
const COOLDOWN_MS = 60_000;
const lastBuildAt = new Map<number, number>();
/** Test seam only. */
export function resetShopBackupCooldownForTests(): void {
  lastBuildAt.clear();
}

router.get(
  "/download",
  authenticateJWT,
  requireRole(["admin"]),
  validateQuery(shopBackupQuerySchema),
  (req: AuthRequest, res) => {
    const tenantId = req.user?.tenantId ?? 0;
    const now = Date.now();
    if (now - (lastBuildAt.get(tenantId) ?? 0) < COOLDOWN_MS) {
      res.json({ success: false, error: "A backup was just prepared. Try again in a minute." });
      return;
    }
    lastBuildAt.set(tenantId, now);

    let backup: ShopBackupFile;
    try {
      backup = backupService().createBackup(req.query as ShopBackupQuery);
    } catch (error) {
      logger.error({ error }, "shop backup failed");
      res.json({ success: false, error: "Could not prepare the backup" });
      return;
    }

    // Exactly once, whichever comes first: the send finished/failed, or the
    // connection closed (the browser cancelled the download).
    res.on("close", backup.dispose);

    res.download(
      backup.filePath,
      backup.fileName,
      {
        headers: {
          "Content-Type": "application/vnd.sqlite3",
          "Cache-Control": "no-store",
        },
      },
      (error) => {
        backup.dispose();
        if (error) {
          logger.error({ error }, "shop backup send failed");
          if (!res.headersSent) res.json({ success: false, error: "Could not send the backup" });
          return;
        }
        // Only a file that was fully sent counts as downloaded.
        auditRest(req, {
          action: "backup_download",
          entity_type: "shop",
          entity_id: null,
          summary: "Backup downloaded",
          metadata: { file_name: backup.fileName, size_bytes: backup.sizeBytes },
        });
      },
    );
  },
);

export default router;
