# Feature Specification: Euro rate from the online feed (LIRA-404)

**Feature Branch**: main (no branch — owner rule) · **Created**: 2026-11-25 · **Status**: Built
**Input**: CornerTech asked that the euro not be typed statically. Owner decisions 2026-11-25 (final).

## Summary

The euro stops being a Settings-configured rate. Like GBP/CAD/AUD it takes its rate from the
online feed the Exchange page already uses (open.er-api.com, cached until the feed's next
publish). Buy = sell = market, so the spread is $0 unless the cashier types a custom rate on the
leg (existing per-leg override). EUR stays a currency and a drawer currency (drawers still hold
euros; checkpoints/closing still count `physical_eur`). LBP stays typed in Settings.

The Open Positions panel now fills Market (USD) and Unrealized P&L from the feed for every
foreign currency the server leaves blank (display only).

## User Scenarios

### US1 — Exchange euros at the online rate (P1)

A cashier picks EUR on the Exchange page. The rate comes from the online feed, no spread.
**Acceptance**: (1) with no EUR row in Settings, EUR is offered in the From/To picker (first in
the feed list); (2) a 100 EUR → USD exchange books at the feed rate on web and desktop;
(3) a typed custom rate still overrides the leg.

### US2 — EUR is gone from Settings → Currencies & Rates (P1)

**Acceptance**: (1) existing shops: migration v235 deletes every `exchange_rates` row with
`to_code = 'EUR'`; (2) new shops (web seed and fresh desktop DB) get only the LBP row;
(3) the EUR spread card disappears by itself (it renders only when a row exists).

### US3 — Euros already held keep their cost (P1)

**Acceptance**: an EUR lot opened while the row existed keeps its `unit_cost_usd`; after the
row is removed, selling those euros (USD → EUR direct and LBP → EUR cross) consumes the lot
FIFO and books realized profit = proceeds − lot cost. Buying more euros (EUR → USD and
EUR → LBP) still opens lots at the trade's own executed value.

### US4 — Open Positions shows market value from the feed (P2)

**Acceptance**: when the server returns `null` market/unrealized for a position, the panel
fills both from the feed snapshot (EUR, GBP, CAD …). Server values, when present, are never
overwritten. Feed unavailable → "—" stays. "Indicative — market feed may be stale" stays.
Never saved, never feeds Profits.

## Audit — every place that read the EUR rate row or hard-coded EUR as Settings-configured

| Spot                                                                                                                                  | Today                                                    | After (no EUR row)                                                                                                                      | Change needed                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/utils/liveExchangeRates.ts` `EXCLUDED_CURRENCIES` (USD, LBP, EUR)                                                       | EUR removed from feed list; Settings row supplies it     | EUR comes from feed                                                                                                                     | **Yes** — drop EUR from the set; add EUR first in `PRIORITY_CODES`                                                                    |
| `frontend/src/hooks/useExchangeCurrencyList.ts`                                                                                       | "configured" branch surfaces EUR from `activeCurrencies` | EUR arrives in the feed branch; configured branch is empty                                                                              | No (reads the same constant) — doc comment updated                                                                                    |
| Exchange page `effectiveRates` (Settings rows + feed extras for selected codes)                                                       | EUR from Settings row                                    | EUR from feed (a re-added Settings row would still win)                                                                                 | No                                                                                                                                    |
| Exchange page `calculateExchange` call                                                                                                | try/catch, shows calc error                              | Same — feed down + EUR selected shows the calc error, no crash                                                                          | No                                                                                                                                    |
| `PositionsPanel.tsx` + `ExchangeLotService.getPositions`                                                                              | Market/Unrealized from the Settings row, else "—"        | Server returns null for EUR; panel fills from feed                                                                                      | **Yes** — pure `fillPositionsMarketFromFeed`, shared `unrealizedProfitUsd` in core `utils/lotMarketRate.ts` used by service AND panel |
| `ExchangeService.addTransaction` (server recompute from `exchange_rates`)                                                             | Would need an EUR row                                    | Throws for EUR                                                                                                                          | No — no transport calls it (REST, IPC, session checkout, offline binding all use `addDirectTransaction`); tests only                  |
| `ExchangeService.addDirectTransaction` (both transports)                                                                              | Trusts client-computed amounts/rates                     | Unchanged                                                                                                                               | No                                                                                                                                    |
| `ExchangeRepository._applyExchangeLotEffects` direct EUR↔USD                                                                          | Unit cost/proceeds from the two amounts, no row          | Unchanged                                                                                                                               | No                                                                                                                                    |
| `ExchangeRepository._crossUsdNotional` EUR↔LBP                                                                                        | Anchors on LBP's row                                     | Unchanged                                                                                                                               | No                                                                                                                                    |
| `_crossUsdNotional` EUR↔GBP (two feed-only)                                                                                           | Anchored on EUR's row                                    | No anchor → lot tracking skipped, spread profit booked (same as GBP→CAD today)                                                          | No — **accepted loss** (owner decision 6)                                                                                             |
| `ExchangeRepository._marketUnitCostUsd` (oversell, uncovered slice)                                                                   | Uncovered EUR valued at the row's market rate            | Falls back to proceeds → uncovered slice books $0 profit (same as GBP)                                                                  | No — **behaviour change**, logged as open question, pinned by test                                                                    |
| `ExchangeLotService.previewSettlement` (`crossPairHasUsdAnchor`)                                                                      | EUR anchors                                              | EUR↔LBP still anchors; EUR↔GBP no longer → preview says not tracked                                                                     | No (stays in step with the write path)                                                                                                |
| `ExchangeRepository._customerPaysUsdRate` (account / forgive)                                                                         | EUR→USD and EUR→LBP from amounts; other pairs via row    | Same for EUR→USD/LBP                                                                                                                    | No                                                                                                                                    |
| `DrawerTopUpRepository` cost basis                                                                                                    | Row → market; else client feed hint; else operator rate  | EUR uses the feed hint the modal already sends (`isFeedOnly`); offline with no feed the cashier types the rate via "edit" (same as GBP) | No                                                                                                                                    |
| `DrawerTopUpModal.resolveBasis`                                                                                                       | Settings row, else feed                                  | Feed                                                                                                                                    | No                                                                                                                                    |
| `LiveRatesPanel` `PINNED_ORDER` LBP, EUR                                                                                              | EUR pinned as a "Settings" row                           | EUR shows as a market row                                                                                                               | No (pin applies only to configured rows)                                                                                              |
| Settings `CurrencyManager` EUR spread card                                                                                            | Shown when row exists                                    | Hidden (null spread)                                                                                                                    | No                                                                                                                                    |
| `frontend/src/utils/exchangeRates.ts` EUR branches                                                                                    | Reads EUR rows                                           | Dead for EUR — no production caller of `getCrossCurrencyRate`/`getConversionOperation`                                                  | No                                                                                                                                    |
| `CurrencyQuickFill.tsx` EUR placeholder                                                                                               | Not imported anywhere                                    | —                                                                                                                                       | No                                                                                                                                    |
| `Services/index.tsx:163`, closing/checkpoint `physical_eur`                                                                           | Formatting / drawer counts                               | Unchanged (EUR stays a currency)                                                                                                        | No                                                                                                                                    |
| `useDynamicExchangeRate` / `useCheckoutPayments`                                                                                      | Payment forms USD + LBP only                             | Unchanged (owner decision 5)                                                                                                            | No                                                                                                                                    |
| Core `constants/currencies.ts` `getBaseRate`/`convertToUsd` EUR                                                                       | No caller outside the file                               | —                                                                                                                                       | No                                                                                                                                    |
| `constants/tenderRateBand.ts`, `DebtRepository`, `RechargeRepository`, `TransactionRepository`, `KpiSnapshotService`, `ProfitService` | LBP row only                                             | Unchanged                                                                                                                               | No                                                                                                                                    |
| `validators/exchange.ts` cross anchor refine                                                                                          | Requires both leg rates on a cross                       | Unchanged                                                                                                                               | No                                                                                                                                    |
| Offline replay (`ReplayEngine.rateChangedNote`, `effectiveRate.ts`)                                                                   | Compares recorded vs current rows                        | No EUR row → no "rate changed" note for EUR                                                                                             | No                                                                                                                                    |
| `TenantRepository.seedExchangeRates`                                                                                                  | Seeds LBP + EUR                                          | Seeds LBP only                                                                                                                          | **Yes**                                                                                                                               |
| `electron-app/create_db.sql` default rates                                                                                            | Inserts LBP + EUR                                        | Inserts LBP only; marks v235 applied                                                                                                    | **Yes**                                                                                                                               |
| `constants/resetTables.ts`                                                                                                            | `exchange_rates` kept on Reset Data                      | No re-seed                                                                                                                              | No                                                                                                                                    |

### Offline (desktop)

The feed is fetched by the screen and cached in memory only. With no internet at start-up, the
feed is unavailable, so EUR — like GBP today — is not offered on the Exchange page until the
feed loads; an already-selected EUR shows the calculator error instead of a rate (no crash).
A EUR drawer top-up offline needs the rate typed via "edit" (same as GBP). A EUR exchange made
while the feed was loaded and replayed later goes through `addDirectTransaction` with its own
recorded amounts, so replay needs no EUR row.

## Requirements

- **FR-001** Migration v235 deletes `exchange_rates` rows with `to_code = 'EUR'` (all tenants). Down re-inserts the old default (1.18 / 1.16 / 1.20, stronger) for tenants that have EUR in `currencies`; custom values typed before are not recoverable.
- **FR-002** New shops (web seed, fresh desktop DB) get no EUR rate row. EUR stays a currency + currency modules.
- **FR-003** EUR is a feed currency in the Exchange and drawer top-up pickers.
- **FR-004** Open EUR lots, their cost, FIFO consumption and realized profit are unchanged.
- **FR-005** Positions panel fills null market/unrealized from the feed via ONE pure function; unrealized math shared with the server (rule 14). Display only.
- **FR-006** Cross exchange between two feed-only currencies stays without lot tracking (accepted).

## Success criteria

- Core jest: migration, seed, lots-after-removal (four directions + oversell) green.
- Frontend jest: feed currency list includes EUR; positions fill derivation; panel renders a filled Market.
- Web e2e: EUR → USD exchange with no Settings row and a mocked feed; Positions panel screenshot.

## Open questions for the owner (defaults chosen, not blocking)

1. **Direction wording.** The brief says "a EUR→USD and a EUR→LBP sale consume the lot". In the app, the shop _sells_ euros when the customer receives EUR (USD → EUR, LBP → EUR); EUR → USD/LBP is the shop _buying_ euros (opens a new lot). Default: the test covers all four.
2. **Oversell after removal.** Selling more euros than the shop has on record: the uncovered part now books $0 profit (no market rate on the server), as GBP does today. Before, it was valued at the Settings market rate. Default: accept.
3. **Re-adding EUR in Settings.** An admin can still add an EUR rate row by hand; it would then win over the feed again. Default: allowed (not blocked).
4. **Custom EUR rates lost on rollback.** Down re-seeds defaults only. Default: accept.
5. **Shop-day e2e still configures an EUR row.** `lira-web-071` step 0.0 writes an EUR rate
   (1.16 / 1.18) as its precondition, so on the shared e2e DB EUR is "configured" during that
   spec. Left as is (it tests a shop that re-added a row); `lira-web-107` deletes any EUR row first.
6. **Desktop specs.** Not run under Electron (no Electron on this Mac). Over the web shim
   (`--project=web-shared`): `lira-147` and the `lira-146` sign-loss case pass; `lira-142` and the
   `lira-146` cross case fail at `getByRole("button", { name: "Confirm Exchange" })` — the button
   reads "Proceed to Payout" for every exchange since the payment window opens for all
   currencies (`canSplitPayout`), so this is likely a stale label that predates this ticket
   (not proven by running the old code). Their EUR steps now take the rate from the live feed
   (network) instead of the 1.16 / 1.20 seed; they should mock the feed or provision an EUR row.
