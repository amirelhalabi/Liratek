# Research: LIRA-340

## R1 — Where to split Transactions vs Payments
- **Decision**: in core, as `LedgerFilters.group: "transactions" | "payments"`; payments = `transaction_type IN (SETTLEMENT, DISCOUNT, ADJUSTMENT)`; transactions = everything else (incl. NULL/unknown types).
- **Rationale**: one definition (rule 14) shared by both transports; counts and rows come from the same predicate; new types fall into Transactions automatically (spec edge case).
- **Alternatives**: classify on the screen from one unfiltered list — rejected: duplicates the existing server-side filters (mode/provider/date) on the client and creates a second predicate.

## R2 — Which types are "Payments"
- **Decision**: SETTLEMENT, DISCOUNT, ADJUSTMENT.
- **Rationale**: owner 2026-10-25 "same as Suppliers": the supplier Payments window is its ledger (PAYMENT, ADJUSTMENT, DISCOUNT); partner ADJUSTMENT is "Add credit / debt", DISCOUNT is the write-off/forgive path, SETTLEMENT is paying in either direction.
- **Alternatives**: put ADJUSTMENT under Transactions — rejected by the owner's answer.

## R3 — Counts on the buttons
- **Decision**: two statement reads per selected partner: Transactions with the current Transactions filters, Payments with its date filter. Counts = rows returned.
- **Rationale**: no new count endpoint; the existing statement call already returns balance + breakdown.
- **Alternatives**: a count endpoint — unnecessary at partner ledger sizes.

## R4 — The window component
- **Decision**: move `SupplierTableModal` to `frontend/src/shared/components/TableModal.tsx` with an optional `testId`; Suppliers re-imports it.
- **Rationale**: spec FR-006 (one shared component); owner memory "reuse over copies".

## R5 — Voided entries
- **Finding**: the ledger read has no voided column; voids write reversing entries. Today's table shows both rows; we keep exactly that (display only).
