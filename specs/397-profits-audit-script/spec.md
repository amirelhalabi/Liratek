# Feature Specification: Profits tenant audit script

**Feature Branch**: `397-profits-audit-script`

**Created**: 2026-11-18

**Status**: Draft (owner decision 2026-11-18: build — "A Tenant audit script")

**Input**: Owner (2026-11-16): "think about a strategy on how to catch similar issues … check on all the examples we have for Cornertech." The audit that found LIRA-391/393/394/395/396 was done by hand with ad-hoc Python against the REST API; this ticket makes it a repeatable script.

## What it does

`node scripts/profits-audit.mjs --host cornertech.liratek.shop --user admin --from 2026-09-01 --to 2026-11-16 [--json] [--module RECHARGE_MTC]`

1. Logs in (`POST /api/auth/login`), unlocks Profits (`POST /api/profits/unlock`), then reads — **strictly sequentially, ≥300 ms apart, never in parallel** (better-sqlite3 is synchronous on the server; parallel profits calls have caused outages, see memory LIRA-376) — `GET /api/profits/by-module`, `/module-detail?module=<key>` for every module key returned, `/summary`, `/by-date`, `/by-user`, `/by-client`, `/by-payment-method`.
2. Runs the checks below and prints a report: one line per check, PASS/FAIL/INFO, with up to 5 example rows (id, date, counterpart, detail, figures). Exit code 1 if any FAIL. `--json` prints the full machine-readable result instead.
3. Secrets: user password from env `LIRATEK_PASSWORD`, profits password from env `LIRATEK_PROFITS_PASSWORD`. Never from argv, never printed, never written to disk. The bearer token stays in memory.

## Checks (each a pure function over the fetched JSON, exported from `scripts/lib/profitsAuditChecks.mjs` so they are unit-testable with a synthetic fixture)

| # | Check | Severity |
| --- | --- | --- |
| 1 | Per module: Σ `counted[].counted_profit_usd/_lbp` = By Module row `profit_usd/_lbp` (± 0.02 / ± 2) and = `counted_total_profit_*` | FAIL |
| 2 | Views agree: Σ By Module = Σ By Date = Σ By User = Summary `totals.gross_profit_*` (± 0.02 / ± 2); By Client reported as INFO only (top-N list) | FAIL |
| 3 | Price − cost = profit per row where `amount` and `cost` are both non-zero and the module is SALE, RECHARGE_*, FINANCIAL_SERVICE_*, CUSTOM_SERVICE, MAINTENANCE, LOTO, EXCHANGE (± 0.02 / ± 2); settlement-allocation rows excluded | FAIL |
| 4 | Reason sanity: parse "paid $X of $Y" → 0 ≤ X ≤ Y; no "still owes" on a row whose detail starts with "REFUND" or that is otherwise marked refunded | FAIL |
| 5 | Detail: no `null`/blank; no raw enum (`^[A-Z_]+( \(settlement allocation\))?$`); no generic "<number> credit" | FAIL |
| 6 | Counterpart: no `^Client\d+$` (auto-named basket) | FAIL |
| 7 | Zero rows: counted rows with amount 0, cost 0, profit 0 (count per module) | INFO (FAIL when > 0 for SALE, KEPT_CHANGE, TOPUP_BUYBACK once 394/396 ship — make the threshold a flag `--strict-zero-rows`) |
| 8 | Negative-profit rows per module (count + examples) — expected for refunds/discounts/waived; informative for SALE/EXCHANGE | INFO |
| 9 | Not-counted rows without a `reason` | FAIL |
| 10 | Row counts per module, run time per endpoint | INFO |

## Requirements

- **FR-001**: Node ≥ 20 ESM, no new dependencies (global `fetch`). Lives at `scripts/profits-audit.mjs` + `scripts/lib/profitsAuditChecks.mjs`. Yarn script `profits:audit` in the root `package.json`.
- **FR-002**: Unit test `scripts/__tests__/profitsAuditChecks.test.mjs` (or the repo's existing pattern for script tests — look at `scripts/` for one; if none, a jest test under `packages/core/src/__tests__/` that imports the .mjs is acceptable) using a SYNTHETIC fixture that contains one violation of every check and asserts each check reports exactly it. No real tenant data in the repo.
- **FR-003**: `docs/OPERATIONS.md`: one short section "Profits audit" — when to run (after every deploy that touches `ProfitRepository`/`ProfitService`, and on a report from a shop), the command, the env vars, and "sequential only — never run two audits at once".
- **FR-004**: Dry run against Cornertech is allowed ONCE at the end, sequentially, with the owner-provided credentials the orchestrator passes to the agent through env vars (do not paste them into files, tests, or the report). Expected today: checks 2, 3 (Katsh), 4, 5, 6, 7 FAIL until LIRA-393–396 ship — list them in the report as the known baseline.

## Success Criteria

- **SC-001**: On Cornertech today the script reproduces the six findings of the 2026-11-16 manual audit (one total per view, Katsh cost, negative paid, refunded "still owes", enum/blank detail, `ClientN`).
- **SC-002**: Full run under 60 s on Cornertech with the 2.5-month range.

## Assumptions / Decisions taken (2026-11-18)

- Web API only (no desktop/IPC path). Admin credentials of the shop.
- Output is for the owner/developers, not shop staff; English, plain.

## File ownership (parallel build)

- Yours: `scripts/profits-audit.mjs`, `scripts/lib/profitsAuditChecks.mjs`, its test, root `package.json` `scripts` entry, `docs/OPERATIONS.md` section.
- Not yours: anything under `packages/core/src` except a test file if the repo has no script-test pattern.

## Decisions taken unattended (2026-11-18)

- **D1 — pacing.** "≥ 300 ms apart" is read conservatively: each request starts ≥ 300 ms after the previous RESPONSE finished (not start-to-start), one request in flight. A mock-server test measures both server-side. Per-request timeout 120 s; a timeout stops the run rather than firing the next call at a server still busy with the last.
- **D2 — session hygiene.** After the reads (also after a failure) the script calls `POST /api/profits/lock` and `POST /api/auth/logout`, best effort.
- **D3 — `--module`.** Narrows the drill-down fetches (and so checks 1, 3–10) to one module; check 2 still uses the full By Module list.
- **D4 — `--save-input <file>` / `--input <file>`.** Added so one live run can be re-checked offline. The file holds the fetched views only (no password, no token), written mode 0600, also on a failed run. It is real shop data: keep it out of the repo.
- **D5 — check 3 scope.** Runs on counted AND not-counted rows; per currency, only when that currency's amount and cost are both non-zero; skips rows whose detail contains "(settlement allocation)". Katsh is `FINANCIAL_SERVICE_Katsh`, covered by the prefix. On the 2026-11-18 Cornertech data all 99 settlement-allocation rows (source `financial_service_allocation`) have amount or cost 0, so the text-based exclusion changes nothing today; once LIRA-396 D5 rewords that detail it simply stops matching, which is harmless while that stays true.
- **D6 — check 4 "otherwise marked refunded".** The live API carries no refunded flag on a sale row: a refunded on-account sale arrives as an all-zero row (amount, cost, profit 0) with "Customer still owes — paid $X of $Y.". So a "still owes" reason FAILs on a row whose detail starts with REFUND / says "refunded", has `refunded`/`is_refunded` true, or is all zeros (nothing left to owe on). "paid $X of $Y" is parsed from the `$` wording `ProfitService` writes.
- **D7 — check 5 raw-code test.** The spec's regex is applied to every module EXCEPT MAINTENANCE and CUSTOM_SERVICE, whose detail is staff-typed free text (device names like "TECNO", "IPHONE" are not codes); blank/null detail is still a FAIL there.
- **D8 — check 7 statuses.** INFO with findings, PASS without; FAIL only under `--strict-zero-rows` and only when a SALE / KEPT_CHANGE / TOPUP_BUYBACK zero row exists. Checks 7, 8 and 10 never fail the run otherwise.
- **D9 — tests.** `node:test` file in `scripts/__tests__/`, added to `yarn test:scripts` (CI runs it with a test-count floor). Root `yarn lint` does not cover `scripts/` (it runs only the workspaces), so the files get `node --check` + Prettier.
- **D10 — stdout.** The script prints with `console.*` like every other `scripts/*.mjs`; the logger rule (rule 4) targets workspace code.
- **D11 — no release note.** Developer tooling; nothing a shop owner or cashier sees (rule 30: "Tests, docs, CI … get no line").
