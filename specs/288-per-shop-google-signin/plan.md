# Implementation Plan: Google sign-in for every user, scoped per shop

**Branch**: `288-per-shop-google-signin` (work directly on local `main`, owner preference) | **Date**: 2026-10-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/288-per-shop-google-signin/spec.md`

## Summary

Make Google sign-in a per-shop property of **any** user, and give www a fast, layout-independent answer to "which shops can this person open?".

**The rule change:**
- Remove the application-level "one Google account = one shop" refusal.
- The existing database constraints (`UNIQUE(provider, subject, tenant_id)` and `UNIQUE(user_id, provider)`) already express the new rule, "one Google account = one user per shop".

**The new platform table, `signin_directory`:**
- Each row maps a confirmed email or a Google account to a (shop, user) pair.
- It is kept current by one idempotent `syncUser(tenantId, userId)`, called after every writer, plus a repair/check CLI and a boot drift warning.
- www's email-code, Google and forgot-password lookups read only this table, so they work unchanged when each shop gets its own database file.

**New screens and endpoints:**
- "Join with Google" on invite links: the username is chosen first, then the user is created and linked in one step.
- An admin view and disconnect of staff Google links in Settings → Users.

## Technical Context

**Language/Version**: TypeScript in strict mode, Node 20 (Fly), React 19 (Vercel).

**Primary Dependencies**: existing ones only — Express, better-sqlite3, zod, the existing Google OAuth code (node:crypto JWKS verification) and the email outbox.

**Storage**: SQLite. New platform table `signin_directory` (migration **v200**). No change to the shop tables.

**Testing**: Jest for core, backend and frontend. Playwright for web e2e. Per-tenant-mode tests reuse the existing per-tenant test harness (`perTenantMode.*.test.ts`).

**Target Platform**: web app only.

**Project Type**: web service plus SPA in the monorepo.

**Performance Goals**: www lookups take one indexed query on `(kind, value)` with a join to `tenants`, at small volume.

**Constraints**:
- Per-tenant mode cannot run one transaction across a shop file and the platform file. The shop write is the source of truth, the sync runs after it, and the repair CLI fixes drift.
- Production holds one existing double link (the owner's Gmail in cornertech and test). Under the new rule it becomes valid.

**Scale/Scope**:
- 1 migration
- 1 repository and 1 service (`SigninDirectoryRepository`, `SigninDirectoryService`)
- About 10 writer call sites wired to `syncUser`
- 3 readers switched to the directory
- The `join` Google intent and `acceptWithGoogle`
- 2 admin endpoint changes
- 2 UI changes (the Join page and Settings → Users)
- 1 CLI

## Constitution Check

| Principle | Status | Note |
|---|---|---|
| I. One core, two transports | **Exception** (as LIRA-267/280) | Web-only: desktop has no Google, invites or email. Recorded below. |
| I. Location-dependent values (rule 27) | Pass | Times are UTC ISO strings, with "now" passed in. |
| I. Browser leaf (rule 29) | Pass | The directory code is Node-only (core `index.ts`, not `browser.ts`). Only schemas and types reach the browser. |
| II. Repositories own SQL | Pass | All SQL is in `SigninDirectoryRepository`. The service only orchestrates scopes. |
| III. Schemas once, derived types (rules 14, 21) | Pass | `joinWithGoogleStartSchema` lives in core validators; the frontend uses `z.input`. The `DIRECTORY_USABLE` predicate is defined once and also replaces the two divergent existing predicates. |
| V. Tenant scoping | Pass | The table is platform-only, with no `tenant_id`, and is registered with tenantSplit, resetTables and check-tenant-scoping. Platform access goes through `runWithoutTenant`. |
| V. id/created_at/updated_at; both schema files with `down()` | Pass | |
| V. Role checks | Pass | The admin disconnect uses `authenticateJWT`, then `requireRole(["admin"])`, with the shop taken from the JWT. |
| VI. Tests first, web proof | Planned | quickstart.md lists failing-first tests, a per-tenant-mode test and a web e2e test. |
| Money integrity | N/A | |
| Delivery: release note | Required | Under Web app: staff can use Google, one Google account can work in several shops, Join with Google, and admins can see and disconnect Google. |

**Post-design re-check:** passes. The only exception is web-only.

## Project Structure

### Documentation

```text
specs/288-per-shop-google-signin/
├── spec.md · plan.md · research.md · data-model.md · quickstart.md
├── contracts/api.md
├── checklists/requirements.md
└── tasks.md                (next: /speckit-tasks)
```

### Source code

```text
packages/core/src/
├── db/migrations/index.ts                 # + v200 signin_directory (+ shared-mode back-fill)
├── db/tenantSplit.ts                      # PLATFORM_ONLY_TABLES / KNOWN_TABLES_WITHOUT_TENANT_ID
├── constants/resetTables.ts               # RESET_EXCLUDED_TABLES
├── repositories/SigninDirectoryRepository.ts   # new: replaceForUser, findByEmail, findByGoogleSubject, listAll, DIRECTORY_USABLE
├── services/SigninDirectoryService.ts          # new: syncUser (shop read → platform replace), rebuildAll, diff
├── repositories/UserIdentityRepository.ts # remove other-shop check + findLiveLinksBySubject/findBySubjectAllTenants (after callers move)
├── repositories/UserRepository.ts         # remove findSigninAccountsByEmail (after callers move)
├── services/GoogleAuthService.ts          # drop isLinkedToAnyShop; findSignInMatches → directory; syncUser after link/unlink
├── services/UserEmailService.ts           # syncUser after set/verify; view gains google; adminUnlinkGoogle
├── services/UserInvitationService.ts      # syncUser after accept; new acceptWithGoogle
├── services/AuthService.ts                # syncUser after deactivate/reactivate/role change
├── services/SigninCodeService.ts, PasswordResetService.ts   # readers → directory
├── services/TenantStorageProvisioner.ts   # syncUser for the first admin
├── validators/account.ts, googleAuth.ts   # "join" intent, joinWithGoogleStartSchema
electron-app/create_db.sql                 # table + seed row
scripts/check-tenant-scoping.mjs           # NON_TENANT_TABLES

backend/src/
├── security/googleOAuth.ts                # "join" intent + join ticket (10 min)
├── api/googleAuth.ts                      # callback join branch; login uses directory; drop in_other_shop / already_connected
├── api/googleSignup.ts                    # drop isLinkedToAnyShop recheck; syncUser after link
├── api/userInvitations.ts                 # POST /google/start
├── api/userEmail.ts                       # list google field; DELETE /:userId/google
├── database/perTenantStorageProvisioner.ts# syncUser after first admin; directory delete on tenant delete
├── database/signinDirectoryCheck.ts       # boot drift warning (model: tenantCompletenessCheck)
└── scripts/signinDirectoryCli.ts          # dry-run/--write (model: tenantSplitCli)

frontend/src/
├── features/auth/pages/JoinShop.tsx       # username first; "Join with Google" | password
├── features/settings/pages/Settings/UsersManager.tsx   # Google column + Disconnect (admin)
├── features/settings/pages/Settings/GoogleAccountPanel.tsx  # message for already_linked = other user in this shop
└── api/backendApi.ts                      # startJoinWithGoogle, adminRemoveUserGoogle
frontend/tests/e2e-web/lira-web-0NN-join-with-google.spec.ts
docs/release-notes/UNRELEASED.md, current_sprint.md (LIRA-288)
```

**Structure decision**: existing layers. SQL lives in core repositories, the logic and scope switching in core services, and the transport in backend routes. No new package.

## Implementation order

1. Migration v200, the table registrations and the repository (with tests).
2. `SigninDirectoryService.syncUser`, rebuild and diff (with tests in shared and per-tenant mode).
3. Wire `syncUser` into every writer (research R3), one at a time, each with a test.
4. Switch the three readers to the directory, then delete the old cross-tenant functions.
5. The rule change: remove the other-shop checks and update the messages.
6. Join with Google: intent, ticket, `acceptWithGoogle`, `POST /google/start`, the Join page.
7. Admin: the list field, the disconnect endpoint, the Settings → Users column.
8. The CLI and the boot drift check.
9. Release note and ticket. Gates and web e2e.
10. Production: deploy, run the CLI dry run (zero differences), then the manual checks in quickstart.md.

## Complexity Tracking

| Exception | Why | Simpler alternative rejected |
|---|---|---|
| Web-only (Constitution I); owner-approved pattern from LIRA-267/280 | The desktop app has no Google, invites or email. | An IPC mirror for flows the desktop cannot show would be dead code. |
| Directory sync is not atomic with the shop write in per-tenant mode | SQLite cannot run a transaction across two files. | Database triggers cannot cross files. Writing the shop data into the platform file would defeat the split. The source of truth plus an idempotent sync plus the repair CLI is the established pattern here (invite + outbox, per-tenant provisioning). |
