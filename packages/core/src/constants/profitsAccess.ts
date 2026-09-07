/**
 * Profits password gate — shared constants (CLAUDE.md rule 14).
 *
 * The `profits` module is visible to BOTH roles (migration v163), and the
 * `/profits` page is protected by a per-page password instead of by role —
 * admin included. A correct password unlocks the page AND the profit data
 * endpoints for `PROFITS_UNLOCK_TTL_MS`; navigating away revokes the unlock
 * immediately (client unmount calls the lock endpoint).
 *
 * `PROFITS_PASSWORD_SETTING_KEY` is the `system_settings.key_name` the hash
 * is stored under. It is also the ONE key `SettingsService` redacts from
 * `getAllSettings`/`getSetting`/`getSettingValue` and refuses to accept via
 * `updateSetting` — see the comment on `SENSITIVE_SETTING_KEYS` there.
 *
 * Single definition consumed by (rule 19 — both transports, one core):
 *  - `ProfitsAccessService` (this package) — set/verify/isPasswordSet
 *  - `packages/core/src/validators/profits.ts` — min-length on the schema
 *  - `electron-app/handlers` (profits:* channels) and `backend/src/api/profits.ts`
 *    (REST routes + `requireProfitsUnlock` TTL check) — agents B/C
 *  - `frontend/src/api/backendApi.ts` adapter fns — agent D
 */

/** system_settings key_name the scrypt password hash is stored under. */
export const PROFITS_PASSWORD_SETTING_KEY = "profits_password_hash";

/** How long a correct password keeps /profits (and its data endpoints) unlocked. */
export const PROFITS_UNLOCK_TTL_MS = 15 * 60 * 1000;

/**
 * Minimum length for the profits password. Deliberately NOT run through
 * `validatePasswordComplexity` (packages/core/src/utils/crypto.ts) — the
 * owner wants a short PIN to be legal here, unlike user account passwords.
 */
export const PROFITS_PASSWORD_MIN_LENGTH = 4;

/**
 * Single source of truth for the "is this unlock still live" predicate
 * (CLAUDE.md rule 14 — this exact fragment was previously copy-pasted into
 * `electron-app/session.ts` `hasProfitsUnlock` and TWICE into
 * `backend/src/middleware/profitsUnlock.ts`, once negated for its sweep).
 *
 * Semantics (exact, do not "improve"):
 *  - `unlockedAt` undefined/null → false (never unlocked).
 *  - Live while `now - unlockedAt < PROFITS_UNLOCK_TTL_MS`.
 *  - EXACTLY at the TTL boundary (`now - unlockedAt === PROFITS_UNLOCK_TTL_MS`)
 *    → EXPIRED (false). Both original call sites used strict `<`; keep it
 *    strict — flipping to `<=` would extend every unlock by one caller's
 *    worth of clock jitter and is not what either call site did before.
 *  - A future `unlockedAt` (`now - unlockedAt` negative) → treated as LIVE.
 *    `unlockedAt` is always server-generated (`Date.now()` at grant time), so
 *    this can only arise from a clock adjustment on the server itself, not
 *    from client input — there is no untrusted-input path that can force it.
 *
 * Pure function of numbers — safe to import from the browser entrypoint too.
 */
export function isProfitsUnlockLive(
  unlockedAt: number | undefined | null,
  now: number = Date.now(),
): boolean {
  if (unlockedAt === undefined || unlockedAt === null) return false;
  return now - unlockedAt < PROFITS_UNLOCK_TTL_MS;
}
