# Research: LIRA-288 — Google sign-in for every user, scoped per shop

All facts were verified against `main` @ `5ed33d6f` on 2026-10-08, with file:line references from a read-only code survey.

## R1. Where the directory lives

- **Decision:** a new platform-only table, `signin_directory`, in the existing platform database. It has **no `tenant_id` column**. The shop is identified by `target_tenant_id`, as `sso_handoff_tokens` already does. The table is registered in `PLATFORM_ONLY_TABLES` (`packages/core/src/db/tenantSplit.ts:127-133`) and in `RESET_EXCLUDED_TABLES` (`constants/resetTables.ts:158-165`).
- **Rationale:**
  - The owner chose the platform database (2026-10-08).
  - A `tenant_id` column would make the tenant split treat the table as shop data (`tenantSplit.ts:119-126`).
  - The platform database already holds `tenants`, so a shop's status is read by joining it at query time. Nothing needs syncing when a shop is suspended, archived or reactivated.
- **Alternatives considered:**
  - A separate auth database: the owner rejected it, since it adds another file to back up and sync.
  - Scanning every tenant file: works only in shared mode today (`UserRepository.ts:757-764`, `UserIdentityRepository.ts:29-35`).

## R2. What the directory stores, and when a row is "usable"

- **Decision:** one row per sign-in method of an **active, non-super-admin** user:
  - `kind='email'` (confirmed emails only), `value` = lowercased email.
  - `kind='google'`, `value` = the Google `sub`.

  Each row also stores `target_tenant_id`, `target_user_id`, `username` (shown as "as rami") and `display_email` (for Google rows, shown in Settings). When a user is deactivated, has their email cleared or unconfirmed, or has Google unlinked, **their rows are deleted**.

  Shop status is applied at read time with one named predicate, `DIRECTORY_USABLE`: `t.status IN ('active')`, joined to `tenants`.
  - **Fix for an existing inconsistency:** today the email lookup uses `status='active'` (`UserRepository.ts:108-115`), while the Google "live link" check also accepts `'provisioning'` (`UserIdentityRepository.ts:109-113`). Sign-in must only list shops someone can actually enter, which means `'active'` only. Defining the predicate once settles it (rule 14).
- **Rationale:** storing only usable *users* means the sync only has to track user facts. Shop facts come from the join. A row that exists is always one the user may use, subject to shop status.

## R3. How the directory stays in sync

- **Decision:** one idempotent operation, `SigninDirectoryService.syncUser(tenantId, userId)`.
  1. It reads the user's current state in the **shop scope** (`runWithTenant`): email, email verified time, active flag, role, username, Google link.
  2. It **replaces** that user's rows in the **platform scope** (`runWithoutTenant`), with a delete and an insert in one platform transaction.

  Every writer calls it after its own shop-side commit. The writers are:

  | Change | Writer (verified) |
  |---|---|
  | Email set, cleared or confirmed | `UserRepository.setEmail` :630 / `markEmailVerified` :659 / `setEmailIfAbsent` :738, via `UserEmailService.setEmail` :193 and `verify` :256 |
  | User created with an email | `UserRepository.createUser` :572, via invite accept (`UserInvitationService.ts:532-546`) and provisioning (`TenantStorageProvisioner.ts:102-111,~173`; `perTenantStorageProvisioner.ts:294-306`) |
  | Google linked or unlinked | `UserIdentityRepository.link` :146 / `unlink` :234, via `GoogleAuthService.linkIdentity` :372 / `unlinkIdentity` :390; Google sign-up `googleSignup.ts:179-195` |
  | User deactivated, reactivated or role changed | `AuthService.deactivateUser` :543 / `reactivateUser` :566 / `setUserRole` ~:597 |
  | Shop deleted | `TenantProvisioningService.deleteTenant` :223-247 → FK `ON DELETE CASCADE` on `target_tenant_id` (shared mode), plus an explicit delete in the per-tenant path (`perTenantStorageProvisioner` `deleteRegistryRow` :813) |
  | Shop slug renamed | No sync needed: the slug is read from `tenants` at query time |

- **Atomicity:** in shared mode, the shop write and the sync could share one transaction. In per-tenant mode they live in **different files** and cannot. Existing precedents for that: invite plus outbox (`UserInvitationService.ts:21-24,:342`) and per-tenant provisioning (`perTenantStorageProvisioner.ts:209-394`).
  - **Decision:** shop write first, then the sync. A sync failure is logged with a warning and does not fail the user's action. The repair command (R4) fixes any drift.
  - Because the shop records are the source of truth, the worst case after a crash is that www cannot list a shop until the next sync or repair. Signing in on the shop's own address never uses the directory, so it keeps working.
- **Alternatives considered:**
  - Per-event deltas (insert or delete a single row): more code paths that can drift.
  - Database triggers: impossible across files.

## R4. Repair and drift check

- **Decision:**
  - `backend/src/scripts/signinDirectoryCli.ts`, modelled on `tenantSplitCli.ts`:
    - Dry run by default: prints a JSON diff of missing, extra and stale rows, then exits with code 0 or 1.
    - `--write` rebuilds the whole directory from every shop's records (each shop file in per-tenant mode, the one database in shared mode).
    - Run it with `yarn api ssh console -C "node dist/scripts/signinDirectoryCli.js"`.
  - A boot-time drift check, modelled on `backend/src/database/tenantCompletenessCheck.ts`, that logs a warning only (spec FR-016).
- **Back-fill (FR-017):** migration **v200** creates the table and, when `users` and `user_identities` are present in the same file (shared mode, which is production), fills it with one `INSERT … SELECT`. In per-tenant mode the operator runs the CLI with `--write` once after the split.

## R5. The rule change: one Google account = one user per shop

- **Decision:**
  - Remove the other-shop check in `UserIdentityRepository.link` (:163-166, `GoogleAccountInOtherShopError`).
  - Remove the "linked anywhere" sign-up refusal (`GoogleAuthService.isLinkedToAnyShop` :357; `googleAuth.ts:469-474`; `googleSignup.ts:130`).
  - The existing database constraints already give exactly the new rule:
    - `UNIQUE(provider, subject, tenant_id)`: one user per shop per Google account.
    - `UNIQUE(user_id, provider)`: one Google account per user.

    A violation already maps to `IdentityAlreadyLinkedError` (:191).
  - Keep `GoogleAccountInOtherShopError` exported but unused for one release, with a "deprecated" comment, in case an old browser tab shows its code. Remove it in a later release.
- **Settings message:** the `in_other_shop` outcome becomes unreachable. `already_linked` now means "another user in this shop".

## R6. Join with Google (invites)

- **Decision:**
  - New Google flow intent **`join`**. Add it to `GoogleIntent` (`backend/src/security/googleOAuth.ts:121`), the zod enums (`validators/account.ts:108-111`, `validators/googleAuth.ts:54`) and `readStateTicket` (:147-148).
  - New ticket purpose `join`, with a 10-minute TTL. Its payload carries the invite token, the chosen username and the shop.
  - It is started like `link`: a **POST** to `/start` (`googleAuth.ts:237-266`), so the token never appears in a URL.
  - The callback calls the new `UserInvitationService.acceptWithGoogle({ token, username, googleProfile, now, requiredTenantId })`:
    1. Claim the invite.
    2. Check that the Google `email_verified` is true and that the Google email equals the invite email, ignoring case.
    3. Check that the Google account is not linked to another user in this shop.
    4. In one shop transaction: create the user (role from the invite, email confirmed) and link the identity.
    5. Finalize the invite, then `syncUser`, then the SSO hand-off into the shop.

    On failure the claim is released, so the invite stays usable (FR-009).
- **Password for a Google-only user (spec assumption):** `users.password_hash` is required. Store an **unusable random hash**, made from 32 random bytes and never shown, so a password login cannot succeed. The person sets a real password through "Forgot password", since their email is confirmed. **To check during implementation:** whether anything treats "has a password" as meaningful. Nothing known does.
- **Where the username is chosen:** on the join page, *before* going to Google. The page has one username field, then either "Join with Google" or a password and "Join".

## R7. Admin view and disconnect

- **Decision:**
  - Extend `GET /api/user-email` (`backend/src/api/userEmail.ts:106`, admin only), which already feeds Settings → Users. Each user gains `google: { email } | null`. That is one call, and `UserEmailView` grows by one field (`UserEmailService.ts:69-73`).
  - New `DELETE /api/user-email/:userId/google` (admin only, same shop, never the super admin). It calls `GoogleAuthService.unlinkIdentity` and then `syncUser`.
  - The user's own `DELETE /api/auth/google/link` (:672) stays as it is.
- **Rationale:** it lives on the router the Users tab already uses. Linking stays self-only, because it needs the person's Google consent. Disconnecting is an admin power.

## R8. Callers switched to the directory (FR-015)

| Today (shared mode only) | After |
|---|---|
| `UserIdentityRepository.findBySubjectAllTenants` :265 ← `GoogleAuthService.findSignInMatches` :344 ← `googleAuth.ts signInRedirect` :308 | `SigninDirectoryRepository.findByGoogleSubject(sub)` |
| `UserRepository.findSigninAccountsByEmail` :765 ← `SigninCodeService` :160, :225; `PasswordResetService.requestByEmailEveryShop` :229 | `SigninDirectoryRepository.findByEmail(email)` |
| `findBySubjectInTenant` :246 ← POST `/choose` | unchanged (explicit shop) |

The old cross-tenant functions are deleted once nothing calls them, together with their "shared mode only" comments.

## R9. Desktop and transport

Web-only, as with LIRA-267 and LIRA-280: the desktop app has no Google, invites or email. Recorded in plan.md Complexity Tracking. The directory table also exists in desktop databases (one schema for both), where it stays empty.
