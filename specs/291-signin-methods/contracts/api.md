# API contracts: LIRA-291

Everything here is web only. The envelope is the same as LIRA-267, 280, 287 and 288: expected refusals are `200 {success:false, error, code}`.

## New: `POST /api/password-reset/set-initial`

- **Auth:** `authenticateJWT`, then `requireRole(TENANT_ROLES)`. The user comes from the JWT, never from the body.
- **Body:** `{ password }`, checked by `setInitialPasswordSchema = { password: newPasswordSchema }`. That schema lives in core `validators/account.ts` and is exported from `index.ts` and `browser.ts`, together with `SetInitialPasswordInput`.
- **Success:** `200 { success:true, data:{ hasPassword:true, noticeSent:boolean } }`.
- **Refusals:**
  - `PASSWORD_ALREADY_SET`
  - `VALIDATION_ERROR` (policy messages)
- **Side effects:**
  - `updatePassword`, which sets `has_password = 1`;
  - a `password-added` email when the user has a confirmed email and email is on;
  - audit `update` / `user`, summary "Added a password for sign-in", metadata `{via:"set_initial"}`.
  - Sessions are kept.

## Changed: `DELETE /api/auth/google/link` (the user's own disconnect)

- **New refusal:** `SET_PASSWORD_FIRST`, message "Set a password first, so you can still sign in."
  - Returned when `has_password = 0`.
  - Nothing is changed.
- Otherwise unchanged.

## Changed: `GET /api/auth/google/link`

- `data` gains `hasPassword: boolean`.

## Changed: `DELETE /api/user-email/:userId/google` (admin)

- Unchanged when the user has a password.
- When `has_password = 0`, after the unlink it calls `sendForUser` in set mode.
  - `data` gains `passwordLink: "sent" | "not_sent"` and `passwordLinkCode?: PasswordResetCode`.
  - A failed send never undoes the disconnect.

## Changed: `GET /api/user-email` (admin list)

- Each item gains `hasPassword: boolean`.

## Changed: `POST /api/password-reset/check`

- `data` gains `hasPassword: boolean`.

## Changed: forgot password and admin "Send password reset"

- The routes and replies are unchanged. `POST /forgot` still always gives the same answer.
- The email template is chosen per user:
  - `password-set` when `has_password = 0`;
  - `password-reset` otherwise.

## Changed: every password-setting route

- The symbol rule is now "any character that is not a letter or digit". Message: "Password must contain a symbol (for example - _ . @ ! #)".
- This covers `/reset`, `/user-invitations/accept`, sign-up `/signup`, Google sign-up, `PUT /api/users/:id/password`, `POST /api/users`, and the desktop IPC equivalents through the shared core rule.

## Frontend adapter (`backendApi.ts`, all `assertWebOnly`)

| Function | Change |
|---|---|
| `setInitialPassword(input: SetInitialPasswordInput)` | new |
| `googleLinkStatus()` | gains `hasPassword` |
| `googleUnlink()` | may return `code: "SET_PASSWORD_FIRST"` |
| `adminRemoveUserGoogle(userId)` | gains `passwordLink` / `passwordLinkCode` |
| `listUserEmails()` | items gain `hasPassword` |
| `checkResetToken()` | gains `hasPassword` |
