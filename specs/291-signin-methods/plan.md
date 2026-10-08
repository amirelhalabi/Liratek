# Implementation Plan: Sign-in methods for users who joined with Google

**Branch**: `291-signin-methods` (work directly on local `main`, owner preference) | **Date**: 2026-10-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/291-signin-methods/spec.md`

## Summary

Record whether each user has a usable password, then use that fact everywhere sign-in methods matter.

**The flag:**
- A new column, `users.has_password`, defaults to 1.
- Join with Google creates users with 0.
- The one shared password writer (`UserRepository.updatePassword`) sets it back to 1.
- Migration v202 back-fills it from the join audit trail.

**What it drives:**
- The user's own Google disconnect is refused while they have no password, with a **Set a password** action backed by a new route.
- An admin disconnect warns, then sends a "Set a password" link.
- Forgot-password emails and the page say "Set a password for <username>" or "Reset the password for <username>".
- Settings → Users shows "Password", "Google" or "Password + Google".

**Separate fixes:**
- The password rule is defined once (in core) and accepts any symbol.
- The new-password page gets show/hide eyes.
- The shop sign-in page gets a "not your email" hint.

## Technical Context

**Language/Version**: TypeScript in strict mode, Node 20 (Fly), React 19 (Vercel).

**Primary Dependencies**: existing ones only — Express, better-sqlite3, zod, the email outbox, `@liratek/ui`.

**Storage**: SQLite. One new column, `users.has_password` (migration **v202**, data back-fill from `audit_log`).

**Testing**:
- Jest for core, backend and frontend.
- Playwright for web e2e.
- The migration test uses a seeded shared database.

**Target Platform**: web app. The desktop app only inherits the shared password rule and the column, whose default makes its raw-SQL writers correct.

**Project Type**: web service plus SPA in the monorepo.

**Performance Goals**: n/a. One more column is read on existing queries.

**Constraints**:
- Never strand a user (spec SC-001).
- Never undo an admin disconnect because an email failed.
- `passwordPolicy.ts` must stay a pure leaf, because it is in the browser bundle (rule 29).

**Scale/Scope**:
- 1 migration
- 1 repository change (`UserRepository`)
- Service changes: `PasswordResetService` (set mode, `setInitialPassword`, `check`), `GoogleAuthService.unlinkIdentity`, `UserEmailService` (view), `UserInvitationService.acceptWithGoogle`
- 1 new route
- 4 changed routes
- 2 new email templates and 1 reworded template
- UI changes: Sign-in methods panel, UsersManager, ResetPassword, Login
- 1 frontend utility deleted

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I. One core, two transports | **Exception** (as LIRA-267/280/288) | Web-only flows: desktop has no Google, invites or email. The password rule is shared by both transports through core. Recorded below. |
| I. Location-dependent values (rule 27) | Pass | `now` is passed in. No day logic. |
| I. Browser leaf (rule 29) | Pass | `passwordPolicy.ts` and `signinMethodLabel` are pure. Services stay Node-only. |
| II. Repositories own SQL | Pass | The flag is read and written in `UserRepository`. The back-fill SQL lives in the migration. |
| III. Schemas once, derived types (rules 14, 21) | Pass | One password rule (the frontend copy is deleted). `setInitialPasswordSchema` lives in core, and the adapter uses `SetInitialPasswordInput`. One label helper. |
| V. Tenant scoping | Pass | `updatePassword` is already tenant-scoped. The new route takes its user from the JWT. |
| V. Schema in both files, with `down()` | Pass | v202, with `create_db.sql` mirrored. |
| V. Role checks | Pass | `set-initial` uses `TENANT_ROLES` (self). The admin routes are unchanged (`admin`). |
| VI. Tests first, web proof | Planned | See quickstart.md. Web e2e `lira-web-0NN-signin-methods`. |
| Money integrity | N/A | |
| Delivery: release note | Required | Under Web app: sign-in methods in Users, Set a password, no lockout on disconnect, show/hide on the reset page, username hint. Under Settings (desktop and web): browser-suggested passwords accepted. |

**Post-design re-check:** passes. The only exception is web-only.

## Project Structure

### Documentation

```text
specs/291-signin-methods/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md                (next: /speckit-tasks)
```

### Source code

```text
packages/core/src/
├── db/migrations/index.ts                 # + v202 users.has_password (+ audit back-fill)
├── repositories/UserRepository.ts         # has_password on create (default 1), updatePassword sets 1, hasPassword(), listEmails selects it
├── services/UserInvitationService.ts      # acceptWithGoogle creates with has_password:false
├── services/GoogleAuthService.ts          # unlinkIdentity refuses SET_PASSWORD_FIRST; link status + hasPassword
├── services/PasswordResetService.ts       # template by has_password; check() + hasPassword; setInitialPassword; sendForUser set mode
├── services/UserEmailService.ts           # UserEmailView.hasPassword
├── utils/passwordPolicy.ts                # symbol = any non-letter/digit; new message
├── utils/signinMethods.ts                 # new, pure: signinMethodLabel()
├── constants/passwordReset.ts             # PASSWORD_SET_TEMPLATE, PASSWORD_ADDED_TEMPLATE, PASSWORD_ALREADY_SET
├── utils/errors.ts                        # LastSigninMethodError (SET_PASSWORD_FIRST)
├── validators/account.ts                  # setInitialPasswordSchema (+ index/browser exports)
electron-app/create_db.sql                 # has_password column + (202) seed row

backend/src/
├── api/passwordReset.ts                   # POST /set-initial
├── api/googleAuth.ts                      # DELETE /link refusal; GET /link hasPassword; fix comment
├── api/userEmail.ts                       # admin unlink → set-mode link; list hasPassword
└── email/templates/passwordSet.ts, passwordAdded.ts (+ index.ts, preview.ts); passwordReset.ts names the username

frontend/src/
├── features/settings/pages/Settings/GoogleAccountPanel.tsx   # "Sign-in methods": Set a password form; refusal message; fix comment
├── features/settings/pages/Settings/UsersManager.tsx         # Sign-in column label; conditional confirm + result toast
├── features/auth/pages/ResetPassword.tsx                     # PasswordInput ×2; "Set a password" heading
├── features/auth/pages/Login.tsx                             # username hint + "@" message
├── features/setup/steps/{Step1Account,Step4Users,StepJoinShop}.tsx  # import the core rule
├── shared/utils/validatePassword.ts                          # DELETED
└── api/backendApi.ts                                         # setInitialPassword + changed shapes
frontend/tests/e2e-web/lira-web-0NN-signin-methods.spec.ts
docs/release-notes/UNRELEASED.md, current_sprint.md (LIRA-291)
```

**Structure decision**: existing layers. SQL lives in core repositories, the logic in core services, and the transport in backend routes. No new package.

## Implementation order

1. **Password rule**
   - Core policy change, with tests.
   - Delete the frontend copy and move its importers to the core rule.
2. **The flag**
   - Migration v202 (tests: flag values plus the back-fill cases).
   - `UserRepository` changes.
   - `acceptWithGoogle` creates users with `has_password: false`.
3. **Own disconnect guard**
   - Core `unlinkIdentity` refusal.
   - Route.
   - Panel message.
4. **Set a password**
   - `setInitialPassword`, schema, route.
   - `password-added` template.
   - Panel form.
5. **Wording**
   - `password-set` template, chosen by `issue` per user.
   - `check()` returns `hasPassword`.
   - ResetPassword heading and `PasswordInput` on both fields.
   - `password-reset` names the username.
6. **Admin**
   - The list gains `hasPassword` and the label helper.
   - Admin unlink sends the set-mode link.
   - UsersManager column, confirm text and result.
7. **Login hint.**
8. **Wrap-up**
   - Release notes and the LIRA-291 ticket.
   - Gates.
   - Web e2e in the main folder (Node ABI).
   - Commit locally on the owner's go. Do not push.

## Known limits (out of scope)

- The admin's Set Password form in Settings → Users is a plain browser prompt, and its schema only requires 4 characters (`setUserPasswordBodySchema`). The server still applies the full rule (`AuthService.resetPassword`), so a weak password is refused, but only after submit, and the error appears as a generic message. Replacing that prompt with a proper form, and giving the web app a self-service "change password", are a separate ticket.

## Complexity Tracking

| Exception | Why | Simpler alternative rejected |
|---|---|---|
| Web-only flows (Constitution I); owner-approved pattern from LIRA-267/280/288 | Desktop has no Google, invites or email. | An IPC mirror for flows the desktop cannot show would be dead code. |
| A flag that defaults to 1 rather than a timestamp | Raw-SQL writers outside core (desktop setup, per-tenant provisioning, seeds) stay correct with no edit. | `password_set_at NULL` would need about 8 writers edited, and a forgotten one would mislabel users (research R1). |
| The back-fill is read from `audit_log` | It is the only durable record of "joined with Google". | Reading the identity row was rejected because unlink deletes it (research R2). |
