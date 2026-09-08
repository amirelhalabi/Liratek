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
