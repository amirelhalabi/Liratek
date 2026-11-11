# UI contract: payout "− Less | + Extra" line

## When shown

`payer="payout"` (or `direction="payout"`) AND `onRoundUpChange` given AND no `payoutExcessToAccount`, `perCurrencyTotals` or `discountRow`. The "− Less" side only with `onKeptChange`.

## Test ids

- `payout-extra-less` — the line (a `DiscountLine`)
- `payout-extra-less-input` — the amount field (total's currency)
- `discount-mode-discount` / `discount-mode-extra` — the "− Less" / "+ Extra" switch (inside the line)
- `discount-cap-note` — "Capped to max ($5.00)" inside the line
- `payout-you-pay` — "You pay" row when a value is set

## Behaviour

1. Typing V on a side: fill target = owed ± min(V, cap); a single payment line is set to it (even after a hand edit); in split mode the last line absorbs the change.
2. Switching side: field cleared, lines back to owed.
3. Editing the lines: the field shows `payoutRoundUpRounded` (extra) or `payoutKeptRounded` (less), side switched to match; empty when neither.
4. Reports to the page are unchanged: `onRoundUpChange` / `onKeptChange` from the lines.
