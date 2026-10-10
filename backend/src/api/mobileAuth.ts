/**
 * LIRA-289 — sign-in for the LiraTek phone app (contracts/mobile-api.md).
 *
 * The web login finds the shop from the request Host (`<slug>.liratek.shop`).
 * A native app calls the API host directly, so the shop address travels in
 * the body instead, and the username is then looked up INSIDE that shop only:
 * usernames are unique per shop, never across shops.
 *
 * Every refusal for an unknown shop, a wrong username or password, or a shop
 * that is not active is the same generic INVALID_CREDENTIALS, so the reply
 * never confirms which shops or usernames exist (FR-028). The phone app is
 * for admins only (FR-016): a staff user gets ADMIN_ONLY and no session.
 */
import express from "express";
import {
  MobileAuthService,
  createErrorResponse,
  ErrorCodes,
  mobileLoginSchema,
  type MobileLoginInput,
} from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { NO_SUCH_REALM } from "../middleware/tenantHost.js";
import { clientIp } from "../middleware/clientIp.js";
import { sendWebLoginResponse } from "../services/webLoginSession.js";
import { logger } from "../server.js";

const router = express.Router();

// The rules (shop lookup, per-shop authentication, active shop, admins only,
// session revocation) live in core's MobileAuthService (rule 13). This route
// validates, calls it, and shapes the reply.
let service: MobileAuthService | null = null;
function mobileAuth(): MobileAuthService {
  service ??= new MobileAuthService({ unknownRealm: NO_SUCH_REALM });
  return service;
}

// POST /api/mobile/auth/login
router.post(
  "/login",
  authLimiter,
  validateRequest(mobileLoginSchema),
  async (req, res): Promise<void> => {
    try {
      const body = req.body as MobileLoginInput;
      const ip = clientIp(req) || req.socket.remoteAddress;
      const outcome = await mobileAuth().loginWithShop({
        shop: body.shop,
        username: body.username,
        password: body.password,
        deviceInfo: body.deviceName || req.headers["user-agent"] || "Phone",
        ...(ip ? { ipAddress: ip } : {}),
      });

      if (!outcome.ok) {
        if (outcome.reason === "ADMIN_ONLY") {
          res
            .status(403)
            .json(
              createErrorResponse(
                "ADMIN_ONLY",
                "The phone app is for shop admins only",
              ),
            );
          return;
        }
        res
          .status(401)
          .json(
            createErrorResponse(
              ErrorCodes.INVALID_CREDENTIALS,
              "Invalid credentials",
            ),
          );
        return;
      }

      sendWebLoginResponse(res, outcome.user, {
        sessionToken: outcome.sessionToken,
        summary: `User "${outcome.user.username}" signed in on the phone app`,
        metadata: { via: "mobile" },
        extra: { shop: { slug: outcome.shop.slug, name: outcome.shop.name } },
      });
    } catch (error) {
      logger.error({ error }, "Mobile login error");
      res
        .status(500)
        .json(
          createErrorResponse(ErrorCodes.INTERNAL_ERROR, "Internal server error"),
        );
    }
  },
);

export default router;
