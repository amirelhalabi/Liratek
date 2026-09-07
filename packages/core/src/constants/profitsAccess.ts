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
