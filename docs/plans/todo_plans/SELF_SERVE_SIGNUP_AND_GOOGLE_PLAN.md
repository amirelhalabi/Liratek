# Self-serve sign-up (email + shop name), then Google sign-in — Plan

**Status:** todo (planned 2026-10-07). Builds on LIRA-267 (email invites, live).
**Tickets to open:**
- **LIRA-278:** self-serve sign-up without Turnstile (Phase 1).
- **LIRA-279:** users get an email address (Phase 2). This is also the prerequisite for LIRA-275 and LIRA-276.
- **LIRA-280:** Sign in / Sign up with Google (Phase 3).
- **LIRA-281:** invite users to a shop by email from Settings → Users (Phase 2b).

---

## Goal

The public **Create your shop** page asks for exactly what the admin **Send invite** dialog asks for: **email** and **shop name (optional)**. Submitting it emails the same one-time link. The link opens the full form (shop address, username and password), with the email locked.

Later, a **Continue with Google** button replaces the email-link step for people with a Google account, because Google has already proved who owns the email.

Turnstile stays off (owner decision, 2026-10-07).

## Today (verified 2026-10-07)

- **The request form already exists.** Self-serve mode (`Signup.tsx` without `?invite=`, `POST /api/auth/signup/request`) is built and tested. It currently asks for email only.
- **It switches on only with Turnstile.** `selfServeEnabled = canSendInvites() && isTurnstileConfigured()`. Without Turnstile, `/signup` says "not available".
- **Limits already in place:**
  - 5 requests per IP per hour (`signupRequestLimiter`)
  - 3 per email per hour
  - 50 per day across the platform (`SIGNUP_SELF_SERVE_DAILY_CAP`)
  - the same "check your inbox" reply whether or not the address already has a shop
- **The per-IP limit is not doing its job.** The production log shows requests arriving from `66.241.124.103`, which is a proxy's address, not the visitor's. The chain is browser → Vercel rewrite → `api.liratek.shop` → Fly, with `trust proxy` = 1. As a result every visitor shares one 5-per-hour budget.
- **Users have no email address.** Only `tenants.contact_email` exists, one per shop.

---

## Phase 1 — self-serve without Turnstile (LIRA-278, small: about 1–2 days)

**What users see:**
- The login page shows **Sign up**.
- `/signup` asks for **Email** and **Shop name (optional)**, then shows "Check your inbox".
- The email holds the same link as an admin invite.
- The link opens the full form with the email locked and the shop name filled in. Submitting it creates the shop.

**Changes:**

1. **A switch, not a dependency.** Self-serve turns on with a new setting, `SIGNUP_SELF_SERVE_ENABLED=true`. Email must also be working.
   - Turnstile becomes an **optional extra layer**: it is checked only if its keys are set.
   - `selfServeEnabled` becomes `canSendInvites() && SIGNUP_SELF_SERVE_ENABLED`, with Turnstile verification when configured.
   - The setting lives in `.env.fly`.
2. **Shop name on the request form.** Add `shopNameHint` (optional, at most 100 characters) to `requestSignupLinkSchema`. Store it on the invite, as admin invites already do.
3. **Abuse protection without Turnstile.** This is the part that matters: an open form that sends email is what spammers look for.
   - **Fix the real client IP first.** Measure the forwarded headers on one production request (`x-forwarded-for`, `x-real-ip`, `x-vercel-forwarded-for`, `fly-client-ip`). Then set `trust proxy` (or read one specific header) so that `req.ip` is the visitor. Without this, the per-IP limit protects nothing. The fix must not break `X-Forwarded-Host` tenant routing (`docs/OPERATIONS.md` deploy checks).
   - **Never echo visitor text in a self-serve email.** A spammer would put a URL in "shop name" and use our domain to deliver it. For `source='self'`, the email leaves out the shop name; it only prefills the form behind the link. Admin invites keep showing it.
   - **Honeypot field.** A hidden input that people never fill and bots often do. If it is filled, reply "check your inbox" and send nothing.
   - **Minimum time on the form** (for example 3 seconds), with the same silent treatment.
   - **Lower the daily cap** to about 20 for launch, and log a warning when it is reached. It is configurable.
   - Keep the per-email limit (3 per hour) and the identical reply for every case.
4. **The admin can see self-serve requests.** The Invitations list already shows Source = Self. Add a **Source filter** so self-serve rows can be reviewed or revoked.

**Tests (written failing first):**
- the switch on and off, with Turnstile absent and with it present;
- the shop name stored but missing from a self-serve email, and present in an admin email;
- the honeypot and the minimum time, both silent;
- `req.ip` taken from the real header, plus a guard that `X-Forwarded-Host` routing still works;
- extend web e2e `lira-web-039`: request with email and shop name, then the link, then sign-up.

**Go-live:** add `SIGNUP_SELF_SERVE_ENABLED=true` to `.env.fly` and run the import command. To switch it off, set it to false and import again.

---

## Phase 2 — users get an email (LIRA-279, medium)

This is shared groundwork for password reset (LIRA-275 and LIRA-276) and Google sign-in.

- **Migration:** `users.email TEXT NULL` and `users.email_verified_at TEXT NULL`.
  - Unique **per shop** (`tenant_id, email`), not globally, because one person may own several shops.
  - Both `migrations/index.ts` and `create_db.sql`.
- **At sign-up through a link:** the shop's first admin gets `email` = the invite email, with `email_verified_at` set, because the link proved they own it.
- **For existing shops:** backfill the first admin's email from `tenants.contact_email` where one exists.
- **Settings → Users:** an optional email field per user. Verifying it reuses the LIRA-267 token and outbox: we send a link, and opening it marks the address verified.
- **Desktop:** the column exists (the schema is shared) but nothing uses it, because email is web-only.

### Phase 2b — invite users by email (LIRA-281, medium)

Settings → **Users** gets **Invite by email** next to the existing **Add user**. Manual accounts with a password keep working as they do now.

- **The invite:** the shop admin enters an **email** and a **role**. The invitee receives a single-use link that expires in 72 hours. It opens `https://<slug>.liratek.shop/#/join?invite=…`, where they choose a **username and password**. Their user is created in **that shop**, with the email filled in and already verified.
- **A separate table, `user_invitations`.** It is **tenant-scoped**: it has `tenant_id`, and the tenant-scoping check applies to it. `signup_invitations` stays platform-level, because it creates shops.
  - Columns: `email`, `role`, `token_hash`, `invited_by_user_id`, `expires_at`, `used_at`, `used_by_user_id`, `revoked_at`, `email_outbox_id`, `created_at`, `updated_at`.
- **Reused from LIRA-267:** `generateToken`/`hashToken`, the email outbox and its retries, the template renderer, and the claim → create → finalize step that makes a link work only once.
- **A new email template, `user-invite`:** "<Shop name> invited you to LiraTek". The shop name is safe to include here, because only a shop admin can send this invite.
- **Rules:**
  - Refuse an email that already belongs to a user in that shop.
  - Only roles the inviting admin is allowed to grant.
  - A pending list in the Users tab with revoke and resend, like the platform Invitations list.
- **Web-only.** Desktop keeps manual accounts. Record this as an exception, like LIRA-267.
- **Reset password (LIRA-275/276) uses the same email** once a user has one.

---

## Phase 3 — Continue with Google (LIRA-280, large: use Spec Kit)

### The constraint that shapes the design

Shops sign in at their own subdomain (`<slug>.liratek.shop`). Google OAuth requires **every redirect URI and JavaScript origin to be listed exactly**. Likely, based on Google's OAuth client rules: **wildcard subdomains are not accepted**. Verify this when setting up the client. If so, a "Sign in with Google" button cannot run inside each shop's subdomain.

### Design: one central Google flow on `www.liratek.shop`

1. The button on any login or sign-up page sends the browser to `https://www.liratek.shop/#/auth/google?intent=login|signup&shop=<slug>`.
2. `www` runs the Google flow, using the authorization-code flow with PKCE through the backend. Its single registered redirect is `https://www.liratek.shop/api/auth/google/callback`.
3. The backend verifies Google's ID token: issuer, audience, expiry and `email_verified = true`. Google's keys are available as JWKS, so no heavy SDK is needed.
4. **Sign-up:** Google has proved the email, so the email-link step is skipped. The person goes straight to the full form (shop name, address, username, password), with the email locked.
   - A shop created this way gets `contact_email` and the admin's `email_verified_at`.
   - The rule "one shop per contact email" (LIRA-267) still applies.
   - Open question: whether a Google sign-up must still set a password. Recommended: yes for now, so the POS login and the desktop app keep working.
5. **Sign-in:** find users whose `user_identities` row matches Google's `sub`, or, the first time only, whose verified `users.email` matches.
   - **One match:** create a short-lived (about 60 seconds) one-time login token and redirect to `https://<slug>.liratek.shop/#/login?sso=<token>`. That page exchanges the token for a normal session. This is the same pattern as the existing impersonation hand-off.
   - **Several shops:** show a "choose your shop" list.
   - **None:** "No LiraTek account uses this Google address" with a link to sign up.
6. **New table `user_identities`:** `id`, `user_id`, `provider` ('google'), `subject` (Google `sub`), `email`, `created_at` and `updated_at`, unique on (`provider`, `subject`).
   - Link by `sub`, never by email alone after the first match. An email address can change hands; a `sub` cannot.
7. **Linking an existing account:** Settings → **Connect Google**, while signed in normally, creates the `user_identities` row. Recommended over silently linking on the first Google sign-in.

### Owner setup (later)

- **Google Cloud project:**
  - OAuth consent screen (app name LiraTek, support email `mail@liratek.shop`, the domain `liratek.shop` verified)
  - an OAuth **Web client**, with authorized origin `https://www.liratek.shop` and redirect `https://www.liratek.shop/api/auth/google/callback`
- **Secrets in `.env.fly`:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.

### Scope notes

- **Web-only.** The desktop app keeps username and password. Record this as an exception, like LIRA-267.
- **Super admin:** Google sign-in is out of scope (it uses a different login).
- **The email sign-up path stays.** Google is an additional way in, not a replacement.

---

## Order and dependencies

```
Phase 1 (LIRA-278) ── independent, ship first
Phase 2 (LIRA-279) ── needed by LIRA-275/276, LIRA-281 and Phase 3
Phase 2b (LIRA-281) ── after Phase 2
Phase 3 (LIRA-280) ── after Phase 2; Spec Kit (/speckit-specify --number 280)
```

## Owner decisions (2026-10-07)

1. **Phase 1:**
   - The self-serve daily cap is **20**.
   - Self-serve emails **leave out** the visitor's shop name. It only prefills the form behind the link.
2. **Phase 2:**
   - A user's email is **unique per shop**.
   - Each shop's **admin account is linked to the email used at sign-up**.
   - Other users are added in Settings → Users, either by **email invite** (new, LIRA-281) or as a **manual account with a password** (already works).
3. **Phase 3:**
   - A Google sign-up **still sets a password**.
   - Existing users link Google **from Settings only**, never automatically.
   - **Google sign-up is always allowed when Google is configured.** It does
     not follow `SIGNUP_SELF_SERVE_ENABLED` (that switch is for the emailed
     form only). `/status` has no separate sign-up flag; the login page
     offers "Create a shop with Google", and `/signup` offers "Continue with
     Google" even while the emailed form is off.
   - **Google sign-ups count toward the one daily cap**
     (`SIGNUP_SELF_SERVE_DAILY_CAP`, default 20): one limit for every public
     sign-up, emailed requests and Google sign-ups together.
     - Source of the count: a new platform column, `tenants.google_signup_at`
       (migration **v197**, UTC ISO), set only when a shop is created with
       Google. `tenants` is the platform registry, so the count also works in
       per-tenant DB mode, where `audit_log` and `user_identities` live in
       each shop's own file. `created_at` was not used: it is
       `CURRENT_TIMESTAMP` text, which does not compare correctly with an ISO
       window start.
     - One count, defined once: `SignupInvitationRepository.countPublicSignupsSince`
       (self-serve invites + Google shops, rolling 24 hours), asked through
       `SignupInvitationService.isPublicSignupCapReached`, which the email
       form and the Google route both use.
     - When the cap is reached, the email form still answers "check your
       inbox" and sends nothing (it must not reveal the cap). Google sign-up
       is refused openly, because the person is signed in with Google: the
       callback sends them to `/#/auth/google?error=signup_limit`, and the
       shop-creating request answers 200 `{success:false, code:"SIGNUP_DAILY_CAP"}`.
       Both log a warning. The check at shop creation is the authoritative
       one; two sign-ups racing at the last free place can both pass (a soft
       cap).
   - **After Google sign-in, the app is left in the same state as after a
     password login.** The hand-off reloads the app, which boots through
     session restore. A one-shot marker (`freshSignIn.ts`) makes that boot
     run the same post-sign-in step as `login()`: the opening-balance check
     that sets `needsOpening`. Note (unverified owner question): nothing
     in the app reads `needsOpening` today. The automatic Checkpoint pop-up
     after login was removed in v1.18.49, so neither sign-in path shows a
     pop-up; the Dashboard's opening-balance alerts come from the shop's
     data and show after either.

---

## Contracts (foundation, 2026-10-07)

The foundation commit (migration **v196**) builds the shared pieces. Features **A–D** build on it in parallel. Each feature edits only the files it owns (the ownership table is at the end). Shared files already carry one **anchor comment per feature**, separated by blank lines, so parallel branches merge cleanly. Add your lines directly under **your** anchor only.

### What the foundation provides

**Schema (v196)**, in `migrations/index.ts` and `create_db.sql`:

- `users.email`, `users.email_verified_at`, plus a partial `UNIQUE(tenant_id, email) WHERE email IS NOT NULL`.
- Backfill: each shop's **first admin** gets `tenants.contact_email`, marked verified.
  - "First admin" means the lowest-id **active** user with `role='admin'`. It is defined once in `UserRepository`, as `FIRST_ADMIN_WHERE`/`FIRST_ADMIN_ORDER`.
  - The admin is skipped if they already have an email, or if another user in the shop already holds that address.
- Tenant-scoped tables (`tenant_id NOT NULL`, `ON DELETE CASCADE`):
  - `user_invitations`
  - `password_reset_tokens`
  - `email_verification_tokens` (new; it stores the `email` the link was sent to)
  - `user_identities`
- Platform table: `sso_handoff_tokens`.
  - It has `target_tenant_id` and **no `tenant_id`**, so the per-tenant split and the platform-split guard never count its rows as shop data.
  - Neither `target_tenant_id` nor `user_id` has a foreign key.
- `email_outbox_id` is a plain INTEGER everywhere, with **no foreign key**. The outbox is platform-only and is deleted from every `tenants/<id>.db`, so a foreign key would fail that file's `foreign_key_check`.
- `user_identities` uniqueness:
  - `UNIQUE(provider, subject, tenant_id)`: at most one user per shop.
  - **One Google account = one shop (owner decision 2026-10-07, supersedes "several shops"):** a Google account may be linked to one user in one shop, platform-wide. Enforced in `UserIdentityRepository.link` (check + insert in one IMMEDIATE transaction), not by a `(provider, subject)` unique index, because production already holds one account linked in two shops. Those existing links are kept and sign in through the chooser. Google sign-up is refused for an account linked anywhere (`isLinkedToAnyShop`, checked at the callback and at `POST /signup`). Only LIVE links count (owner decision 2026-10-07): active user in an `active`/`provisioning` shop; a deactivated user's link or one in a `suspended`/`archived` shop is ignored but kept — one predicate (`LIVE_LINK_FROM`, `findLiveLinksBySubject`) for both checks. A revived dead link can leave the account in two shops; sign-in then shows the chooser. Same per-tenant DB mode limitation as `findBySubjectAllTenants`.
  - `UNIQUE(user_id, provider)`: one Google account per user.
  - The first index also serves the by-subject lookup.
- Case-insensitivity: emails are stored trimmed and lowercased.
  - `signupEmailSchema` does this at the edge.
  - `normalizeEmail()` does it inside every repository, because provisioning bypasses zod.
  - Lookups compare the normalized value. The plain unique index is therefore case-insensitive in practice, the same approach as v195.

**Repositories** (`@liratek/core`, Node only):

- Every "now" is a UTC ISO string passed in by the caller.
- Every `created_at` in the token tables is written as ISO.
- By-token methods are cross-tenant in SQL, because the token is the capability; the row's `tenant_id` names the shop.
  - The route must check that shop against the host's shop when the host resolves one.
  - It must then do the rest inside `runWithTenant(row.tenant_id)`.
  - In per-tenant DB mode, the route must already be inside the host shop's scope before calling.

| Repository | Methods |
| --- | --- |
| `UserRepository` (added) | `setEmail(userId, email\|null, verifiedAt\|null)`, `markEmailVerified(userId, email, verifiedAt)` (only if the user's email is still `email`), `getEmail(userId)`, `listEmails()`, `findByEmailInTenant(email, tenantId)` (active users only), and `createUser({…, email?, email_verified_at?})`. Throws `EmailTakenInShopError` (`EMAIL_TAKEN_IN_SHOP`). |
| `UserInvitationRepository` | `createInvitation`, `linkOutbox`, `findByTokenHash`, `claim(hash, now, staleBefore)`, `finalize(id, userId, now)`, `release`, `revoke`, `listRecent(limit)`, `findPendingByEmail(email, now)`, `countCreatedSince(iso)`, and `deriveUserInvitationStatus`. |
| `PasswordResetTokenRepository` | `createToken({userId, tokenHash, expiresAt, requestedIpHash?, now})`, `linkOutbox`, `findUsableByTokenHash(hash, now)`, `consume(hash, now)`, `invalidateForUser(userId, now)`, `countForUserSince(userId, iso)` |
| `EmailVerificationTokenRepository` | `createToken({userId, email, tokenHash, expiresAt, now})`, `linkOutbox`, `findUsableByTokenHash`, `consume`, `invalidateForUser`, `countForUserSince` |
| `UserIdentityRepository` | `link({userId, provider, subject, email, now})` (throws `IdentityAlreadyLinkedError`, `IDENTITY_ALREADY_LINKED`), `findByUser`, `unlink`, `findBySubjectInTenant(provider, sub, tenantId)`, `findBySubjectAllTenants(provider, sub)` (active users only, **shared DB mode only**) |
| `SsoHandoffTokenRepository` | `createToken({tokenHash, userId, targetTenantId, expiresAt, now})`, `consume(hash, now)`, `deleteExpiredBefore(iso)`. Callers wrap it in `runWithoutTenant`. |

Atomic single use:

- `claim()` and `consume()` are conditional UPDATEs; the second call returns `null`.
- Expired tokens are refused with `expires_at > now`. That predicate is defined once, as `USABLE_TOKEN_WHERE`.
- Reuse `generateToken()` / `hashToken()` from LIRA-267 and store only the hash.

**Provisioning:**

- `ProvisionTenantData.contactEmailVerifiedAt` and `CreateTenantStorageInput.adminEmailVerifiedAt` link the first admin to the shop's `contactEmail`. This works in both shared and per-tenant modes, through `adminEmailFields()`.
- The email is **verified** only when the caller proves it. `POST /api/auth/signup` (invite link) now passes `contactEmailVerifiedAt: now`.
- A super admin's typed `contactEmail` links the email **unverified**. Google sign-up (D) must pass the instant Google confirmed the email.

**Env** (`env.ts`, `.env.deploy.example`, `backend/.env.example`):

| Variable | Default | Notes |
| --- | --- | --- |
| `SIGNUP_SELF_SERVE_ENABLED` | `false` | On only for `true` or `1` (any case). Not `z.coerce.boolean`. |
| `SIGNUP_SELF_SERVE_DAILY_CAP` | `20` | Changed from 50. |
| `CLIENT_IP_HEADER` | unset | Lowercased, for example `fly-client-ip`. |
| `GOOGLE_CLIENT_ID` | unset | Google sign-in stays dormant while this is unset. |
| `GOOGLE_CLIENT_SECRET` | unset | |
| `PASSWORD_RESET_TTL_MINUTES` | `60` | |
| `USER_INVITE_TTL_HOURS` | `72` | |

**Validators** (`validators/account.ts` and `signupInvitation.ts`; exported from `index.ts` **and** `browser.ts`):

- `requestSignupLinkSchema`:
  - `turnstileToken` is now optional.
  - New optional fields: `shopNameHint` (≤100), the honeypot `website` (≤200), and **`formElapsedMs`**.
  - `formElapsedMs` is an integer from 0 to 86 400 000 (one day), measured by the browser **on its own clock** from render to submit.
  - It replaces the `formStartedAt` timestamp the brief asked for. Comparing a browser timestamp with the server clock would let clock skew silently drop real people (rule 27).
- Account schemas: `createUserInvitationSchema {email, role: admin|staff}`, `checkUserInvitationSchema {token}`, `acceptUserInvitationSchema {token, username (trim, 3..100), password}`, `forgotPasswordSchema {email, shop?: slug}`, `checkResetTokenSchema {token}`, `resetPasswordSchema {token, password}`, `setUserEmailSchema {email: email|null}`, `verifyUserEmailSchema {token}`, `googleStartQuerySchema {intent: login|signup|link, shop?: slug}`, `ssoExchangeSchema {token}`.
- Passwords use `newPasswordSchema`, which is `validatePasswordComplexity` (the rule user creation enforces). It was moved to the pure `utils/passwordPolicy.ts` and is re-exported from `crypto.ts` and `browser.ts`.
- Exported input types for the frontend (rule 21): `RequestSignupLinkInput`, `CreateUserInvitationInput`, `CheckUserInvitationInput`, `AcceptUserInvitationInput`, `ForgotPasswordInput`, `CheckResetTokenInput`, `ResetPasswordInput`, `SetUserEmailInput`, `VerifyUserEmailInput`, `GoogleStartQueryInput`, `SsoExchangeInput`.
- `browser.ts` also exports these error codes: `EMAIL_ALREADY_HAS_SHOP`, `EMAIL_NOT_CONFIGURED`, `EMAIL_TAKEN_IN_SHOP`, `IDENTITY_ALREADY_LINKED`. Pages compare codes, never message text.

**Link bases** (`backend/src/email/emailConfig.ts`):

- `resolveInviteBaseUrl()` gives the **platform** origin: `SIGNUP_INVITE_BASE_URL`, else `https://www.<APP_BASE_DOMAIN>`. Use it for sign-up invites and every Google `www` URL.
- `resolveTenantBaseUrl(slug)` gives `https://<slug>.<APP_BASE_DOMAIN>`, or null. `loginUrl` and the impersonation `targetOrigin` now use it.
- **`resolveShopLinkBaseUrl(slug)`** is what every **shop-scoped emailed link** uses. It is the shop subdomain, or the one platform origin when `APP_BASE_DOMAIN` is unset, because every shop is served there in dev, preview and e2e. When it is null, the feature refuses to send.
- No new env variable was needed. `docs/DEPLOYMENT.md` says production has `APP_BASE_DOMAIN=liratek.shop`. That is **unverified against the live secrets**; check with `yarn api:secrets`.

**Pre-mounted routers** (empty; the feature fills its own file and never edits `server.ts`):

| File | Mounted at | Feature |
| --- | --- | --- |
| `backend/src/api/userInvitations.ts` | `/api/user-invitations` | B |
| `backend/src/api/userEmail.ts` | `/api/user-email` | B |
| `backend/src/api/passwordReset.ts` | `/api/password-reset` | C |
| `backend/src/api/googleAuth.ts` | `/api/auth/google` (mounted before `authRoutes`) | D |

**Anchors** are in `packages/core/src/services/index.ts` and `browser.ts` (end of file), `frontend/src/app/App.tsx` (imports and routes), `frontend/src/api/backendApi.ts` (end of file), `frontend/src/features/auth/pages/Login.tsx` (imports, the `?sso=` effect, and links under the form), and `backend/src/email/templates/index.ts` (imports and the registry).

### Conventions for every route below

- **Envelope:** `{ success, data?, error?, code? }`, from `createSuccessResponse`/`createErrorResponse`.
- **Statuses:**
  - Expected business refusals (bad link, email taken, not configured) are **HTTP 200** with `success:false` plus a `code`. `requestJson` throws on non-2xx, which is why this matches `signup/invite/check`.
  - Zod failures are 400 (`validateRequest`).
  - Missing or invalid JWT is 401. Wrong role is 403. Rate limits are 429.
- **Authenticated routes:** `authenticateJWT` **then** `requireRole([...])`, per route. The actor and the shop come from the JWT, never from the body.
- **Public token routes:** the token goes in the **body**, never the URL path. Every unusable token (unknown, expired, used, revoked, claimed) gets **one** generic message. If the host resolves a shop and the token's shop differs, use that same generic message.
- **Emails:** go through the outbox inside the same transaction as the token row, using the idempotency keys below. Templates escape all variables. `expiresAtText` is formatted in UTC with an explicit "UTC" suffix (rule 27).
- **Web-only:** every function in `backendApi.ts` calls `assertWebOnly(...)`. Record the desktop exception as LIRA-267 does.
- **Release notes** (rule 30): add one line under your area in `docs/release-notes/UNRELEASED.md` (Web app / Settings).

### A — Self-serve sign-up (LIRA-278)

**Owns:**

- `backend/src/api/auth.ts`, the `/signup/request` and `/signup-status` blocks only.
- `backend/src/security/turnstile.ts`.
- A new `backend/src/middleware/clientIp.ts`, plus the limiter key generators in `backend/src/middleware/rateLimit.ts`.
- `SignupInvitationService` (core) and the `signup-invite` template.
- `frontend/src/features/auth/pages/Signup.tsx` (request mode).
- The admin Invitations page's Source filter.
- `frontend/tests/e2e-web/lira-web-039*`.

**`POST /api/auth/signup/request`** (public; `signupRequestLimiter` keyed on the real client IP):

- Body: `requestSignupLinkSchema`.
- Availability: `canSendInvites() && SIGNUP_SELF_SERVE_ENABLED`. Otherwise 200 `{success:false, error:"Sign-up is not available right now."}`.
- Turnstile is verified **only if** `isTurnstileConfigured()`. When it is configured, a missing or invalid token gets 200 `{success:false, error:"Please complete the check and try again."}`.
- A filled `website`, or `formElapsedMs < 3000`, gets the normal success reply and sends nothing. Log the reason. An absent `formElapsedMs` skips the timing check.
- Otherwise the response is unchanged: 200 `{success:true, data:{message}}`, with the per-email limit (3 per hour) and the daily cap (20, plus a warning log).
- `shopNameHint` is stored on the invite. For `source='self'` the email **omits** the shop name.

**`GET /api/auth/signup-status`:**

- `selfServeEnabled` is `canSendInvites() && SIGNUP_SELF_SERVE_ENABLED`.
- `turnstileSiteKey` is returned only when both Turnstile keys are set.

**Real client IP:** when `CLIENT_IP_HEADER` is set, the limiters key on that header's first value, else on `req.ip`. Never change `trust proxy` in a way that breaks `X-Forwarded-Host` (see `OPERATIONS.md`).

**Admin list:** `GET /api/admin/signup-invitations?source=admin|self`.

**Frontend:** `requestSignupLink(input: RequestSignupLinkInput)` exists; change it in place. The form sends `email`, `shopNameHint`, `website:""` (a hidden input) and `formElapsedMs`.

### B — Settings → Users: emails and invites (LIRA-279, LIRA-281)

**Owns:**

- `backend/src/api/userInvitations.ts` and `backend/src/api/userEmail.ts`.
- The core services `UserInvitationService` and `UserEmailService` (new files).
- Templates `user-invite` and `verify-email` (new files, registered under the `[auth-B]` anchors).
- `frontend/src/features/settings/pages/Settings/UsersManager.tsx`.
- New pages `frontend/src/features/auth/pages/JoinShop.tsx` (route `/join`) and `VerifyEmail.tsx` (route `/verify-email`).
- The LIRA-276 **button** in Settings → Users, which calls C's endpoint.

**User email** (mounted at `/api/user-email`):

| Method + path | Auth | Body | 200 `data` | Refusal `code`s |
| --- | --- | --- | --- | --- |
| `GET /` | JWT + `admin` | none | `{ users: [{ id, email, emailVerifiedAt }] }` | none |
| `PUT /:userId` | JWT + `admin` | `setUserEmailSchema` | `{ email, emailVerifiedAt: null, verificationSent }` | `EMAIL_TAKEN_IN_SHOP`, `NOT_FOUND` |
| `POST /:userId/send-verification` | JWT + `admin` | none | `{ sent: true }` | `USER_HAS_NO_EMAIL`, `EMAIL_ALREADY_VERIFIED`, `EMAIL_NOT_CONFIGURED`, `RATE_LIMITED` (at most 3 per hour per user, `countForUserSince`) |
| `POST /verify` | public | `verifyUserEmailSchema` | `{ verified: true }` | generic "This link is not valid…" |

- **`PUT /:userId`:**
  - Saves the address **unverified**.
  - Calls `invalidateForUser` on any old verification links.
  - When the email is non-null and email is configured, it issues a verification link (TTL 24 hours, a constant `EMAIL_VERIFY_TTL_HOURS = 24` in B's service) and returns `verificationSent:true`.
  - `null` clears both the email and the verified stamp.
- **`POST /verify`:** `consume` → `runWithTenant(row.tenant_id)` → `markEmailVerified(row.user_id, row.email, now)`. When that returns false (the email has changed since), give the generic refusal.
- **Template `verify-email`:**
  - Variables: `verifyUrl`, `username`, `shopName`, `expiresAtText`, `supportEmail`.
  - Idempotency key: `verify-email:<tokenId>`.
  - Link: `<shopLinkBase>/#/verify-email?token=<token>`.

**User invitations** (mounted at `/api/user-invitations`):

| Method + path | Auth | Body | 200 `data` | Refusal `code`s |
| --- | --- | --- | --- | --- |
| `GET /` | JWT + `admin` | none | `{ emailConfigured, invitations: [UserInvitationView] }` | none |
| `POST /` | JWT + `admin` | `createUserInvitationSchema` | `{ invitation }` | `EMAIL_NOT_CONFIGURED`, `EMAIL_TAKEN_IN_SHOP` (an active user here already has it), `RATE_LIMITED` (20 per day per shop, `countCreatedSince`) |
| `POST /:id/revoke` | JWT + `admin` | none | `{ invitation }` | `USER_INVITATION_USED` |
| `POST /:id/resend` | JWT + `admin` | none | `{ invitation }` (a **new** invite) | as `POST /` |
| `POST /check` | public | `checkUserInvitationSchema` | `{ email, role, shopName, expiresAt }` | generic |
| `POST /accept` | public | `acceptUserInvitationSchema` | `{ loginUrl }` | generic, `USERNAME_TAKEN` (claim released), `EMAIL_TAKEN_IN_SHOP` (claim released) |

- **`UserInvitationView`:** `{ id, email, role, status, createdAt, expiresAt, usedAt, usedByUserId, revokedAt, emailDelivery }`. `emailDelivery` is read from `EmailOutboxRepository` under `runWithoutTenant`; do not join it, because it lives in a different file in per-tenant mode. The token hash is never included.
- **`POST /:id/resend`:** revokes the old invite if it is pending, then creates a new invite with the same email and role.
- **`POST /accept`:**
  1. `claim(hash, now, now - 10 min)`.
  2. Check the host's shop.
  3. Inside `runWithTenant(invite.tenant_id)`: `usernameExistsInRealm`, then `createUser({ role: invite.role, email: invite.email, email_verified_at: now })`.
  4. `finalize`. On any failure, `release`.
- **Audit log:** `logAdminAction`-style entries `user_invitation.create` and `user_invitation.revoke`, and `user.create` with `via: "invite"`.
- **Template `user-invite`:**
  - Subject: "<Shop name> invited you to LiraTek".
  - Variables: `inviteUrl`, `shopName`, `roleText`, `expiresAtText`, `supportEmail`. The shop name is safe to show, because only a shop admin can send this.
  - Idempotency key: `user-invite:<id>`.
  - Link: `<shopLinkBase>/#/join?invite=<token>`.
  - TTL: `USER_INVITE_TTL_HOURS`.

**`backendApi.ts`** (under `[auth-B]`): `listUserEmails`, `setUserEmail(userId, input: SetUserEmailInput)`, `sendUserEmailVerification(userId)`, `verifyUserEmail(input: VerifyUserEmailInput)`, `listUserInvitations`, `createUserInvitation(input: CreateUserInvitationInput)`, `revokeUserInvitation(id)`, `resendUserInvitation(id)`, `checkUserInvitation(input)`, `acceptUserInvitation(input: AcceptUserInvitationInput)`.

### C — Forgot / reset password (LIRA-275), and send reset from Settings (LIRA-276)

**Owns:**

- `backend/src/api/passwordReset.ts` and the core `PasswordResetService` (new file).
- The `password-reset` template.
- New pages `frontend/src/features/auth/pages/ForgotPassword.tsx` (route `/forgot-password`) and `ResetPassword.tsx` (route `/reset-password`).
- The "Forgot password?" link under the `Login.tsx` anchor.

Routes (mounted at `/api/password-reset`):

| Method + path | Auth | Body | 200 `data` | Refusal `code`s |
| --- | --- | --- | --- | --- |
| `POST /forgot` | public; per-IP limiter 5 per hour (real IP, from A) | `forgotPasswordSchema` | `{ message }`, always the same | `SHOP_REQUIRED` (host tenancy off, no `shop`; on www see LIRA-287) |
| `POST /check` | public | `checkResetTokenSchema` | `{ username, shopName }` | generic "This reset link is not valid. Ask for a new one." |
| `POST /reset` | public | `resetPasswordSchema` | `{ loginUrl }` | generic |
| `POST /send/:userId` | JWT + `admin` | none | `{ sent: true }` | `USER_HAS_NO_EMAIL`, `EMAIL_NOT_VERIFIED`, `EMAIL_NOT_CONFIGURED`, `RATE_LIMITED` |

- **`POST /forgot`:**
  - The shop is the host's shop (`resolveTenantHost`, kind `tenant`). Otherwise it is `body.shop`, resolved by slug to an **active** shop.
  - On www with no `shop` (LIRA-287): one reset link per shop the email signs in to (`requestByEmailEveryShop`, at most 10), answered with `PASSWORD_RESET_EVERY_SHOP_MESSAGE`. With host tenancy off (dev, previews, e2e) and no `shop`: 200 `{success:false, code:"SHOP_REQUIRED"}`. An unknown shop returns the generic reply.
  - The reply is always the same message: "If this email belongs to an account in this shop, we've sent a link." Whether the user exists never changes it.
  - **Mail goes only to a VERIFIED email** (`findByEmailInTenant` and `email_verified_at` not null). Recommended, owner to confirm: an unverified address could be a typo that hands over the account.
  - At most 3 per hour per user (`countForUserSince`); requests beyond that are silently not sent.
  - `requested_ip_hash = hashToken(ip)`.
- **`POST /reset`:**
  1. Validate the password with the schema **before** `consume`.
  2. `consume`.
  3. Inside `runWithTenant(row.tenant_id)`: `updatePassword(hashPassword(pw))`, `invalidateForUser`, and revoke all of the user's sessions.
  4. Write an audit log entry.
- **`POST /send/:userId`:** the target must be in the admin's shop.
- **Template `password-reset`:**
  - Variables: `resetUrl`, `username`, `shopName`, `expiresAtText`, `supportEmail`.
  - Idempotency key: `password-reset:<tokenId>`.
  - Link: `<shopLinkBase>/#/reset-password?token=<token>`.
  - TTL: `PASSWORD_RESET_TTL_MINUTES`.

**`backendApi.ts`** (under `[auth-C]`): `forgotPassword(input: ForgotPasswordInput)`, `checkResetToken(input: CheckResetTokenInput)`, `resetPassword(input: ResetPasswordInput)`, `sendPasswordReset(userId)`. B's Settings button calls `sendPasswordReset`.

### D — Continue with Google (LIRA-280; Spec Kit `/speckit-specify --number 280`)

**Owns:**

- `backend/src/api/googleAuth.ts` and the core `GoogleAuthService` (new file; it verifies ID tokens with Google's JWKS).
- The new page `frontend/src/features/auth/pages/GoogleAuth.tsx` (route `/auth/google`, www only).
- The Google button and the `?sso=` effect under the `Login.tsx` anchors.
- "Connect Google" in Settings, as a new component; B owns `UsersManager.tsx`.
- The Google step in `Signup.tsx`, coordinated with A. A owns the request-mode block; D adds a separate `?google=` branch.

**Dormancy:** while `GOOGLE_CLIENT_ID` is unset, every route answers 200 `{success:false, code:"GOOGLE_NOT_CONFIGURED"}`, or redirects with `error=not_configured`, and the button stays hidden.

Routes (mounted at `/api/auth/google`):

| Method + path | Auth | Result |
| --- | --- | --- |
| `GET /status` | public | `{ enabled }` |
| `GET /start?intent=login\|signup&shop=` | public (www) | 302 to Google (auth code + PKCE; `state` and the verifier sit in a signed, httpOnly cookie of about 10 minutes) |
| `POST /link/start` | JWT, any tenant role, own account | `{ url }`, a www start URL carrying a signed link ticket (about 10 minutes) for `{userId, tenantId}` |
| `GET /callback` | public (www) | 302, see below |
| `POST /choose` | public | body `{ ticket, tenantId }`, returns `{ redirectUrl }` |
| `POST /sso-exchange` | public (shop host) | `ssoExchangeSchema` |
| `DELETE /link` | JWT | unlink the current user's Google account |

- **`GET /callback`:** the backend verifies `iss`, `aud`, `exp` and `email_verified`, then redirects as follows.
  - **login, one match** (`findBySubjectAllTenants`): mint `sso_handoff_tokens` (60 s), then go to `https://<slug>.<base>/#/login?sso=<token>`.
  - **login, several matches:** `https://www.<base>/#/auth/google?choose=<signed ticket>`.
  - **login, no match:** `…/#/auth/google?error=no_account`.
  - **signup:** `https://www.<base>/#/signup?google=<signed ticket carrying email + verified-at>`.
    - The page shows the full form with the email locked.
    - `POST /api/auth/signup` gains an alternative proof `googleTicket`, which is A's or D's schema change, coordinated.
    - The shop is provisioned with `contactEmail` and `contactEmailVerifiedAt`.
    - A password is still required.
  - **link:** `identityRepo.link(...)` inside `runWithTenant`, then go to `https://<slug>.<base>/#/settings?google=linked|error`.
- **`POST /sso-exchange`:** `consume` under `runWithoutTenant`. Require host shop == `target_tenant_id`. Then issue the session **exactly** as `POST /api/auth/login` does, with the same response shape and audit entry.
- **No automatic linking by email** (owner decision 3). Sign-in matches only through `user_identities`.
- **Per-tenant DB mode limitation:** `findBySubjectAllTenants` only sees every shop in shared mode. Before Phase D (the database split) goes live, a platform-level `(provider, subject) → (tenant_id, user_id)` index is needed. This is a known follow-up, not part of this work.

**`backendApi.ts`** (under `[auth-D]`): `googleAuthStatus()`, `googleLinkStart()`, `googleChooseShop(input)`, `ssoExchange(input: SsoExchangeInput)`, `googleUnlink()`. The start URL is a plain navigation, not a fetch.

### Ownership summary

| Shared file | A | B | C | D |
| --- | --- | --- | --- | --- |
| `backend/src/api/auth.ts` | `/signup/request`, `/signup-status` | none | none | the `googleTicket` branch of `/signup` (coordinate with A) |
| `server.ts` | none | none | none | none (all routers pre-mounted) |
| `App.tsx` anchors | none | `[auth-B]` | `[auth-C]` | `[auth-D]` |
| `backendApi.ts` | `requestSignupLink` in place | `[auth-B]` | `[auth-C]` | `[auth-D]` |
| `Login.tsx` anchors | none | none | `[auth-C]` | `[auth-D]` (both) |
| `email/templates/index.ts` | none | `[auth-B]` | `[auth-C]` | none |
| core `services/index.ts`, `browser.ts` (end of file) | `[auth-A]` | `[auth-B]` | `[auth-C]` | `[auth-D]` |

---

## LIRA-287 — identifier-first sign-in on www (2026-10-07)

- **www page** (`PlatformSignIn.tsx`): remembered shops (cookie `lt_shops` on `.<base>`, written by the shop page after a password or Google sign-in; slug + name + time only, ≤10, 1 year, Lax, Secure, not httpOnly, validated on read), email → code → "Your shops", Google, "Create your shop". No shop-address field; super admins use the unlinked `#/platform`.
- **Routes** (`backend/src/api/signinCode.ts`, mounted at `/api/auth/signin-code`): `POST /request {email}` → always `SIGNIN_CODE_REQUEST_MESSAGE`; `POST /verify {email, code}` → `{ shops: [{slug, name, username}] }` or `SIGNIN_CODE_INVALID`. Per-IP 10/h and 30/h (`SIGNIN_CODE_*_RATE_LIMIT_MAX`).
- **Core**: `SigninCodeService` + `SigninCodeRepository` (platform table `signin_codes`, v199). Looked up by email; stores `hashToken("<email>:<code>")`; 10-min TTL, 5 wrong tries lock it, a new code burns older ones, 5 codes/email/hour; outbox `signin-code:<id>` in the same transaction. "Who can sign in with this email" is `UserRepository.findSigninAccountsByEmail` (verified, active, non-super-admin user in an active shop) — shared by the code gate, the shops list and the www forgot fan-out. SHARED DB mode only.
- **Google email**: `GoogleAuthService.linkIdentity` sets `users.email` (verified at the link instant) when empty and free in the shop (`setEmailIfAbsent`); v198 backfills earlier links.
- No housekeeping job deletes expired `signin_codes` (nor `sso_handoff_tokens`) yet; `deleteExpiredBefore` exists for one.
