# Tasks: LIRA-291 — Sign-in methods for users who joined with Google

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/api.md and quickstart.md, all in this folder.

**Tests**: REQUIRED. Rule 17: write each test first, run it, and record the real failure before implementing. Never re-break finished code to prove a test.

Work **directly on local `main`**. **Do not commit or push**: the owner commits. Desktop e2e is never run on this Mac.

## Phase 1: Foundational — the password rule (blocks US5 and every password form)

- [X] T001 Write the test first in `packages/core/src/utils/__tests__/passwordPolicy.test.ts`. It must cover:
  - `xY7-pq_Rt.9mZ`, `Abcdefg1:` and `Abcdefg1 x` are valid;
  - `Abcdefg1` is refused with "Password must contain a symbol (for example - _ . @ ! #)";
  - the other rules are unchanged.
- [X] T002 Make the symbol rule `/[^A-Za-z0-9]/` and update the message in `packages/core/src/utils/passwordPolicy.ts`. Keep the file pure (rule 29). Update any core test that asserts the old message, using the message from the policy rather than retyping it (rule 24).
- [X] T003 Delete the duplicate rule:
  - Delete `frontend/src/shared/utils/validatePassword.ts`.
  - Move its importers to `validatePasswordComplexity` from `@liratek/core`: `features/settings/pages/Settings/UsersManager.tsx`, `features/setup/steps/Step1Account.tsx`, `Step4Users.tsx`, `StepJoinShop.tsx`.
  - Adapt the result shape: `{valid, errors}`.
  - Fix any frontend test that imported the old file.

## Phase 2: Foundational — the flag (blocks US1–US4)

- [X] T004 Write the test first in `packages/core/src/db/migrations/__tests__/v202_usersHasPassword.test.ts`. It must cover:
  - the column exists with `NOT NULL DEFAULT 1`;
  - the back-fill cases from quickstart.md:
    - Google-joined, no later password → 0;
    - Google-joined, then reset by link → 1;
    - Google-joined, then admin "Changed user password" → 1;
    - Google-joined, with a used `password_reset_tokens` row → 1;
    - password invite → 1;
    - no audit row → 1;
  - `users` absent → skipped;
  - `down()` drops the column.
- [X] T005 Add migration **v202 `users_has_password`** to `packages/core/src/db/migrations/index.ts` (re-read the last entry; it should be v201), following research R2 and data-model.md. Mirror it in `electron-app/create_db.sql`: add the column to `users` and the `(202, …)` seed row. Run `yarn check:schema-equivalence`.
- [X] T006 Write the test first, then change `packages/core/src/repositories/UserRepository.ts`:
  - `CreateUserData.has_password?: boolean` (default `true`), written by `createUser`;
  - `updatePassword` sets `has_password = 1` in the same UPDATE;
  - a new `hasPassword(userId): boolean` (current shop);
  - `listEmails()` selects `has_password`.
- [X] T007 Write the test first, then make `UserInvitationService.acceptWithGoogle` (`packages/core/src/services/UserInvitationService.ts`) create the user with `has_password: false`. Assert that the password `accept` path still gives `1`.
- [X] T008 [P] Write the test first, then add `packages/core/src/utils/signinMethods.ts` with `signinMethodLabel({hasPassword, google})`, returning "Password", "Google" or "Password + Google". It must be pure. Export it from `index.ts` and `browser.ts`.

## Phase 3: User Story 1 — no self-lockout (P1)

- [X] T009 [US1] Write the test first, then:
  - `GoogleAuthService.unlinkIdentity` throws `LastSigninMethodError` (`SET_PASSWORD_FIRST`, added in `packages/core/src/utils/errors.ts`) when `hasPassword` is false, and the identity row is kept;
  - the link status gains `hasPassword`.
- [X] T010 [US1] Write the test first in `backend/src/api/__tests__/googleAuth.api.test.ts`, then change `backend/src/api/googleAuth.ts`:
  - `DELETE /link` answers `200 {success:false, code:"SET_PASSWORD_FIRST", error}`;
  - `GET /link` returns `hasPassword`;
  - replace the false comment ("can never lock anyone out").
- [X] T011 [US1] Write the test first, then add `setInitialPasswordSchema` (= `{password: newPasswordSchema}`) and `SetInitialPasswordInput` to `packages/core/src/validators/account.ts`, exported from `index.ts` and `browser.ts`.
- [X] T012 [US1] Write the test first, then add `PasswordResetService.setInitialPassword` (`packages/core/src/services/PasswordResetService.ts`):
  - it refuses `PASSWORD_ALREADY_SET` (new in `constants/passwordReset.ts`);
  - it checks the policy, calls `updatePassword`, keeps Google and keeps sessions;
  - it queues a `password-added` email only when the user has a confirmed email and email is on;
  - it returns `{hasPassword:true, noticeSent}`.
- [X] T013 [US1] Write the test first, then:
  - add the `password-added` template at `backend/src/email/templates/passwordAdded.ts`, registered in `templates/index.ts` and `preview.ts`, with `secretKeys: []`;
  - add the route `POST /api/password-reset/set-initial` in `backend/src/api/passwordReset.ts`: `authenticateJWT` → `requireRole(TENANT_ROLES)` → `validateRequest(setInitialPasswordSchema)`, user taken from the JWT, audit "Added a password for sign-in" `{via:"set_initial"}`;
  - add the route to the `requireWritableSubscription` coverage if needed.
- [X] T014 [US1] Write the test first, then change `frontend/src/features/settings/pages/Settings/GoogleAccountPanel.tsx`:
  - the heading becomes "Sign-in methods";
  - when `hasPassword` is false, show "You sign in with Google only" and a **Set a password** form using `PasswordInput` ×2 with `autoComplete="new-password"`;
  - Disconnect shows the `SET_PASSWORD_FIRST` message;
  - after a password is set, Disconnect works;
  - fix the header comment.
  - Add `setInitialPassword` to `frontend/src/api/backendApi.ts`, typed `SetInitialPasswordInput` (rule 21), and update the `googleLinkStatus` / `googleUnlink` types.

## Phase 4: User Story 2 — an admin disconnect cannot strand anyone (P1)

- [X] T015 [US2] Write the test first, then add **set mode** to `PasswordResetService`: `issue` picks the `password-set` template when `has_password = 0`. This applies to `requestByEmail`, `requestByEmailEveryShop` and `sendForUser`.
  - Add the `password-set` template at `backend/src/email/templates/passwordSet.ts` (registered and previewed; `secretKeys: [PASSWORD_RESET_URL_KEY]`).
  - `PASSWORD_SET_TEMPLATE` lives in `constants/passwordReset.ts`.
  - Assert that completing a reset or set link keeps the user's Google identity (FR-009).
- [X] T016 [US2] Write the test first in `backend/src/api/__tests__/userEmail*.test.ts`, then change `DELETE /api/user-email/:userId/google` (`backend/src/api/userEmail.ts`):
  - after the unlink, if the user had no password, call `sendForUser` (set mode) and return `passwordLink:"sent"|"not_sent"` plus `passwordLinkCode`;
  - a failed send never undoes the disconnect.
  - Cover all three cases: sent; email off; no or unverified email.
  - **Admin disconnecting their OWN Google with no password** (`:userId` = the JWT user) is refused `SET_PASSWORD_FIRST`, with the same rule as T009 (spec edge case). Test it.
- [X] T017 [US2] Write the test first, then change `UsersManager.tsx`:
  - the confirm text depends on `hasPassword`. With no password it says "<username> has no password. We'll email them a link to set one." If they have no confirmed email or email is off, it says "<username> won't be able to sign in until a password is set. You can set one here with Set Password.";
  - after confirming, a message reports `passwordLink`.

## Phase 5: User Story 3 — wording of the reset and set-password emails (P2)

- [X] T018 [US3] Write the test first, then:
  - `PasswordResetService.check` returns `hasPassword`, and so does `POST /api/password-reset/check`;
  - the `password-reset` template's heading names the username ("Reset the password for {{username}}").
- [X] T019 [US3] Write the test first, then change `frontend/src/features/auth/pages/ResetPassword.tsx`:
  - the heading is "Set a password" or "Choose a new password", depending on `hasPassword`, with "For <username> at <shop>" kept;
  - replace both raw inputs with `PasswordInput` (`name`/`id` `new-password` and `confirm-password`, `autoComplete="new-password"`), which gives the eye toggles (US5, FR-012).
  - Update the `checkResetToken` type.
- [X] T019a [US5] [P] Write the test first, then swap the remaining raw password inputs for `PasswordInput` (eye toggle, `autoComplete="new-password"`, distinct `name`/`id`) in these files (FR-012):
  - `frontend/src/features/auth/pages/Signup.tsx`
  - `frontend/src/features/auth/components/GoogleSignupForm.tsx`
  - `frontend/src/features/auth/pages/JoinShop.tsx`
  - `frontend/src/features/admin/components/AddTenantModal.tsx`

  The setup steps already use it.

## Phase 6: User Story 4 — sign-in methods in Settings → Users (P2)

- [X] T020 [US4] Write the test first, then:
  - `UserEmailView.hasPassword` (`packages/core/src/services/UserEmailService.ts`) and `GET /api/user-email`;
  - `UsersManager.tsx` shows a "Sign-in" column using `signinMethodLabel` (keep the Google email and Disconnect).

## Phase 7: User Story 6 — the username hint (P3)

- [X] T021 [US6] Write the test first in `frontend/src/features/auth/pages/__tests__/Login.usernameHint.test.tsx`, then change `Login.tsx`:
  - add the hint "Not your email — use the username your admin gave you" under the username field;
  - show "Use your username, or Continue with Google" when the value contains `@`;
  - submitting is still allowed;
  - www's identifier-first page is unchanged.

## Phase 8: Release, ticket, gates

- [X] T022 Add lines to `docs/release-notes/UNRELEASED.md`, in shop-owner language:
  - **Web app:**
    - Settings → Users shows how each person signs in;
    - staff who use Google can set a password in Settings;
    - you can't disconnect your last way to sign in;
    - an admin disconnecting Google emails the person a link to set a password;
    - reset emails name the username;
    - show/hide on the new-password page;
    - username hint on the shop sign-in page.
  - **Settings:** browser-suggested passwords are accepted.

  Also add a `current_sprint.md` **LIRA-291** entry with a "What users will notice" line.
- [X] T023 Add the web e2e test `frontend/tests/e2e-web/lira-web-0NN-signin-methods.spec.ts` (next free number). Use a seeded `has_password = 0` user (the harness has Google off). It must prove:
  - their own Disconnect is refused;
  - Set a password works;
  - username and password sign-in works;
  - an admin disconnect of another `has_password = 0` user queues a `password-set` outbox row;
  - the reset page shows the eye toggles.
- [X] T024 Run the gates:
  - `yarn typecheck`, `yarn lint`
  - `check:tenant-scoping`, `check:bind-arity`, `check:schema-equivalence`
  - `build-release-notes --check`
  - `node scripts/run-tests.mjs`
  - `yarn build` (restore the core symlink afterwards)
  - the full web e2e in the main folder (Node ABI)

## Phase 9: My account (owner-approved 2026-10-08, added during implementation)

- [X] T025 Write the test first, then send the Google link result to `/#/account?google=…` instead of `/#/settings?tab=devices` (`backend/src/api/googleAuth.ts` `linkResultUrl`). Prove a STAFF JWT can use `GET`/`DELETE /api/auth/google/link` (`/link/start` and `/set-initial` already had staff tests).
- [X] T026 Write the test first, then add `frontend/src/features/account/pages/MyAccount.tsx` ("My account": `GoogleAccountPanel` + `SignedInDevices`; the sessions routes `/api/auth/sessions*` only need `authenticateJWT`, so devices are included) and the `/account` route under `ProtectedRoute` (not `AdminRoute`) in `app/App.tsx`.
- [X] T027 Write the test first, then add a "My account" button next to the user's name / Sign out in `TopBar.tsx`, for every role, hidden on desktop.
- [X] T028 Write the test first, then hide Settings' "Signed-in Devices" tab on the web (`DESKTOP_ONLY_TABS`), so the panels live in one place; desktop keeps the tab.
- [X] T029 Extend `lira-web-044`: a STAFF Google-only user is sent home from `/settings`, opens My account from the top bar and sets a password there.
- [X] T030 Update the release notes, the LIRA-291 ticket and spec.md; re-run every gate.

## Dependencies

- T001–T003 (the rule) and T004–T008 (the flag) come first. T008 can run alongside the others.
- US1 (T009–T014) needs T006.
- US2 (T015–T017) needs T006 and T012's constants.
- US3 (T018–T019) needs T015.
- US4 (T020) needs T006 and T008.
- US6 (T021) is independent.
- T022–T024 come last.

## MVP

Phase 1, Phase 2, US1 and US2: no user can be stranded, and Chrome's passwords work.
