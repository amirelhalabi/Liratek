# Remaining work — Session Basket Payment

The core feature, supplier-ledger fix, transaction-based profits + refund fix, rules 13/14
refactor, and **5 e2e specs** are **DONE, green, and committed** on branch
**`feat/session-basket-payment`** (7 commits ahead of `main`). What's below is **optional**

- housekeeping.

## Current state / housekeeping

- Working tree **clean**; all work committed on `feat/session-basket-payment`.
- ⚠️ A parallel **LIRA-059** (supplier cashflow / `SUPPLIER_PAYS_US` v103) session committed to the
  **same branch** — history is interleaved but every change is intact (verified: `package.json`
  sequential `-A`, CLAUDE.md e2e rule, migrations v100–v103, `ProfitRepository` /
  `SessionPaymentRepository` / `SessionPaymentService`).
- **Native ABI:** jest leaves `better-sqlite3` on the **Node** ABI. Run `yarn dev` **once** to
  restore the **Electron** ABI before `test:e2e`. Always run e2e as: `yarn dev` → **stop it** →
  `yarn test:e2e` (see CLAUDE.md "Running E2E tests"). I do not run `test:e2e` — the user does.
- Gates currently green: **jest 374/374**, frontend 209, 5 e2e specs, lint 0 errors, typecheck clean.

---

## #1 — Thread `exchange_rate` on non-financial session transactions ✅ DONE

> **Done (2026-06-19):** threaded handler → service → repo `createTransaction` for
> `CustomServiceRepository` (+ Zod schema), `LotoTicketRepository`, and `LotoCashPrizeRepository`
> (loto repos now use `data.exchange_rate ?? 100000`). Sales + maintenance already forwarded it.
> Extended `lira-session-exchange-rate.spec.ts` with custom-service + loto-ticket cases. Core 379 /
> backend 384 green; e2e specs typecheck clean. Original plan below for reference.

**Why:** `electron-app/handlers/sessionHandlers.ts` sets `data.exchange_rate = exchangeRate` (and
`data.exchangeRate`) on **every** cart item, but only **financial + recharge** repos forward it to
`createTransaction({ exchange_rate })`. Custom-service / sales / loto session transactions get
`exchange_rate = null`, so the viewer shows no `@ <rate>` and USD/LBP display is inconsistent for
those rows.

**Fix** — in each repo's `getTransactionRepository().createTransaction({...})` call, add
`exchange_rate` (and add an optional `exchange_rate?: number` to that repo's input type; keep it
optional so **non-session/direct flows are unchanged**):

- `packages/core/src/repositories/CustomServiceRepository.ts` — `createService` → createTransaction
  (~L105). Add `exchange_rate: data.exchange_rate ?? null`.
- `packages/core/src/repositories/SalesRepository.ts` — `processSale` → createTransaction (~L322).
  Pass `exchange_rate: sale.exchange_rate` (sale already carries a rate / `exchange_rate_snapshot`).
- `packages/core/src/repositories/LotoTicketRepository.ts` — `sellTicket` → createTransaction.
- `packages/core/src/repositories/LotoCashPrizeRepository.ts` — `recordCashPrize` → createTransaction.
- `packages/core/src/repositories/MaintenanceRepository.ts` — **VERIFY first**: it already passes
  `exchange_rate: opts.exchangeRate` (likely done) → no change needed.

**Verify:** `cd packages/core && npm run build` then sync
`cp -r packages/core/dist/. node_modules/@liratek/core/dist/`. Extend
`frontend/tests/e2e-electron/lira-session-exchange-rate.spec.ts` to also checkout a `custom_service`
item and assert its row's `exchange_rate` == the modal rate. Run jest + (user) `test:e2e`.

---

## #3 — UI e2e specs (optional, lower value) ❌ NOT DONE

> **Validated 2026-08-04:** neither (a) nor (b) exists. ⚠️ The (a) recipe below is **stale** — it
> names `sessionBorderClass()` / `border-l-4 border-<color>-500`, which **never shipped**. The
> feature landed as "WS8" using a `data-session` attribute + a `--session-hue` CSS custom property.
> Use the corrected recipe in **Left TODO** at the bottom of this file, not the one below.

**(a) Per-session border color** — new `frontend/tests/e2e-electron/lira-session-grouping-ui.spec.ts`:

- Reuse the `lira-session-basket-payment` pattern: start a session, `session.checkout` 2
  custom-service items.
- `navigateTo(appPage, "<viewer route>")` — confirm the transactions-viewer route in
  `frontend/src/app/App.tsx` / sidebar (likely `/audit` or `/transactions`).
- Assert the two session `<tr>` rows' `class` contains `border-l-4` + `border-<color>-500`, same
  color for both (`sessionBorderClass(session_id)` in `TransactionsViewer.tsx`). Optionally toggle
  dark mode (TopBar sun/moon) and re-assert.

**(b) Sell-rate hook** — low value; `useSellRate` is already exercised by unit/integration tests.
Skip unless desired. If wanted: assert the recharge page and the Session Checkout modal show the
**same** sell rate.

---

## After both

1. Full gate: `yarn typecheck`, `yarn lint`, `yarn test` (sequential), then `yarn dev`→stop→`yarn test:e2e`.
2. Commit: `feat(core): thread exchange_rate on non-financial session txns` (#1);
   `test(e2e): session grouping UI` (#3).
3. ✅ **DONE — PR merged.** `feat/session-basket-payment` no longer exists; the core feature,
   `SessionPaymentRepository`/`SessionPaymentService`/`ProfitRepository`, migrations v100–v103 and
   the session e2e specs are all on `main`. Only step 2's `test(e2e)` half remains (see below).

---

## Left TODO

<!--
//TODO — Validation pass 2026-08-04. Verdict: NOT fully implemented, so this plan STAYS in
//TODO   docs/plans/todo_plans/. Everything except #3 shipped; #3 was never started and its
//TODO   original recipe (above) points at code that does not exist.
//
//TODO   VERIFIED DONE (no action needed — do not redo):
//TODO     - #1 exchange_rate threading: all five repos pass it into createTransaction —
//TODO       CustomServiceRepository.ts:139, SalesRepository.ts:506,
//TODO       LotoTicketRepository.ts:191, LotoCashPrizeRepository.ts:86 (both `?? 100000`),
//TODO       MaintenanceRepository.ts:383 (`opts.exchangeRate`, was already correct).
//TODO     - lira-session-exchange-rate.spec.ts covers the custom-service case (L110) and the
//TODO       loto-ticket case (L168), as the #1 done-note claims.
//TODO     - Branch merged to main; migrations v100–v103 present.
//
//TODO   REMAINING — #3(a) per-session border-accent e2e spec. Still worth doing: the accent has
//TODO   ZERO test coverage (nothing under frontend/ references `data-session`, `--session-hue`,
//TODO   or `sessionHue` except the component itself), so a refactor that drops the attribute or
//TODO   the inline style would ship silently.
//
//TODO   CORRECTED RECIPE (the #3(a) text above is wrong — read this instead):
//TODO     File: frontend/tests/e2e-electron/lira-session-grouping-ui.spec.ts
//TODO     1. Route is `/audit` — NOT `/transactions`. AuditPage defaults to the "transactions"
//TODO        tab (AuditPage.tsx:22), so TransactionsViewer renders without clicking a tab.
//TODO     2. Setup: reuse the lira-session-basket-payment pattern — start a session, then
//TODO        `session.checkout` with 2 custom-service items so both rows share one session_id.
//TODO     3. Assertions — the implementation is an ATTRIBUTE + CSS VAR, not a Tailwind class:
//TODO          - both rows expose `data-session` (TransactionsViewer.tsx:984 — note the value is
//TODO            the EMPTY STRING `""`, so match on presence: `tr[data-session]`, never `="1"`).
//TODO          - both rows carry the same inline `--session-hue`, read via
//TODO            `getPropertyValue("--session-hue")` on the row's style, or assert the computed
//TODO            `border-left-color` is equal across the two rows and non-transparent.
//TODO          - expected hue is derivable: sessionHue(id) = round(abs(id * 137.508)) % 360
//TODO            (golden angle, TransactionsViewer.tsx:621) — assert the exact value for the
//TODO            session id the test created.
//TODO     4. Light + dark: index.css:474 (`.dark tr[data-session]`) and index.css:483
//TODO        (`html:not(.dark) tr[data-session]`) use DIFFERENT lightness (62% vs 42%). Toggle
//TODO        the TopBar sun/moon and re-assert `border-left-color` CHANGES while the hue holds.
//TODO     5. Rule 15 — do NOT grab `tbody tr.first()`. The e2e DB accumulates across specs; match
//TODO        the rows by the unique custom-service label this spec created.
//TODO     6. Sandwiched-sibling rows (TransactionsViewer.tsx:1326/1387) get the accent too — an
//TODO        optional extra case, e.g. a checkout that auto-writes a SUPPLIER_PAYMENT sibling.
//
//TODO   REMAINING — #3(b) sell-rate hook spec: intentionally NOT done. The plan itself rates it
//TODO   "low value; skip unless desired" and `useSellRate` already has unit/integration cover.
//TODO   Leave it dropped unless the owner asks; it is not a gap.
//
//TODO   GATE for #3(a) when picked up: `yarn typecheck`, `yarn lint`, then
//TODO   `yarn dev` -> STOP IT -> `yarn test:e2e` (jest leaves better-sqlite3 on the Node ABI;
//TODO   `yarn dev` restores the Electron ABI). Commit as `test(e2e): session grouping UI`.
//TODO   Once that spec is green, this file has nothing left -> move it to docs/plans/done_plans/.
-->

**Summary — one item left:** the #3(a) per-session border-accent e2e spec
(`lira-session-grouping-ui.spec.ts`), written against the real `data-session` + `--session-hue`
implementation rather than the stale `sessionBorderClass` recipe above. #3(b) is deliberately
dropped. Everything else in this plan is verified shipped on `main`.
