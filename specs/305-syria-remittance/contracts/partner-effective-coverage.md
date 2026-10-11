# Contract — partner effective coverage (core, internal)

LIRA-305 adds no external interface. No IPC channel, REST route, preload binding, adapter function or Zod schema is added
or changed. The only contract is an internal SQL-fragment contract inside `@liratek/core`.

## `partnerEffectiveCoveredSql(alias: string): string`

**File**: `packages/core/src/constants/partnerObligation.ts` (not exported from `index.ts` or `browser.ts`).

**Input**: `alias` — the `partner_ledger` alias of a row that passes `partnerObligationHeadRowSql(alias)`. Must not be the
bare table name, and must not be one of the aliases the inner sub-queries use (reserved: `plb`, `plb_tx`, `plb_tx2`, `ph`, `pg`, `g`,
`plg`, `plg_tx`, `plh_earlier`, `plh_prev`, `plo_first` — list them in the doc comment).

**Output**: a parenthesised scalar SQL expression, no bind parameters, value in `[0, coverable(alias)]`.

**Semantics**: see `data-model.md` → "The derived quantities". Pay out heads add netting; every other head returns exactly
`MIN(alias.covered_amount, coverable(alias))`.

## `partnerNettingBalanceSql(alias: string): string`

Same file, exported (tests use it). Scalar: Σ DEBIT − Σ CREDIT for `alias`'s partner/currency/tenant, leaving out only
paper credits (CREDIT rows that source a `PARTNER_ADJUSTMENT` transaction) (data-model.md).

## `partnerPayoutUncoveredSql(alias)` and `payoutNewerSumSql(alias)` (`@internal`)

Exported only so T004 (o) can pin them to `partnerObligationCoverableSql` (rule 14). Not for other callers. The ONE definition of the netting balance (rule 14); not a replacement for `getBalance`, which
keeps showing the full balance on the Partners page.

**Consumers (the only two; rule 14)**:

| Fragment | Before | After |
| --- | --- | --- |
| `partnerCoverageRatioWhereSql` | `SUM(MIN(covered_amount, coverable)) / SUM(coverable)` | `SUM(effective) / SUM(coverable)` |
| `partnerUncoveredExistsWhereSql` | `plp.covered_amount < coverable − 0.005` | `effective(plp) < coverable(plp) − 0.005` |

Every Profits reader already goes through these two (`notPartnerPending`, `partnerCoverageRatio`,
`txnNotPartnerPending`, `txnPartnerCoverageRatio` in `ProfitRepository.ts`), so desktop (IPC → `ProfitService`) and web
(REST `backend/src/api/profits.ts` → `ProfitService`) change together.

**Not consumers (must stay on raw stamps)**: `PartnerRepository.applySettlementCoverage` (which rows cash covers) and
`TransactionRepository._unwindPartnerSettlementCoverage` (give-back on a settlement void). Netting must never be written
into `covered_amount`.

**Tenant scoping**: every new sub-query filters `tenant_id = <alias>.tenant_id`, `partner_id = <alias>.partner_id` and
`currency = <alias>.currency`. `yarn check:tenant-scoping` does not scan `constants/`, so a unit test asserts this on the
generated SQL string of each NEW sub-query (`plb`, `plb_tx`, `plb_tx2`, `ph`, `pg` — T004 n). The two `transactions`
look-ups use `+<alias>.tenant_id` so SQLite keeps `idx_transactions_source` (T004 t asserts the plan). The inherited coverable / head
fragments are reference-keyed by design (no tenant filter, `partnerObligation.ts` ~:72-75) and are not part of that
assertion.

**Ordering**: "newer" = `julianday(created_at)` then `id` — never text order (two formats are stored).

## Existing external contracts the corridor relies on (unchanged; listed so nobody re-builds them)

| Operation | Desktop | Web | Shared schema |
| --- | --- | --- | --- |
| Book SEND / RECEIVE | IPC `custom-services:add` (`electron-app/handlers/customServiceHandlers.ts`) | `POST /api/custom-services` (`backend/src/api/customServices.ts`) | `createCustomServiceSchema` (`packages/core/src/validators/customService.ts`, `direction` + payout refines) |
| Void (Custom Services history) | IPC `custom-services:delete` | `DELETE /api/custom-services/:id` | — |
| Void / refund (Transactions page) | IPC `transactions:void` / `transactions:refund` | `POST /api/transactions/:id/void` / `.../refund` | core transaction validators |
| Settle partner | IPC `partners:settle` | `POST /api/partners/settle` | `partnerSettleSchema` |
| Partner balance / ledger | IPC `partners:get-balance` / `partners:get-ledger` | `GET /api/partners/:id/balance`, `/ledger` | — |
| Profits by module | IPC `profits:by-module` (password unlock) | `GET /api/profits/by-module?from&to` (unlock) | — |

Channel and route names above are as used by the existing specs `lira-custom-service-payout` and
`lira-web-custom-service-payout` / `lira-web-008-partners` / `lira-web-052`; T001 re-confirms each by grep before the e2e
tasks rely on them.
