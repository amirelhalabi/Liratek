/**
 * Continue with Google + the www -> shop sign-in hand-off (LIRA-280, feature D). Dormant unless GOOGLE_CLIENT_ID is set.
 *
 * Pre-mounted EMPTY by the v196 foundation commit so the feature agent edits
 * only this file (server.ts already mounts it at `/api/auth/google`). The full contract —
 * paths, auth, envelopes, error codes, link formats — is in
 * docs/plans/todo_plans/SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md,
 * "Contracts (foundation, 2026-10-07)", section D.
 *
 * Paths below are RELATIVE to `/api/auth/google`. Every response uses the IPC-identical
 * envelope { success, data?, error? } from createSuccessResponse /
 * createErrorResponse. Authenticated routes: authenticateJWT, THEN
 * requireRole(...), per route (no router-level middleware here, because
 * this router also serves public routes).
 */

import express from "express";

const router = express.Router();

export default router;
