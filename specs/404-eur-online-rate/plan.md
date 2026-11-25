# Implementation Plan: Euro rate from the online feed (LIRA-404)

**Spec**: spec.md · **Date**: 2026-11-25

## Technical context

React 19 + Vite frontend, `@liratek/core` (SQLite) shared by Electron IPC and the Fly REST
backend. Exchange submits already use `addDirectTransaction` on both transports, so the money
write path needs no change. Work is: data (migration + seeds), one constant, a shared pure
helper, and the Positions panel display.

## Constitution check

- Rule 10: migration in `migrations/index.ts` AND `create_db.sql` (row removed + v235 listed).
- Rule 13/14: `unrealizedProfitUsd` lives once in `utils/lotMarketRate.ts` (browser-safe leaf,
  rule 29); the service and the panel both call it. The fill rule is one pure function.
- Rule 17: guard tests first, failures recorded in tasks.md.
- Rule 19: no transport change — panel reads the same `exchangeLots.getPositions` on both;
  the feed is fetched by the screen on both.
- Rule 20/26/31: no new ledger row, no auto row, no copied value.
- Rule 27: the feed snapshot is client-side; nothing server-side reads the clock for this.
- Rule 30: release note + Highlights card with a real screenshot.

## Design

1. **Migration v235 `eur_rate_from_feed`**: `DELETE FROM exchange_rates WHERE to_code = 'EUR'`
   (guarded by `tableExists`). Down: `INSERT OR IGNORE … SELECT tenant_id, 'EUR', 1.18, 1.16,
1.2, -1 FROM currencies WHERE code = 'EUR'`.
2. **Seeds**: `TenantRepository.seedExchangeRates` LBP only; `create_db.sql` EUR insert removed.
3. **Feed constant**: `EXCLUDED_CURRENCIES = {USD, LBP}`; `PRIORITY_CODES` starts with EUR.
4. **Core helper**: `unrealizedProfitUsd(openQty, marketUnitUsd, avgUnitCostUsd)` (cent-rounded)
   in `utils/lotMarketRate.ts`; `ExchangeLotService.getPositions` uses it.
5. **Frontend**: `features/exchange/utils/positionsMarket.ts` →
   `fillPositionsMarketFromFeed(positions, marketRates)`; `PositionsPanel` takes `marketRates`
   prop from the Exchange page and renders the filled rows.

## Tests

- Core: `packages/core/src/__tests__/lira404.eurOnlineRate.test.ts` — migration up/down, seed,
  lot cost kept + four directions + oversell after removal.
- Frontend: `positionsMarket.test.ts`, `PositionsPanel.feedMarket.test.tsx`,
  `liveExchangeRates.eurFeed.test.ts`.
- Web e2e: `lira-web-107-eur-online-rate.spec.ts` (mocked feed; EUR→USD with no row; screenshot
  of the Positions panel to `frontend/public/whats-new/1.35.0/eur-positions-market.png`).
