# Tasks: Euro rate from the online feed (LIRA-404)

**Input**: spec.md, plan.md · **Tests**: required (rule 17 failing-first).

## Phase 1: Guard tests FIRST

- [x] T001 Core `packages/core/src/__tests__/lira404.eurOnlineRate.test.ts` — run on unchanged code, record failure
- [x] T002 Frontend `positionsMarket.test.ts`, `PositionsPanel.feedMarket.test.tsx`, `liveExchangeRates.eurFeed.test.ts` — run on unchanged code, record failure

## Phase 2: Core

- [x] T003 Migration v235 + `create_db.sql`
- [x] T004 `TenantRepository.seedExchangeRates` LBP only
- [x] T005 `unrealizedProfitUsd` in `utils/lotMarketRate.ts`; `ExchangeLotService.getPositions` uses it
- [x] T006 Core build + sync; core guard green

## Phase 3: Frontend

- [x] T007 `EXCLUDED_CURRENCIES` without EUR; EUR first in `PRIORITY_CODES`; comments
- [x] T008 `fillPositionsMarketFromFeed` + `PositionsPanel` `marketRates` prop; Exchange page passes it
- [x] T009 Frontend guards green

## Phase 4: E2E + notes

- [x] T010 Web e2e `lira-web-107` + screenshot
- [x] T011 `UNRELEASED.md` line + Highlight card; `build-release-notes.cjs --check`
- [x] T012 `current_sprint.md` LIRA-404; FEATURE_GUIDE note
- [x] T013 Full core suite `--maxWorkers=2`, `yarn typecheck`, `yarn lint`

## Failing-first log

Run on the unchanged code (2026-11-25), before any fix:

- `lira404.eurOnlineRate.test.ts`: **4 failed / 3 passed.** Failed: v235 "exists" (`undefined`),
  fresh DB has no EUR row (`Expected 0, Received 1`), up/down (`m` undefined), seedConfig
  (`Expected 0, Received 1`). Passed (characterization, **not proven failing-first**): lots
  before/after removal in four directions + oversell, buying after removal, server positions null
  without a row — the lot engine already needed no EUR row; these pin that it stays so.
- `lotMarketRate.unrealized.test.ts`: 2 failed (`unrealizedProfitUsd` not exported).
- `positionsMarket.test.ts`: suite failed (`Cannot find module '../positionsMarket'`).
- `PositionsPanel.feedMarket.test.tsx`: "fills from the feed" failed (`$1.2000` not found — "—"
  shown); "keeps — with no feed" passed (characterization).
- `liveExchangeRates.eurFeed.test.ts`: both failed (set had EUR; first code `GBP`, not `EUR`).

After the fix: all green. Full core suite surfaced 3 offline suites (`drawers.binding`,
`allFamilies.parity`, `bindings.complete`) whose EUR top-up fixture relied on create_db.sql's EUR
row; the fixture now carries the feed hint like the real top-up screen, and the
"recorded EUR rate" test configures its own EUR row (it tests a configured currency).

Web e2e `lira-web-107` was written after the fix (not proven failing-first). Related
`lira-web-022`, `026`, `089` re-run green.
