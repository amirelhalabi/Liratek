# Implementation Plan: Partner switch on repair jobs (LIRA-403)

**Spec**: `spec.md` · **Reference implementation**: Custom Services (`CustomServiceRepository.createService` FOR/VIA blocks, `PartnerModeSwitch`, `partnerModeTransition`).

## FEATURE_GUIDE §13 checklist

1. **Transaction row** — `MAINTENANCE`, `source_table='maintenance'`, `source_id=job id` (unchanged). No supplier sibling.
2. **IN/OUT badge** — `MAINTENANCE: "in"` (cashFlow.ts), same as For-Partner Custom Services (`IN`). No change.
3. **Payment legs** — For: none (refused). Via: unchanged single IPC payload; repo consumes IN legs only (rule 16, existing loop).
4. **Drawers** — For: none. Via: as today.
5. **Client propagation** — unchanged on both modes; For keeps `client_id`, labels `client_name` with the partner (like Services).
6. **CUSTOMER_ACCOUNT** — Via: allowed (existing gate). For: refused (no legs).
7. **Partner ledger** — For: `FOR_MAINTENANCE` DEBIT per currency of the amount due (labour final + parts). Via: `THROUGH_MAINTENANCE` CREDIT of labour cost. `reference_table='maintenance'`, `reference_id=job id`.
8. **Void path** — generic `_reversePartnerLedger` (reference = source) + existing payment/debt/profit reversal. Proven by tests.
9. **Profits** — stamp unchanged; `getMaintenanceTotals`, `daily_maint`, `getMaintenanceDetail` weighted by `partnerCoverageRatio('maintenance', m.id)`; detail gains `has_partner_obligation`, `partner_coverage_ratio`. Transaction-level reports already use `txnPartnerCoverageRatio` on source.
10. **Sessions** — For hidden (`useForPartnerOffInSession`) and refused with `deferPayment`; Via books CREDIT on defer (before the defer early-return).
11. **Audit viewer** — no new type; row label unchanged.

## Layers

- **Migration v234** `maintenance.partner_mode TEXT CHECK IN ('FOR','VIA')`, `maintenance.partner_id INTEGER REFERENCES partners(id)`; `create_db.sql` updated.
- **Core validator** `saveMaintenanceJobSchema`: `partner_mode` (`z.enum(['FOR','VIA']).nullable().optional()`), `partner_id` (`positiveIntegerSchema.nullable().optional()`); refines: mode needs partner; For → no payments / change / kept / extra; Via → no extra. Exported constant messages shared with the service.
- **Core repo** `MaintenanceRepository`: `hasPartnerColumns()`, `setJobPartner()`, `getColumns()` carries partner columns; `MAINTENANCE_AMOUNT_FIELDS`-style lock for partner fields; `processPayments` gets `partnerMode`/`partnerId`: For skips legs/change/rounding/account/debt; both write partner rows right after `createTransaction` (before the defer return).
- **Core service** `MaintenanceService.saveJob`: resolve effective mode (incoming else stored); For refused on basket; `wantsToCharge` adds "For moving into a paid status"; persists partner fields; same guards server-side as the schema.
- **PartnerRepository** union: `FOR_MAINTENANCE`, `THROUGH_MAINTENANCE` (doc comment above it).
- **ProfitRepository** — three maintenance queries weighted.
- **Transports** — handler/route pass the parsed schema data straight to `saveJob` (no key picking); preload `maintenance.save` is typed `SaveJobParams` → add keys to `SaveJobParams`. Three-way diff: schema ⊇ new keys, preload type = `SaveJobParams`, service reads both (rule 23). `SessionCheckoutService` forwards `formData` whole.
- **Frontend** — move `PartnerModeSwitch` + `partnerModeTransition` to `features/partners/` (shared, test-id prefix prop, labels in `partners` namespace); Custom Services imports updated; Maintenance page: switch + `PartnerSelector`, For → "Deliver to partner" button through the ONE `buildJobPayload` (mode is a parameter), Via → CheckoutModal without the extra switch; `isAmountLocked` also locks a charged For job; `MaintenanceJob` UI type gets the fields; `electron.d.ts` union.

## Tests

- Core guard (failing-first): `packages/core/src/services/__tests__/lira403.maintenancePartnerModes.test.ts` on the real `create_db.sql`, payloads through `saveMaintenanceJobSchema.parse` → `MaintenanceService.saveJob`: For DEBIT + no drawer; Via CREDIT + legs; LBP job with parts; refund + void nets 0 per currency (ledger, drawers, profit); Profits counts For only after settlement; variant walk customer/For/Via; refusals (For + legs, For in basket, extra on partner job, mode without partner); resave of a paid For job does not re-bill.
- Frontend: `PartnerModeSwitch` test moved; Maintenance page payload test for For/Via.
- Web e2e: extend a maintenance web spec if feasible.
