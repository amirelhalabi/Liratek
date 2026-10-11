/**
 * LIRA-306 — /api/offline (contracts/rest-offline.md).
 *
 * PC routes (device key, constitution exception E3 — G0 approved):
 *   POST /pair            admin signs in on the PC; key returned once
 *   POST /checkin         every ~30 s while online
 *   POST /events          upload 1–100 events (stored once, acked; processed
 *                         asynchronously in merge rounds)
 *   GET  /events/status   outcomes from a sequence number
 * The rules live in core (OfflineDeviceService, OfflineEventService); this
 * file validates, authenticates and shapes the IPC-identical envelope
 * (HTTP 200 on business failure, rule 19c). Review routes (JWT, admin) are
 * US3 (T071).
 */
import express from "express";
import {
  checkinSchema,
  eventsStatusQuerySchema,
  getOfflineEventService,
  pairDeviceSchema,
  uploadEventsSchema,
  type CheckinInput,
  type PairDeviceInput,
  type UploadEventsInput,
} from "@liratek/core";
import { validateQuery, validateRequest } from "../middleware/validation.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { clientIp } from "../middleware/clientIp.js";
import { authenticateDevice, offlineDeviceService, type DeviceRequest } from "../middleware/deviceAuth.js";
import { scheduleOfflineRound } from "../offline/processorTimer.js";
import { logger } from "../server.js";

const router = express.Router();

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

export default router;
