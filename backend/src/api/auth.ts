import express from "express";
import {
  getUserRepository,
  getAuthService,
  loginSchema,
  createErrorResponse,
  createSuccessResponse,
  ErrorCodes,
  JWT_SECRET,
  JWT_EXPIRES_IN,
} from "@liratek/core";
import { validateRequest } from "../middleware/validation.js";
import { logger } from "../server.js";
import jwt from "jsonwebtoken";

const router = express.Router();

// Get JWT config with defaults (non-null since we provide fallback)
const jwtSecret: string = (JWT_SECRET ??
  "your-secret-key-change-in-production") as string;
const jwtExpiresIn: string = (JWT_EXPIRES_IN ?? "7d") as string;

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

      // Create JWT that includes the session token
      const jwtToken = jwt.sign(
        {
          userId: result.user.id,
          role: result.user.role,
          sessionToken: result.token, // Link JWT to database session
        },
        jwtSecret,
        { expiresIn: jwtExpiresIn as jwt.SignOptions["expiresIn"] },
      );

      logger.info(
        { userId: result.user.id, username: result.user.username, rememberMe },
        "User logged in with database session",
      );

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
router.get("/me", async (req, res): Promise<void> => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "No token provided" });
      return;
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, jwtSecret) as {
      userId: number;
      role: string;
    };

    const userRepo = getUserRepository();
    const user = userRepo.findById(decoded.userId);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
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
        };

        // Delete session from database if sessionToken exists
        if (decoded.sessionToken) {
          const authService = getAuthService();
          await authService.logout(decoded.sessionToken);
          logger.info(
            { userId: decoded.userId },
            "User logged out, session deleted",
          );
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
