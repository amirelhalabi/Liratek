import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { logger } from "../server.js";
import { getAuthService, JWT_SECRET } from "@liratek/core";

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    role: string;
    sessionToken?: string;
  };
}

export function authenticateJWT(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token provided" });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(
      token,
      JWT_SECRET || "your-secret-key-change-in-production",
    ) as {
      userId: number;
      role: string;
      sessionToken?: string;
    };

    // If session token exists, validate it against database
    if (decoded.sessionToken) {
      const authService = getAuthService();
      authService
        .validateSession(decoded.sessionToken)
        .then((user: any) => {
          if (!user) {
            logger.warn(
              { userId: decoded.userId },
              "Session expired or invalid",
            );
            res.status(401).json({ error: "Session expired" });
            return;
          }

          // Session is valid, proceed
          req.user = decoded;
          next();
        })
        .catch((error: any) => {
          logger.error({ error }, "Session validation error");
          res.status(401).json({ error: "Session validation failed" });
        });
    } else {
      // Old JWT without session token, just verify JWT
      req.user = decoded;
      next();
    }
  } catch (error) {
    logger.error({ error }, "JWT verification failed");
    res.status(401).json({ error: "Invalid token" });
  }
}

// Alias for consistency
export const requireAuth = authenticateJWT;

export function requireRole(roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    next();
  };
}
