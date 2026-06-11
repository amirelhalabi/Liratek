import { safeStorage, app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { logger } from "@liratek/core";

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

// Cache for stored session to avoid multiple keychain prompts
let storedSessionCache: StoredSession | null | undefined = undefined;

// File path for encrypted session storage
const getSessionFilePath = () => path.join(app.getPath("userData"), ".session");

/**
 * Generate a cryptographically secure session token
 */
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Serialize and persist a session to disk.
 * Uses safeStorage encryption; plaintext is only permitted in unpackaged
 * (dev) builds where the OS keychain may be unavailable.
 * Throws if the session cannot be stored securely.
 */
function writeSessionFile(sessionData: StoredSession): void {
  let dataToStore: Buffer;

  if (safeStorage.isEncryptionAvailable()) {
    dataToStore = safeStorage.encryptString(JSON.stringify(sessionData));
    logger.debug("Encrypted session stored (safeStorage)");
  } else if (!app.isPackaged) {
    // Dev-only fallback: plaintext JSON (no keychain in some dev environments)
    logger.warn(
      "safeStorage not available, storing session as plaintext (dev only)",
    );
    dataToStore = Buffer.from(JSON.stringify(sessionData), "utf-8");
  } else {
    throw new Error(
      "safeStorage unavailable in packaged build — refusing to persist session as plaintext",
    );
  }

  fs.writeFileSync(getSessionFilePath(), dataToStore);
  storedSessionCache = sessionData;
}

/**
 * Encrypt and store session token to disk using safeStorage
 */
export function storeEncryptedSession(userId: number): string | null {
  try {
    const token = generateToken();
    writeSessionFile({ userId, token, createdAt: Date.now() });
    return token;
  } catch (error) {
    logger.error({ error }, "Failed to store session");
    return null;
  }
}

/**
 * Store database session token to encrypted file (for persistence across refreshes)
 * This is used by the new database-backed session system
 */
export function storeSessionTokenToFile(token: string, userId: number): void {
  try {
    writeSessionFile({ userId, token, createdAt: Date.now() });
  } catch (error) {
    logger.error({ error }, "Failed to store session token to file");
    throw error;
  }
}

/**
 * Retrieve and decrypt session from disk
 * Handles both encrypted (safeStorage) and fallback (base64) sessions
 */
export function getEncryptedSession(): StoredSession | null {
  // Return cached value if already loaded (prevents multiple keychain prompts)
  if (storedSessionCache !== undefined) {
    return storedSessionCache;
  }

  try {
    const filePath = getSessionFilePath();
    if (!fs.existsSync(filePath)) {
      storedSessionCache = null;
      return null;
    }

    const fileData = fs.readFileSync(filePath);
    let decrypted: string;

    if (safeStorage.isEncryptionAvailable()) {
      // Only accept sessions that decrypt successfully. A file that fails to
      // decrypt is either corrupt or was written as plaintext — never trust it.
      try {
        decrypted = safeStorage.decryptString(fileData);
      } catch {
        logger.warn(
          "Session file failed safeStorage decryption — discarding it",
        );
        clearEncryptedSession();
        return null;
      }
    } else if (!app.isPackaged) {
      // Dev-only: plaintext sessions written by the dev fallback
      decrypted = fileData.toString("utf-8");
    } else {
      logger.error(
        "safeStorage unavailable in packaged build — refusing to read plaintext session",
      );
      storedSessionCache = null;
      return null;
    }

    const session: StoredSession = JSON.parse(decrypted);

    // Check if session is expired (1 day max)
    const MAX_SESSION_AGE = 1 * 24 * 60 * 60 * 1000;
    if (Date.now() - session.createdAt > MAX_SESSION_AGE) {
      logger.info("Stored session expired, clearing");
      clearEncryptedSession();
      return null;
    }

    // Cache the session
    storedSessionCache = session;
    logger.debug("Session restored from disk");
    return session;
  } catch (error) {
    logger.error({ error }, "Failed to read session");
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
      logger.debug("Encrypted session cleared");
    }
    // Clear cache
    storedSessionCache = null;
  } catch (error) {
    logger.error({ error }, "Failed to clear encrypted session");
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
): { ok: true; role: UserRole; userId: number } | { ok: false; error: string } {
  const session = getSession(webContentsId);
  if (!session) return { ok: false, error: "Not authenticated" };
  if (!allowed.includes(session.role)) return { ok: false, error: "Forbidden" };
  return { ok: true, role: session.role, userId: session.userId };
}

export function isAuthenticated(webContentsId: number): boolean {
  return !!sessions.get(webContentsId);
}

// In-memory session idle timeout. Matches the DB-side inactive-session
// cleanup (SessionRepository.deleteInactiveSessions) so both layers expire
// together. Enforced by the periodic cleanup interval in main.ts.
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Purge in-memory sessions idle past SESSION_TIMEOUT_MS.
 * Returns the webContents ids of purged sessions so callers can notify
 * the affected renderers.
 */
export function purgeExpiredSessions(now = Date.now()): number[] {
  const purged: number[] = [];
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > SESSION_TIMEOUT_MS) {
      sessions.delete(id);
      purged.push(id);
    }
  }
  return purged;
}
