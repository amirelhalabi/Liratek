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
