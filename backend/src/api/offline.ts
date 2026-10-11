/**
 * LIRA-306 — /api/offline (contracts/rest-offline.md).
 *
 * PC routes (device key, constitution exception E3 — G0 approved):
 *   POST /pair            admin signs in on the PC; key returned once
 *   POST /checkin         every ~30 s while online
 *   POST /events          upload 1–100 events (stored once, acked; processed
 *                         asynchronously in merge rounds)
 *   GET  /events/status   outcomes from a sequence number
 *   GET  /snapshot        gzip copy of the PC's shop (≤ 5 min old, shared by
 *                         every PC of the shop); `?schemaVersion=n` must equal
 *                         the server's, else VERSION_MISMATCH (T116, FR-007)
 *   POST /manifest        N5 cross-check when the PC goes back to the web (T067)
 *
 * Web routes (JWT → admin, actor from the JWT — never the body; web-only by
 * nature, exception E1 — G0 approved) (T071, FR-002, FR-037, FR-038):
 *   GET  /review                     open (or filtered) review items
 *   GET  /history                    processed events, server rows, receipt numbers
 *   POST /review/:id/apply | /dismiss | /reviewed | /book-anyway
 *   GET  /devices                    paired PCs (no key material)
 *   POST /devices/:id/revoke
 * The rules live in core (OfflineDeviceService, OfflineEventService,
 * OfflineReviewService); this file validates, authenticates and shapes the
 * IPC-identical envelope (HTTP 200 on business failure, rule 19c).
 */
import express from "express";
import {
  checkinSchema,
  eventsStatusQuerySchema,
  getOfflineEventService,
  getOfflineReviewService,
  manifestSchema,
  offlineHistoryQuerySchema,
  reviewDismissSchema,
  reviewIdParamSchema,
  reviewListQuerySchema,
  type ManifestInput,
  type OfflineHistoryQuery,
  type ReviewDismissInput,
  type ReviewListQuery,
  getOfflineSnapshotService,
  pairDeviceSchema,
  snapshotQuerySchema,
  type OfflineSnapshotService,
  uploadEventsSchema,
  type CheckinInput,
  type PairDeviceInput,
  type UploadEventsInput,
} from "@liratek/core";
import { validateParams, validateQuery, validateRequest } from "../middleware/validation.js";
import { authenticateJWT, requireRole, type AuthRequest } from "../middleware/auth.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { clientIp } from "../middleware/clientIp.js";
import { authenticateDevice, offlineDeviceService, type DeviceRequest } from "../middleware/deviceAuth.js";
import { scheduleOfflineRound } from "../offline/processorTimer.js";
import { logger } from "../server.js";

const router = express.Router();

// Lazy so backend jest can inject a service whose copy builder uses the real
// better-sqlite3 constructor (jest maps the module to a mock) — same shape as
// `offlineDeviceService()` in deviceAuth.ts. Production always uses the core
// singleton.
let snapshotServiceOverride: OfflineSnapshotService | null = null;
function snapshotService(): OfflineSnapshotService {
  return snapshotServiceOverride ?? getOfflineSnapshotService();
}
/** Test seam only. */
export function setOfflineSnapshotServiceForTests(svc: OfflineSnapshotService | null): void {
  snapshotServiceOverride = svc;
}

// POST /api/offline/pair — no key yet; the admin's credentials are the proof.
router.post("/pair", authLimiter, validateRequest(pairDeviceSchema), async (req, res): Promise<void> => {
  try {
    const ip = clientIp(req) || req.socket.remoteAddress;
    const result = await offlineDeviceService().pair(req.body as PairDeviceInput, ip ? { ipAddress: ip } : {});
    res.json(result);
  } catch (error) {
    logger.error({ error }, "offline pair failed");
    res.json({ success: false, error: "Pairing failed" });
  }
});

// POST /api/offline/checkin
router.post("/checkin", authenticateDevice, validateRequest(checkinSchema), (req: DeviceRequest, res) => {
  try {
    const device = req.device!;
    const result = offlineDeviceService().checkin(device.deviceId, req.body as CheckinInput);
    // A PC reporting waiting work (or a restart) gets a round scheduled.
    if (result.success) scheduleOfflineRound(device.tenantId);
    res.json(result);
  } catch (error) {
    logger.error({ error }, "offline checkin failed");
    res.json({ success: false, error: "Check-in failed" });
  }
});

// POST /api/offline/events
router.post("/events", authenticateDevice, validateRequest(uploadEventsSchema), (req: DeviceRequest, res) => {
  try {
    const device = req.device!;
    const result = getOfflineEventService().upload(device.deviceId, req.body as UploadEventsInput);
    if (result.success && (result.data?.acked.length ?? 0) > 0) scheduleOfflineRound(device.tenantId);
    res.json(result);
  } catch (error) {
    logger.error({ error }, "offline upload failed");
    res.json({ success: false, error: "Upload failed" });
  }
});

// GET /api/offline/events/status?fromSeq=n
router.get("/events/status", authenticateDevice, validateQuery(eventsStatusQuerySchema), (req: DeviceRequest, res) => {
  try {
    const fromSeq = Number((req.query as { fromSeq?: number }).fromSeq ?? 0);
    res.json(getOfflineEventService().statusSince(req.device!.deviceId, fromSeq));
  } catch (error) {
    logger.error({ error }, "offline status failed");
    res.json({ success: false, error: "Status failed" });
  }
});

// GET /api/offline/snapshot?schemaVersion=n — the shop copy (FR-005). The
// body is raw gzip bytes as application/octet-stream and deliberately NOT
// `Content-Encoding: gzip`: a client that inflated it transparently would run
// its integrity check on bytes other than the ones served.
router.get("/snapshot", authenticateDevice, validateQuery(snapshotQuerySchema), (req: DeviceRequest, res) => {
  try {
    const pcSchemaVersion = Number((req.query as { schemaVersion?: number }).schemaVersion);
    const result = snapshotService().serve({ deviceId: req.device!.deviceId, pcSchemaVersion });
    if (!result.success) {
      res.json(result);
      return;
    }
    const s = result.snapshot;
    res.set({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Copy-Id": s.copyId,
      "X-Snapshot-Schema-Version": String(s.schemaVersion),
      "X-Snapshot-Tenant-Id": String(s.tenantId),
      "X-Snapshot-Built-At": s.builtAt,
    });
    res.status(200).end(s.gzip);
  } catch (error) {
    logger.error({ error }, "offline snapshot failed");
    res.json({ success: false, error: "Copy failed" });
  }
});

// POST /api/offline/manifest — the N5 cross-check (FR-035, FR-036).
router.post("/manifest", authenticateDevice, validateRequest(manifestSchema), (req: DeviceRequest, res) => {
  try {
    res.json(getOfflineEventService().compareManifest(req.device!.deviceId, req.body as ManifestInput));
  } catch (error) {
    logger.error({ error }, "offline manifest failed");
    res.json({ success: false, error: "Cross-check failed" });
  }
});

// ── Web routes: JWT (tenant context) → admin; actor from the JWT ──────────
const admin = [authenticateJWT, requireRole(["admin"])];
const actor = (req: AuthRequest): number => req.user!.userId;

// Static paths before `/:id` paths.
router.get("/review", ...admin, validateQuery(reviewListQuerySchema), (req, res) => {
  try {
    res.json(getOfflineReviewService().list(req.query as ReviewListQuery));
  } catch (error) {
    logger.error({ error }, "offline review list failed");
    res.json({ success: false, error: "Could not load the review list" });
  }
});

router.get("/history", ...admin, validateQuery(offlineHistoryQuerySchema), (req, res) => {
  try {
    res.json(getOfflineReviewService().history(req.query as OfflineHistoryQuery));
  } catch (error) {
    logger.error({ error }, "offline history failed");
    res.json({ success: false, error: "Could not load the history" });
  }
});

router.get("/devices", ...admin, (_req, res) => {
  try {
    res.json(offlineDeviceService().listDevices());
  } catch (error) {
    logger.error({ error }, "offline devices list failed");
    res.json({ success: false, error: "Could not load the paired PCs" });
  }
});

router.post("/devices/:id/revoke", ...admin, validateParams(reviewIdParamSchema), (req: AuthRequest, res) => {
  try {
    res.json(offlineDeviceService().revokeDevice(Number(req.params.id), actor(req)));
  } catch (error) {
    logger.error({ error }, "offline device revoke failed");
    res.json({ success: false, error: "Could not unpair the PC" });
  }
});

type ReviewAction = "apply" | "dismiss" | "reviewed" | "book-anyway";
function reviewRoute(action: ReviewAction) {
  return async (req: AuthRequest, res: express.Response): Promise<void> => {
    try {
      const id = Number(req.params.id);
      const svc = getOfflineReviewService();
      const by = actor(req);
      const result =
        action === "apply"
          ? await svc.apply(id, by)
          : action === "dismiss"
            ? await svc.dismiss(id, by, (req.body as ReviewDismissInput | undefined)?.note)
            : action === "reviewed"
              ? await svc.markReviewed(id, by)
              : await svc.bookAnyway(id, by);
      res.json(result);
    } catch (error) {
      logger.error({ error, action }, "offline review action failed");
      res.json({ success: false, error: "The review action failed" });
    }
  };
}

router.post("/review/:id/apply", ...admin, validateParams(reviewIdParamSchema), reviewRoute("apply"));
router.post("/review/:id/dismiss", ...admin, validateParams(reviewIdParamSchema), validateRequest(reviewDismissSchema), reviewRoute("dismiss"));
router.post("/review/:id/reviewed", ...admin, validateParams(reviewIdParamSchema), reviewRoute("reviewed"));
router.post("/review/:id/book-anyway", ...admin, validateParams(reviewIdParamSchema), reviewRoute("book-anyway"));

export default router;
