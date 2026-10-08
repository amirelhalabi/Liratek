# Tasks: LIRA-288 — Google sign-in for every user, scoped per shop

**Input**: spec.md, plan.md, research.md, data-model.md, contracts/api.md, quickstart.md (this folder).

**Tests**: REQUIRED. Rule 17: write each test first, run it, and record the real failure before implementing.

**Owner decisions** (2026-10-08):
- One Google account = one user **per shop**.
- The directory lives in the **platform** database.
- Join with Google; admins see and disconnect; staff still connect Google themselves.
- **Google-only staff need no password.** They get an unusable random hash and can set one later through "Forgot password".

Work **directly on local `main`**. **Do not commit** (the owner commits everything together).

## Phase 1: Foundation (blocks every story)

- [X] T001 Write `packages/core/src/db/migrations/__tests__/v200_signinDirectory.test.ts` first. It checks:
  - the table, its CHECK on `kind`, `UNIQUE(kind,value,target_tenant_id)`, the `(target_tenant_id,target_user_id)` index and the FK cascade on `target_tenant_id`;
  - the back-fill on a seeded shared database: confirmed emails of active non-super-admin users, plus their Google links; unconfirmed, inactive and super-admin users are skipped;
  - the back-fill is skipped when `users` is absent;
  - `down()` drops the table.
- [X] T002 Add migration **v200 `signin_directory`** to `packages/core/src/db/migrations/index.ts` (re-read the last entry; it should be v199). Mirror it in `electron-app/create_db.sql` with the seed row. Run `yarn check:schema-equivalence`.
- [X] T003 [P] Register the table:
  - `packages/core/src/db/tenantSplit.ts`: `PLATFORM_ONLY_TABLES` and `KNOWN_TABLES_WITHOUT_TENANT_ID`, with a split test showing it stays whole in `platform.db` and is deleted from shop files.
  - `packages/core/src/constants/resetTables.ts`: `RESET_EXCLUDED_TABLES`, plus its guard test.
  - `scripts/check-tenant-scoping.mjs`: `NON_TENANT_TABLES`.
- [X] T004 Write the test first, then `packages/core/src/repositories/SigninDirectoryRepository.ts` (`tenantScoped:false`, platform scope only):
  - `replaceForUser(tenantId, userId, rows, now)`: one transaction, delete then insert.
  - `deleteForTenant(tenantId)`
  - `findByEmail(email)` and `findByGoogleSubject(sub)`: both apply the one predicate **`DIRECTORY_USABLE`** (`t.status='active'`) and return `{tenant_id, slug, shop_name, user_id, username}`, ordered by shop name.
  - `listAll()`
  - Export it from `repositories/index.ts` (Node-only, not `browser.ts`).
- [X] T005 Write the test first, then `packages/core/src/services/SigninDirectoryService.ts`:
  - `syncUser(tenantId, userId, now)`: reads the user (email, verified, active, role, username) and their Google identity in **`runWithTenant(tenantId)`**, builds the rows following data-model.md invariant 1, then `replaceForUser` in **`runWithoutTenant`**. Calling it twice changes nothing. It never throws to callers: it logs a warning and returns `false` on failure.
  - `computeExpected()`, which walks every shop (shared database, or every per-tenant file through the existing tenant iteration).
  - `diff()` returning `{missing, extra, stale}`.
  - `rebuildAll(now)`.
  - Tests cover shared mode **and per-tenant mode**, using the existing per-tenant harness.

## Phase 2: Keep the directory in sync (US4)

Each writer gets a test first ("after X, the directory has exactly Y"), then the `syncUser` call after its own commit:

- [X] T006 Emails: `UserEmailService.setEmail` and `verify` (`packages/core/src/services/UserEmailService.ts`), and `GoogleAuthService.linkIdentity` → `setEmailIfAbsent`.
- [X] T007 Google link and unlink: `GoogleAuthService.linkIdentity` and `unlinkIdentity`, and the Google sign-up link step in `backend/src/api/googleSignup.ts`.
- [X] T008 Users: `AuthService.deactivateUser`, `reactivateUser` and `setUserRole` (`packages/core/src/services/AuthService.ts`).
- [X] T009 Creation:
  - invite accept (`UserInvitationService.accept`);
  - provisioning of the first admin (`TenantStorageProvisioner` shared path, and `backend/src/database/perTenantStorageProvisioner.ts`);
  - per-tenant shop delete → `deleteForTenant` (in shared mode the FK cascade handles it; test both).

## Phase 3: Readers use the directory (US1, US4)

- [X] T010 Tests first, then switch these to the directory:
  - `GoogleAuthService.findSignInMatches` → `findByGoogleSubject`.
  - `SigninCodeService` (request and verify) and `PasswordResetService.requestByEmailEveryShop` → `findByEmail`.
  - Then delete `UserIdentityRepository.findBySubjectAllTenants`, `findLiveLinksBySubject`, `LIVE_LINK_FROM` and `UserRepository.findSigninAccountsByEmail` / `SIGNIN_ACCOUNT_FROM`, together with their "shared mode only" comments.
  - Add a per-tenant-mode test proving the www lookups return the same shops as in shared mode.

## Phase 4: The rule change (US1)

- [X] T011 Tests first:
  - linking the same Google account in shop B while it is linked in shop A **succeeds**;
  - a second user in the **same** shop is refused (`IdentityAlreadyLinkedError` → `google=already_linked`);
  - relinking the same user changes nothing;
  - Google sign-up with an account linked elsewhere is **allowed** (it still counts toward the daily cap).

  Then:
  - remove the other-shop check in `UserIdentityRepository.link`;
  - remove `GoogleAuthService.isLinkedToAnyShop` and its callers (`backend/src/api/googleAuth.ts` signup intent, `backend/src/api/googleSignup.ts`);
  - mark `GoogleAccountInOtherShopError` as deprecated (kept exported for one release);
  - in `GoogleAccountPanel.tsx`, `already_linked` now reads "This Google account is already connected to another user in this shop."

## Phase 5: Join with Google (US2)

- [X] T012 [P] Validators: add `joinWithGoogleStartSchema {token, username}` to `packages/core/src/validators/account.ts` (exported from index and browser, plus its `*Input` type). Add `"join"` to the Google intent enums (`validators/account.ts`, `validators/googleAuth.ts`).
- [X] T013 Tests first, then `backend/src/security/googleOAuth.ts`: the `join` intent, a `join` ticket (10 minutes; payload `{token, username, tenantId}`), and `StateTicket.join`.
- [X] T014 Tests first, then `UserInvitationService.acceptWithGoogle({token, username, google:{sub,email,emailVerified}, now, requiredTenantId})`:
  1. Claim the invite.
  2. Check that the email is verified and equals the invite email (case-insensitive), that the shop is active and not lapsed, that the username is free, and that the account is not linked to another user in this shop.
  3. In one shop transaction: `createUser` (role from the invite, email confirmed, **unusable random password hash**) and `link` the identity.
  4. Finalize, then `syncUser`.

  On any failure, release the claim. A Google-only user's password login must fail until a reset.
- [X] T015 Tests first, then the backend:
  - `POST /api/user-invitations/google/start` (`backend/src/api/userInvitations.ts`; public; client-IP limiter; scope check; refusal codes from contracts/api.md);
  - the `/api/auth/google/callback` `join` branch (`backend/src/api/googleAuth.ts`): success gives the SSO hand-off; refusals redirect to `/#/join?invite=…&google=<code>`.
- [X] T016 Tests first, then `frontend/src/features/auth/pages/JoinShop.tsx`:
  - Username first, then **Join with Google** (POST form to www `/api/auth/google/start` with `{intent:"join", ticket}`), or a password and **Join**.
  - Show the `google=` refusal messages.
  - Add `startJoinWithGoogle` to `frontend/src/api/backendApi.ts`, typed from the core input (rule 21).
  - Hide Google when it is not configured.

## Phase 6: Admin view and disconnect (US3)

- [X] T017 Tests first, then the backend (`backend/src/api/userEmail.ts` and `UserEmailService`):
  - `GET /api/user-email` items gain `google: {email} | null`.
  - New `DELETE /api/user-email/:userId/google` (`authenticateJWT` → `requireRole(["admin"])`, same shop, not a super admin; calling it again changes nothing) → `unlinkIdentity`, then `syncUser`, then the audit entry `google_link.remove` with `{by:"admin"}`.
  - Add `/api/user-email` deletes to the `requireWritableSubscription` coverage if not already prefix-covered.
- [X] T018 Tests first, then `frontend/src/features/settings/pages/Settings/UsersManager.tsx`: a "Google" column showing the connected email or "—", and a **Disconnect** action behind a confirm step (admins only). Add `adminRemoveUserGoogle` to `backendApi.ts`. Desktop: hidden.

## Phase 7: Operations

- [X] T019 Tests first, then `backend/src/scripts/signinDirectoryCli.ts`:
  - Dry-run JSON diff by default (exit 1 if there are differences, 0 if none); `--write` rebuilds.
  - Model it on `tenantSplitCli.ts`. Make sure the build emits `dist/scripts/signinDirectoryCli.js`.
- [X] T020 Tests first, then `backend/src/database/signinDirectoryCheck.ts`: a boot-time drift check that only logs a warning, wired in `server.ts` next to the existing startup checks (model: `tenantCompletenessCheck.ts`).
- [X] T021 Docs:
  - `docs/OPERATIONS.md`: a short "Sign-in directory" note (what it is, the CLI command, when to run it).
  - `docs/plans/todo_plans/SELF_SERVE_SIGNUP_AND_GOOGLE_PLAN.md`: the LIRA-280 "one Gmail = one shop" rule is superseded by LIRA-288.

## Phase 8: Release, ticket, gates

- [X] T022 `docs/release-notes/UNRELEASED.md` (🌐 Web app, shop-owner language):
  - staff can sign in with Google;
  - one Google account works in several shops;
  - Join with Google on invites;
  - admins can see and disconnect Google in Settings → Users.

  Also add a `current_sprint.md` **LIRA-288** entry with a "What users will notice" line.
- [X] T023 Web e2e `frontend/tests/e2e-web/lira-web-0NN-join-with-google.spec.ts`, with Google stubbed the same way the backend tests do it. If the harness cannot stub Google end to end, cover the join through the backend API tests and say so.
  - Done as `frontend/tests/e2e-web/lira-web-043-google-per-shop.spec.ts`. The web harness runs with Google OFF and the callback must reach Google's real token endpoint, so the join callback is covered by `backend/src/api/__tests__/googleAuth.api.test.ts` ("Join with Google (invite links)") and core `UserInvitationService.joinWithGoogle.test.ts`; the e2e proves the Google-off invite page, the start route's refusal, and the admin disconnect (link + directory row) through the real server.
- [X] T024 Gates: `yarn typecheck`, `yarn lint`, `check:tenant-scoping`, `check:bind-arity`, `check:schema-equivalence`, `build-release-notes --check`, `node scripts/run-tests.mjs`, `yarn build`, and web e2e. The lead runs the e2e suites in a throwaway test copy, because the main folder's driver is built for Electron.
  - 2026-10-08: every gate except the web e2e run green in the main folder; the web e2e (incl. lira-web-042, lira-web-043) is left to the lead.

## Dependencies

- T001–T005 come first.
- T006–T009 come next (they need T005).
- T010 needs T005. T011 is independent of T010 but touches the same Google files, so do it after T010.
- T012–T016 come after T011.
- T017–T018 can run alongside Phase 5 (different files).
- T019–T021 come after T005.
- T022–T024 come last.

## MVP

Phases 1–4: the directory, sync, readers and the rule. That alone fixes the per-tenant risk and allows one Gmail in several shops.
