# Research: LIRA-382

## R1 — Where the line lives

- **Decision**: inside `MultiPaymentInput` payout mode, shown when the caller wires `onRoundUpChange` and neither `payoutExcessToAccount`, `perCurrencyTotals` nor `discountRow` is set. "− Less" side only when `onKeptChange` is also wired.
- **Rationale**: every LIRA-334 payout screen already passes `onRoundUpChange` only for cash walk-in payouts outside a session and not For Partner; gating on it gives exactly the spec's screen list with zero page edits (also avoids touching Exchange, edited in parallel by LIRA-380).
- **Alternatives**: a per-page `discountRow` — rejected: 7 copies of the same line (rule 14).

## R2 — How the line moves money (one source of truth)

- **Decision**: the line moves only the payout's fill target (owed ± value). The kept/round-up reported to the page are still `payoutKeptRounded` / `payoutRoundUpRounded`, measured from the lines against the owed total. What the line shows when not being typed in is read back from those same figures.
- **Rationale**: reusing the pay-in extra (raising `effectiveTotals`) would make the overpay 0 and drop `rounding_given_*` from the payload. Reading back avoids a second computation and an autofill effect (a pay-in autofill once caused a synchronous render loop).
- **Alternatives**: separate autofill state like the pay-in line — rejected (second computation, loop risk).

## R3 — Collision with the LIRA-269 payout fee discount

- **Decision**: own state (`payoutLineText`, `payoutLineMode`), never `discountRaw`/`lineMode`.
- **Rationale**: OMT/Whish App receive and Binance cash-out show a fee discount on the payout through the built-in discount field; sharing state would merge two different meanings.

## R4 — Cap

- **Decision**: typed value above `SHORTFALL_MAX[currency]` is held at the cap with the existing "Capped to max (…)" note; acceptance via `isWithinShortfallMax` as today. The line works in the total's currency only.

## R5 — Loto cash prize payout

- **Decision**: not applicable. The Cash Prize tab has no payment box and core has no `rounding_given` on loto prizes; adding it would be a core booking change outside "same booking". Logged as a morning question in the spec.

## R6 — Labels

- **Decision**: "− Less" / "+ Extra" (switch), "Less" / "Extra" (row label), "You pay" row under the line when a value is set; en + ar.
