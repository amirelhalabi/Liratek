/**
 * LIRA-331: the signed-in user's own preferences (today: the UI language).
 * Contract: specs/331-arabic-ui/contracts/user-preferences-api.md.
 *
 * Mirrors the IPC channels `user-preferences:get` /
 * `user-preferences:set-language` (electron-app/handlers/
 * userPreferencesHandlers.ts); both call UserPreferencesService (rule 19)
 * and answer the SAME flat envelope: `{ success, data }` or
 * `{ success: false, error: string, code }`, HTTP 200 even on a refusal
 * (rule 19c). The user ALWAYS comes from the JWT, never the body or a param.
 *
 * The body is checked with the shared core schema (setMyLanguageSchema, the
 * one the IPC handler uses) inline rather than through `validateRequest`,
 * because that middleware's refusal carries no `code` and the contract asks
 * for VALIDATION_ERROR on both transports.
 */

import express, { type Response } from "express";
import {
  ErrorCodes,
  getUserPreferencesService,
  isAppError,
  setMyLanguageSchema,
} from "@liratek/core";
import {
  authenticateJWT,
  requireRole,
  type AuthRequest,
} from "../middleware/auth.js";
import { logger } from "../server.js";

const router = express.Router();

/** Every shop role (a super admin has no shop account here). */
const TENANT_ROLES = ["admin", "staff"];

function refuse(res: Response, code: string, error: string): void {
  res.json({ success: false, error, code });
}

function fail(res: Response, error: unknown, logMessage: string, fallback: string): void {
  if (isAppError(error) && error.isOperational) {
    refuse(res, error.code, error.message);
    return;
  }
  logger.error({ error }, logMessage);
  refuse(res, ErrorCodes.INTERNAL_ERROR, fallback);
}

// GET /me — read-only, so an impersonated session may read it.
router.get(
  "/me",
  authenticateJWT,
  requireRole(TENANT_ROLES),
  (req: AuthRequest, res) => {
    try {
      res.json({
        success: true,
        data: getUserPreferencesService().getMine(req.user!.userId),
      });
    } catch (error) {
      fail(res, error, "GET /api/user-preferences/me failed", "Failed to load your preferences");
    }
  },
);

// PUT /me/language — the caller's own language. An impersonated session is
// refused: a super admin looking at a shop must not change the owner's
// language behind their back (the /api/user-email/me/change rule).
router.put(
  "/me/language",
  authenticateJWT,
  requireRole(TENANT_ROLES),
  (req: AuthRequest, res) => {
    if (req.user?.impersonatorId !== undefined) {
      refuse(res, ErrorCodes.FORBIDDEN, "Forbidden");
      return;
    }
    const parsed = setMyLanguageSchema.safeParse(req.body);
    if (!parsed.success) {
      refuse(
        res,
        ErrorCodes.VALIDATION_ERROR,
        parsed.error.issues[0]?.message ?? "Validation failed",
      );
      return;
    }
    try {
      res.json({
        success: true,
        data: getUserPreferencesService().setMine(req.user!.userId, parsed.data),
      });
    } catch (error) {
      fail(
        res,
        error,
        "PUT /api/user-preferences/me/language failed",
        "Failed to save your language",
      );
    }
  },
);

export default router;
