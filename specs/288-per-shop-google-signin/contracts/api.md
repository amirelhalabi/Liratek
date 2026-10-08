# API Contracts: LIRA-288

All web-only. The response envelope and HTTP status conventions are the same as LIRA-267, LIRA-280 and LIRA-287: expected refusals return `200 {success:false, error, code}`, and `validateRequest` failures return `200 success:false`.

## Changed: the Google link rule

- `POST /api/auth/google/link/start` → `/callback` (intent `link`):
  - Linking an account already linked **in another shop** now **succeeds**.
  - Linking an account already linked to **another user in this shop** still refuses: the callback redirects to `#/settings?tab=devices&google=already_linked`.
  - The `in_other_shop` outcome is no longer produced.
- `GET /api/auth/google/start?intent=signup` → `/callback`: no longer refuses `already_connected` when the account is linked elsewhere (FR-003). The daily cap and the other checks are unchanged.
- `/callback` with intent `login` on **www**: shops come from the **directory**. One shop gives the hand-off, several give the chooser, none gives `error=no_account`. Unchanged for the user.

## New: Join with Google

### `POST /api/user-invitations/google/start`

- **Rate limit:** the link limiter (`createPublicLinkLimiter`, client-IP keyed). Public.
- **Body:** `{ token, username }`. `token` is checked like `/check`, and `username` is checked with the existing username rules.
- **Scope:** the token's shop must be the host's shop (`resolvePublicTokenScope`).
- **Success:** `200 { success:true, data:{ url, ticket } }`. The page then POSTs `{ intent:"join", ticket }` to `https://www.<base>/api/auth/google/start`, the same pattern as `link`.
- **Refusals:** `INVITE_INVALID` (unusable invite, generic message), `SHOP_NOT_ACTIVE`, `USERNAME_TAKEN`, `GOOGLE_NOT_CONFIGURED`.

### `/api/auth/google/callback` (intent `join`)

1. Verify the Google ID token (unchanged).
2. Require `email_verified === true` and Google email = invite email, ignoring case. If not, redirect `https://<slug>.<base>/#/join?invite=<token>&google=email_mismatch`; the invite stays usable.
3. `acceptWithGoogle`:
   - **Success:** SSO hand-off to `https://<slug>.<base>/#/login?sso=<token>`, then signed in.
   - **Refused:**
     - `google=already_linked`: the account is linked to another user in this shop.
     - `google=invite_invalid`
     - `google=shop_not_active`
     - `google=username_taken`
   - Every refusal releases the claim, so the invite stays usable unless it is used, expired or revoked.

## New: admin view and disconnect

### `GET /api/user-email` (existing, admin) — extended

Each item gains `google: { email: string | null } | null`. It is `null` when the user has no Google link; `email` is the Google-reported address.

### `DELETE /api/user-email/:userId/google`

- **Auth:** `authenticateJWT` → `requireRole(["admin"])`; same shop as the JWT; `requireWritableSubscription` applies.
- **Success:** `200 { success:true, data:{ user: UserEmailView } }`. Calling it again when nothing is linked returns `success:true` and changes nothing.
- **Refusals:** `NOT_FOUND` (not in this shop, or a super admin), `400 VALIDATION_ERROR` (bad id).
- **Side effects:** `unlinkIdentity`, then `syncUser`, then the audit entry `google_link.remove` with metadata `{ by: "admin" }`.

## Operator command (not HTTP)

`node dist/scripts/signinDirectoryCli.js [--write]` inside the Fly machine (`yarn api ssh console -C "…"`).
- Without `--write` it prints `{ missing:[…], extra:[…], stale:[…] }` and exits 1 if it found any differences, 0 if none.
- With `--write` it rebuilds the directory and prints the counts.

## Frontend adapter (`backendApi.ts`, all `assertWebOnly`)

| Function | Change |
|---|---|
| `startJoinWithGoogle(input: z.input<typeof joinWithGoogleStartSchema>)` | new |
| `adminRemoveUserGoogle(userId)` | new |
| `listUserEmails()` | gains the `google` field (type from core `UserEmailView`) |
