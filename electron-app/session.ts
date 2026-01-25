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
 * Encrypt and store session token to disk using safeStorage
 * Falls back to base64 encoding if safeStorage is not available (development mode)
 */
export function storeEncryptedSession(userId: number): string | null {
  try {
    const token = generateToken();
    const sessionData: StoredSession = {
      userId,
      token,
      createdAt: Date.now(),
    };

    let dataToStore: Buffer;
    
    if (safeStorage.isEncryptionAvailable()) {
      dataToStore = safeStorage.encryptString(JSON.stringify(sessionData));
      console.log("[SESSION] Encrypted session stored (safeStorage)");
    } else {
      // Fallback for development: use base64 encoding
      console.warn("[SESSION] safeStorage not available, using base64 fallback (NOT SECURE for production)");
      dataToStore = Buffer.from(JSON.stringify(sessionData), 'utf-8');
    }

    fs.writeFileSync(getSessionFilePath(), dataToStore);
    
    // Update cache
    storedSessionCache = sessionData;
    
    return token;
  } catch (error) {
    console.error("[SESSION] Failed to store session:", error);
    return null;
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
      // Try to decrypt with safeStorage
      try {
        decrypted = safeStorage.decryptString(fileData);
      } catch (decryptError) {
        // Might be a base64-encoded session from fallback mode
        console.warn("[SESSION] Failed to decrypt with safeStorage, trying base64 fallback");
        decrypted = fileData.toString('utf-8');
      }
    } else {
      // No safeStorage, treat as base64-encoded
      decrypted = fileData.toString('utf-8');
    }

    const session: StoredSession = JSON.parse(decrypted);

    // Check if session is expired (7 days max)
    const MAX_SESSION_AGE = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - session.createdAt > MAX_SESSION_AGE) {
      console.log("[SESSION] Stored session expired, clearing");
      clearEncryptedSession();
      return null;
    }

    // Cache the session
    storedSessionCache = session;
    console.log("[SESSION] Session restored from disk");
    return session;
  } catch (error) {
    console.error("[SESSION] Failed to read session:", error);
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
    // Clear cache
    storedSessionCache = null;
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
