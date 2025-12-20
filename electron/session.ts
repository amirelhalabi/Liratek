import { safeStorage, app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

export type UserRole = "admin" | "staff";

interface SessionData {
  userId: number;
  role: UserRole;
  lastActivity: number; // epoch ms
}

interface StoredSession {
  userId: number;
  token: string;
  createdAt: number;
}

const sessions = new Map<number, SessionData>(); // key: webContents.id

// File path for encrypted session storage
const getSessionFilePath = () =>
  path.join(app.getPath("userData"), ".session");

/**
 * Generate a cryptographically secure session token
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Encrypt and store session token to disk using safeStorage
 */
export function storeEncryptedSession(userId: number): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("[SESSION] safeStorage encryption not available");
      return null;
    }

    const token = generateToken();
    const sessionData: StoredSession = {
      userId,
      token,
      createdAt: Date.now(),
    };

    const encrypted = safeStorage.encryptString(JSON.stringify(sessionData));
    fs.writeFileSync(getSessionFilePath(), encrypted);
    console.log("[SESSION] Encrypted session stored");
    return token;
  } catch (error) {
    console.error("[SESSION] Failed to store encrypted session:", error);
    return null;
  }
}

/**
 * Retrieve and decrypt session from disk
 */
export function getEncryptedSession(): StoredSession | null {
  try {
    const filePath = getSessionFilePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("[SESSION] safeStorage encryption not available");
      return null;
    }

    const encrypted = fs.readFileSync(filePath);
    const decrypted = safeStorage.decryptString(encrypted);
    const session: StoredSession = JSON.parse(decrypted);

    // Check if session is expired (7 days max)
    const MAX_SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - session.createdAt > MAX_SESSION_AGE) {
      console.log("[SESSION] Stored session expired, clearing");
      clearEncryptedSession();
      return null;
    }

    return session;
  } catch (error) {
    console.error("[SESSION] Failed to read encrypted session:", error);
    clearEncryptedSession();
    return null;
  }
}

/**
 * Clear encrypted session from disk
 */
export function clearEncryptedSession(): void {
  try {
    const filePath = getSessionFilePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log("[SESSION] Encrypted session cleared");
    }
  } catch (error) {
    console.error("[SESSION] Failed to clear encrypted session:", error);
  }
}

/**
 * Validate a session token against stored encrypted session
 */
export function validateSessionToken(token: string): StoredSession | null {
  const stored = getEncryptedSession();
  if (!stored || stored.token !== token) {
    return null;
  }
  return stored;
}

// In-memory session management (existing functionality)

export function setSession(
  webContentsId: number,
  userId: number,
  role: UserRole,
) {
  sessions.set(webContentsId, { userId, role, lastActivity: Date.now() });
}

export function clearSession(webContentsId: number) {
  sessions.delete(webContentsId);
}

export function getSession(webContentsId: number): SessionData | undefined {
  const s = sessions.get(webContentsId);
  if (s) s.lastActivity = Date.now();
  return s;
}

export function requireRole(
  webContentsId: number,
  allowed: UserRole[] = ["admin"],
): { ok: boolean; error?: string; role?: UserRole; userId?: number } {
  const session = getSession(webContentsId);
  if (!session) return { ok: false, error: "Not authenticated" };
  if (!allowed.includes(session.role)) return { ok: false, error: "Forbidden" };
  return { ok: true, role: session.role, userId: session.userId };
}

export function isAuthenticated(webContentsId: number): boolean {
  return !!sessions.get(webContentsId);
}

// Optional: session timeout (30 min) placeholder
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export function purgeExpiredSessions(now = Date.now()) {
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
    }
  }
}
