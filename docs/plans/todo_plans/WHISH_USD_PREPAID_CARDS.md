# TODO — MTC / Alfa prepaid cards in Whish App USD mode

**Status:** deferred (owner decision 2026-10-15). Not part of the first Whish App USD-mode release.

## Context

Whish App → Bills is getting an LBP | USD switch, like the currency selector in the
Whish app itself. In USD mode each item shows and sells at its USD price
(`cost_usd` / `sell_usd`); the cost comes out of the Whish App drawer's USD balance.

The first release leaves the **MTC / Alfa Prepaid** cards out of USD mode: they stay
LBP-only. Every other group (Alfa data bundles, MTC validity, internet, gaming, gift
cards, streaming, international telecom, ACTC) is in.

## Why they were left out

The prepaid cards carry the "Only Days" / credits-back logic (`credits`,
`validity_days`, `days_cost_lbp`, `sell_days_lbp`, `sell_credit_lbp`,
`max_returned_credits_usd`; `packages/core/src/utils/telecomCredit.ts`, plan
`TELECOM_DAYS_COST_PLAN.md`). All of it is priced and netted in LBP. Selling the same
card in USD needs that logic to be currency-aware, or explicitly switched off for USD
sales.

## To decide when picking this up

1. Should a USD sale of a prepaid card offer "only days" / credits back at all?
2. If yes: what is the USD equivalent of `days_cost_lbp` / `sell_days_lbp`, and in which
   currency are the returned credits valued?
3. Wrong-number cards (`wrong_number_cards.card_cost_lbp`) are LBP-only too — same question.

## Data already available

The Whish app crawl (2026-10-14, `docs/whish-prices/whish_prices.csv`) has the USD
price of every Touch / Alfa prepaid card, e.g. TOUCH $1.67 → 2.08 USD, ALFA $3.03 →
USD price in the same file.

## Learned while building the first release (LIRA-324, 2026-10-16)

- The exclusion is one rule: `isUsdSellable` in `packages/core/src/constants/catalogCurrency.ts`
  refuses `alfa`/`mtc` + `Prepaid`. Lifting it starts there; migration v218 and the starting
  catalog (`frontend/src/data/providers/whishApp.ts`) also left these cards without
  `cost_usd`, so their USD prices must be added too (a new migration, not an edit to v218).
- The money path needs no change for a plain USD card sale: `FinancialServiceRepository`
  already books cost, profit, legs and void/refund per currency. The open work is only the
  Only-Days / credits-back logic above.
- Other screens that list catalog cards filter on `cost_lbp > 0` (Expenses stock use,
  resale-line recharge) or show only MTC/Alfa cards (Wrong number). They keep working
  for prepaid cards because those keep their LBP price; check them again if a card ever
  becomes USD-only.
