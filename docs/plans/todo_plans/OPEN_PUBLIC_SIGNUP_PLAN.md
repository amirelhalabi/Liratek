# Opening Self-Service Signup to the Public

> **Status**: planned, not started. **Do not remove `SIGNUP_INVITE_CODE` before
> at least item 1 below exists.**
> **Written**: 2026-09-09, after the owner asked whether the invite code could be
> optional.
> Related: `docs/DEPLOYMENT.md` § 5b (signup), § 5c (automatic subdomains).

---

## 1. What the invite code is actually holding back

`POST /api/auth/signup` is **public and unauthenticated**. It is gated only by
`SIGNUP_INVITE_CODE` being set — unset means the route 403s, which is the safe
default. Every success permanently:

| Consumes                                           | Where                  | Recoverable?                               |
| -------------------------------------------------- | ---------------------- | ------------------------------------------ |
| A slug                                             | `tenants` table        | Only by deleting the tenant                |
| A **Cloudflare DNS record**                        | your CF zone           | Yes, but it is third-party quota           |
| A **domain on your Vercel project**                | your Vercel account    | Vercel enforces a per-project domain limit |
| A subscription row                                 | `tenant_subscriptions` | Yes                                        |
| A full config seed                                 | 11 tables              | Yes                                        |
| _(after the per-tenant split)_ a **database file** | the Fly volume         | Disk                                       |

What is already in place: the slug charset + reserved-name blocklist, the whole
provisioning happening in one transaction, and `signupLimiter`.

**Why that is not enough on its own.** `signupLimiter` is **5 per hour per IP**
(`SIGNUP_RATE_LIMIT_MAX`, `backend/src/middleware/rateLimit.ts`). That is a
_rate_ limit, not a total, and it is per-IP — defeated by patience or a handful
of addresses. And signup collects only `contactName` and `contactPhone`, both
**optional and unverified** (`packages/core/src/validators/tenant.ts`), with no
payment step, because the subscription model is deliberately no-trial and
owner-managed. So a fake tenant costs an abuser nothing while consuming quota on
accounts the owner pays for.

The specific bad day: a script exhausts the Vercel per-project domain limit, and
the next _real_ shop cannot be onboarded.

---

## 2. Interim: keep the gate, delete the friction

**Do this first regardless — it is small and it may remove the entire motivation.**

The complaint is not that a gate exists, it is that a shop must be _told a
secret and type it_. `frontend/src/features/auth/pages/Signup.tsx` does not read
the code from the URL (no `useSearchParams`), so today it must be typed.

Make it a shareable link:

```
https://www.liratek.shop/#/signup?code=<invite-code>
```

- Prefill `inviteCode` from the query string; render it read-only (or hidden)
  when supplied, and leave the manual field for anyone without a link.
- HashRouter note: with `#/signup?code=…` the query lives inside the hash, so
  react-router's `useSearchParams` reads it. `?code=…#/signup` would NOT work —
  that lands in `location.search`.
- Onboarding becomes "click this link", and a leaked link is fixed by rotating
  one env var.

Effort: under an hour, including a test that a URL-supplied code submits and a
malformed one still shows the normal error.

---

## 3. The three prerequisites, in dependency order

Each one alone makes public signup defensible. **Item 2 is the one that matters
most**, because it is the only one that stops abuse from reaching third-party
quotas at all.

### 3.1 Cloudflare Turnstile — stop scripted signup

Free, and the zone is already on Cloudflare. Kills the trivially-automated case,
which is the entire realistic threat for a small platform.

- Frontend: Turnstile widget on the signup page; the token goes in the request.
- Backend: verify server-side against Cloudflare's `siteverify` before
  `provisionTenant()` is called. A missing or invalid token is a 403.
- **Off unless configured** — no `TURNSTILE_SECRET_KEY`, no verification, same
  rule as `tenantDomains.ts` and Litestream. A half-configured captcha that
  silently passes everything is worse than none.
- Failing-first test: a signup with no token is refused when the secret IS set,
  and accepted when it is not (so desktop/dev is unaffected).

Effort: half a day. **This is the minimum bar for dropping the invite code.**

### 3.2 Defer DNS + Vercel registration until approved — the important one

Today `provisionTenant()` creates the tenant **and** its hostname in one go. That
couples an unauthenticated public request to writes on the owner's Cloudflare
and Vercel accounts. Split it:

```
signup            → tenant row + config seed + admin user, status = 'pending'
owner approves    → provisionTenantDomain() runs, status = 'active'
   (or payment succeeds, if billing ever lands)
```

- `tenants.status` already has `active | suspended | archived`; this needs a
  `pending` value — which means the CHECK constraint changes, and on SQLite that
  is the 12-step table rebuild on a table that is the FK target of 22 others.
  Non-trivial: budget for it, and see migration v172 for the pattern and the
  `foreign_keys = OFF` bracket the runner already provides.
- A pending tenant must not be able to log in. `AuthService.login` already
  refuses a non-`active` tenant (`denied = tenant is ${status}`), so this falls
  out for free — but prove it with a test rather than assuming.
- The signup response must stop returning `loginUrl` for a pending tenant; it
  should say "awaiting approval" instead of handing out a dead hostname.
- Super-admin UI: a pending queue with approve/reject. Reject should archive,
  not delete — deleting is the 68-table cascade and it is not needed here.

Effort: 2–3 days, mostly the status migration and the admin queue.

**Payoff beyond abuse:** the owner sees who is signing up before their
infrastructure is touched, which is also just good business practice for a paid
product.

### 3.3 A verified contact — make a tenant traceable

Today `contactPhone` is optional and unverified, so there is no way to reach or
identify a signup.

- Add a required `contactEmail` (or phone) to `signupSchema` and the `tenants`
  table — an additive column, so a plain migration, no rebuild.
- Send a verification link/code; approval in 3.2 can require it to be verified.
- This is the one that turns "an anonymous row appeared" into "a person asked
  for an account", and it pairs naturally with the approval queue.

Effort: 1–2 days, plus choosing a mail provider — which is a new external
dependency and the reason this is third rather than first.

---

## 4. Decision gate

Drop `SIGNUP_INVITE_CODE` only when **3.1 is live**, and preferably 3.2 as well.

Acceptance, each with a test that fails first:

- [ ] A signup with no/invalid Turnstile token is refused (when configured)
- [ ] Turnstile unset ⇒ verification skipped, desktop and dev unaffected
- [ ] A newly signed-up tenant is `pending`, and **no DNS record or Vercel
      domain exists for it**
- [ ] A `pending` tenant's admin cannot log in on any host
- [ ] Approval provisions the hostname and flips to `active`
- [ ] The signup response never returns a hostname that does not resolve
- [ ] Rejection archives rather than deletes

Until then the invite code stays, and § 2 makes it painless.

---

## 5. Explicitly out of scope

- **Billing at signup.** The strongest possible gate, but the subscription model
  is deliberately owner-managed with no trial
  (`SUBSCRIPTION_MANAGEMENT_PLAN.md` § 3). Revisit only if that changes.
- **Per-tenant resource quotas.** Worth having eventually; not what stops the
  first abusive script.
