# LIRA-195 — four web specs have been red for two weeks behind the Profits password

**Priority: HIGH** (owner, 2026-09-20) · **Status: ✅ DONE, verified green 2026-09-20** · **Type: test infrastructure**

> **Correction on close:** this ticket was written as "three web specs". The file has **four**
> tests — the fourth is `(d) role parity: STAFF may record usage`, which fails for the same
> reason and passes with the same fix. Counted from the spec, not from the original triage.
>
> **Verified:** `node scripts/run-e2e.mjs web lira-web-025 --min=0` → **4 passed (34.1s)**,
> floor check clean. The pass is real proof rather than luck: Playwright starts a *fresh*
> backend via `webServer`, and the unlock map is module-level and per-process, so it began
> empty — the only way `/api/profits/summary` can answer 200 in that process is the new
> helper actually running.
>
> **`--min=0` is required.** The web floor is 20 (`DEFAULT_MIN.web`) and a bare filename
> filter is not `-g`, so `hasGrepFilter()` returns false and the floor still applies — without
> it, four passing tests still exit 1 with `FLOOR CHECK FAILED`.

Not a product bug. The app is behaving correctly; the specs were written before the gate existed and
nobody noticed them go red.

## What fails

`frontend/tests/e2e-web/lira-web-025-carrier-line-usage-expense.spec.ts`, all **four** tests
— (a) HTTP-branch usage, (b) envelope parity, (c) void nets to zero, (d) staff role parity:

```
Error: {"success":false,"error":"Profits locked"}
  at snapshot (lira-web-025-carrier-line-usage-expense.spec.ts:174)
```

All three die in the same shared `snapshot()` helper (~line 168), which calls
`GET /api/profits/summary` to read expense totals before and after the action under test. That
endpoint is password-gated and answers `403 {success:false,error:"Profits locked"}` until the caller
unlocks.

## Why, with dates

| | |
| --- | --- |
| Spec last touched | **2026-08-27** (`8845ef2a`, LIRA-145) |
| Profits password shipped | **2026-09-07** (`12c3dd72`, v163) |

The spec predates the gate by eleven days, so it has **never once run against it**. It has been
failing on every web run since, unnoticed, because nobody reads a red suite closely when the
failures look familiar.

## The fix

`backend/src/api/profits.ts` exposes `POST /api/profits/unlock` (admin and staff, rate-limited on
failed attempts, mounted before the gated routes). The spec should unlock once in its setup and
reuse the resulting session, the same way it already handles auth headers.

**Check first whether a shared web-e2e fixture is the right home.** If any other spec reads profits
data it will have the same latent problem, so a helper beside the existing auth setup beats three
copies inside one file. Grep the web suite for `/api/profits` before deciding.

Do **not** weaken the assertion, skip the tests, or route around the gate by reading the numbers from
somewhere else. The point of the spec is that a carrier-line usage expense lands in the expense
totals; that check is the test.

## While you are there

Two other web specs failed in the same 2026-09-15 run and are **not** related to this or to the OMT
work. Worth triaging in the same pass, but they are separate causes — do not fold them into this fix
without confirming why each one fails:

- `lira-web-030-maintenance-parts.spec.ts` — two tests. One waits for the device-name field to clear
  after "Save as Draft" and it never does; the other waits for the checkout modal to close and it
  stays open. Last touched 2026-09-08.
- `app.spec.ts` "Debts: add sale debt and settle" (web-shared) — `waitForLoadState("networkidle")`
  times out, on all three retries. Reads as a genuine flake or a never-idle network.

## Acceptance

`node scripts/run-e2e.mjs web` shows those carrier-line tests passing, with the expense
assertions intact and still asserting real figures.

**Met 2026-09-20.** `node scripts/run-e2e.mjs web lira-web-025 --min=0` → **4 passed (34.1s)**.
No assertion was weakened, no test skipped: the diff is **45 insertions, 0 deletions** in that
one file — an `E2E_PROFITS_PASSWORD` constant plus a local `ensureProfitsUnlocked(page, headers)`
helper, called inside `snapshot()` immediately before the profits GET.

Unlocked per `snapshot()` call rather than once in setup, because the gate's grant is keyed
`${tenantId}:${userId}` and its 15-minute TTL is **fixed from the moment of unlock** —
`grantProfitsUnlock` writes the stamp, `hasProfitsUnlock` only reads it and never refreshes
(`backend/src/middleware/profitsUnlock.ts`). A single `beforeAll` unlock would therefore be a
time-bomb the moment the file runs past 15 minutes, despite the middleware header's word
"rolling".
