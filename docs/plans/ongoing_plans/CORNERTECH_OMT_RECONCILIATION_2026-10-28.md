# Cornertech OMT reconciliation — plan and progress (2026-10-28)

**Objective:** Cornertech's OMT account and drawers in LiraTek match OMT's own SMS balances, every day, with no negative drawer.

**Rules we work by**

- Only the owner says when the shop paid OMT or OMT paid the shop. Rayan's Excel "OMT" line is an end-of-day net, not a payment.
- OMT's SMS is the truth for balances. "+" = shop owes OMT, "−" = OMT owes shop.
- Corrections go through the app's own screens (voids, re-entries with "Set custom time"), never straight into the database.
- Work is done as user `liratek_sync` (admin) on a local frontend pointed at Cornertech.

**Owner-confirmed facts**

| Day | What happened |
|---|---|
| Thu 22 | SMS: +$2,663.63 / −16,275,782 LBP (starting point) |
| Sat 24 | Rayan paid OMT $9,000 (already recorded) |
| Sun 25 | SMS: +$447.49 / +1,119,100,468 LBP |
| Mon 26 | Shop paid OMT $500 + 1,119,000,000 LBP from the OMT cash drawer |
| Mon 26 | SMS: −$3,487.20 / −24,550,032 LBP |
| Tue 27 | OMT paid shop $3,400 + 24,000,000 LBP into the OMT cash drawer |
| Tue 27 | SMS: −$3,732.01 / +12,614,968 LBP (sent Wed 28, 1:56 PM) |
| Wed 28 | OMT paid $3,700; shop paid 15,000,000 LBP (Rayan recorded both) |

---

## 1. Issues found

### Data problems on Cornertech

| # | Problem | Effect |
|---|---|---|
| D1 | Several OMT transfers were entered on the wrong day or with wrong details (Said, taan, nazih, Souheil, wajih, Adham) and some were missing (ramzi, Mechanic ×2) | Day-by-day totals off |
| D2 | Hassan's OMT receive was entered twice | Shop shown owing 3,600,000 LBP too little |
| D3 | Monday's payment to OMT was replaced by 3 manual adjustments (−$1,651.01, −1,099,566,686, −35,689,064 LBP) | Monday's payment missing; balance wrong |
| D4 | Tuesday's payment from OMT was erased | Tuesday's payment missing |
| D5 | Ihab's $100 was recorded as a Whish App send in cash; it really went through OMT, paid by Whish | OMT account $100 short; General $100 too high |

### App bugs found (all fixed, see section 2)

| # | Bug |
|---|---|
| B1 | Settle Account had no "Set custom time" |
| B2 | Top Up → Transfer had no "Set custom time" |
| B3 | A back-dated drawer transfer did not clear the drawer count's Short/Over, so it moved the money twice (General went to −909,020,000 LBP) |
| B4 | A back-dated OMT/Whish transfer or Loto entry dated its supplier ledger line on the day it was typed, not its real day |
| B5 | Add Credit / Debt (suppliers) had no "Set custom time" (LIRA-352) |
| B6 | A voided debt charge and its cancellation looked like 2 more charges on a client's account; back-dated account lines took the save day |
| B7 | **Open.** "Check against OMT's statement" → "Up to: <past day>" gives a wrong figure once a payment to or from OMT was recorded after that day (it only counts still-open rows). On Wed 28 it shows +$6,464.54 / +20,006,750 LBP for Tue 27, while the real Tue balance (and the system's ledger) is −$3,730.59 / +12,585,968. Checking "up to yesterday" in the morning, before any payment, still works. |

### Things to know (not bugs)

- Settle Account treats extra money as change handed back unless "put on account" is chosen in the change box.
- OMT App is a prepaid wallet: its sends do not change the OMT account. Only OMT (cash-drawer system) sends do.
- Supplier paper adjustments cannot be voided; the way to undo one is an opposite entry.

---

## 2. What is fixed

### App fixes (all pushed to main and live)

| Commit | Fix |
|---|---|
| `333aae10` | B6: voided charges and their cancellations marked; back-dated account lines keep their date |
| `888a3018` | B1: "Set custom time" on Settle Account |
| `9ee42dbf` | B2: "Set custom time" on Top Up → Transfer |
| `cf567330` | B3: back-dated drawer transfer clears the count's Short/Over |
| `52352298` | B4: supplier lines take the date of what they belong to (all modules, one shared writer) |
| `4535df42` | B5 / LIRA-352: "Set custom time" on Add Credit / Debt (paper and cash) |

Each fix has a test written first and seen failing.

### Data fixes on Cornertech (done through the app)

| Done | What | Transactions |
|---|---|---|
| ✅ | D2: Hassan's duplicate voided | #13417 |
| ✅ | D1: 6 wrong OMT transfers voided and re-entered on their real days | voids #13419–#13428, re-entries #13429–#13438, Souheil redone #13574 |
| ✅ | D1: missing transfers added on their real days (ramzi $81, Mechanic 2,900,000 and 12,090,000 LBP) | #13439–#13444 |
| ✅ | D1: Adham corrected from $203 to $200 | void #13447, re-entry #13449 |
| ✅ | D3: Monday's 3 manual adjustments cancelled with opposite paper credits (dated Wed 28 — no custom time existed then) | #13634–#13636 |
| ✅ | D3: Monday's move of 1,119,000,000 LBP from General to the OMT cash drawer, dated Mon 26 13:18, now clearing General's Monday Short | first try #13656 voided; redo transfer id 13 |
| ✅ | D3: Monday's payment to OMT: $500 + 1,119,000,000 LBP from the OMT cash drawer, $51.35 extra kept as OMT credit | first try #13662 voided; redo settlement #717 |
| ✅ | D4: Tuesday's payment from OMT: $3,400 + 24,000,000 LBP into the OMT cash drawer, dated Tue 27 21:31; cleared Tuesday's OMT drawer Over | settlement #720 |
| ✅ | D5: Ihab moved to an OMT send paid by Whish ($99 + $1 fee = $100), dated Tue 27 22:14 | voids #13676, #13680 |

### Result now

| | System | Should be (from SMS) | Gap |
|---|---|---|---|
| OMT account | +$11,643.42 / +107,805,968 LBP | +$11,642.00 / +107,834,948 LBP | $1.42 / 28,980 LBP |
| General drawer | +206,335,000 LBP (no negative) | | |
| OMT cash drawer | $34,778.03 / 129,720,000 LBP | | |

Day by day, once dates are right: Sun 25 within $1.16 / 750 LBP; Mon 26 within $1.16 / 61,000 LBP; Tue 27 within $1.42 / 28,980 LBP.

---

## 3. Still to do, in order

| # | Task | Status |
|---|---|---|
| 1 | Re-date Monday's correction: paper credits dated Mon 26 ($1,651.01 and 1,135,255,750 LBP) and matching debits dated Wed 28, so the correction sits on Monday. Total unchanged. | ✅ Done (ledger 725–728) |
| 2 | Re-date the 10 OMT entries made before fix B4 (9 re-entries + Ihab): voided and re-entered; their OMT account lines now sit on their real days. Totals and drawers unchanged. | ✅ Done (transfers 977–986, ledger 731–756) |
| 2b | Re-apply the credit released by the task-2 voids (each void turned the old entry's paid part into OMT credit; the re-entries came in unpaid, so the calendar showed 24, 26, 27 as unpaid again). One credit-only Settle Account, $0 cash, days 24/26/27: $6,522.31 + 20,029,750 LBP of credit used. Balance and drawers unchanged; 23–27 now settled; $30.59 + 2,414,032 LBP credit left. | ✅ Done (settlement ledger 757) |
| 3 | Check each day against the SMS (25, 26, 27), from the OMT account's ledger | ✅ Done — all within $1.42 / 61,000 LBP (table below) |
| 4 | Compare Wednesday's own balance. The SMS sent Wed 28 is the balance **as of Tue 27** (checked in task 3). The balance as of Wed 28 arrives Thu 29. If no more OMT activity is recorded today, expect about +$11,494.59 / +107,834,968 LBP (system +$11,496.01 / +107,805,968 minus the same small leftover). | Waiting for Thursday's SMS |
| 5 | Message for Rayan: use "put on account" for extra money at Settle Account; record every OMT payment in Settle Account the same day; type the SMS into the check each morning | To do |
| 6 | Turn off user `liratek_sync` | Last step |

### Day-by-day check (OMT account incl. OMT App, from the ledger, Wed 28 evening)

| End of day | OMT SMS | System | Difference |
|---|---|---|---|
| Thu 22 | +$2,663.63 / −16,275,782 | same (starting point) | 0 |
| Sat 24 / Sun 25 | +$447.49 / +1,119,100,468 | +$448.65 / +1,119,101,218 | $1.16 / 750 |
| Mon 26 | −$3,487.20 / −24,550,032 | −$3,486.04 / −24,489,032 | $1.16 / 61,000 |
| Tue 27 | −$3,732.01 / +12,614,968 | −$3,730.59 / +12,585,968 | $1.42 / −29,000 |
| Wed 28 (so far) | arrives Thu 29 | +$11,496.01 / +107,805,968 | — |

The leftovers are small fees or rounding, not worth chasing.

### Rayan's Excel vs the system ("RAYAN OMT NEW 2 (1).xlsx", Thu 23 – Wed 28)

Most lines match. To confirm with Rayan:

- **Mon 26, Mechanic:** sheet 2,700,000 LBP vs system 2,760,000 LBP (#766, paid $31, no client). The 60,000 matches Monday's 61,000 leftover against the SMS, so the system is probably wrong.
- **Wed 28, Taxes Imad:** sheet 119,016,000 vs system 119,020,000 LBP. Thursday's SMS will tell.
- **In the system, not on the sheet:** Fawzie 950,000 and Samer Hisham Kerbej 1,191,000 (Thu 23), Rabiha 790,000 (Sat 24), Khattar 730,000 and Client3 1,220,000 (Wed 28). The SMS confirms the Thu/Sat ones.
- **Same thing, written differently:** "wallet rayan" 26,060,000 = OMT App top-up; "BET" $15.23 + $10.15 = one $25 send + $0.38 fee; Noura 12,975,000 paid as $145.
- OMT cash drawer now $34,784 / 129,720,000 LBP, same as the sheet's opening for Thu 29.

### Later (app tickets, not needed for today's objective)

- LIRA-351: Loto on Settle Account (day calendar).
- LIRA-353: Settle Account "too early" message shows a raw date.
- LIRA-354: a page silently joins another customer's open session.
- LIRA-355: Settings → Users does not list admin users.
- Supplier lines written with no link (some sales, recharge, partner-service and warranty paths) still take the save day if back-dated. Needs a check of whether those screens allow a custom time.
- Voiding a settled transfer turns its paid part into OMT credit, and its re-entry arrives unpaid; the credit must be applied by hand (Settle Account). Consider offering it automatically when a voided transfer is re-entered.
- B7: make the "Up to" check right for past days after later payments.
- What's new cards with screenshots for the new "Set custom time" controls (release-note lines are written).

### Tracking page

Visual version with day-by-day tables: https://claude.ai/artifact/SpZT761jtXC6p1Ybd5RV8P
