import express from "express";
import {
  getAuthService,
  getAuditService,
  getUserRepository,
  runWithTenant,
  loginSchema,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
  JWT_SECRET,
  JWT_EXPIRES_IN,
} from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import { authenticateJWT, type LiratekJwtPayload } from "../middleware/auth.js";
import { logger } from "../server.js";
import jwt from "jsonwebtoken";

const router = express.Router();

// Validate JWT configuration on startup
if (!JWT_SECRET) {
  throw new Error(
    "JWT_SECRET is required. Please set it in your environment variables (min 32 characters).",
  );
}

const jwtSecret: string = JWT_SECRET;
const jwtExpiresIn: string = JWT_EXPIRES_IN;

// POST /api/auth/login
router.post(
  "/login",
  validateRequest(loginSchema),
  async (req, res): Promise<void> => {
    try {
      const { username, password, rememberMe } = req.body;

      // Use AuthService with database session support
      const authService = getAuthService();
      const result = await authService.login(username, password, {
        rememberMe: rememberMe || false,
        deviceType: "web",
        deviceInfo: req.headers["user-agent"] || "Unknown",
        ipAddress: req.ip || req.socket.remoteAddress,
      });

      if (!result.success || !result.user || !result.token) {
        res
          .status(401)
          .json(
            createErrorResponse(
              ErrorCodes.INVALID_CREDENTIALS,
              result.error || "Invalid credentials",
            ),
          );
        return;
      }

      const user = result.user;

      // Create JWT v2: session-linked AND tenant-carrying (plan §3).
      // tenantId comes from the user row (null only for super_admin).
      const payload: LiratekJwtPayload = {
        userId: user.id,
        role: user.role,
        sessionToken: result.token, // Link JWT to database session
        tenantId: user.tenant_id ?? null,
      };
      const jwtToken = jwt.sign(payload, jwtSecret, {
        expiresIn: jwtExpiresIn as jwt.SignOptions["expiresIn"],
      });

      logger.info(
        { userId: user.id, username: user.username, rememberMe },
        "User logged in with database session",
      );

      // Mirrors authHandlers.ts's auth:login audit (action=login,
      // entity_type=session, no entity_id). Fire-and-forget — never blocks
      // the response. tenant_id comes from the just-authenticated user; a
      // platform super_admin (tenant_id null) has no tenant to write the
      // row under, so the log call is skipped for that one case rather than
      // silently failing inside AuditRepository.log()'s getCurrentTenantId().
      const loginTenantId = user.tenant_id ?? null;
      if (loginTenantId !== null) {
        runWithTenant(loginTenantId, () => {
          getAuditService().log({
            user_id: user.id,
            username: user.username,
            role: user.role,
            action: "login",
            entity_type: "session",
            summary: `User "${username}" logged in`,
          });
        });
      }

      res.json(
        createSuccessResponse({
          user: {
            id: result.user.id,
            username: result.user.username,
            role: result.user.role,
          },
          token: jwtToken,
          sessionToken: result.token,
        }),
      );
    } catch (error) {
      logger.error({ error }, "Login error");
      res
        .status(500)
        .json(
          createErrorResponse(
            ErrorCodes.INTERNAL_ERROR,
            "Internal server error",
          ),
        );
    }
  },
);

// GET /api/auth/me
// Behind authenticateJWT: (a) closes the same signature-only legacy hole the
// middleware closed (this route used to accept any signed JWT without a DB
// session), and (b) answers from the middleware-validated identity instead of
// a user-table read — which, post multi-tenancy, would require tenant context
// this pre-navigation probe doesn't need.
router.get("/me", authenticateJWT, async (req, res): Promise<void> => {
  try {
    if (!req.user) {
      // authenticateJWT always sets req.user before calling next()
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    res.json({
      success: true,
      user: {
        id: req.user.userId,
        username: req.user.username,
        role: req.user.role,
        tenantId: req.user.tenantId,
      },
    });
  } catch (error) {
    logger.error({ error }, "Get current user error");
    res.status(401).json({ error: "Invalid token" });
  }
});

// POST /api/auth/logout
router.post("/logout", async (req, res): Promise<void> => {
  try {
    // Extract session token from JWT
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, jwtSecret) as {
          userId: number;
          role: string;
          sessionToken?: string;
          tenantId?: number | null;
        };

        // Delete session from database if sessionToken exists
        if (decoded.sessionToken) {
          const authService = getAuthService();
          await authService.logout(decoded.sessionToken);
          logger.info(
            { userId: decoded.userId },
            "User logged out, session deleted",
          );

          // Mirrors authHandlers.ts's auth:logout audit (action=logout,
          // entity_type=session). The verified JWT has no username claim
          // (only login mints usernames into the response, not the token),
          // so resolve it the same way auditFromAuth does on IPC — a
          // best-effort repository lookup, falling back to "user-{id}".
          // Skipped for a null tenantId (platform super_admin) for the same
          // reason as login: there's no tenant to write the row under.
          if (decoded.tenantId != null) {
            const tenantId = decoded.tenantId;
            runWithTenant(tenantId, () => {
              let username = `user-${decoded.userId}`;
              try {
                const user = getUserRepository().findById(decoded.userId);
                if (user?.username) username = user.username;
              } catch {
                // keep the fallback
              }
              getAuditService().log({
                user_id: decoded.userId,
                username,
                role: decoded.role,
                action: "logout",
                entity_type: "session",
                summary: "User logged out",
              });
            });
          }
        }
      } catch (error) {
        logger.warn({ error }, "Failed to decode JWT during logout");
      }
    }

    res.json({ success: true });
  } catch (error) {
    logger.error({ error }, "Logout error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
