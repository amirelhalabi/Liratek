# Desktop licensing — what exists, what's dangerous, and what to build

> **Status: PASS 2 — research complete, recommendations made.**
> Written 2026-09-10 after the owner asked how desktop licence keys should
> work, noting it is their first time linking a product to a licence key.
> Pass 1 inventoried the code; pass 2 researched how comparable products
> handle offline-tolerant licensing and answered the open questions.
>
> Companions: `MULTI_TENANT_IMPLEMENTATION_PLAN.md`,
> `electron-app/licenseSync.ts`, `backend/src/middleware/requireWritableSubscription.ts`.

---

## 0. Read this first: most of it is already built

The ask was "generate licences, see them, revoke them, decide where the key
lives, re-check periodically". Nearly all of that exists. Rebuilding it would
be the expensive mistake.

| Asked for | Status | Where |
| --- | --- | --- |
| Generate a licence key | **Built** | `POST /api/admin/subscriptions/:tenantId/license-key` → `lsk_` + 16 random bytes, audited (`backend/src/api/admin.ts:545`) |
| Issue it from the UI | **Built** | `PlanModal.tsx` |
| Store it against a tenant | **Built** | `tenant_subscriptions.license_key`, PARTIAL UNIQUE so two shops can never share one |
| Desktop presents it | **Built** | `GET /api/subscription/by-key` |
| Periodic re-check | **Built** | `licenseSync.ts` — boot, then every 4 hours |
| One entitlement implementation | **Built** | Sync writes the local row; all gates read it via the same `SubscriptionService` the web uses (rules 13/19) |
| Per-module entitlement | **Built** | `entitled_modules` JSON; NULL = all |
| Lapse handling | **Built** | `active → grace → read_only`, hourly `runLapseSweep()` |
| Revoke a key | **Route exists** | `PATCH /api/admin/subscriptions/:tenantId` with `licenseKey: null` — but see §1 and §3.5 |
| Licences overview | **Partial** | `GET /api/admin/subscriptions` lists them; no last-check-in, no machine count |

---

## 1. 🔴 URGENT — `read_only` stops the till selling, today

Everything else in this document is a design discussion. This is a live
hazard, already deployed, and it should be fixed before any licensing work.

`requireWritableSubscription` is mounted **app-wide**
(`backend/src/server.ts:117`) and blocks **every** write method when a
subscription reaches `read_only`. The exemption list is the whole of it:

```js
const ALWAYS_WRITABLE = [
  "/api/auth/login", "/api/auth/logout", "/api/auth/signup",
  "/api/auth/signup-status", "/api/subscription", "/api/admin",
];
```

**The sell path is not on that list.** So a lapsed tenant cannot `POST` a
sale, a payment, a session close, or anything else. The shop can log in and
look at yesterday's numbers, and that is all. For a point-of-sale system this
is the catastrophic failure the owner named — arriving not from an attack or
an outage, but from an invoice being late.

The industry answer is unanimous and none of it looks like this. Microsoft 365
past its 30-day window drops to "view and print"; JetBrains reverted to
*"you will no longer be locked out… you'll retain access with the free feature
set"*; ICONICS keeps running "as previously licensed". Every one of them keeps
the primary job working and removes the periphery.

**Recommendation.** Invert the allowlist into a *denylist*. The sell path —
sales, payments, drawers, sessions, receipts, closing — is **never** gated by
subscription state. What degrades is: reports and exports, new user creation,
new device enrolment, module changes, settings, bulk import, backup config.
A shop that hasn't paid should find the software annoying and diminished, not
unable to trade.

Worth noting the middleware is otherwise careful — it already fails open when
the subscription lookup itself throws ("A failed lookup must not stop a shop
trading"). The instinct was right; the allowlist just doesn't reach far
enough.

---

## 2. The enforcement posture

`licenseSync.ts` fails open on everything: no key, no network, 404, 500,
timeout, bad JSON. The consequence, stated plainly: **a desktop install with
no key, or a revoked one, is fully functional as long as it never reaches the
server.** Unplugging the network is a complete bypass.

That is closer to right than wrong, and the research supports keeping it —
with one distinction the current code does not make.

**Keep failing open on "I could not reach the server."** Keygen's own
integration guidance calls immediate denial *"not recommended unless your
product relies on an active internet connection."* A till does not.

**Act only on "the server said something"** — an authenticated, signed
statement. Today a 404 (unknown key) and a timeout are treated identically;
they are completely different facts and only one of them is evidence.

This one change converts the question from *"can I reach the server?"* — the
wrong question in Lebanon — into *"do I hold a valid statement?"*, which is
answerable on a dead link.

---

## 3. Decisions

### 3.1 Grace window — **30 days minimum, 45–60 defensible** ✅ decided

Convergent across unrelated vendors: Microsoft 365 (30 days, then reduced
functionality), Autodesk (30), ICONICS (30), Citrix NetScaler (30), and
Keygen's own recommendation ("e.g. 30 days or 5 additional product usages").

**Ignore Sentinel's "1–2 days"** — that is grace for a floating seat on a LAN
licence server, a different failure mode from subscription revalidation over
the internet. Anchoring on it would be a serious misread.

Given the owner's stated economics — a month unpaid is cheaper than a lost
sale — the longer end is justified. Microsoft ships a **180-day** extended
mode precisely for "devices that go offline for an extended period", so
nothing in the evidence argues against generosity here.

Copy the countdown UX, which is universal: a visible in-app indicator from day
one, escalating near the end (Keygen fires webhooks at 3/2/1 days; M365 warns
at 15 remaining). Silent degradation is a support call.

### 3.2 Signed licence blob, not an opaque key ✅ decided

Replace `lsk_…` + liveness check with an **Ed25519-signed licence document**:
`{tenantId, status, entitled_modules, issued, expiry, ttl, nonce}`, signed
server-side, verified in the desktop app against a pinned 32-byte public key.

Why it is the right shape here:

- It works on a dead link — the whole point for a Lebanese shop.
- The client can verify *authenticity* offline; only *expiry* needs a clock.
- Ed25519 is Keygen's "overall recommended scheme"; the public key is 32 bytes
  and ships in the binary.

Verification rules to implement (Keygen's, and they are sound): signature
valid, **`issued` not in the future** (rollback signal), `expiry` not past.

The trade-off is real and must be accepted rather than engineered around: a
signed blob **cannot be revoked before it expires** (§3.5).

### 3.3 Where the key lives — **move it, and encrypt it** ✅ decided

Currently `settings.license_key`, in the shop's own unencrypted SQLite
(`~/Documents/LiraTek/liratek.db`; SQLCipher logs `applied: false`).

Two concrete problems, the second worse than the first:

1. The customer can read and edit it.
2. **It travels with a backup.** Restore onto a second machine and the licence
   goes with it — today that is an unlimited, undetectable clone.

Move it to `app.getPath("userData")`, outside the shop's data directory, and
encrypt with `safeStorage` — already used for the session file
(`electron-app/session.ts`), OS-keychain-backed, and enough to defeat casual
copying. Combined with §3.2, what is stored becomes a signed blob rather than
a secret, so the bar is "don't let it silently ride along with a restore",
which this clears.

### 3.4 Machine binding — **don't hard-lock; count seats** ✅ decided

Hard node-locking's support burden is documented everywhere and its
false-positive rate is documented **nowhere** — that combination is itself the
warning.

Documented brittleness: Windows `MachineGuid` is generated at OS install, so
**cloned or restored machines collide** (plausible in a shop chain imaging one
PC). Docking stations change MAC — Dell ships a BIOS pass-through feature
because of it. Wyday draws the practical line: reformats and disk swaps are
survivable, motherboard and CPU changes are not.

Recommendation, cheapest first:

1. **Detection before enforcement.** Record machine fingerprints seen per key
   and show the count in the admin UI. Zero lockout risk, and it tells you
   whether cloning is even a real problem for your customers before you spend
   anything defending against it.
2. If enforcement is needed later: a **seat count** with self-service release,
   the way M365 auto-releases the least-recently-used device (5 desktops), not
   a hard bind. If you must fingerprint, use N-of-M scoring — Keygen's
   `MATCH_TWO`/`MATCH_MOST`, or Cryptlex's Fuzzy-by-default — never
   `MATCH_ALL` on volatile components.

### 3.5 Revocation — **TTL is your revocation SLA** ✅ decided

Unanimous across every vendor that addresses it: a revoked licence cannot
reach an offline machine. Cryptlex: *"a machine with no connectivity… never
receives the change at all."* Keygen warns that a `null` TTL is "perpetual and
**irrevocable**". Notably, **no mainstream licensing SDK implements a CRL** —
they all revoke by not renewing.

So: pick a TTL you can live with. 30 days is the standard default; 7–14
tightens the window at the cost of more revalidation churn. Then accept that a
refunded tenant keeps working until it expires.

Do add an explicit `revoked` status that the server returns **when reachable**
and the client honours immediately — an authenticated "revoked" is the one
signal that should act at once. It should still *degrade* per §1, not lock.

Worth stealing Cryptlex's distinction: **suspend** self-heals on next sync;
**revoke** is permanent and needs re-activation. Refunds and chargebacks are
the revoke case.

### 3.6 Clock tampering — **24h tolerance, UTC, freeze don't deny** ✅ decided

Four unrelated vendors converged on ~24 hours: Sentinel RMS (86,400s default),
Sentinel LDK V-Clock, FlexNet ("clock surfing", >24h future), LM-X (24h, and
it ships a `LmxResetSystemClock` tool *specifically to clear false positives*).

Implement: persist the maximum timestamp ever seen — from the server's signed
`issued`, **not** the local clock — and compare **in UTC only** (LicenseSpring's
detail; makes timezone changes harmless).

**On a backwards jump, freeze the grace countdown and nag. Never deny.** The
false-positive causes are mundane and common: a dead CMOS battery on a machine
that sat off for weeks, a shop PC that never NTP-syncs, a VM. Vendors from
LUSAS to Arm ship canned support articles because it happens often enough to
need one. A Lebanese shop with a flat CMOS battery is far likelier than a
determined clock attacker.

Keygen, honestly, on the ceiling here: *"you can't really prevent this attack
vector, because what the offline device says is the time, frankly, is the
time."*

### 3.7 Admin surface — **`last_check_in` is phase 1** ✅ decided

Not recorded anywhere today, and it is the highest-value single field: it
turns a static key store into something that says whether an install is alive,
and it is a prerequisite for §3.4's detection option and §3.6's elapsed-time
logic.

Add: last check-in, machine count, current status, issued date. Keep the key
shown once at issue (current behaviour, and correct).

---

## 4. Build order

| Phase | What | Why here |
| --- | --- | --- |
| **0 🔴** | Narrow `read_only` so it cannot block the sell path (§1) | Live hazard. Independent of everything else. Ship alone |
| **1** | Record `last_check_in` + machine fingerprint per key; surface both in admin | Cheap, useful immediately, unblocks phases 3 and 4 |
| **2** | Ed25519-signed licence blob; move key to `userData` + `safeStorage` | The core change — makes offline verification real |
| **3** | 30-day (or 45–60) grace with visible countdown + escalating warnings | Depends on phase 2's `issued`/`expiry` |
| **4** | Clock-tamper detection: freeze countdown, never deny | Depends on phase 1's timestamps |
| **5** | Seat counting with self-service release — **only if phase 1 shows cloning is real** | Evidence first |

---

## 5. What NOT to build

- **A CRL or revocation list.** No mainstream SDK does it; TTL is the mechanism.
- **Hard machine binding.** Until phase 1 produces evidence of a real problem.
- **TPM / secure monotonic counters.** No mainstream desktop licensing SDK uses
  them; the literature is SGX research and DRM patents, not shipping products.
- **A stronger anti-crack scheme.** Any local check is defeatable — *"all it
  takes is to replace your private keys with theirs, or patch a JMP."* Wyday's
  framing is the right one: *"The point of licensing isn't to stop crackers…
  it's to increase revenue by preventing casual piracy."*
- **A third-party licensing SaaS**, probably. The standard advice is buy, and
  the standard reason is unbudgeted edge cases — but LiraTek already has the
  multi-tenant server, subscription rows, entitlement allowlist and deploy
  pipeline. The marginal work is a signed blob and a verifier. (If you want
  vendor defaults without the bill, **Keygen CE is free to self-host** and its
  licence permits licensing your own product.)

---

## 6. Still needs an owner decision

Nothing above is blocked on these except phase 5, but they shape the model:

- **Priced per shop, per machine, or per seat?** Determines whether §3.4 ever
  becomes enforcement.
- **Can one customer have both desktop and web, sharing one subscription row?**
  Today desktop *is* tenant 1 locally, so a desktop install is a tenant. Whether
  a customer's desktop and web tenants are the same row is undecided and
  affects the schema.
- **Perpetual + support window, or recurring?** Changes what `expiry` means.
- **Trial period, and what happens at the end?**
- **The actual threat**: a customer who stops paying but keeps trading, or
  someone cloning to a second shop? The first is answered by §1 + §3.1; the
  second by §3.3 + §3.4. If it is only the first, phases 4–5 may never be worth
  building.

---

## 7. Evidence quality — the honest gaps

Marked so nobody treats inference as fact later:

- **No quantitative comparison exists** anywhere of the commercial cost of a
  false lockout versus tolerated non-payment. The observation that *every*
  documented disaster is a lockout (Autodesk's AWS outage, Deye remotely
  disabling inverters) is evidence about **what gets written about**, not a
  measured rate.
- **No POS vendor documents its offline licence enforcement.** The POS
  findings are adjacent: Lightspeed's 28-day dunning is billing-side, and
  Square/Shopify cap offline *risk* (24h, per-transaction limits) rather than
  offline *function* — a good pattern to steal, but not direct evidence.
- **No vendor publishes false-positive rates** for fingerprinting or
  clock-tamper detection. Every "it costs support" claim is qualitative, and
  the loudest come from vendors selling tolerant matching.
- **Wyday's shipped defaults are unresolved** — 30/14 and 90/14 both appear in
  their own materials.
- **BSA piracy statistics are contested** and shouldn't anchor an argument in
  either direction.

If the commercial reality turns out to be that many tenants exploit a 30-day
window, §3.1 moves to the tighter end. Nothing found would justify moving §1
or §2.

**Primary sources:** [Keygen validating licenses](https://keygen.sh/docs/validating-licenses/) ·
[Keygen cryptography](https://keygen.sh/docs/api/cryptography/) ·
[M365 licensing & activation](https://learn.microsoft.com/en-us/microsoft-365-apps/licensing-activation/overview-licensing-activation-microsoft-365-apps) ·
[M365 extended offline access](https://learn.microsoft.com/en-us/microsoft-365-apps/licensing-activation/overview-extended-offline-access) ·
[ICONICS grace periods](https://documentation.iconics.com/v10.97.3/Content/Licensing/About-Your-License/grace-periods.htm) ·
[Sentinel RMS time tampering](https://docs.sentinel.thalesgroup.com/softwareandservices/rms/RMSDocumentation/APIREF/Content/APICustomizations/Protection%20Against%20Time%20Tampering.htm) ·
[LM-X system clock check](https://docs.x-formation.com/display/LMX/System+clock+check) ·
[Cryptlex revoking licenses](https://cryptlex.com/docs/license-management/revoking-licenses) ·
[Cryptlex node-locked](https://cryptlex.com/docs/licensing-models/node-locked-licenses) ·
[LicenseSpring hardware ID](https://docs.licensespring.com/sdks/tutorials/best-practices/hardware-id-generation) ·
[JetBrains subscription licensing](https://sales.jetbrains.com/hc/en-gb/articles/206544679-Subscription-based-licensing) ·
[Shopify POS offline payments](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/selling-offline/offline-payments) ·
[Windows duplicate Machine ID](https://learn.microsoft.com/troubleshoot/azure/virtual-machines/windows-activation-duplicate-client-machine-id) ·
[wyday: why LimeLM](https://wyday.com/limelm/features/why/) ·
[Keygen open source](https://keygen.sh/open-source/) ·
[KETIV: Autodesk outage](https://ketiv.com/blog/autodesk-outage/) ·
[Software kill switches](https://www.yeandel.co.uk/22-q3-2026-updates/who-else-has-the-switch.html)
