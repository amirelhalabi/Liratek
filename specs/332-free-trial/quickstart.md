# Quickstart: verifying the free trial (LIRA-332)

**Standing rules**:

- Ask the owner before running any test suite.
- Run affected test files only (pass explicit paths).
- Never launch Electron or the desktop e2e on the owner's Mac.
- To read a database, use Python's `sqlite3` on a copy (CLAUDE.md gotcha). Never use `better-sqlite3` from a shell.

## 1. Unit: the calendar (no database)

`packages/core/src/utils/__tests__/trialCalendar.test.ts` is table-driven, with an injected `now`. Every row must pass:

| Last day (Beirut) | Offset | Check at (Beirut) | = UTC | Expected |
| --- | --- | --- | --- | --- |
| 2026-07-15 (summer) | +3 | 07-15 00:30 | 07-14 21:30 | trial, daysLeft 1, "last day" |
| 2026-07-15 | +3 | 07-15 02:59 | 07-14 23:59 | trial (the server's date says 07-14) |
| 2026-07-15 | +3 | 07-15 23:30 | 07-15 20:30 | trial |
| 2026-07-15 | +3 | 07-16 00:30 | 07-15 21:30 | **ended** (the server's date still says 07-15) |
| 2026-07-15 | +3 | 07-16 02:59 | 07-15 23:59 | ended |
| 2026-11-01 (winter, spec US4) | +2 | 11-01 00:30 | 10-31 22:30 | trial, last day |
| 2026-11-01 | +2 | 11-01 02:59 | 11-01 00:59 | trial |
| 2026-11-01 | +2 | 11-01 23:30 | 11-01 21:30 | trial |
| 2026-11-01 | +2 | 11-02 00:30 | 11-01 22:30 | **ended** |
| 2026-10-24 (DST ends at 10-25 00:00 → 10-24 23:00) | +3 → +2 | 10-24 23:30, **both** occurrences | 20:30 and 21:30 UTC | trial |
| 2026-10-24 | +2 | 10-25 00:30 | 10-24 22:30 | ended (end instant = **10-24 22:00 UTC**) |
| 2027-03-27 (DST starts at 03-28 00:00 → 01:00; local 00:00 never exists) | +2 → +3 | 03-27 23:30 | 03-27 21:30 | trial |
| 2027-03-27 | +3 | 03-28 01:00 | 03-27 22:00 | ended (end instant = **03-27 22:00 UTC**, the first instant of 03-28) |

Offsets and instants were verified with Python `zoneinfo` on 2026-10-17. `startOfShopDay` must return the **first instant whose Beirut day is that day**. The naive "offset at noon" approach gives 21:00 UTC for 2027-03-28, one hour early. The spring row catches that.

The same file also checks:

- **Sign-up day convention (research R4)**: a sign-up at 2026-10-17 10:00 Beirut → last day 2026-10-30. On 10-19 (day 3), `daysLeft = 12`.
- **ICU**: `Intl.DateTimeFormat(undefined, { timeZone: "Asia/Beirut" })` resolves to `Asia/Beirut`, not UTC.

## 2. Core service and provisioning (in-memory DB)

- `SubscriptionService.trial.test.ts`:
  - the standing precedence;
  - fail open with no row;
  - the invariant fallback;
  - `canWrite` is false for trial-ended;
  - Activate clears the trial;
  - Extend is refused for a past date and for a paying shop;
  - `runLapseSweep` never moves a trial or trial-ended row (no grace, FR-008).
- `TenantProvisioning.trial.test.ts`:
  - `trial` set → a row with `trial_ends_at`;
  - not set → today's row, byte-identical;
  - a rollback leaves no subscription row.

## 3. Backend API (jest, injected clock)

- **Clock**: these tests fake only the system time (`doNotFake` timers; see the tasks.md Tests header).
- `requireOpenTrial.test.ts`:
  - a trial-ended tenant: POST `/api/sales` → `{success:false, code:"TRIAL_ENDED"}` with HTTP 200;
  - GET `/api/transactions` → 200 with data;
  - POST `/api/auth/logout` and POST `/api/reports/pdf` → pass;
  - a trial tenant → pass;
  - a paying tenant → pass;
  - a thrown lookup → pass.
- `signup.trial.api.test.ts` and `googleSignup.trial.api.test.ts`: the new shop is on a trial, ending on day 14.
- `admin.trial.api.test.ts`:
  - activate and extend, including the 403 for a non-super-admin;
  - refusal of a past date;
  - an audit row is written;
  - shop B is untouched.
- `OfflineMergeProcessor.trial.test.ts` (core): of pre-end and post-end events, the pre-end ones book and the post-end ones stay `received`. After Extend, the next round books them. The manifest still matches while events are held.

## 4. Web e2e (`lira-web-0NN-free-trial.spec.ts`, next free number)

Run in this order:

1. **Set up**: the super-admin API creates a shop. It has no trial (FR-004 check).
2. **Extend trial** to the last day = today + 2. Sign in as the shop: `trial-strip` shows "3 days left" and the ends-soon wording, and the WhatsApp href starts with `https://wa.me/96181077357?text=` and contains the slug.
3. **Write path while on trial**: make one sale → OK.
4. **End the trial**: the test writes `trial_ends_at` into the past through the fixture's direct DB helper. This is test setup only; Extend refuses past dates by design.
5. **Ended state**: reload. `trial-ended` is shown. Visit every page from the lira-web-001 list → each renders, shows its records, **and shows `trial-ended`** (in step 2, each page shows `trial-strip`; FR-006). Export Debts → the file downloads.
6. **Refused write**: try a sale → the trial message is shown. Confirm by identity that no new sale row exists (rule 15).
7. **Activate** (super admin, open-ended), then reload without signing out: no strip, and a sale works.

## 5. Manual checks on the test tenant (owner)

- Sign up a new shop by email link, and another with Google → the strip shows "14 days left".
- On the owner's Tenants page, both rows show "Trial · 14 days left · ends …". The PlanModal history is empty until an action is taken.
- **Phone**: sign in to a trial shop → the strip is shown. After the end (set by the owner), the strip turns to "trial ended" and Sell is refused with the trial message.
- **Paired PC**: offline sales made before the end appear after reconnecting. A sale attempted offline after the PC has heard the trial ended is refused on the PC.
