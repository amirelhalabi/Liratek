# Implementation Plan: Give credit back from a line for sale

**Branch**: `337-give-credit-back` (work on `main`, no branch) | **Date**: 2026-10-18 | **Spec**: [spec.md](./spec.md) | **Ticket**: LIRA-337

## Summary

Add a "Give credit back" action to Phone Lines → For sale. It moves part of a for-sale line's credit to one of the shop's own lines of the same carrier. It is the mirror of LIRA-309's "Recharge from shop-line credit":

- **One pure planner, shared by the screen and the server.** `planLineGiveBack` (browser-safe, in `utils/`) computes the transfer, the SMS fee, the credit left, the price drop and the cost drop. The preview and the saved figures come from this same function (FR-012, rule 14).
- **One new transaction type**, `LINE_CREDIT_GIVE_BACK`. Its writes:
  - a `+received` USD leg on the carrier drawer (MTC/Alfa), as a payments row;
  - a `+received` movement on the shop line (`carrier_line_movements`, reason `RESALE_GIVE_BACK`);
  - `−priceDrop` on the product's selling price;
  - `−costDrop` on the product's cost and on its open batch unit cost;
  - the line's new credit;
  - a `resale_line_give_backs` row holding the exact deltas.
- **Undo is the generic void**:
  - `_reversePayments` reverses the drawer leg;
  - `_reverseCarrierLineMovements` reverses the shop-line movement;
  - a new `_reverseResaleLineGiveBack` reverses product, batch and line by delta.
  - Refusals: the line is sold, or a newer recharge/give-back on the line is still active. The newest-first check spans BOTH tables through ONE helper.
- **Both transports**:
  - schema in `validators/resaleLine.ts`;
  - IPC `resale-lines:give-back` (admin, staff);
  - REST `POST /api/resale-lines/:productId/give-back`;
  - adapter `giveBackResaleLineCredit`.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20, React 19 + Vite, Electron 31

**Primary Dependencies**: `@liratek/core`, Zod, Express, `@liratek/ui`

**Storage**: SQLite. Migration **v223** adds `resale_line_give_backs`. v222 is the last version on disk on 2026-10-18; re-read `migrations/index.ts` at build time, because another session also adds migrations.

**Testing**: core jest (planner unit test, service + void money tests), frontend jest (panel), backend route test, web e2e. Affected paths only. No desktop e2e on the Mac.

**Target Platform**: Electron desktop + multi-tenant web

**Constraints**: every figure is rounded to cents. Create + void must net to $0.00 per touched balance (SC-003).

**Scale/Scope**: one action, about 12 files touched, 1 new table.

## Constitution Check

| Rule | How this plan meets it |
|---|---|
| 13 services never touch DB | SQL in `ResaleLineRepository`; service orchestrates in `withTransaction` |
| 14 one derivation | `planLineGiveBack` used by panel preview and service; newest-first check one helper |
| 16 payment legs | single IN-style leg on carrier drawer, no OUT legs |
| 17 failing first | money tests written and run red before the service exists |
| 19 dual transport | IPC + REST + adapter, same core service |
| 20 reversal owner | drawer leg: `_reversePayments`; shop line: `_reverseCarrierLineMovements`; product/batch/line: new `_reverseResaleLineGiveBack`; type is reversible (not in `NON_REVERSIBLE_TRANSACTION_TYPES`) |
| 21/22 payload types | `GiveBackResaleLineInput = z.input<…>`; one payload literal in the panel |
| 26 is_auto | not auto: operator action, visible in Transactions |
| 27 day | `client_day ?? clientDay()` |
| 29 browser leaf | planner lives in `utils/telecomCredit.ts`-style pure module, no Node imports |
| 30 release note | one line under Phone Lines / Inventory heading |
| 10 migrations | `migrations/index.ts` AND `create_db.sql` |

No violations.

## Project Structure

### Documentation

```text
specs/337-give-credit-back/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md, tasks.md
└── contracts/give-back.md
```

### Source code (touched)

```text
packages/core/src/
├── utils/lineGiveBack.ts                 (new, pure: planLineGiveBack)
├── validators/resaleLine.ts              (giveBackResaleLineSchema)
├── repositories/ResaleLineRepository.ts  (recordGiveBack, reverseGiveBack, newest-change helper)
├── repositories/TransactionRepository.ts (_reverseResaleLineGiveBack in void + refund)
├── services/ResaleLineService.ts         (giveBack)
├── constants/transactionTypes.ts, postingRules.ts, utils/cashFlow.ts, utils/transactionText.ts
├── db/migrations/index.ts                (v223)
└── index.ts, browser.ts                  (exports)
electron-app/create_db.sql, handlers/resaleLineHandlers.ts, preload.ts, schemas/index.ts
backend/src/api/resaleLines.ts
frontend/src/api/backendApi.ts, api/ElectronApiAdapter.ts, types/electron.d.ts
packages/ui/src/api/types.ts
frontend/src/features/phoneLines/components/ResaleLineGiveBackPanel.tsx (new)
frontend/src/features/phoneLines/pages/PhoneLines/index.tsx (button)
frontend/src/features/audit/auditConstants.ts, transactionPresentation.ts
frontend/src/i18n locales (phoneLines namespace)
docs/release-notes/UNRELEASED.md
```

## Complexity Tracking

| Choice | Why | Simpler alternative rejected because |
|---|---|---|
| New table instead of a new `source` in `resale_line_recharges` | that table's CHECKs (`source IN (…)`, `cost_usd > 0`, `credits_added >= 0`) forbid a negative change, and SQLite cannot alter a CHECK without rebuilding a table that already holds money rows | a table rebuild on a live money table is riskier than one new table |
