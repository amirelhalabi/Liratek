/**
 * Subscription status for the signed-in tenant.
 *
 * Read-only and tenant-scoped: the tenant comes from the JWT, never from the
 * request, so one shop cannot ask about another's standing. The owner-facing
 * write routes (mark paid, set the module allowlist, issue a licence key) live
 * in `admin.ts` behind `requireSuperAdmin` — a tenant must never be able to
 * edit its own entitlements, which is the entire reason the allowlist is not
 * in the tenant-writable `modules` table.
 *
 * Deliberately reachable in `read_only`: this endpoint is how the UI knows to
 * explain itself, and how a shop confirms a payment landed. Blocking it would
 * leave a lapsed customer with a broken app and no explanation.
 */

import express from "express";
import {
  getSubscriptionService,
  createSuccessResponse,
  createErrorResponse,
  ErrorCodes,
} from "@liratek/core";
import { authenticateJWT } from "../middleware/auth.js";
import { logger } from "../server.js";

const router = express.Router();

/**
 * GET /api/subscription/by-key — the DESKTOP channel.
 *
 * Authenticated by the licence key itself, in a header, because a desktop
 * install has no JWT: it never logs in to the server at all. Its users
 * authenticate against its OWN local database, and this is the only call the
 * desktop app makes outward.
 *
 * Declared BEFORE `router.use(authenticateJWT)` deliberately — that is what
 * keeps it reachable without a token. Anything added after this line inherits
 * JWT auth.
 *
 * Returns 404 for an unknown key rather than 401/403: the desktop client
 * treats every failure identically (keep working — fail open), and a 404
 * distinguishes "this key is not ours" from "the server is unwell" in a log
 * without telling a probe anything it could not learn by trying.
 */
router.get("/by-key", (req, res): void => {
  try {
    const key = req.header("x-liratek-license-key")?.trim();
    if (!key) {
      res
        .status(400)
        .json(
          createErrorResponse(
            ErrorCodes.VALIDATION_ERROR,
            "Missing licence key",
          ),
        );
      return;
    }

    const view = getSubscriptionService().statusForLicenseKey(key);
    if (!view) {
      res
        .status(404)
        .json(createErrorResponse(ErrorCodes.NOT_FOUND, "Unknown licence key"));
      return;
    }

    // tenantId is echoed so a support conversation can confirm WHICH shop a
    // key belongs to. It is not a secret — the holder of the key already is
    // that tenant.
    res.json(createSuccessResponse(view));
  } catch (error) {
    logger.error({ error }, "subscription by-key failed");
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to load subscription",
        ),
      );
  }
});

router.use(authenticateJWT);

// GET /api/subscription/status
router.get("/status", (req, res): void => {
  try {
    const tenantId = req.user?.tenantId;

    // A platform user (super_admin) has no subscription of its own. Report
    // "unlimited" rather than an error: the same UI renders for both, and a
    // 4xx here would surface as a broken banner on the admin screens.
    if (tenantId === undefined || tenantId === null) {
      res.json(
        createSuccessResponse({
          status: "active",
          plan: "platform",
          canWrite: true,
          currentPeriodEnd: null,
          graceEndsAt: null,
          entitledModules: null,
        }),
      );
      return;
    }

    const view = getSubscriptionService().statusFor(tenantId);

    // No row: this tenant predates v173 or was created outside provisioning.
    // Report the same permissive shape the service itself falls back to, so
    // the UI and the backend agree instead of the UI inventing a stricter
    // reading of the same silence.
    res.json(
      createSuccessResponse(
        view ?? {
          status: "active",
          plan: "standard",
          canWrite: true,
          currentPeriodEnd: null,
          graceEndsAt: null,
          entitledModules: null,
        },
      ),
    );
  } catch (error) {
    logger.error({ error }, "subscription status failed");
    res
      .status(500)
      .json(
        createErrorResponse(
          ErrorCodes.INTERNAL_ERROR,
          "Failed to load subscription status",
        ),
      );
  }
});

export default router;
