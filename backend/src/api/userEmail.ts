/**
 * A user's own email: set, send verification, verify (LIRA-279, feature B).
 *
 * Pre-mounted EMPTY by the v196 foundation commit so the feature agent edits
 * only this file (server.ts already mounts it at `/api/user-email`). The full contract —
 * paths, auth, envelopes, error codes, link formats — is in
 * docs/plans/todo_plans/SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md,
 * "Contracts (foundation, 2026-10-07)", section B.
 *
 * Paths below are RELATIVE to `/api/user-email`. Every response uses the IPC-identical
 * envelope { success, data?, error? } from createSuccessResponse /
 * createErrorResponse. Authenticated routes: authenticateJWT, THEN
 * requireRole(...), per route (no router-level middleware here, because
 * this router also serves public routes).
 */

import express from "express";

const router = express.Router();

export default router;
