# Feature Specification: Partner settlement by day

**Ticket**: LIRA-346 (rollout step 3 of the LIRA-343 settle-by-day calendar). Work happens on `main`.

**Created**: 2026-10-26 · **Status**: Built (uncommitted, awaiting owner review)

**Builds on**: LIRA-343 (`specs/343-omt-settle-by-day/`): the generic `buildSettleDays` / `buildDaySelections` / `allocateAccountSettlement` utilities and the generic `settleCalendar` components. Read that spec first; this one only states what differs for partners.

## Owner decisions (2026-10-26, final)

- **P1 — a coverage record.** A new table `partner_settlement_coverage` (migration v225) stores what each partner settlement paid on each partner row ("paid by which settlement"), like `supplier_settlement_coverage` (v217). Skipping days and exact undo rely on it.
- **P2 — every partner row sits on its own shop day, and rows net against each other.** For and Through rows, Whish top-ups, manual paper entries: each is a day row. A For $100 (partner owes the shop, 20 Oct) and a Through $300 (the shop owes the partner, 21 Oct) settled together with a net payment of $200 to the partner leave both days green.
- **P3 — overpay becomes partner credit.** Money beyond the picked days stays on the partner account as an account row (on no day) and is offered at the next settlement as "Use partner credit [x]".
- **P4 — voiding a sale a settlement already paid.** The void goes through; the settlement is unchanged; what it paid for that sale becomes partner credit on the account, and the void day gets the ↺ mark (LIRA-343 R12, balance = Σ open remaining).

## Decisions taken while building (for owner review)

- **D1 — sign.** Partner rows are signed like the partner balance: **+ = the partner owes the shop (DEBIT)**, − = the shop owes the partner (CREDIT). With that sign the generic allocator's "payer" is the partner, so its "account credit" is exactly the **partner credit** (the shop owes the partner at account level), and `credit_used` is "Use partner credit".
- **D2 — rows and groups.** A settle row is a GROUP of partner_ledger rows: the original booking (head, lowest id) plus its reversals, item refunds and undos (same type and currency, same source; item refunds reach the sale through their `transactions` row — the same rule as `sameObligationGroupSql`). Its amount is the group's net. One TS function (`partnerSettleUnits.ts`) defines it; a test pins it to the SQL group rule.
- **D3 — DAY vs ACCOUNT.** ACCOUNT rows (on no day): settlement rows (`SETTLEMENT`), forgives / write-offs (`DISCOUNT`), and manual entries with "Cash moved" (they are payments). Everything else is a DAY row, on the shop day (`localDayExpr`) of its head.
- **D4 — signed coverage.** A coverage row has an amount > 0 and a `side` (DEBIT / CREDIT): the side of the row it consumes. A row's remaining = its net − Σ active coverage (signed). When a void or an undo leaves a row covered beyond its net, the remaining flips sign; that part is shown as an ACCOUNT row with a ↺ origin (VOID / UNDO) on the day of the reversal, and a later settlement can use it like any account row. Nothing extra is written for it.
- **D5 — a settlement covers itself.** The new settle writes one `SETTLEMENT` row per currency with the money (0 when only netting or credit is used), a `DISCOUNT` row for a forgive, and coverage on the picked rows. Its own `SETTLEMENT` row gets coverage equal to the money applied, so its leftover (overpay, P3) is its open remaining. No separate overpay row.
- **D6 — profit.** `partner_ledger.covered_amount` stays the ONE source the profit fragments read (`ProfitRepository`, `constants/partnerObligation.ts`), and ONE writer keeps it in step: `covered_amount = legacy_covered_amount + Σ active PAYMENT / NETTING / WAIVE / DISCOUNT coverage` on obligation heads (shared oldest first over the heads of one group). **Owner decision 2026-10-26 (reverses the first draft): a For row cleared by NETTING in a settlement counts its profit as earned at that settlement.** P2: For $100 (20 Oct) + Through $300 (21 Oct), the shop pays a net $200 → the $100 sale's profit is earned by that settlement; undoing the settlement puts it back to deferred. RELIEF never counts. Legacy coverage is untouched. Read-time netting is unchanged (Via-Partner pay-outs only, LIRA-305). The list is `PARTNER_PROFIT_COVERAGE_SOURCES` (one place).
  - **Owner decision 2026-10-26 (page section 8, Case B):** netting against a manual credit entry with "Cash moved" off (a paper credit) also releases the For sale's profit — "anything that clears the sale earns it". This is the built behaviour (pinned by a characterization test); LIRA-305's pay-out rule for paper credits is unchanged.
- **D7 — history before v225.** v225 freezes today's `covered_amount` into `legacy_covered_amount`. Old settlement / forgive / cash-moved rows are shown as account credit minus what they already paid (their frozen legacy coverage, matched oldest first), so the balance always equals what is open. "Settle old history up to <date>" is a no-money settlement through the same endpoint: the picked old days and every account credit, money 0.
- **D8 — the old settle path stays** (`partners:settle`, balance-based, still used by offline replays and old clients). Its coverage now goes through the same writer (rows in the new table, oldest-first on obligation heads as before), so every settlement after v225 is undone exactly. A settlement from before v225 is undone with today's newest-first give-back, limited to the frozen legacy amounts.
- **D9 — undo.** Any settlement can be undone, in any order. Its coverage is reversed exactly. When a later, still-active settlement also paid a row this one paid, this one's coverage on that row is kept, and a RELIEF coverage row owned by the undo moves the same amount onto the undone settlement's own row: the later day stays as it was and the account shows the difference (LIRA-343 R12). A credit a later settlement used shows the same way, with no extra writes (D4).
- **D10 — forgive.** The calendar sheet keeps "Forgive" per currency when the partner pays (same rule as today: off when the shop pays). It is booked as today (`DISCOUNT` row + COUNTERPARTY_DISCOUNT transaction) and covers the oldest picked debts (`WAIVE`).
- **D11 — roles.** Calendar reads: same gate as the partner reads. Settle picked days and old history: `admin` + `staff`, the same as `partners:settle` (old history is a settlement with no money). Offline: online-only, like `partners:settle`.

## Scope

- Migration v225 (table + `legacy_covered_amount`, both files, `down()`).
- Core: units builder, month rows + day detail reads, settle-picked-days write, exact undo, void relief (derived), profit writer, old-path coverage through the writer.
- Dual transport: IPC + REST + adapter, shared Zod schemas in `validators/partner.ts`.
- Partners page: the Settle button opens the calendar sheet (generic `SettleCalendar`, `SettleSelectionBar`, `SettleDayDetails`), with per-currency payment, "Use partner credit", forgive, and "Settle old history up to…".
- `getLedgerEntries` day filters compare the shop day (`localDayExpr`), not raw text.

## Out of scope

- Undoing a standalone write-off or a paper (PARTNER_ADJUSTMENT) entry (not undoable today; unchanged).
- USDT rows (partners never carry USDT balances; such rows are ignored by the calendar).
- Splitting coverage between several heads of one group in the calendar view (a group shows as one row).
- A What's new screenshot from a real screen (needs a web e2e run; see the report).

## Known limits

- **Account rows of both signs at once.** An account row where the partner owes the shop (the shop overpaid the partner, or an undo / void relief in that direction) is always in scope and nets first, like LIRA-343. The sheet's pre-fill (`buildDaySelections`) counts only the picked days and the partner credit, so in that rare case the pre-filled payment is off by that amount; the server's stale check and allocator stay exact, and the difference simply stays open.
- **Old pre-v225 legacy coverage** is matched to old payer rows oldest first in total, per partner and currency (the old data never recorded which settlement paid which row). Balance and open totals are exact; which old payment "paid" which old row is a best match.
- **Undo keep-rule** keeps an undone settlement's coverage only on DAY rows a later active settlement also paid. A credit the undone settlement used becomes available again (it was genuinely handed back).
