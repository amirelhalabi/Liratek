# Implementation Plan: Email Invites for Sign-up

**Branch**: `267-email-invite-signup` | **Date**: 2026-10-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/267-email-invite-signup/spec.md`. Design notes are in `docs/plans/done_plans/EMAIL_INVITE_SIGNUP_PLAN.md`.

## Summary

The super-admin enters an email address, and the system sends a personal sign-up link that works once and expires after 72 hours. Opening the link fills in the sign-up form with that email, locked, and the new shop is created with a verified `tenants.contact_email`. The shared `SIGNUP_INVITE_CODE` keeps working independently while this rolls out.

How it works:
- **Sending.** Email is sent by a module inside `backend/src/email/`. It reads a durable SQLite `email_outbox` table, using the same in-process interval pattern as `lapseSweep`. Each email has a unique key so it is never sent twice. Failed sends are retried 4 times with increasing delays, and a send stuck mid-way after a crash is picked up again.
- **The link token.** The token is a random value. The invite stores only its sha256 hash. The token itself sits in the outbox row until the email is accepted or finally fails, and is then erased.
- **Self-serve (owner decision 2026-10-07).** **Sign up** on the login page opens a form that asks only for an email. The form is protected by Cloudflare Turnstile, a per-IP limit (5 per hour), a per-email limit (3 per hour) and a daily cap (50). It emails the same kind of link, and the response is the same whether or not the address already has a shop. The admin **Send invite** button sits on the super-admin Tenants page.
- **Using the link.** The `inviteToken` is used in three steps: the server first marks the invite as claimed, then creates the shop, then marks the invite used. If creating the shop fails, the claim is released. This avoids putting the shop creation and the invite update in one database transaction, which per-tenant mode cannot do.
- **The real sender is Spacemail SMTP**, using `nodemailer`, behind an `EmailTransport` interface. Everything else is tested against the `fake` and `file` transports.
- **Launch removes the shared invite code from the code entirely** (Stage B, contracts/api.md). A shop's contact email is unique, enforced by a partial unique index. The admin "Add shop" form gets an optional email field.

## Technical Context

**Language/Version**: TypeScript in strict mode. Node 20 (`backend/Dockerfile`), ESM backend.

**Primary Dependencies**:
- Already used: Express 4, better-sqlite3 12, zod 3, pino, express-rate-limit, React 19, TanStack Query.
- New: `nodemailer`, for the Spacemail SMTP transport the owner chose. If Fly blocks SMTP ports, `resend` is the fallback; it needs no dependency because it uses the built-in `fetch`.

**Storage**: SQLite, one migration (last migration + 1, currently v195). It adds the `tenants.contact_email` column and two platform tables, `signup_invitations` and `email_outbox`.

**Testing**:
- Jest for core, using a real in-memory database through `__LIRATEK_TEST_DB__`.
- Jest with supertest for the backend.
- Jest with RTL for the frontend.
- Playwright web e2e, with the `file` transport writing emails to disk.

**Target Platform**: The web app only. The backend runs on Fly `liratek-api` (one machine) and the frontend on Vercel.

**Project Type**: Web service plus SPA, inside a monorepo.

**Performance Goals**: Not critical; volume is about 10 invites a day. Worker interval: 30 seconds. Each pass handles at most 20 rows.

**Constraints**:
- Exactly one machine, so one worker. No cross-process locking is needed, but the claim step guards against it anyway.
- No Node built-ins may be reachable from `browser.ts`.

**Scale/Scope**:
- 1 migration
- 2 repositories
- 1 service
- 4 transports
- 1 template
- 4 routes
- 2 frontend screens (admin invites, sign-up with an invite)

## Constitution Check

*GATE: checked before Phase 0 and again after Phase 1 design.*

| Principle | Status | How |
| --- | --- | --- |
| I. One core, two transports | **Exception** | Web-only. See Complexity Tracking. Admin and sign-up calls use the existing `assertWebOnly()` pattern. |
| I. No raw `window.api` | Pass | All calls go through `backendApi.ts`. |
| I. Location-dependent values (rule 27) | **Justified deviation** | Expiry and retry give-up times use the server's clock. See Complexity Tracking. Times are UTC instants, "now" is passed in as a parameter, the email text says "UTC" explicitly, and there is no calendar-day logic. |
| I. Browser leaf (rule 29) | Pass | Transports and the worker live in `backend/`. Core adds only the repositories, validators and `hashToken`; `hashToken` goes in `utils/crypto.ts`, which is already Node-only. **Check during implementation:** `utils/crypto.ts` must not be reachable from `browser.ts`. The guard test enforces this. |
| II. Repositories own SQL | Pass | `SignupInvitationRepository` and `EmailOutboxRepository` are in core. `SignupInvitationService` and the outbox worker contain no SQL. |
| II. No logic in routes | Pass | Routes validate input, check the role, call the service and return the envelope. |
| III. Schemas defined once | Pass | `validators/signupInvitation.ts` is exported from both `index.ts` and `browser.ts`. `SignupInput` is replaced by `z.input<typeof signupSchema>`. |
| III. Three-way key diff (rule 23) | Required | `signupSchema` changes, so diff its keys against `Signup.tsx`'s payload and the handler's `provisionTenant` arguments before landing it. |
| IV. Money integrity | N/A | No money flows. |
| V. Parameterised SQL, tenant scoping | Pass | New tables have no `tenant_id`, so they are outside the `TENANT_SCOPED_TABLES` allowlist. Access goes through `runWithoutTenant`. |
| V. Role checks | Pass | Admin routes sit behind `authenticateJWT` and `requireSuperAdmin`. Public routes use `signupLimiter`. The actor is taken from the JWT. |
| V. `id`/`created_at`/`updated_at`; both schema files plus `down()` | Pass | See data-model.md. |
| VI. Failing-first tests, row identity, schema-derived names, web e2e | Planned | See quickstart.md §3. Each test is written and seen failing before its code. |
| VII. Strict TypeScript, module logger, named exports | Planned | Uses the `logger` from `server.js`, as `lapseSweep` does. |
| Delivery: release note | Required | Add to `UNRELEASED.md` under `## 🌐 Web app` when the invite screen ships. |

**Post-design re-check:** still passing. The only exception is the web-only scope. Two items were added because of design findings:
- The `tenantSplit.ts` cleanup for the new tables (research R5).
- The FR-004 amendment covering the link held in the outbox (research R3).

## Project Structure

### Documentation (this feature)

```text
specs/267-email-invite-signup/
├── spec.md
├── plan.md            # this file
├── research.md        # R1–R9 decisions
├── data-model.md      # migration, entities, state machines
├── quickstart.md      # validation guide
├── contracts/api.md   # routes, schemas, template variables
├── checklists/requirements.md
└── tasks.md           # /speckit-tasks (not yet)
```

### Source Code (repository root)

```text
packages/core/src/
├── db/migrations/index.ts                 # + v195 (tenants.contact_email, signup_invitations, email_outbox)
├── db/tenantSplit.ts                      # + delete the new platform tables from each shop file
├── config/env.ts                          # + EMAIL_* / SMTP_* / RESEND_API_KEY / SIGNUP_INVITE_BASE_URL
├── utils/crypto.ts                        # + hashToken(), constant-time compare helper
├── validators/signupInvitation.ts         # new: createSignupInvitationSchema, checkInviteSchema
├── validators/tenant.ts                   # signupSchema: exactly one of inviteCode | inviteToken; createTenant gets contactEmail
├── repositories/SignupInvitationRepository.ts   # new (tenantScoped: false)
├── repositories/EmailOutboxRepository.ts        # new (tenantScoped: false)
├── repositories/TenantRepository.ts             # + contact_email in create / entity
├── services/SignupInvitationService.ts          # new: create (invite + outbox in one transaction), revoke, list, claim/finalize/release
├── services/TenantProvisioningService.ts        # + contactEmail passthrough
├── services/TenantStorageProvisioner.ts         # + contactEmail passthrough
├── index.ts / browser.ts                        # export validators (browser: schemas + types only)
electron-app/create_db.sql                       # mirror schema + schema_migrations seed row

backend/src/
├── email/
│   ├── EmailTransport.ts            # interface + TransientEmailError / PermanentEmailError
│   ├── transports/{fake,file,disabled,smtp,resend}.ts   # smtp/resend land after the owner decides
│   ├── createTransport.ts           # chosen by EMAIL_TRANSPORT
│   ├── renderTemplate.ts            # {{var}} with HTML escaping; throws on an unknown variable
│   ├── templates/{layout,signupInvite}.ts   # HTML + text as TS string modules
│   ├── outboxWorker.ts              # startEmailOutbox()/stopEmailOutbox()/runOutboxOnce()
│   └── __tests__/
├── api/admin.ts                     # + GET/POST /signup-invitations, POST /:id/revoke
├── api/auth.ts                      # + POST /signup/invite/check; /signup token path; constant-time code compare
├── server.ts                        # + startEmailOutbox() next to startLapseSweep()
├── database/perTenantStorageProvisioner.ts      # + contactEmail passthrough
└── scripts/email-preview.ts         # yarn workspace @liratek/backend email:preview <name>

frontend/src/
├── api/backendApi.ts                # + adminList/Create/RevokeSignupInvitation, checkSignupInvite; signup typed from schema
├── features/admin/pages/Tenants/index.tsx   # + "Send invite" button and Invitations section (FR-031)
├── features/admin/components/SendInviteModal.tsx
├── features/auth/components/TurnstileWidget.tsx
├── features/auth/pages/Login.tsx    # "Create your shop" → "Sign up"; shown when self-serve is on
├── features/admin/hooks/useSignupInvitations.ts
├── features/auth/pages/Signup.tsx   # read ?invite=, check it, lock email, hide code field
frontend/tests/e2e-web/lira-web-039-email-invite.spec.ts
docs/release-notes/UNRELEASED.md     # Web app line
```

**Structure Decision**: This uses the existing monorepo layers. SQL and business rules go in `packages/core`. Transport, worker, templates and routes go in `backend`. UI goes in `frontend`. No new package is created.

## Implementation order

1. **Core data:** the migration and `create_db.sql`, repositories, `hashToken`, validators, and the `contactEmail` passthrough. Then core tests, and `check:schema-equivalence`.
2. **Email module:** the transport interface, the fake/file/disabled transports, the renderer, the template, the worker, and the preview script. Then their tests.
3. **Backend routes:** the admin routes and the auth changes. Then API tests. Then start the worker in `server.ts`.
4. **Frontend:** the adapter functions, Send invite and the Invitations section on the Tenants page, the Signup `?invite=` handling. Then RTL tests.
4b. **Self-serve (US4):** Turnstile verification, the request limiter, the request route, the CSP change, the Signup request mode, and the Login "Sign up" link. Then web e2e.
5. **Web e2e** with the `file` transport. Add the release note. Update `SUBSCRIPTION_MANAGEMENT_PLAN.md` to use the `contact_email` name, and point `PLAN_OVERVIEW.md` at this spec.
0. **First, before any build work:** test whether Fly allows outbound SMTP (research R6). The result decides between `smtp` and the `resend` fallback.
6. **SMTP transport:** add `nodemailer`. The owner sets up the mailbox and DNS. Go live on Stage A and verify a real email (quickstart §5 steps 1–3).
7. **Stage B, launch (FR-013):** delete the shared invite code from the code: `inviteCode`, `SIGNUP_INVITE_CODE`, the Signup field and the related tests; update `docs/DEPLOYMENT.md` §5b/5c. Merge only after step 6 is verified. Add a release note line. After the deploy, unset the Fly secret.

## Complexity Tracking

| Exception | Why Needed | Simpler Alternative Rejected Because |
| --- | --- | --- |
| Web-only, no IPC mirror (Constitution I) | Sign-up provisions web tenants, and super-admin exists only on web. The desktop app has no sign-up and no platform admin. **Approved by the owner on 2026-10-07.** | An IPC handler for a screen the desktop app can never show would be dead code that the rule-19 checks must then maintain. |
| The outbox holds the raw invite link until a final status (owner-approved 2026-10-07) | A retry has to re-render the email. | Storing only the hash makes retry impossible. Encrypting with an env key adds key management for the same exposure window. The link is erased on `accepted` or `failed`. |
| HTTP status codes on the new routes (Constitution III says REST returns 200 on failure). Owner-approved 2026-10-07. | The routes are web-only, so there is no IPC response to stay identical to. They follow the existing conventions of `admin.ts` (201/404/409) and `/signup` (201/400/403), and the adapter reads `success` from the body on every status. | Returning 200 for only the new routes would make `admin.ts` inconsistent with itself, while protecting no desktop path. |
| Server clock for invite expiry and retry give-up (Constitution I, rule 27) | Expiry is a security boundary. If the client supplied "now", anyone could extend a link. Rule 27 is about calendar-day logic, and these are absolute UTC times. | Taking "now" from the client defeats the expiry. |
| Claim/finalize/release instead of one transaction | Per-tenant provisioning writes more than one database file. | A single transaction only works in shared mode, and per-tenant mode is the target layout. |
