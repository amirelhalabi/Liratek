# Research: LIRA-291 — sign-in methods

Each entry gives the decision, why it was chosen, and the alternatives considered. The file:line references are as of 2026-10-08 (HEAD `42829dc9`).

## R1. How "has a usable password" is stored

**Decision**: add a new column `users.has_password INTEGER NOT NULL DEFAULT 1` (migration v202). These are the only writers that touch it:
- `UserInvitationService.acceptWithGoogle` creates the user with `has_password = 0`.
- `UserRepository.updatePassword` sets `has_password = 1`.

**Rationale**:
- Every password write that runs after creation goes through ONE repository method, `UserRepository.updatePassword` (`UserRepository.ts:537`). That covers:
  - the reset link (`PasswordResetService.reset`, `:366`);
  - an admin setting a password (`AuthService.resetPassword`, `:555`);
  - change password (`AuthService.changePassword`, `:519`).
  So deriving the flag there covers them all, and any new writer inherits it (rule 14, the same move as rule 26's "derive it at the shared writer").
- The default of **1** makes every writer that bypasses core correct with no edit:
  - the Electron raw SQL in `main.ts`, `authHandlers.ts` and `setupHandlers.ts`;
  - per-tenant provisioning's raw INSERT (`perTenantStorageProvisioner.ts:296`);
  - the super-admin bootstrap;
  - test fixtures.
- Only ONE place in the codebase creates a user without a usable password: `acceptWithGoogle`, which uses `hashPassword(generateToken())` (`UserInvitationService.ts:603-607`).

**Alternatives considered**:
- `password_set_at TEXT NULL`, as the spec draft suggested. NULL would mean "no password", so every raw-SQL writer above (desktop setup, per-tenant provisioning, the seed) would have to be edited to stamp it, or their users would read as "no password" and get the wrong labels and guards. That is roughly eight writers, and a ninth would forget. Rejected.
- A sentinel hash (for example `!` or `NOPASSWORD:`) instead of a column. Rejected for two reasons:
  - It overloads `password_hash`.
  - `verifyPassword` would have to special-case it, and any path that copies hashes (the migration table rebuilds at `index.ts:10813` and `:10913`) is a trap.
- Deriving it from `user_identities` plus the audit log at read time. Rejected:
  - It is slow.
  - An unlink hard-deletes the identity row, so the evidence disappears exactly when it matters.

## R2. Back-filling existing users (spec edge case "Existing users")

**Decision**: v202 sets `has_password = 0` only for users who meet all of these:
- there is an audit row with `entity_type = 'user'`, `entity_id = user id` and `json_extract(metadata, '$.via') = 'invite_google'` (written by the join callback, `googleAuth.ts:496-512`);
- there is no later audit row for that user saying a password was set:
  - `metadata.via = 'password_reset_link'` (`passwordReset.ts:340-352`), or
  - summary "Changed user password" (the admin "Set Password");
- there is no used `password_reset_tokens` row for that user.

Everyone else keeps the default of 1.

**Rationale**:
- No column records "joined with Google" (see research for 288). The audit row is the only durable evidence, and it is written in the same request as the user.
- Erring towards 1 is the safe direction for the Users-list label. For the disconnect guard, only a user wrongly marked 1 could still self-strand, and that is today's behaviour, so the migration never makes anything worse.
- **Production on 2026-10-08:** the only Google-joined user (`aelhalabi` in test) reset a password during the checks. So the expected result is zero rows set to 0.

**Alternative considered**: the timestamp heuristic (invite `used_at` = identity `created_at` = `email_verified_at`). Rejected: it is fragile, and the identity row is deleted on disconnect.

## R3. Refusing to remove the last sign-in method

**Decision**:
- The check lives in core: `GoogleAuthService.unlinkIdentity` refuses when the user has no password. It throws `LastSigninMethodError` (code `SET_PASSWORD_FIRST`).
- `DELETE /api/auth/google/link` answers `200 {success:false, code:"SET_PASSWORD_FIRST", error}`.
- The admin path (`UserEmailService.adminUnlinkGoogle`) is NOT refused. It disconnects, then sends the set-password link (R5).

**Rationale**:
- FR-004 requires the server, not only the page, to enforce the rule.
- An admin is allowed to proceed because the spec's admin story deliberately lets the admin decide, after a warning.
- Fixes the false comments at `googleAuth.ts:817-818` and `GoogleAccountPanel.tsx:19`.

## R4. "Set a password" while signed in

**Decision**:
- A new core method, `PasswordResetService.setInitialPassword({userId, password, now, ...emailCtx})`.
  - It refuses `PASSWORD_ALREADY_SET` when `has_password = 1`.
  - It checks the password against the one policy, then calls `updatePassword` (which sets the flag).
  - If the user has a confirmed email and email is on, it queues a `password-added` notice.
- The route is `POST /api/password-reset/set-initial` (`authenticateJWT` → `requireRole(TENANT_ROLES)`, user from the JWT, `validateRequest(setInitialPasswordSchema)`).
- The UI goes in the Settings panel that already shows Google: `GoogleAccountPanel.tsx`, renamed in the UI to "Sign-in methods".

**Rationale**:
- No self-service change-password exists on web (`AuthService.changePassword` has no callers). So this is the first self-service password route, and it is limited to the no-password case so that it never bypasses a current-password check.
- The password code lives in `PasswordResetService`, which owns the outbox, the templates and the rate context.
- Sessions are NOT revoked: the user is adding a method, not recovering from a compromise.

**Alternative considered**: a general change-password screen. Out of scope; the spec's edge case keeps it for later.

## R5. Admin disconnect of a user with no password

**Decision**: the order is:
1. `UserEmailService.adminUnlinkGoogle` (unchanged).
2. If `has_password = 0`, the route calls `PasswordResetService.sendForUser` in **set** mode (R6).

The response gains `passwordLink: "sent" | "not_sent"`, plus the refusal code when not sent (`EMAIL_NOT_CONFIGURED`, `USER_HAS_NO_EMAIL`, `EMAIL_NOT_VERIFIED`, `RATE_LIMITED`; these already exist in `PASSWORD_RESET_CODES`).

The confirm text in `UsersManager.tsx:598` changes depending on `hasPassword` from the list.

**Rationale**:
- It reuses the admin "send reset" path that already exists (`PasswordResetService.ts:266`), including its email checks and rate limit.
- The disconnect is not rolled back when the email can't be sent, because the admin was warned (spec admin story, scenario 4).

## R6. Wording: "Set a password" versus "Reset your password"

**Decision**:
- A new template, `password-set` (`backend/src/email/templates/passwordSet.ts`):
  - subject "Set a password for your LiraTek account";
  - body "Set a password for **{{username}}** at **{{shopName}}**";
  - `secretKeys: [PASSWORD_RESET_URL_KEY]`.
- `PasswordResetService.issue` picks the template from the user's `has_password`. The token, page and expiry are shared.
- The `password-reset` template's heading names the username: "Reset the password for **{{username}}**".
- `check()` returns `hasPassword`, so the page heading is "Set a password" or "Choose a new password".
- A new template, `password-added`: "A password was added to **{{username}}** at **{{shopName}}**. If this wasn't you, contact your shop admin." It carries no link and no secret keys.

**Rationale**: the templates are `{{var}}` strings with no conditionals (`renderTemplate.ts`). A second template is clearer than passing the subject in as data, and it keeps the secret-key list right.

## R7. One password rule

**Decision**:
- `packages/core/src/utils/passwordPolicy.ts` stays the only rule. Its symbol check becomes `/[^A-Za-z0-9]/`, with the message "Password must contain a symbol (for example - _ . @ ! #)".
- `frontend/src/shared/utils/validatePassword.ts` is deleted. Its importers move to `validatePasswordComplexity` from `@liratek/core`, which is already exported from `browser.ts:62`:
  - `UsersManager.tsx:11`
  - `Step4Users.tsx:6`
  - `Step1Account.tsx:6`
  - `StepJoinShop.tsx:13`

**Rationale**:
- Rule 14 / Constitution III: two copies already disagreed on wording ("number" versus "digit").
- `passwordPolicy.ts` is pure (no imports), so it is safe for the browser bundle (rule 29).
- The desktop setup pages use the same rule, so FR-014's shared-rule note covers it.
- **Note:** a space counts as a symbol under `/[^A-Za-z0-9]/`. That is acceptable, and the same as most services.

## R8. Show/hide on the new-password page

**Decision**: `ResetPassword.tsx:245-276` replaces its two raw `<input type="password">` with `PasswordInput` (`frontend/src/shared/components/PasswordInput.tsx`), passing:
- `autoComplete="new-password"` (the default);
- distinct `name`/`id` (`new-password`, `confirm-password`).

The new "Set a password" form in Settings uses the same component.

**Rationale**: the component already has the eye toggle and the password-manager attributes (commit `f7b20283`).

## R9. Username hint on the shop sign-in page

**Decision**: in `Login.tsx:245-260`:
- add a hint line under the `TextInput`: "Not your email — use the username your admin gave you";
- add a conditional message when `username.includes("@")`: "Use your username, or Continue with Google".

These are shown only when the username form is shown and the host is not www's identifier-first page.

**Rationale**: the spec's username-hint story. `TextInput` (`@liratek/ui`) may need a `hint` prop. If it has none, render a small `<p>` under it. The desktop login shows the hint too, which is harmless and also true there.

## R10. The Users list label

**Decision**:
- `UserEmailView` (`UserEmailService.ts:77`) gains `hasPassword: boolean`.
- `UserRepository.listEmails()` selects `has_password`.
- The label is computed by a pure core helper `signinMethodLabel({hasPassword, google})`, which returns "Password", "Google" or "Password + Google".
- `GET /api/auth/google/link` (own) also returns `hasPassword`.

**Rationale**: one helper gives one wording (rule 14). It is pure, so it is browser-safe.
