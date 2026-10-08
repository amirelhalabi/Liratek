/**
 * Machine-readable refusal codes for Settings -> Users: user emails and
 * user invitations (LIRA-279/281, feature B of
 * SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md "Contracts").
 *
 * Pure, zero imports: `browser.ts` re-exports this module, so pages compare
 * codes, never message text (rule 29 — must stay a leaf).
 *
 * One object rather than loose constants on purpose: feature C (password
 * reset) needs some of the same strings (`USER_HAS_NO_EMAIL`,
 * `RATE_LIMITED`), and two branches each adding a top-level export of the
 * same name to `browser.ts` would collide when they merge.
 */
export const USER_ACCOUNT_CODES = {
  /** The chosen username already exists in this shop (invite accept). */
  USERNAME_TAKEN: "USERNAME_TAKEN",
  /** A verification link was asked for a user who has no email. */
  USER_HAS_NO_EMAIL: "USER_HAS_NO_EMAIL",
  /** The user's email is already verified; there is nothing to send. */
  EMAIL_ALREADY_VERIFIED: "EMAIL_ALREADY_VERIFIED",
  /** Too many links or invites in the rolling window. */
  RATE_LIMITED: "RATE_LIMITED",
  /** An invite that already created a user cannot be revoked. */
  USER_INVITATION_USED: "USER_INVITATION_USED",
  /** No such user / invite in this shop. */
  NOT_FOUND: "NOT_FOUND",
  /** The invite is otherwise valid, but its shop's subscription has lapsed
   * to read-only: the link works again once the shop renews. */
  SHOP_NOT_ACTIVE: "SHOP_NOT_ACTIVE",
  /** LIRA-288: an invite link that cannot be used (unknown, expired, used,
   * revoked, claimed, another shop's) — "Join with Google" start. */
  INVITE_INVALID: "INVITE_INVALID",
  /** LIRA-288: "Join with Google" with a Google account whose verified
   * email is not the invited address. The invite stays usable. */
  GOOGLE_EMAIL_MISMATCH: "GOOGLE_EMAIL_MISMATCH",
} as const;

export type UserAccountCode =
  (typeof USER_ACCOUNT_CODES)[keyof typeof USER_ACCOUNT_CODES];
