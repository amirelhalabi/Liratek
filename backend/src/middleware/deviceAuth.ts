/**
 * LIRA-306 — authentication for the PC routes of /api/offline (FR-003,
 * O-new-8 / constitution exception E3 — approved by the owner at gate G0).
 *
 * A paired PC sends `X-LiraTek-Device-Key: ltd_<tenantId>_<keyId>_<secret>`.
 * The format is checked first (a malformed key never reaches the database);
 * then the key is looked up INSIDE the tenant the key names and its secret
 * compared in constant time (core OfflineDeviceService.verifyKey). A revoked
 * key → DEVICE_REVOKED. The rest of the request runs inside that tenant's
 * context, with `req.device` set. Never trusts anything else in the request
 * for the shop. Envelope: HTTP 200 + `{ success:false, code, error }`.
 */
import type { NextFunction, Request, Response } from "express";
import {
  MobileAuthService,
  OfflineDeviceService,
  getAuthService,
  parseDeviceKey,
  runWithTenant,
} from "@liratek/core";
import { NO_SUCH_REALM } from "./tenantHost.js";
import { registerDeviceRateLimitIdentity } from "./rateLimit.js";

export const DEVICE_KEY_HEADER = "x-liratek-device-key";

export interface DeviceRequest extends Request {
  device?: { tenantId: number; deviceId: number; deviceNo: number; keyId: string };
}

let service: OfflineDeviceService | null = null;
export function offlineDeviceService(): OfflineDeviceService {
  service ??= new OfflineDeviceService({
    mobileAuth: new MobileAuthService({ unknownRealm: NO_SUCH_REALM }),
    auth: getAuthService(),
  });
  return service;
}

function headerKey(req: Pick<Request, "headers">): string | undefined {
  const v = req.headers[DEVICE_KEY_HEADER];
  return typeof v === "string" ? v : undefined;
}

export function authenticateDevice(req: DeviceRequest, res: Response, next: NextFunction): void {
  const key = headerKey(req);
  if (!parseDeviceKey(key)) {
    res.json({ success: false, code: "INVALID_DEVICE_KEY", error: "This PC's key is not valid" });
    return;
  }
  const v = offlineDeviceService().verifyKey(key);
  if (!v.ok) {
    res.json({ success: false, code: v.code, error: v.error });
    return;
  }
  req.device = { tenantId: v.tenantId, deviceId: v.deviceId, deviceNo: v.deviceNo, keyId: v.keyId };
  runWithTenant(v.tenantId, () => next());
}

/** Rate-limit bucket for a VERIFIED device key only, else null. */
export function deviceRateLimitIdentity(req: Pick<Request, "headers">): string | null {
  const key = headerKey(req);
  if (!parseDeviceKey(key)) return null;
  try {
    const v = offlineDeviceService().verifyKey(key);
    return v.ok ? `device:${v.tenantId}:${v.keyId}` : null;
  } catch {
    return null;
  }
}

registerDeviceRateLimitIdentity(deviceRateLimitIdentity);
