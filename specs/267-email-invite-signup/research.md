# Research: Email Invites for Sign-up (LIRA-267)

All findings were verified against the repo on 2026-10-07 unless marked otherwise.

## R1. Where the mail code lives

- **Decision:** a module inside `backend/src/email/`, running in-process, with a durable SQLite outbox.
- **Rationale:**
  - The API is a single Fly machine with a single SQLite writer and very low mail volume.
  - The backend already runs in-process periodic jobs: `startLapseSweep()` and `startSessionSweep()`, started at `backend/src/server.ts:299,304`.
  - Running in-process keeps it Node-only, which rule 29 requires. It must never be reachable from `packages/core/src/browser.ts`.
- **Alternatives considered:**
  - **A separate service, like Hetivo's** `hetivo-back-messenger` (an Azure Function reading from a Service Bus topic). Rejected: it means a second deploy, a queue, and a shared secret, for no gain at this size.
  - **Sending synchronously inside the request.** Rejected: it can't retry, and a provider outage would fail the admin action.

## R2. The outbox pattern and send-once guarantees

- **Decision:** an `email_outbox` table with:
  - a UNIQUE `idempotency_key`;
  - a worker that claims due rows with `UPDATE … SET status='sending' WHERE id=? AND status='pending'` and acts only if `changes === 1`;
  - a stuck-`sending` recovery: a row left in `sending` for more than 10 minutes goes back to `pending`.
- **Retry schedule (owner decision 2026-10-07):** each round makes 2 attempts back to back. If both fail temporarily, the next round starts 10 minutes later. Rounds repeat until `give_up_at`, which is the invite's expiry, 72 hours after creation. A permanent error (HTTP 4xx other than 429, or an SMTP 5xx) goes to `failed` immediately. At most about 432 rounds over 72 hours, and only while the provider is down.
- **Status names:** `accepted` (never `delivered`), because it only means the provider accepted the email.
- **Rationale:** this addresses the three weaknesses found in the Hetivo messenger:
  - it can send the same email twice when a message is redelivered;
  - it swallows send errors without retrying;
  - it calls an email "sent" when it was only accepted.
- **Residual risk:** if the process crashes after the provider accepted the email but before the row is marked `accepted`, the recovery step resends it once. Total prevention needs the provider's own idempotency key.
  - **Likely, based on Resend's docs:** Resend accepts an `Idempotency-Key` header. Verify this before relying on it.
  - SMTP has no such mechanism, so the risk is accepted there.

## R3. The token and the outbox

- **Decision:**
  - Token: `randomBytes(32)` as base64url, sent in the link.
  - Invite row: stores only `sha256(token)`, via a new `hashToken()` in `packages/core/src/utils/crypto.ts`. That file has no sha256 helper today; it only has `hashPassword` and `verifyPassword`.
  - Outbox row: holds the full link in `data_json` until it reaches a final status, then the worker **scrubs** the link out (spec FR-004, amended).
- **Rationale:** a retry has to re-render the email, which needs the link. A hashed token can't produce it.
- **Alternatives considered:**
  - Store the rendered email body. That still holds the secret, and it is larger.
  - Encrypt with a key from the environment. More moving parts for the same exposure window.

## R4. Using the token atomically

The facts:
- `provisionTenant()` runs in its own transaction, in shared mode (`TenantStorageProvisioner.ts:108-131`).
- In per-tenant mode it spans more than one file (`backend/src/database/perTenantStorageProvisioner.ts`).
- So one transaction can't cover both "mark the invite used" and "create the tenant".

**Decision: claim, then provision, then finalize or release.**

1. **Claim:** `UPDATE signup_invitations SET claimed_at=?now WHERE token_hash=? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?now AND (claimed_at IS NULL OR claimed_at < ?now-10min)`. Proceed only if `changes === 1`.
2. **Provision:** `provisionTenant({... contactEmail: invite.email })`.
3. **Finalize:** on success, `UPDATE … SET used_at=?now, used_by_tenant_id=?`.
4. **Release:** if provisioning throws, set `claimed_at = NULL` so the invite can be used again (spec FR-011).
   - **Exception:** if it throws `EMAIL_ALREADY_HAS_SHOP` and the shop holding `invite.email` exists, a previous claim crashed after provisioning. In that case finalize with that shop's id instead of releasing (spec FR-010).

**Rationale:**
- better-sqlite3 calls are synchronous, and the database has a single writer. The conditional UPDATE is therefore atomic, so two sign-ups racing on one token can't both claim it (FR-012).
- A crash between claim and finalize leaves an invite that expires on its own after 10 minutes. No manual cleanup is needed.

## R5. Platform-level tables and tenant scoping

**Findings:**
- `scripts/check-tenant-scoping.mjs` only flags tables listed in its `TENANT_SCOPED_TABLES` allowlist (around :142 and :154). A new table without a `tenant_id` column needs no annotation.
- Platform data goes through the platform database: `runWithoutTenant()` (`tenantContext.ts:181`) together with `tenantDbResolver.ts:49-57`.
- `BaseRepository` accepts `{ tenantScoped: false }`.

**Decisions:**
- **`signup_invitations` has no `tenant_id`.** The tenant created from an invite is stored as `used_by_tenant_id`, which is not a scoping column. As a result, `tenantSplit.ts` `EXPECTED_GLOBAL_TABLES` doesn't need updating.
- **Split leak to fix:** `tenantSplit.ts:556-566` deletes only tenant-scoped tables plus `tenants` and `tenant_subscriptions` from each `tenants/<id>.db`. Without a change, the new platform tables would be copied into every shop's file. Add `DELETE FROM signup_invitations` and `DELETE FROM email_outbox` next to the `tenant_subscriptions` delete, and include both in the verify counts (around :781).
- **Repository access:** both repositories are created with `tenantScoped: false`. Every call goes through `runWithoutTenant`, matching how `admin.ts` already handles the platform.

## R6. Mail transport (owner chose Spacemail SMTP on 2026-10-07)

- **Decision:**
  - Define an `EmailTransport` interface with `send(msg) → { providerMessageId } | throws TransientError | PermanentError`.
  - Build three implementations now:
    - `fake`: in-memory, for unit tests.
    - `file`: writes `.html`/`.txt`/`.json` into `EMAIL_FILE_DIR`. Used for dev, for local preview, and for web e2e, which reads the link from disk.
    - `disabled`: used when nothing is configured; reports "email not configured".
  - Build the real transport last, once the owner picks one:
    - `smtp`: adds the `nodemailer` dependency. **Unverified:** whether Fly allows outbound connections on ports 465/587.
    - `resend`: uses the global `fetch` in Node 20 (`backend/Dockerfile:10,93`), so no new dependency.
- **Owner decision:** `smtp` through Spacemail, using `nodemailer` (a new backend dependency).
  - **First task:** test whether Fly allows outbound connections on 465/587 to the Spacemail host. Use a one-off `yarn api -- ssh console` with `nc -zv`, or open a TLS connection from Node.
  - If those ports are blocked, `resend` (an HTTPS API) is the fallback. It needs no dependency because Node has built-in `fetch`.
- **Rationale:** everything except the final send can be built and tested before the real transport exists.

## R7. Templates

- **Decision:**
  - Files: `backend/src/email/templates/<name>.html`, `<name>.txt`, and `layout.html`.
  - Renderer: a small `{{var}}` replacer that HTML-escapes every value in the `.html` output. The `.txt` output is not escaped. `{{{var}}}` is not supported.
  - An unknown variable makes rendering throw, both in tests and at enqueue time.
  - Layout: table-based, with inline CSS, in LiraTek colours. The logo comes from a stable HTTPS URL on `www.liratek.shop`.
  - Preview: `yarn workspace @liratek/backend email:preview <name>` renders sample data into the scratch directory and opens it.
- **Packaging:** the files must ship in the build. Backend builds with plain `tsc`, which doesn't copy `.html` files. Either copy them in the build script, or store the templates as `.ts` modules that export strings.
  - **Decision: `.ts` modules.** `signupInvite.html.ts` exports a string. This avoids a copy step and keeps git diffs readable.
- **Alternatives considered:**
  - MJML or React Email: heavy dependencies for 1–2 templates.
  - SendGrid-hosted templates, as Hetivo does: invisible to git.

## R8. Configuration

All new variables are optional and go in all three places in `packages/core/src/config/env.ts`: the schema around :87, the `parseEnv` mapping around :165, and the destructured export around :209.

| Variable | Meaning |
| --- | --- |
| `EMAIL_TRANSPORT` | `disabled` (default), `file`, `smtp` or `resend` |
| `EMAIL_FROM` | Default `LiraTek <mail@liratek.shop>` |
| `EMAIL_REPLY_TO` | Optional |
| `EMAIL_FILE_DIR` | Used by the `file` transport |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Used by `smtp` |
| `RESEND_API_KEY` | Used by `resend` |
| `SIGNUP_INVITE_BASE_URL` | Defaults to `https://www.${APP_BASE_DOMAIN}` |

`validateProductionEnv()` warns, rather than fails, when `smtp` or `resend` is selected but a required credential is missing.

## R10. Self-serve abuse protection (owner chose rate limits plus Turnstile on 2026-10-07)

- **Turnstile:**
  - The widget is loaded from `https://challenges.cloudflare.com/turnstile/v0/api.js`. Verification is server-side via `siteverify`, using global `fetch` with no new dependency.
  - **The frontend CSP must change.** `frontend/index.html:13` currently allows `script-src 'self'` and has no `frame-src`. Add `https://challenges.cloudflare.com` to `script-src`, and add `frame-src https://challenges.cloudflare.com`. Without this the widget is silently blocked.
  - The site key is served by `/api/auth/signup-status`, so the configuration lives in one place (backend env) rather than in a Vercel build variable.
- **Limits:**
  - **Per IP:** a new `signupRequestLimiter` in `backend/src/middleware/rateLimit.ts`, 5 per hour, with the same in-memory `express-rate-limit` store as the other limiters. The in-memory store is fine because there is exactly one machine.
  - **Per email:** 3 per hour, counted from `signup_invitations` where `source='self'`.
  - **Daily cap:** 50 per day by default (`SIGNUP_SELF_SERVE_DAILY_CAP`), counted from `signup_invitations` where `source='self'` over the last 24 hours.
  - **Rationale:** the email limits live in the database, so they survive a restart.
- **No enumeration:** after Turnstile passes, the response is the same in every case (FR-028).
- **Alternatives considered:** owner approval of each shop. Rejected by the owner for now; `OPEN_PUBLIC_SIGNUP_PLAN.md` §3.2 keeps it as a later option.

## R9. Desktop and transport scope

- **Decision:** the feature is web-only. It is recorded as an exception in the plan's Complexity Tracking.
- **Why:** the desktop app has no sign-up and no super-admin. The admin API calls are `assertWebOnly()`, which is the existing pattern in `backendApi.ts` around :7124.
