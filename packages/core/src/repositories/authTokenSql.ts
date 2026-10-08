/**
 * Shared SQL for the single-use account tokens (v196): password reset,
 * email verification and the www -> shop sign-in hand-off. Defined once
 * (rule 14) so "is this link still usable" cannot drift between them.
 *
 * Every time compared here is a UTC ISO string the app wrote and passed in
 * as a parameter — never SQLite's `datetime('now')`/`CURRENT_TIMESTAMP`,
 * whose `YYYY-MM-DD HH:MM:SS` shape sorts BELOW a same-day ISO string and
 * would silently break the comparison (see SignupInvitationRepository's
 * header).
 */

/** Not used yet and not expired. Bind: now (ISO). */
export const USABLE_TOKEN_WHERE = "used_at IS NULL AND expires_at > ?";

/**
 * Housekeeping: the row expired strictly before the cutoff. Used and
 * superseded rows keep their original expiry, so they age out by the same
 * rule. Bind: cutoff (ISO). The cleanup sweep passes `now - grace`.
 */
export const EXPIRED_BEFORE_WHERE = "expires_at < ?";
