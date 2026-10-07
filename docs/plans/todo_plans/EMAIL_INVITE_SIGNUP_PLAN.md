# Email Invites for Sign-up — Plan

**Status:** todo (planned 2026-10-07, not started)
**Proposed ticket:** LIRA-267 (no `specs/267-*` directory exists yet)
**Next step after approval:** `/speckit-specify --number 267 …`. This feature qualifies for Spec Kit because it spans core, backend and frontend and adds a new data model.
**Relates to:**
- `OPEN_PUBLIC_SIGNUP_PLAN.md`: this plan delivers its §3.3, "verified contact".
- `SUBSCRIPTION_MANAGEMENT_PLAN.md`: needs a tenant email for notices.
- `PLAN_OVERVIEW.md`: lists the email capability as unbuilt and blocking both of the plans above.

> **Superseded in detail by `specs/267-email-invite-signup/`.** The owner decided the following on 2026-10-07:
> - Web-only is approved.
> - Spacemail SMTP is the sender.
> - Invite links expire after 72 hours.
> - The **shared invite code is deleted from the code at launch** (not kept as a fallback).
> - One shop per contact email.
> - Emails are in English only.
> - There is no welcome email.
>
> Where this file disagrees with the spec, the spec wins.

---

## 1. Goal

Replace the shared `SIGNUP_INVITE_CODE` with **personal, single-use invite links sent by email** from `mail@liratek.shop`. Each new shop then has a verified email address on file.

**Today, verified 2026-10-07:**
- **The invite code is one shared secret.** It is a single env var, `SIGNUP_INVITE_CODE`:
  - Defined in `packages/core/src/config/env.ts:73`.
  - Checked with a plain `!==` in `backend/src/api/auth.ts:689-698`.
  - There is no table for it and no UI that creates codes.
  - Anyone who learns the code can open any number of shops.
- **No email capability exists.** The repo has no mail-sending code. Neither `tenants` nor `users` has an email column.
- **DNS for `liratek.shop` is on Cloudflare.** The nameservers are `dee` and `thaddeus.ns.cloudflare.com`. The domain has no MX record and no TXT record.

## 2. Decisions

| #   | Decision | Why |
| --- | -------- | --- |
| D1  | **Build mail as a module inside `backend/`, not as a separate messenger service.** | The backend is one Fly machine with one SQLite writer and very low mail volume. A separate service would add a second deploy, a queue and a shared secret, and buy nothing at this size. |
| D2  | **Put a durable outbox table in SQLite, drained by an in-process worker.** | It gives the queue benefits without queue infrastructure. The row is written in the same transaction as the invite, so a crash cannot lose the email. |
| D3  | **Phase 1 is admin-sent invites only. Self-serve "email me a link" comes later and needs Turnstile.** | A public endpoint that emails any address is a spam relay. It could get `liratek.shop` blocklisted before the first real user arrives. |
| D4  | **Keep the email templates in the repo**, as HTML plus a plain-text version, with a local preview command. | They are versioned and reviewed like code, and they work with any mail provider. Hetivo keeps its templates inside SendGrid, so they are invisible to git. |
| D5  | **Add one column, `tenants.contact_email`.** | It is the name `OPEN_PUBLIC_SIGNUP_PLAN` §3.3 already uses. `SUBSCRIPTION_MANAGEMENT_PLAN`, which says `tenants.email`, must be updated to match. |
| D6  | **Web-only feature.** | Sign-up provisions a web tenant. The desktop app has no sign-up, so rule 19's IPC mirror does not apply. |
| D7  | **The provider is open; see §4.** The code depends on an `EmailTransport` interface, with SMTP and Resend implementations. | It lets us start with what we have and switch providers later without rewriting anything. |

## 3. Why Hetivo's messenger is separate, and why that does not carry over

Hetivo source: `~/Documents/Hetivo/hetivo-mono`.

- `apps/hetivo-back-messenger` is a NestJS app that runs as an Azure Function. It sends email only, through SendGrid dynamic templates.
- The main app, `hetivo-back-admin-auth`, never calls the messenger directly. It publishes `{ templateName, to, templateData }` to the Azure Service Bus topic `on-email-send-requested`, and the messenger consumes it from there.
- Each send is logged in a Mongo collection called `emails`.

Hetivo is split this way because it is built as Azure Functions joined by Service Bus. That is a platform choice, not a requirement of sending email.

**Lessons to keep. Each one is an acceptance criterion in §8.**

1. **Hetivo can send the same email twice.** On a redelivery it creates a new pending record. We need an idempotency key on every outbox row.
2. **Hetivo never retries a failed send.** SendGrid errors are caught and dropped. We need to retry temporary failures with backoff.
3. **Hetivo's "sent" only means the provider accepted the email.** Its delivery webhook was never registered. We will name the status `accepted`, not `delivered`.
4. **Hetivo had a DMARC failure** because it sent from a domain that was not set up for that provider. Our From address must be on `liratek.shop`, with SPF and DKIM aligned to that domain.

## 4. Mailbox and provider

### 4.1 Mailbox `mail@liratek.shop` on Spaceship (Spacemail)

This mailbox is for people: reading replies and receiving bounces.

1. Buy Spacemail at spaceship.com. Attach `liratek.shop`, or "use a domain registered elsewhere" if Spaceship does not list it. Pick the smallest plan.
2. Go to **Configure Products → Configure**, enter the mailbox name `mail`, then **Create mailboxes**. Copy the generated password into the password manager.
3. **Do NOT switch the nameservers to Spaceship.** Spaceship offers to set up DNS automatically on its own nameservers. Tenant hostnames are created through the Cloudflare API (`CLOUDFLARE_API_TOKEN`/`ZONE_ID`), so moving DNS would quietly break every new shop's address.
4. Add Spacemail's records by hand in **Cloudflare → liratek.shop → DNS**. Set each one to **DNS only (grey cloud)**.
   - **Assumption (unverified):** the values are `MX @ mx1.spacemail.com` and `MX @ mx2.spacemail.com`, and SPF is `v=spf1 include:spf.spacemail.com ~all`. These come from a search snippet; the Spaceship help page refused automated access.
   - **Copy the exact values from the Spacemail dashboard instead**, including the DKIM TXT record and its selector.
   - Add `_dmarc TXT "v=DMARC1; p=none; rua=mailto:mail@liratek.shop"`.
5. Check the records:
   - `dig MX liratek.shop`
   - `dig TXT liratek.shop`
   - Send a test from webmail to a Gmail address. In Gmail, use **Show original** and confirm SPF, DKIM and DMARC all say PASS.

**Only one SPF record per name.** If a second provider is added, merge its `include:` into the same record. Two SPF records make every email fail SPF.

### 4.2 How the app sends (open decision)

| Option | Pros | Cons |
| ------ | ---- | ---- |
| **A. Spacemail SMTP** with nodemailer, using `mail@` credentials | No new vendor and works right away. | Uses a person's mailbox password. Sending limits are unknown. There are no bounce webhooks or delivery logs. **Unverified:** whether Fly allows outbound 465/587, so test it first. |
| **B. Resend** (HTTP API), From `mail@liratek.shop` | Has a delivery log, bounce and complaint webhooks, a scoped API key and HTTPS only. | One more vendor and a few more DNS records. **Unverified:** the free tier limits, so check them on resend.com before relying on it. |

**Recommendation:** use **A** to get started, behind `EmailTransport`, and move to **B** once mail volume or the need for bounce data justifies it. Switching is one env var plus DNS records.

## 5. Flows

### Phase 1: the platform owner invites a shop

1. On the super-admin page, the owner enters an email address and an optional shop name, then clicks **Send invite**.
2. One transaction does two things:
   - It inserts a `signup_invitations` row holding the token hash, `expires_at` set 72 hours ahead, and the email.
   - It inserts an `email_outbox` row with template `signup-invite`.
3. The worker sends `https://www.liratek.shop/signup?invite=<token>`.
4. When the link is opened, `/signup` calls `GET /api/auth/signup/invite/:token`. If the token is valid, the email is shown locked and pre-filled, and the "Invite code" field is hidden.
5. `POST /api/auth/signup` sends `inviteToken` instead of `inviteCode`. The server does three things:
   - It checks the hash, checks that the token has not expired and has not been used, and compares it in constant time.
   - It provisions the tenant with `contact_email`.
   - It marks the invite as used, inside the same transaction as the tenant.
6. Optionally, send a "welcome" email with the shop's login address.

During the transition, `SIGNUP_INVITE_CODE` stays as a fallback. Each mode is independent: invite links work only when mail is configured, and the shared code works only while the env var is set.

### Phase 2: self-serve (later, gated)

`POST /api/auth/signup/request { email }` sends the same invite email. It needs all three of these first:
- Turnstile, from `OPEN_PUBLIC_SIGNUP_PLAN` §3.1.
- Rate limits per IP and per email address.
- A response that is identical whether or not the email is already known.

## 6. Data model

Take the version number from the last migration in `packages/core/src/db/migrations/index.ts`. Mirror every change in `electron-app/create_db.sql`.

- **`tenants.contact_email TEXT NULL`** is an added column, so no table rebuild is needed.
- **`signup_invitations`** has these columns:
  - `id`, `email`
  - `token_hash` (sha256, UNIQUE)
  - `invited_by_user_id`, `shop_name_hint`
  - `expires_at` (a UTC ISO time)
  - `used_at`, `used_by_tenant_id`, `revoked_at`
  - `created_at`, `updated_at`
- **`email_outbox`** has these columns:
  - `id`
  - `idempotency_key` (UNIQUE)
  - `template`, `to_email`
  - `data_json`, which holds variables only and never a rendered body containing secrets
  - `status`: `pending` | `sending` | `accepted` | `failed`
  - `attempts`, `next_attempt_at`, `last_error`, `provider_message_id`
  - `created_at`, `updated_at`

**Scoping.** Both tables are platform-level and are written before any tenant exists. Mark their queries with the `/* tenant-exempt: <reason> */` annotation that `scripts/check-tenant-scoping.mjs` recognizes. Also decide whether they belong in `EXPECTED_GLOBAL_TABLES` (`packages/core/src/db/tenantSplit.ts:71`). Follow the pattern `TenantRepository` already uses.

**Times.** `expires_at` is compared as an absolute UTC instant, never as a calendar day, so it is not affected by the server's timezone (rule 27).

## 7. Code layout

- **`packages/core/src/repositories/SignupInvitationRepository.ts` and `EmailOutboxRepository.ts`:** all SQL lives here (rule 13).
- **`packages/core/src/validators/`:** gets an `inviteSignupSchema`, and `signupSchema` changes to require exactly one of `inviteCode` or `inviteToken`.
- **`backend/src/email/`:** Node-only. It must never be reachable from `packages/core/src/browser.ts` (rule 29). It contains:
  - `EmailTransport.ts` (the interface), `smtpTransport.ts` and `resendTransport.ts`.
  - `renderTemplate.ts`, which fills `{{var}}` placeholders and HTML-escapes every value, because the shop name is user input.
  - `outboxWorker.ts`, a `setInterval` loop:
    - It claims `pending` rows that are due by setting them to `sending`, then sends them.
    - On a temporary error it uses backoff of 1m, 5m, 30m and 2h, then marks the row `failed`.
    - On a permanent 4xx error it marks the row `failed` straight away.
  - `templates/signup-invite.html`, `templates/signup-invite.txt` and `templates/layout.html`. The HTML uses table layout and inline CSS in LiraTek colours, with no external images except the logo at a stable HTTPS URL.
- **`scripts/email-preview.mjs`** (`yarn email:preview signup-invite`): renders a template with sample data to a local HTML file and opens it.
- **New env vars**, each added in all three places in `env.ts`. Mail stays **off** when they are unset:
  - `EMAIL_TRANSPORT` (`smtp` | `resend`)
  - `EMAIL_FROM` (`LiraTek <mail@liratek.shop>`)
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
  - `RESEND_API_KEY`
- **Backend:** `POST /api/admin/signup-invitations` (super-admin only), `GET /api/auth/signup/invite/:token`, and the extended `POST /api/auth/signup`.
- **Frontend:** a super-admin invite form and list (pending, used, expired, with a revoke action), and `Signup.tsx` reading `?invite=`.

## 8. Acceptance

Each criterion gets a test that is shown to fail first (rule 17).

- [ ] With mail env vars unset, nothing is sent and both the invite form and the endpoint say "email not configured".
- [ ] Creating an invite writes the invite row and the outbox row in one transaction. If either insert fails, neither row exists.
- [ ] A redelivered or crashed-and-restarted worker does not send twice, thanks to the idempotency key and the `sending` claim.
- [ ] A temporary send failure is retried with backoff. After the last retry the row is `failed` and `last_error` is set.
- [ ] Expired, used, revoked and unknown tokens are all refused, with the same response for each.
- [ ] Using a token marks it used. A second sign-up with the same token is refused.
- [ ] The new tenant has `contact_email` set to the invite's email.
- [ ] Template variables are HTML-escaped. A shop name of `<script>` arrives as text.
- [ ] `browserEntryIsNodeFree` and `check:tenant-scoping` pass.
- [ ] The DNS check in §4.1 step 5 shows SPF, DKIM and DMARC PASS on a real Gmail message.

## 9. Out of scope

- Password-reset emails. They reuse this module later, but need a `users.email` column first.
- Delivery webhooks and bounce handling. These only become possible with option B.
- Arabic and French templates. The layout allows a `-ar` variant later.
- Phase 2 self-serve, until Turnstile is live.

## 10. Effort

**Likely, based on similar scoped work in this repo:** about 3–4 days for Phase 1. That covers the migration, two repositories, the transport and worker, the template, the endpoints, the two frontend screens and the tests. DNS and mailbox setup take about 1 hour of the owner's time.
