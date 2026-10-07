# Tasks: Email Invites for Sign-up (LIRA-267)

**Input**: Design documents from `specs/267-email-invite-signup/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: These are REQUIRED. Constitution VI and CLAUDE.md rule 17 say every test task must be written first, **run and seen failing**, and only then implemented. Record the real failure in the commit or PR note. Never prove a test by reverting finished code.

**Organization**: Tasks are grouped by user story (spec.md: US1 P1, US2 P2, US3 P3), then the launch stages, then polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: US1, US2 or US3

## Standing rules for every task

- **Core rebuild:** after editing core, rebuild and sync it: `cd packages/core && npm run build && cp -r dist/. ../../node_modules/@liratek/core/dist/`.
- **Repositories:**
  - SQL lives in repositories only (rule 13), and every value uses a `?` placeholder.
  - The repositories for the new tables use `tenantScoped: false`.
  - Every caller wraps them in `runWithoutTenant`.
- **"Now" is a parameter.** It is passed in as a UTC ISO string, never `datetime('now')` (data-model.md "Time format").
- **Logging:** use the module logger, never `console.log`. No `any`.

---

## Phase 1: Setup

- [ ] T001 Check whether Fly allows outbound SMTP. `scripts/fly.mjs` passes arguments straight to flyctl (`shell:false`, adds `--app`), so `yarn api -- ssh console -C "…"` works as written. Spacemail SMTP was the owner's choice; this decides between `smtp` and the `resend` fallback (research R6).
  - From the live machine, run `yarn api -- ssh console -C "node -e \"require('net').connect(465,'<spacemail smtp host>').on('connect',()=>{console.log('OPEN');process.exit(0)}).on('error',e=>{console.log('BLOCKED',e.code);process.exit(1)})\""`.
  - Repeat for port 587.
  - Take the SMTP host from the Spacemail dashboard. Don't guess it.
  - Record the result in `specs/267-email-invite-signup/research.md` under R6.
  - If both ports are blocked, stop and tell the owner. Then T040 switches to `resend`.
- [ ] T002 Add the `nodemailer` dependency and `@types/nodemailer` to `backend/package.json`. Do this only if T001 found a port OPEN; otherwise skip it.
- [X] T003 [P] Add the optional environment variables to `packages/core/src/config/env.ts`, in all three places: the schema (around :87), the `parseEnv` mapping (around :165, values `.trim()`ed) and the destructured export (around :209). Defaults:
  - `EMAIL_TRANSPORT`: `z.enum(["disabled","file","smtp","resend"]).default("disabled")`.
  - `EMAIL_FROM`: default `"LiraTek <mail@liratek.shop>"`.
  - `EMAIL_REPLY_TO`, `EMAIL_FILE_DIR`, `SMTP_HOST`, `SMTP_PORT` (coerced number), `SMTP_USER`, `SMTP_PASS`, `RESEND_API_KEY`, `SIGNUP_INVITE_BASE_URL`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `SIGNUP_SELF_SERVE_DAILY_CAP` (coerced number, default 50).
  - `validateProductionEnv()` (around :241) only warns when `smtp` lacks host, user or pass, or `resend` lacks a key.

---

## Phase 2: Foundational (blocks every story)

- [X] T004 Write the guard test `packages/core/src/db/migrations/__tests__/v195_emailInvites.test.ts` and run it to see it fail. It checks four things after migrating an in-memory database:
  - `tenants.contact_email` exists.
  - A partial unique index rejects two tenants with the same non-NULL `contact_email`, but allows several NULLs.
  - The `signup_invitations` and `email_outbox` tables exist with the columns in data-model.md.
  - `down()` removes all of it.
- [X] T005 Add the migration to `packages/core/src/db/migrations/index.ts`.
  - **Version:** re-read the last entry first. It was v194 `maintenance_job_client_phone` at :13372; use last + 1.
  - **Shape:** use `type: "typescript"` with guarded `up`/`down`, using the `tableExists` and `columnExists` helpers, like v194.
  - **`tenants`:**
    - `ALTER TABLE tenants ADD COLUMN contact_email TEXT DEFAULT NULL`
    - `CREATE UNIQUE INDEX idx_tenants_contact_email ON tenants(contact_email) WHERE contact_email IS NOT NULL`
  - **`signup_invitations`:**
    - `email TEXT NOT NULL`, `shop_name_hint TEXT`, `token_hash TEXT NOT NULL UNIQUE`
    - `source TEXT NOT NULL CHECK (source IN ('admin','self'))`, `invited_by_user_id INTEGER` (nullable; NULL for `self`), `expires_at TEXT NOT NULL`
    - `claimed_at TEXT`, `used_at TEXT`
    - `used_by_tenant_id INTEGER REFERENCES tenants(id)`, `revoked_at TEXT`
    - `email_outbox_id INTEGER REFERENCES email_outbox(id)`
    - `created_at`/`updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`
    - Indexes on `(email, created_at)` and `(source, created_at)`.
  - **`email_outbox`:**
    - `idempotency_key TEXT NOT NULL UNIQUE`, `template TEXT NOT NULL`, `to_email TEXT NOT NULL`, `data_json TEXT NOT NULL`
    - `status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','accepted','failed'))`
    - `attempts INTEGER NOT NULL DEFAULT 0`, `next_attempt_at TEXT NOT NULL`, `give_up_at TEXT NOT NULL`
    - `locked_at TEXT`, `last_error TEXT`, `provider_message_id TEXT`, `sent_at TEXT`
    - `created_at`/`updated_at`
    - Index on `(status, next_attempt_at)`.
  - **Order:** create `email_outbox` before `signup_invitations`, because of the foreign key.
- [X] T006 Mirror T005 in `electron-app/create_db.sql`:
  - Add `contact_email` to the `tenants` block (:8-21), plus the index.
  - Add both new tables.
  - Add the `schema_migrations` seed row (around :2196): change the trailing `;` to `,` and append `(<v>, '<name>');`.
  - Build core, then run `yarn check:schema-equivalence`, which must pass.
- [X] T007 [P] In `packages/core/src/db/tenantSplit.ts`, add `DELETE FROM signup_invitations` and `DELETE FROM email_outbox` to each per-tenant file, next to the `tenant_subscriptions` delete at around :566. Add both tables to the verify counts at around :781. Extend the split's existing test so both tables are empty in a tenant file and kept whole in `platform.db`. Write that test first and see it fail.
- [X] T008 [P] Write the test `packages/core/src/utils/__tests__/crypto.hashToken.test.ts` first and see it fail. Then add to `packages/core/src/utils/crypto.ts`:
  - `generateToken()`: `randomBytes(32).toString("base64url")`.
  - `hashToken(t)`: sha256 hex.
  - `safeEqual(a, b)`: compare with `timingSafeEqual`, padding unequal lengths so the timing doesn't leak the length.
  - Confirm `crypto.ts` is still unreachable from `browser.ts`: the `browserEntryIsNodeFree` guard must stay green.
- [X] T009 [P] Create `packages/core/src/validators/signupInvitation.ts`:
  - `createSignupInvitationSchema`: `{ email: z.string().trim().toLowerCase().email().max(254), shopNameHint: z.string().trim().max(100).optional() }`
  - `checkSignupInviteSchema`: `{ token: z.string().min(1).max(200) }`
  - `requestSignupLinkSchema`: `{ email: z.string().trim().toLowerCase().email().max(254), turnstileToken: z.string().min(1).max(2048) }`
  - Export the inferred input types.
  - Re-export everything from `packages/core/src/validators/index.ts`, which `browser.ts:55` already re-exports. This is a browser-safe module with only zod.
- [X] T010 Make these schema changes in `packages/core/src/validators/tenant.ts`:
  - `createTenantSchema` gets `contactEmail: z.string().trim().toLowerCase().email().max(254).optional()` (FR-013b).
  - `signupSchema` (:51-53) becomes **Stage A**: `inviteCode?: string` and `inviteToken?: string`, with `.superRefine` requiring exactly one of them. The error for both or neither is "Use an invite link or an invite code".
  - **Before landing this, do the rule-23 three-way key diff.** Compare three key sets: the schema, the `Signup.tsx` payload (:90 area), and the `provisionTenant` arguments in `backend/src/api/auth.ts`. Write the diff into the PR notes.
- [X] T011 Thread `contactEmail` through tenant creation:
  - `TenantEntity` and `create()` in `packages/core/src/repositories/TenantRepository.ts` (:360-375 insert).
  - `ProvisionTenantData` (:51-59) in `packages/core/src/services/TenantProvisioningService.ts`.
  - `packages/core/src/services/TenantStorageProvisioner.ts` (:108-131).
  - `backend/src/database/perTenantStorageProvisioner.ts`.
  - **Test first:** provisioning with `contactEmail` stores it lowercased. Provisioning a duplicate throws an error the caller can recognise (`EMAIL_ALREADY_HAS_SHOP`, mapped from SQLite's UNIQUE error on `idx_tenants_contact_email`).
- [X] T012 [P] Write `packages/core/src/repositories/__tests__/EmailOutboxRepository.test.ts` first and see it fail. It uses a real in-memory database through `__LIRATEK_TEST_DB__`. Then create `packages/core/src/repositories/EmailOutboxRepository.ts` (BaseRepository, `tenantScoped: false`) with these methods:
  - `enqueue({ idempotencyKey, template, toEmail, data, now, giveUpAt })`: on a duplicate key it returns the existing row and inserts nothing.
  - `findDue(now, limit)`
  - `claim(id, now)`: `UPDATE … SET status='sending', locked_at=? WHERE id=? AND status='pending'`. Returns `changes === 1`.
  - `markAccepted(id, providerMessageId, now)`
  - `markRetry(id, error, nextAttemptAt, now)`
  - `markFailed(id, error, now)`: `last_error` is cut to 1000 characters.
  - `recoverStuck(now, olderThanMs)`
  - `scrubSecret(id, key)`: removes one key from `data_json`.
  - `findById(id)`
- [X] T013 [P] Write the test `packages/core/src/repositories/__tests__/SignupInvitationRepository.test.ts` first and see it fail. Then create `packages/core/src/repositories/SignupInvitationRepository.ts` (`tenantScoped: false`) with these methods:
  - `create({ email, shopNameHint, tokenHash, invitedByUserId, expiresAt })`
  - `linkOutbox(id, outboxId)`
  - `findByTokenHash(hash)`
  - `claim(hash, now, staleBefore)`: the conditional UPDATE from research R4. Returns the row or null.
  - `finalize(id, tenantId, now)`
  - `release(id)`
  - `revoke(id, now)`
  - `listRecent(limit)`: joins `email_outbox` for the email status.
  - `findTenantByContactEmail(email)`
  - `countSelfRequestsByEmailSince(email, sinceIso)` and `countSelfRequestsSince(sinceIso)`. These feed the per-email limit and the daily cap.
  - A pure `deriveStatus(row, now)` helper. Order: revoked, then used, then expired (`expires_at <= now`), then pending.
  - **Tests must cover:**
    - A second `claim` on the same hash returns null.
    - A stale claim (older than 10 minutes) can be claimed again.
    - Expired, used and revoked invites cannot be claimed.
- [X] T014 [P] Create `backend/src/email/EmailTransport.ts`:
  - `interface EmailTransport { name; send(msg: { to; from; replyTo?; subject; html; text }): Promise<{ providerMessageId: string | null }> }`
  - Classes `TransientEmailError` and `PermanentEmailError`.
- [X] T015 [P] Create `backend/src/email/transports/fake.ts`, which records sent messages in memory and can be scripted to throw. Create `backend/src/email/transports/disabled.ts`, which throws `PermanentEmailError("email not configured")`.
- [X] T016 [P] Write the test first, then create `backend/src/email/transports/file.ts`. It writes `<template>-<outboxId>.html`, `.txt` and `.json` (subject, to, from) into `EMAIL_FILE_DIR` and returns `providerMessageId: "file:<path>"`.
- [X] T017 Create `backend/src/email/createTransport.ts`, which picks the transport from `EMAIL_TRANSPORT` and exports `isEmailConfigured()` (true when the transport is not `disabled`). Selecting `smtp` or `resend` before T040 lands throws at boot with a clear message.
- [X] T018 [P] Write `backend/src/email/__tests__/renderTemplate.test.ts` first and see it fail. Then create `backend/src/email/renderTemplate.ts`:
  - `render(template, vars)` → `{ subject, html, text }`.
  - Every `{{var}}` in the HTML is HTML-escaped, including `"` and `'`, so values are safe inside attributes.
  - Text output is not escaped.
  - An unknown or missing variable throws.
  - A block wrapped in `{{#if var}}…{{/if}}` is shown only when the variable is non-empty. That is the only control structure.

**Checkpoint:** migration, repositories, crypto, validators, transports and renderer are all green, and `yarn check:schema-equivalence` and `yarn check:tenant-scoping` pass.

---

## Phase 3: User Story 1 — the owner invites a shop, and the person signs up (P1) 🎯 MVP

**Goal:** an invite email reaches the person, the link opens a sign-up form with the email locked, and the shop is created with `contact_email`.

**Independent test:** quickstart §1, steps 1–6, using `EMAIL_TRANSPORT=file`.

### Tests for US1 (write first, see them fail)

- [X] T019 [P] [US1] Write `packages/core/src/services/__tests__/SignupInvitationService.test.ts`. Use mocked repositories and a fixed clock. It covers:
  - `create` writes the invite and the outbox row in one transaction; if the outbox insert throws, no invite row exists.
  - `create` refuses with `EMAIL_ALREADY_HAS_SHOP` when `findTenantByContactEmail` finds a shop.
  - `create` refuses with `EMAIL_NOT_CONFIGURED` when email is not configured.
  - `expiresAt` is now + 72 hours.
  - The outbox `data.inviteUrl` is `${base}/signup?invite=<token>`, and the stored `token_hash` equals `hashToken(token)`.
  - `consume` follows claim → provision → finalize. A provisioning error releases the claim and rethrows.
  - **Crash case (FR-010):** a stale claim is reused, provisioning throws `EMAIL_ALREADY_HAS_SHOP`, and a shop with `contact_email = invite.email` exists. Then the invite is finalized as used with that shop's id, not released, and the generic refusal is returned. No second shop is created.
  - The outbox row's `giveUpAt` equals the invite's `expiresAt`.
- [X] T020 [P] [US1] Write `backend/src/api/__tests__/signupInvitations.api.test.ts`, using the supertest pattern from `signup.api.test.ts`. It covers:
  - `POST /api/admin/signup-invitations` returns 401/403 for anyone who is not super-admin.
  - It returns 201 with no token anywhere in the body.
  - It returns 409 `EMAIL_NOT_CONFIGURED`, and 409 `EMAIL_ALREADY_HAS_SHOP` with the slug.
- [X] T021 [P] [US1] Extend `backend/src/api/__tests__/signup.api.test.ts`. Take payload field names from the schema (rule 24). Cases:
  - `POST /api/auth/signup/invite/check`: valid → 200 `{ email, shopNameHint, expiresAt }`. Unknown, expired, used, revoked or claimed → 200 `success:false` with the same generic message.
  - `POST /api/auth/signup` with `inviteToken`: valid → 201, and `provisionTenant` is called with `contactEmail` equal to the invite's email even when the body carries another `contactEmail`.
  - Invalid token → 403 with the generic message.
  - Provisioning error → 400 and the invite is released.
  - Both fields or neither → 400.
  - `inviteCode` still works (Stage A), compared with `safeEqual`.

### Implementation for US1

- [X] T022 [US1] Create `packages/core/src/services/SignupInvitationService.ts`, with no SQL in it. Methods:
  - `create({ source, email, shopNameHint, invitedByUserId, now, baseUrl, emailConfigured })`: checks the duplicate shop, generates the token, then inside one repository transaction creates the invite, enqueues the outbox row (`signup-invite:<id>`, template `signup-invite`, data `{ inviteUrl, shopNameHint, expiresAtText, supportEmail }`, `giveUpAt` = the invite's `expiresAt`) and links the two.
  - `check(token, now)`
  - `consume(token, now, provisionFn)`: research R4.
  - Export a `getSignupInvitationService()` singleton and export the service from `packages/core/src/index.ts`. Don't export it from `browser.ts`.
- [X] T023 [US1] Create `backend/src/email/templates/layout.ts` and `backend/src/email/templates/signupInvite.ts`. They export HTML and text strings and the subject `You're invited to open your shop on LiraTek`. Layout requirements:
  - Table layout, max width 600px, inline CSS, LiraTek colours.
  - Logo from a stable `https://www.liratek.shop/…` URL. Check it exists in `frontend/public/`.
  - A button, plus the link written out in full as a fallback.
  - The text "This link works once and expires on {{expiresAtText}}".
  - The shop name hint inside `{{#if shopNameHint}}`.
  - Variables follow the template contract in contracts/api.md.
- [X] T024 [US1] Write `backend/src/email/__tests__/outboxWorker.test.ts` (basic: a due row is claimed, rendered, sent once, marked `accepted`, and `inviteUrl` is scrubbed) and see it fail. Then create `backend/src/email/outboxWorker.ts`:
  - `runOutboxOnce(now)`: `findDue(now, 20)`, then for each row claim → render → `transport.send` → `markAccepted` → `scrubSecret(id, "inviteUrl")`.
  - `startEmailOutbox()` and `stopEmailOutbox()`: run once at boot, then `setInterval` every 30 seconds with `.unref()`.
  - Every call runs inside `runWithoutTenant`, with a try/catch that logs. Mirror `backend/src/services/lapseSweep.ts`.
  - Leave retry and backoff for US3, but structure the error branch so US3 only fills it in.
- [X] T025 [US1] In `backend/src/server.ts`, call `startEmailOutbox()` next to `startLapseSweep()` (around :299). On `SIGTERM` (around :308), call `stopEmailOutbox()`.
- [X] T026 [US1] In `backend/src/api/admin.ts`, add `POST /signup-invitations`:
  - `validateRequest(createSignupInvitationSchema)`, then `runWithoutTenant` → `service.create({ invitedByUserId: req.user.userId, now: new Date().toISOString(), baseUrl: SIGNUP_INVITE_BASE_URL ?? \`https://www.${APP_BASE_DOMAIN}\`, emailConfigured: isEmailConfigured() })`.
  - Map the errors to 409. Write an audit entry `signup_invitation.create` with `getAuditService().logAdminAction`.
  - Return 201 with the invitation view shape from contracts/api.md.
- [X] T027 [US1] In `backend/src/api/auth.ts`:
  - Add `POST /signup/invite/check` (with `signupLimiter`).
  - Change `POST /signup` (:666): for `inviteToken`, call `service.consume(token, now, () => provisionTenant({...body, contactEmail: invite.email}))`, with the existing audit, `provisionTenantDomain` and `loginUrl` steps after it. For `inviteCode`, use `safeEqual`.
  - Map `EMAIL_ALREADY_HAS_SHOP` to 400 "This email already has a shop."
  - Extend `GET /signup-status` with `emailInvitesEnabled`.
- [ ] T028 [P] [US1] In `frontend/src/api/backendApi.ts`. This file only: admin functions are not part of `ApiAdapter`/`ElectronApiAdapter`. `adminCreateTenant` lives only in `backendApi.ts` and is imported directly by `useTenants.ts`. Do the same here.
  - Add `adminCreateSignupInvitation(input: z.input<typeof createSignupInvitationSchema>)` and `checkSignupInvite(token)`. Use `assertWebOnly` and `requestJson`, like `adminCreateTenant` (around :7135).
  - Replace the hand-written `SignupInput` (:149-158) with `z.input<typeof signupSchema>` (rule 21).
- [ ] T029 [US1] Write `frontend/src/features/auth/pages/__tests__/Signup.invite.test.tsx` first and see it fail. Its `useApi()`/API mock must return a stable reference (rule 25). It checks:
  - With `?invite=abc`, `checkSignupInvite` is called once.
  - The email is shown read-only and the invite-code field is absent.
  - Submitting sends `inviteToken: "abc"` and no `inviteCode`.
  - An invalid token shows the generic message and no form.
  - Then implement in `frontend/src/features/auth/pages/Signup.tsx`: `useSearchParams`, a check on mount (reading the API through a ref), prefilling the shop name from the hint, the read-only email, and the payload built once (rule 22).
- [ ] T030 [US1] Create `frontend/src/features/admin/hooks/useSignupInvitations.ts`, using react-query in the style of `useTenants.ts` (key `ADMIN_SIGNUP_INVITATION_KEYS`).
  - On the existing super-admin Tenants page `frontend/src/features/admin/pages/Tenants/index.tsx` (spec FR-031), add a **Send invite** button next to **Add shop**. It opens a new `frontend/src/features/admin/components/SendInviteModal.tsx` (email plus optional shop name), which shows the 409 messages inline.
  - No new route and no new nav entry.
  - Write an RTL test first: sending calls the adapter with the schema-derived payload, and the duplicate-shop 409 is shown.
- [ ] T031 [US1] Add the web e2e `frontend/tests/e2e-web/lira-web-039-email-invite.spec.ts`:
  - The super-admin sends an invite to a unique address.
  - The test polls `EMAIL_FILE_DIR` for `signup-invite-*.json`, reads the link from the `.html`, opens it and completes sign-up.
  - It asserts the shop's login URL, and that reopening the link shows the generic message.
  - Match rows by email identity, never by row position (rule 15).
  - Wire `EMAIL_TRANSPORT=file` and `EMAIL_FILE_DIR` into the web e2e backend launch config. Find where `node scripts/run-e2e.mjs web` starts the backend.

**Checkpoint:** US1 works end to end with the `file` transport. This is the MVP.

---

## Phase 4: User Story 2 — manage invites, and email on "Add shop" (P2)

**Goal:** a list showing status and email state, revoke, and an optional email on the admin "Add shop" form.

**Independent test:** spec US2 scenarios 1–4.

- [X] T032 [P] [US2] Extend `signupInvitations.api.test.ts` first. Cases:
  - `GET /api/admin/signup-invitations` returns `emailConfigured` and items with derived `status` and `email.status`, where a pending outbox row shows as `queued`.
  - `POST /:id/revoke`: 200, and calling it twice is harmless; 409 if the invite is already used; 404 for an unknown id.
- [X] T033 [US2] In `SignupInvitationService`, add `list(now)` (map rows to the view shape, `deriveStatus`) and `revoke(id, now)`.
  - In `backend/src/api/admin.ts`, add `GET /signup-invitations` and `POST /signup-invitations/:id/revoke`. Put the static paths before `/:id`. Add the audit entry `signup_invitation.revoke`.
- [ ] T034 [US2] Add `adminListSignupInvitations` and `adminRevokeSignupInvitation` to `frontend/src/api/backendApi.ts`, and wire them into `useSignupInvitations.ts`.
  - On the Tenants page, add an **Invitations** section or tab below or beside the tenants table. It is a table with email, source (Admin or Self), sent, expires, status, and an email-state badge. A failed send shows `lastError` in a tooltip.
  - Add a Revoke action with a confirm step, and an "Email not configured" banner when `emailConfigured` is false.
  - Write the RTL test first.
- [ ] T035 [US2] Admin "Add shop" email (FR-013b):
  - In `backend/src/api/admin.ts`, `POST /tenants` (:100) passes `contactEmail` through and maps a duplicate to 409 `EMAIL_ALREADY_HAS_SHOP`.
  - Add an optional email input to `frontend/src/features/admin/pages/Tenants/components/AddTenantModal.tsx`, typed from `createTenantSchema`.
  - Write tests first, in the existing admin tenants API test and the modal test.
  - Backend half DONE (`POST /tenants` forwards `contactEmail`; duplicate → 409 `EMAIL_ALREADY_HAS_SHOP`, test in `wp5_wp6_admin_tenant.api.test.ts`). Frontend half (modal field + its test) still open, so this task stays unchecked.

---

## Phase 4b: User Story 4 — anyone requests a sign-up link (P1)

**Goal:** a visitor clicks Sign up, enters an email, passes Turnstile, gets the link, and completes sign-up. This reuses the US1 link, email and form.

**Independent test:** spec US4 scenarios 1–6. In web e2e, use Cloudflare's always-pass test keys: site `1x00000000000000000000AA` and secret `1x0000000000000000000000000000000AA`. **Likely, based on Cloudflare's Turnstile docs:** those are the documented dummy keys. Verify them before relying on them.

- [X] T049 [P] [US4] Write tests first in `backend/src/api/__tests__/signupRequest.api.test.ts`, with Turnstile verification mocked through an injectable `verifyTurnstile`. Cases:
  - Self-serve off → 200 `success:false` "not available".
  - Turnstile fails → 200 `success:false` "complete the check", and nothing is queued.
  - Valid → 200 with the generic message, and one invite with `source='self'` plus one outbox row.
  - Address already has a shop → the same generic 200, and nothing is queued.
  - The 4th request in an hour for the same email → generic 200, nothing queued.
  - Daily cap reached → generic 200, nothing queued, and a warning is logged.
  - The 6th request from one IP in an hour → 429 "Too many requests, please try again later", whatever the email.
  - Turnstile `siteverify` times out or errors → 200 `success:false` "Please try again in a few minutes", and nothing is queued.
  - The response body is identical across the valid, has-shop, email-limit and cap cases (FR-028).
- [X] T050 [P] [US4] Write the test first, then create `backend/src/security/turnstile.ts`:
  - `verifyTurnstile(token, ip)` POSTs form data to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response` and `remoteip`, a 5-second timeout and global `fetch`.
  - It returns `true` only when `success === true`. Network errors return `false`, so the check fails closed.
  - `isTurnstileConfigured()` is true when both keys are set.
  - As built: returns a tri-state `"passed" | "rejected" | "unavailable"` instead of a boolean, so the route can give contracts/api.md's two different messages. Both non-passed outcomes still fail closed. Cloudflare rejecting OUR secret (`invalid-input-secret` etc.) counts as `unavailable`, not `rejected`.
- [X] T051 [US4] Add `signupRequestLimiter` to `backend/src/middleware/rateLimit.ts` (5 per hour per IP, following `signupLimiter` at :68). Add `SignupInvitationService.requestSelfServe({ email, now, baseUrl, emailConfigured, dailyCap })`. It returns `{ queued: boolean, reason }`. It checks the existing shop, then the per-email limit (3 per hour), then the daily cap, then calls `create({ source: "self", invitedByUserId: null })`. It contains no SQL.
- [X] T052 [US4] Add `POST /api/auth/signup/request` to `backend/src/api/auth.ts`, following contracts/api.md.
  - The client IP comes from `req.ip`. Confirm Express `trust proxy` is set to match the Vercel → Fly chain already used by the limiters.
  - Log the outcome with `hashToken(email)`, never the plain address.
  - Extend `GET /signup-status` with `selfServeEnabled` and `turnstileSiteKey`.
- [ ] T053 [P] [US4] Update the CSP in `frontend/index.html:13`: add `https://challenges.cloudflare.com` to `script-src`, and add `frame-src https://challenges.cloudflare.com`. Check whether `vercel.json` sets its own CSP header that would override it (it does not today; confirm).
- [ ] T054 [US4] Write `frontend/src/features/auth/pages/__tests__/Signup.request.test.tsx` first, with a stable API mock (rule 25). It checks:
  - Without `?invite=` and with `selfServeEnabled`, the page shows only the email field and the Turnstile widget. Mock the widget as a component that calls `onSuccess("tok")`.
  - Submitting calls `requestSignupLink({ email, turnstileToken: "tok" })` and shows "Check your inbox".
  - With `selfServeEnabled` false, it shows "not available".
  - Then implement it: create `frontend/src/features/auth/components/TurnstileWidget.tsx`, which loads the script once and renders explicitly with the site key from `signup-status`. Update `Signup.tsx` with three modes: invite (US1), request (US4), and the legacy shared code (Stage A only). Add `requestSignupLink` to `backendApi.ts`.
- [ ] T055 [US4] In `frontend/src/features/auth/pages/Login.tsx` (:216-235):
  - Rename the link text from "Create your shop" to **Sign up**.
  - `canSignUp` becomes `selfServeEnabled || enabled` (Stage A). Update the comment block above it.
  - Write the test first. It covers the link text and visibility.
- [ ] T056 [US4] Extend web e2e `lira-web-039-email-invite.spec.ts` with a second test:
  - Run the backend with the Turnstile test keys. Click Sign up on the login page, enter a unique email and submit.
  - Read the link from `EMAIL_FILE_DIR` (match on the email, not file order), complete sign-up, then log in.
  - Assert the shop's contact email.

---

## Phase 5: User Story 3 — reliable, branded, previewable (P3)

**Goal:** retries, no duplicates, crash recovery, escaping, and a local preview.

**Independent test:** spec US3 scenarios 1–5.

- [X] T036 [US3] Extend `outboxWorker.test.ts` first, using the scriptable fake transport and a fixed clock. Cases:
  - In one round, a first transient error followed by success leads to `accepted`, with `attempts = 2`.
  - Two transient errors lead to `pending` with `next_attempt_at = now + 10m`.
  - The next round, once due, makes 2 more attempts.
  - When `now + 10m ≥ give_up_at`, two transient errors lead to `failed`, with `last_error` set.
  - A permanent error leads straight to `failed`.
  - After `failed`, `inviteUrl` is scrubbed.
  - A row stuck in `sending` with `locked_at` older than 10 minutes goes back to `pending` and is sent once.
  - Two `runOutboxOnce` calls on the same tick send once.
  - `last_error` contains no `SMTP_PASS` or `RESEND_API_KEY` value.
- [X] T037 [US3] Implement the retry and recovery branches in `backend/src/email/outboxWorker.ts`:
  - Each round makes up to 2 `send` attempts back to back, with a 2-second pause between them. On two transient failures, set `next_attempt_at = now + 600_000`, or mark `failed` if that reaches `give_up_at` or later. Increment `attempts` on every try.
  - Call `recoverStuck` at the start of each run.
  - Classify errors: `PermanentEmailError` → failed; anything else → transient.
  - Before storing the error text, redact any configured secret value from it.
- [X] T038 [P] [US3] Add a template-escaping test to `renderTemplate.test.ts`: a shop name hint `<script>alert(1)</script>` and an `inviteUrl` containing `"` render as text and as a safe attribute.
- [X] T039 [P] [US3] Create `backend/src/scripts/email-preview.ts` and the `"email:preview": "tsx src/scripts/email-preview.ts"` script in `backend/package.json`.
  - It renders `<name>` with built-in sample data into `os.tmpdir()/liratek-email-preview/<name>.html` and `.txt`, prints the paths, and opens the HTML with `open` on macOS or `xdg-open`, ignoring failures.
  - Sample data includes a hostile shop name, to show the escaping.

---

## Phase 6: Real transport and go-live (Stage A in production)

- [ ] T040 Write a unit test first for SMTP response-code classification. Then create `backend/src/email/transports/smtp.ts` using `nodemailer`:
  - `createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: port === 465, auth })`.
  - Classify errors: `responseCode` 5xx → `PermanentEmailError`; 4xx, network or timeout → transient.
  - `providerMessageId` is `info.messageId`.
  - Register it in `createTransport.ts`.
  - **If T001 found SMTP blocked**, create `backend/src/email/transports/resend.ts` instead: `fetch("https://api.resend.com/emails", { headers: { Authorization, "Idempotency-Key": <outbox idempotency_key> } })`. 4xx other than 429 → permanent.
- [ ] T041 Write the owner's go-live runbook into `docs/DEPLOYMENT.md`, as a new subsection replacing §5b/5c's invite-code guidance after Stage B. It covers:
  - Creating the Spacemail mailbox.
  - The Cloudflare records (MX, SPF, DKIM, DMARC with `p=none`), all DNS only, with the warning not to move the nameservers.
  - `yarn api -- secrets set EMAIL_TRANSPORT=smtp EMAIL_FROM=… SMTP_HOST=… SMTP_PORT=… SMTP_USER=mail@liratek.shop SMTP_PASS=…`.
  - The Gmail "Show original" check.
  - Creating a Turnstile widget in the Cloudflare dashboard for `www.liratek.shop`, then `yarn api -- secrets set TURNSTILE_SITE_KEY=… TURNSTILE_SECRET_KEY=…`.
  - **If email breaks after launch:** create shops with the admin "Add shop" action until it is fixed (spec FR-019).
- [ ] T042 **Owner plus agent, after deploying Stage A.** Invite a real Gmail address and confirm SPF, DKIM and DMARC all show PASS, and that the email lands in the inbox (spec SC-006). Record the result in `specs/267-email-invite-signup/quickstart.md` §5. **This task gates Phase 7.**

---

## Phase 7: Stage B — remove the shared invite code (FR-013, launch)

**Merge only after T042 passes.** A push to `main` deploys.

- [ ] T043 Write the guard tests first and see them fail on Stage A code:
  - `signup.api.test.ts`: a body with `inviteCode` → 400, and a body without `inviteToken` → 400.
  - `Signup.request.test.tsx`: after Stage B, `/signup` without `?invite=` shows the email request form when `selfServeEnabled` is true, and "Sign-up is not available right now" when it is false. No invite-code field ever appears.
- [ ] T044 Delete the shared-code path everywhere:
  - `signupSchema`: `inviteToken` becomes required and `inviteCode` is removed (`packages/core/src/validators/tenant.ts`).
  - The `SIGNUP_INVITE_CODE` variable, in all three places in `packages/core/src/config/env.ts`.
  - The code branch, and the `signup-status.enabled` semantics, in `backend/src/api/auth.ts`.
  - The invite-code field, its state and the legacy mode in `frontend/src/features/auth/pages/Signup.tsx`. After this, `/signup` without `?invite=` is always the request form (US4).
  - The `SIGNUP_INVITE_CODE` mention in `frontend/src/features/auth/pages/Login.tsx` (:217).
  - The obsolete invite-code tests, in `signup.api.test.ts` and `Signup.test.tsx`. Rewrite them into "code path is gone" guards rather than deleting them (rule 24).
  - `.env.deploy.example`, and `docs/DEPLOYMENT.md` §5b/5c (:349-357, :457-482).
  - `docs/OPERATIONS.md:129`.
  - In Login.tsx, `canSignUp` becomes `selfServeEnabled` only, dropping the Stage A `|| enabled`. The **Sign up** link shows exactly when self-serve is on (spec FR-025). Update the T055 test to match.
- [ ] T045 After the Stage B deploy, the owner runs `yarn api -- secrets unset SIGNUP_INVITE_CODE`. Then check quickstart §5 step 5.

---

## Phase 8: Polish and cross-cutting

- [ ] T046 [P] Add release-note lines under `## 🌐 Web app` in `docs/release-notes/UNRELEASED.md`, in shop-owner language, with no ticket ids:
  - **Stage A:** "New shops can sign up on the web app with just their email: click Sign up on the login page, then follow the link we email you."
  - **Stage B:** "Sign-up no longer uses an invite code. Every new shop confirms its email first."
  - Put a "What users will notice:" line in the LIRA-267 entry in `current_sprint.md`. Add that ticket entry if it's missing, and don't touch the unrelated edits already pending in that file.
- [ ] T047 [P] Update the docs:
  - `docs/plans/ongoing_plans/SUBSCRIPTION_MANAGEMENT_PLAN.md`: rename `tenants.email` to `tenants.contact_email`.
  - `docs/plans/ongoing_plans/PLAN_OVERVIEW.md`: the email capability is now provided by LIRA-267.
  - `docs/plans/todo_plans/OPEN_PUBLIC_SIGNUP_PLAN.md` §3.3: done by LIRA-267, and §2's "keep SIGNUP_INVITE_CODE" is superseded.
  - Move `docs/plans/todo_plans/EMAIL_INVITE_SIGNUP_PLAN.md` to `docs/plans/done_plans/` when Stage B ships.
- [ ] T048 Run the quality gates and confirm each suite actually ran (test counts and elapsed time, rule 28):
  - `yarn lint`, `yarn typecheck`
  - `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`
  - The core, backend and frontend test suites
  - `yarn build`
  - `node scripts/build-release-notes.cjs --check`
  - The web e2e, via `node scripts/run-e2e.mjs web` (rebuild better-sqlite3 for the Node ABI first with `yarn rebuild:node`, then `yarn rebuild:native` afterwards)

---

## Dependencies and execution order

```
T001 ─► T002 ─────────────────────────────► T040
T003 ─┐
T004 ─► T005 ─► T006 ─┐
T007, T008, T009 (P) ─┤
T010 ─► T011 ─────────┤
T012, T013 (P) ───────┼─► Phase 2 checkpoint ─► US1 (T019–T031) ─┬─► US2 (T032–T035)
T014–T018 ────────────┘                                          └─► US3 (T036–T039)
US1 + T040 + T041 ─► deploy Stage A ─► T042 ─► Stage B (T043–T045)
T046–T048 last; T046's Stage A line ships with Stage A
```

- **US4** depends on US1 (the link, the email and the sign-up form). **US2, US3 and US4** can then run in parallel.
- **Stage A go-live (Phase 6)** needs US1 and US4. Turnstile keys come from the owner.
- **Within US1:** the tests (T019–T021) come first. Then T022 → T023/T024 → T025–T027 on the backend. T028–T030 on the frontend can start once T009/T010 are built. T031 comes last.

## Parallel examples

- **Phase 2:** T007, T008, T009, T012, T013, T014, T015 and T016 touch separate files, so they can run together.
- **US1:** T019, T020 and T021 (tests) together; then backend T022–T027 alongside frontend T028–T030.
- **US2 and US3:** T032–T035 alongside T036–T039.

## Implementation strategy

1. **MVP:** Phases 1–3 (US1) with the `file` transport. You can try it locally and in web e2e with no mail account.
2. **Add US2** (manage invites) and **US3** (reliability and preview).
3. **Phase 6:** the real SMTP transport, then deploy Stage A, then the owner's DNS and mailbox setup, then the real Gmail check.
4. **Phase 7:** remove the shared code (launch).
5. **Phase 8:** polish. The release note's Stage A line ships together with Stage A.
