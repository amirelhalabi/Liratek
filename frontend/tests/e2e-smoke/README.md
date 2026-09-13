# Live smoke harness

Drives a **deployed** LiraTek tenant through its real money flows in a real
browser. It is not part of CI and not part of `yarn test` — it exists to
answer one question the unit and jsdom suites structurally cannot:

> does this actually work for a web user, against the real server?

Every defect it found on 2026-09-12/13 was invisible to code review and to
the 1497-test frontend suite, because each was a desktop/web divergence that
only appears when the browser talks to the deployed API (CLAUDE.md rules 27
and 28).

## ⚠ It writes real records

Every flow below **creates a real transaction** — sales, exchanges, OMT and
Whish transfers, recharges, loto tickets, expenses, maintenance jobs. There is
no cleanup step.

`SMOKE_URL` is **required and has no default**, deliberately. An earlier
version defaulted to the test tenant, which is one typo away from writing
transactions into a customer's books. The harness refuses to start without it.

## Running it

```bash
cd frontend
SMOKE_URL=https://test.liratek.shop \
SMOKE_USER=Admin \
SMOKE_PASS='...' \
npx playwright test --config tests/e2e-smoke/playwright.config.js --reporter=list
```

Credentials come from the environment only — never hard-code them here.

**Always `--list` first when changing the config.** Playwright resolves a
relative `--config` against the package root, not your cwd; when a config
fails to load it silently falls back to discovering the repo's own config,
which once started the 300-test Electron suite by accident. Pass an absolute
path and confirm the test count before running.

## The selector map

Hard-won, and the reason this file exists. Each line below cost a failed run.

| Where | What bites |
| --- | --- |
| Login | `input[placeholder="Enter username"]`, `input[type="password"]`; JWT lands in `localStorage["liratek.jwt"]` |
| Clients | inputs are `name="full_name"` / `name="phone_number"` — the *placeholders* are `"John Doe"` / `"03 123 456"`, so matching a placeholder like `/full name/i` finds nothing. Save button: **"Save Client"** |
| Phone validation | **8 digits, no spaces** (`03123456`). `03 000 875` is rejected with "Invalid phone number format" |
| Partners | placeholders `"Partner name"`, `"+961 XX XXX XXX"`; the action is **"Create"**, not "Save" |
| Products | `name="name"`, `name="cost_price"`, `name="retail_price"`, `name="stock_quantity"`; **"Save Product"** |
| Maintenance | there are **TWO** `placeholder="0.00"` inputs — the **second** is price-to-client. Filling `.first()` leaves the job at $0.00 and checkout opens with a zero total |
| Maintenance checkout | needs a **customer** (`client-autocomplete-field`) before "Complete Sale" will post |
| Exchange | submit is **"Proceed to Payout"**, then a dialog whose payout amount is **already correct** — overwriting it creates `Remaining (Debt)`. Just click **"Pay 103,240 LBP"** |
| Recharge | "Proceed to Pay" only *reveals* the submit, which is labelled with the amount: **"Pay 300,000 LBP"** |
| Loto | **two** buttons read "Sell Ticket"; the submit is the **last** one |
| OMT / Whish | providers are `OMT ↑ / ↓` and `WHISH ↑ / ↓` (direction); submit is **"Record Send"** |
| Payment sheets | the amount input id is per-line: `[data-testid^="payment-amount-"]` |
| Checkpoint | **`/#/checkpoint` is not a route** — it silently falls back to the Dashboard. The modal opens from a drawer card's `button[title="Checkpoint"]`, and only when the `sessionManagement` flag is on |
| Success detection | match a completion phrase, not a bare word. `/sold/i` matched the stats label "Tickets **Sold** 0" and reported a false success for a sale that never happened |

## Reading the results

- `SUBMITTED` — the app printed its own completion message.
- `REJECTED` — the app refused it; the message is quoted. A real finding.
- `UNCLEAR` — no completion message. **Usually the harness, not the app.**
  Several flows (client, partner) save correctly and simply show no toast, so
  confirm against the API before calling anything broken.
- A run with **zero HTTP 4xx/5xx** and several UNCLEARs means the forms were
  not completed, not that the server rejected anything.

### Known harness gaps (the app is fine; the driver isn't)

- **client / partner** — both save correctly and show no toast. Confirm via
  `/api/clients` and `/api/partners`; they were verified that way.
- **Whish send** — verified working by hand ("WHISH send recorded
  successfully") but reports UNCLEAR from this spec with an identical
  sequence, so it is sensitive to run order or page state. If you touch this
  flow, fix the driver rather than assuming a regression.

A baseline run on 2026-09-13 against the test tenant: **10 SUBMITTED, 2 SKIP
(carrier lines already existed), 3 UNCLEAR, 0 HTTP errors.**
