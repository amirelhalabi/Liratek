# Implementation Plan: Full transaction details

**Branch**: `main` | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md) | **Ticket**: LIRA-329

**Input**: Feature specification from `specs/329-transaction-full-details/spec.md`; field gaps from `docs/plans/ongoing_plans/TRANSACTION_DETAIL_AUDIT.md`.

## Summary

Every new transaction keeps everything the cashier entered, in three places on the existing `transactions` row, without schema changes:

1. `metadata_json.details`: one typed object per transaction kind (`{ v: 1, kind, ...fields }`), defined once as a zod schema in core.
2. `metadata_json.payment_snapshot`: a copy of the payment lines, change returned and change kept, built by one shared helper from the same legs the repository already books.
3. The existing `client_name` / `client_phone` columns, filled by one shared resolver whenever a name or phone is known.

Existing metadata keys stay untouched, because reports and filters read them. Work proceeds module by module, OMT/Whish system first. Each module ships with a completeness guard test that fails if a field from its audit list is missing.

## Technical Context

**Language/Version**: TypeScript (strict), Node 22 / Electron 31 main process, React 19 renderer.

**Primary Dependencies**: zod (core validators), better-sqlite3 / SQLCipher, Express (backend), TanStack Query (frontend, display not touched).

**Storage**: the existing `transactions.metadata_json` TEXT (JSON) and `client_name` / `client_phone` columns. **No migration.**

**Testing**: core jest (real schema via `create_db.sql` + migrations), backend jest (REST), frontend jest (payload builders), web e2e (one spec proving parity).

**Target Platform**: desktop (Electron, IPC) and web (Fly REST), with the same core code.

**Project Type**: monorepo (core + electron-app + backend + frontend).

**Performance Goals**: no measurable cost per save. The details are built from data already in memory, with one JSON stringify.

**Constraints**:

- No change to any amount, profit, ledger or drawer (FR-008).
- Old rows untouched (FR-009).
- Never block a sale because of details: in production an invalid details object is logged and saved stripped; in tests it is a hard failure.

**Scale/Scope**:

- About 35 transaction kinds across about 18 repositories/services.
- About 25 createTransaction call sites.
- Payload additions on about 10 screens, where a field is not sent today (e.g. Alfa Gift tier, including-fees, item key).

## Constitution Check

_GATE: passes. Re-checked after design: passes._

| Principle                   | How this plan complies                                                                                                                                                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. One core, two transports | Details are built in core repositories/services only. Transports pass the same payload. Payload additions go into the core validators shared by IPC and REST (rule 19).                                                                                                                                                    |
| II. Layer boundaries        | Builders live next to their repository (SQL stays there). The client resolver reads the client through the repository layer. No SQL in services (rule 13).                                                                                                                                                                 |
| III. Contracts defined once | One zod schema per kind in `packages/core/src/validators/transactionDetails.ts`. The payment snapshot comes from one helper; the client resolver is one helper (rule 14). Frontend payload types stay derived from the schemas (rule 21). Before any new key goes into an existing schema, run a three-way diff (rule 23). |
| IV. Money integrity         | The change is additive metadata only. Each module's existing money tests must stay green unchanged. A new "amounts unchanged" assertion compares amounts/profit/ledger rows with and without details (FR-008). No new ledger rows, so rule 20 does not apply. Auto rows keep `is_auto` (rule 26).                          |
| V. Data and security        | No new SQL except reading the client by id (tenant-scoped through BaseRepository). No migration.                                                                                                                                                                                                                           |
| VI. Testing                 | Per module, the completeness guard is written first and seen failing (rule 17). Field names in assertions come from the schemas (rule 24). One web e2e spec reads a saved transaction's details over REST.                                                                                                                 |
| VII. Code quality           | Strict types inferred from the zod schemas; no `any`. Module loggers.                                                                                                                                                                                                                                                      |

## Design

### D1. Shape on the row

```text
metadata_json = {
  ...existing keys (unchanged),
  details: { v: 1, kind: "omt_send", serviceType, reference, sender, receiver, fees, ... },
  payment_snapshot: { lines: [...], change_returned: [...], kept: { usd, lbp } }
}
```

- `kind` is a fixed list (see data-model.md), a discriminated union on `kind`.
- `v` lets a later display step read old and new shapes.
- Absent or empty fields are omitted, never set to null or 0 (spec edge case).

### D2. One entry point

`createTransaction(data)` gains two optional inputs: `details` and `payment_snapshot`. It:

- validates `details` against its kind's schema (strict in tests; logged and stripped in production);
- merges both into `metadata_json`;
- applies the client resolver: if `client_id` is set and the name or phone is missing, it reads them from `clients`. The existing guard "phone requires name" stays satisfied, because the resolver fills the name first.

Void and refund use their own INSERTs today (TransactionRepository ~5745 / ~6317). They get the same merge and resolver via a small shared function, not a copy.

### D3. Payment snapshot helper

`buildPaymentSnapshot({ payments, keptChange, changeReturned })` in `packages/core/src/utils/paymentSnapshot.ts`:

- It uses `partitionLegs` from `utils/payments.ts`, so IN and OUT legs are classified exactly as the repository books them (rule 16).
- Pure function, no Node built-ins, so it stays browser-safe (rule 29).

### D4. Builders per module

Each repository (or service, for multi-row flows) builds its kind's details from the validated input it already holds, e.g. `buildOmtTransferDetails(input)`. Builders are pure and unit-tested. The session checkout, the recharge basket and the partner order reuse the same module builders, so a FinancialService row has identical details whichever path saved it (FR-002).

### D5. Payload gaps

Some fields never leave the screen today:

- Alfa Gift tier;
- including-fees (transfers, Whish top-up from a client);
- the Katsh/iPick item key and category on the combined call;
- the typed discount where it is folded into the amount;
- the client phone on several forms;
- the Online Brokerage fee input. That one is also suspected bug #1; here only its value is saved, and the money fix is the separate bug ticket.

For each gap:

- add the key to the core schema (three-way diff first, rule 23);
- send it from the form, built once per operation (rule 22);
- carry it to the builder.

### D6. Delivery order (FR-012)

1. **Foundation**: schemas skeleton, `createTransaction` inputs, client resolver, payment snapshot, the guard-test harness.
2. **OMT/Whish system** (Services page) + Custom Services + Hold Money.
3. **Mobile Recharge**: MTC/Alfa, buy-back, Alfa Gift, Katsh/iPick, Whish/OMT App bills and transfers, Binance, top-ups, basket, partner order, wrong number.
4. **POS sale + Maintenance + Warranty.**
5. **Exchange + Loto.**
6. **Money & accounts**: expenses, debts, suppliers, partners.
7. **Session checkout siblings, void, refund.**

Each step lands as its own commit with its guard tests and a release-note line.

## Project Structure

### Documentation (this feature)

```text
specs/329-transaction-full-details/
├── spec.md
├── plan.md              # this file
├── research.md
├── data-model.md        # every kind and its fields
├── quickstart.md
├── contracts/
│   └── transaction-details.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── validators/transactionDetails.ts      # NEW: zod schemas per kind + payment snapshot schema (browser-safe)
├── utils/paymentSnapshot.ts              # NEW: buildPaymentSnapshot (pure)
├── utils/transactionClient.ts            # NEW: client name/phone resolver contract (pure part)
├── repositories/TransactionRepository.ts # createTransaction: details/payment_snapshot/client resolver; void/refund
├── repositories/FinancialServiceRepository.ts, RechargeRepository.ts, SalesRepository.ts,
│   MaintenanceRepository.ts, ExchangeRepository.ts, LotoTicketRepository.ts, LotoCashPrizeRepository.ts,
│   CustomServiceRepository.ts, HoldMoneyRepository.ts, ExpenseRepository.ts, DebtRepository.ts,
│   SupplierRepository.ts, PartnerRepository.ts, WrongNumberRepository.ts …  # builders + pass details
├── services/SessionCheckoutService.ts, RechargeBasketService.ts, RechargePartnerOrderService.ts, WarrantyService.ts
└── **/__tests__/*.details.test.ts        # completeness guards per kind

frontend/src/features/**                   # send the fields listed in D5 (payload once, schema-typed)
backend/src/api/**, electron-app/**        # no route/handler changes expected beyond schema re-exports
frontend/tests/e2e-web/lira-web-070-transaction-details.spec.ts  # parity: details over REST
```

**Structure Decision**: core-centred change, with frontend payload additions only where a field is not sent today. No new REST routes or IPC channels.

## Complexity Tracking

No constitution violations.
