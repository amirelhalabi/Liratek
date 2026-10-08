# Data model: LIRA-291

## Changed: `users`

| Column | Type | Rule |
|---|---|---|
| `has_password` | `INTEGER NOT NULL DEFAULT 1` (new) | `1` means the user has a usable password. `0` means they have none, and only a Join-with-Google user starts with `0`. It is set back to `1` by every password write (`UserRepository.updatePassword`), and never set back to `0`. |

Migration **v202** `users_has_password`:
- **up**:
  1. Add the column if it is absent.
  2. Back-fill `0` for the users described in research R2.
  3. Skip the whole migration when `users` is absent.
- **down**: `ALTER TABLE users DROP COLUMN has_password`. Same pattern as v196.
- **Mirror** in `electron-app/create_db.sql`: add the column to the `users` table and the `(202, …)` seed row. Check with `yarn check:schema-equivalence`.

### Invariants

1. Two code paths write `has_password = 0`:
   - user creation with `has_password: false` (only `acceptWithGoogle` does this);
   - the v202 back-fill.
2. `updatePassword` always writes `has_password = 1` in the same statement as the hash.
3. A user with `has_password = 0` always has a Google identity row, except right after an **admin** disconnect, where the warning was shown and a set-password link was sent if possible.
4. Sign-in method = `hasPassword` + whether a Google identity row exists. Labels come from `signinMethodLabel`:
   - "Password"
   - "Google"
   - "Password + Google"

## Changed: views and types

- `UserEmailView` gains `hasPassword: boolean`.
- `GoogleLinkStatus` (the `GET /api/auth/google/link` data) gains `hasPassword: boolean`.
- `PasswordResetCheckResult` gains `hasPassword: boolean`, which selects the page wording.
- `CreateUserData` gains `has_password?: boolean`, default `true`.

## New email templates (outbox, unchanged mechanism)

| Name | When | Data | Secret keys |
|---|---|---|---|
| `password-set` | A reset or link is issued for a user with `has_password = 0`: Forgot password, admin "Send password reset", or automatically after an admin disconnect | `resetUrl, username, shopName, expiresAtText, supportEmail` | `resetUrl` |
| `password-added` | After `setInitialPassword` succeeds, if the user has a confirmed email and email is on | `username, shopName, supportEmail` | none |

`password-reset` keeps its name and data. Only its wording changes to name the username in the heading.

## New refusal codes

| Code | Where | Meaning |
|---|---|---|
| `SET_PASSWORD_FIRST` | `DELETE /api/auth/google/link` | The user has no password, so disconnecting Google would leave them with no way to sign in. |
| `PASSWORD_ALREADY_SET` | `POST /api/password-reset/set-initial` | This route only adds a first password. |
