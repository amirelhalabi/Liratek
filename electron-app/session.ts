import { safeStorage, app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { logger, isProfitsUnlockLive } from "@liratek/core";

export type UserRole = "admin" | "staff";

interface SessionData {
  userId: number;
  role: UserRole;
  lastActivity: number; // epoch ms
  // Profits password gate (frozen contract) — set by profits:unlock, cleared
  // by profits:lock or navigating away from /profits. Lives directly on the
  // session (not a separate map) so logout (clearSession) and idle purge
  // (purgeExpiredSessions) drop it automatically along with everything else —
  // see the doc comments on both below.
  profitsUnlockedAt?: number; // epoch ms
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

// Deletes the whole SessionData entry, so `profitsUnlockedAt` (a field ON
// SessionData, not a separate map) is dropped along with it — logging out
// always relocks Profits too, with nothing left to resurrect a stale unlock.
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

// ─────────────────────────────────────────────────────────────────────────
// Profits password gate (frozen contract) — server-side unlock state.
// A correct password unlocks BOTH the /profits page and its 7 data channels
// for PROFITS_UNLOCK_TTL_MS; navigating away from /profits revokes it
// immediately (client unmount calls profits:lock). Admin does NOT bypass
// this on role alone — the owner's decision is "everyone types it".
// ─────────────────────────────────────────────────────────────────────────

/**
 * Record a live Profits unlock on the caller's session. No-op if the caller
 * has no session at all (an unauthenticated call never reaches this — the
 * profits:unlock handler already required an admin/staff role first).
 * `now` is injectable for tests (SOLID/DIP) — the default is Date.now().
 */
export function grantProfitsUnlock(
  webContentsId: number,
  now = Date.now(),
): void {
  const session = sessions.get(webContentsId);
  if (!session) return;
  session.profitsUnlockedAt = now;
}

/** Revoke the caller's Profits unlock without touching the rest of the session. */
export function revokeProfitsUnlock(webContentsId: number): void {
  const session = sessions.get(webContentsId);
  if (session) delete session.profitsUnlockedAt;
}

/**
 * True only when the session exists AND has a live unlock. The TTL predicate
 * itself lives in `isProfitsUnlockLive` (@liratek/core, rule 14 — never
 * re-inline the window check here). `now` is injectable for tests.
 */
export function hasProfitsUnlock(
  webContentsId: number,
  now = Date.now(),
): boolean {
  const session = sessions.get(webContentsId);
  if (!session) return false;
  return isProfitsUnlockLive(session.profitsUnlockedAt, now);
}

/**
 * Combined gate for the 7 profits data channels (summary/by-module/by-date/
 * by-payment-method/by-user/by-client/pending): requires an authenticated
 * admin-or-staff session AND a live password unlock. Distinct error strings
 * so the caller (and the UI) can tell "log in" from "type the password"
 * apart.
 */
export function requireProfitsAccess(
  webContentsId: number,
): { ok: true } | { ok: false; error: string } {
  const auth = requireRole(webContentsId, ["admin", "staff"]);
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!hasProfitsUnlock(webContentsId)) {
    return { ok: false, error: "Profits locked" };
  }
  return { ok: true };
}

// In-memory session idle timeout. Matches the DB-side inactive-session
// cleanup (SessionRepository.deleteInactiveSessions) so both layers expire
// together. Enforced by the periodic cleanup interval in main.ts.
export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Purge in-memory sessions idle past SESSION_TIMEOUT_MS.
 * Returns the webContents ids of purged sessions so callers can notify
 * the affected renderers. Deletes the whole SessionData entry, so an idle
 * timeout also drops any live `profitsUnlockedAt` — same as clearSession.
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
