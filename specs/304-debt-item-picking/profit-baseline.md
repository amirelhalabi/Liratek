# Profit baseline for research D10 (LIRA-304)

**2026-10-11 — T002.** Local dev database (`~/Documents/LiraTek/liratek-web-dev.db`, copied to the session scratchpad) has **0** `'Session Debt'` rows and **0** `customer_session_transactions` rows, so the per-member profit hold (T040) cannot change any figure there. No baseline totals recorded.

**Who can be affected.** Only baskets checked out on Customer Account whose `'Session Debt'` row is partly covered (`0 < covered < amount` in a currency) and that hold two or more non-sale charge members. For those, today all non-sale profit stays held until the whole row is covered; after T040 a member is released once its own share is covered.

**To measure (T041).** On a copy of a real database (owner-provided, read with Python `sqlite3`, never the live file):
1. Count affected baskets with the condition above.
2. Before the migration: Profits-page totals per currency for the last 90 days (current release).
3. After migration v209 + T040: the same totals.
4. Record both and the difference here; add a release-note line if users would see a change.

## Test shop "before" snapshot — 2026-10-11 (production, code before LIRA-304)

Read through the live web app (Profits API, 2025-10-01 → 2026-10-11, unlocked and locked again). Raw JSON kept in the session scratchpad (`profit-before.json`).

| Module | Non-zero profit figures |
|---|---|
| sales | profit_usd 49.5, count 3 |
| financial_services | commission_lbp 90000, awaiting_settlement_count 4, waiting_for_repayment_usd 3, count 6 |
| mobile_services | profit_lbp 285486, count 3 |
| recharges | profit_lbp 135000, count 1 |
| loto | profit_lbp 8900, count 1 |
| expenses | count 1 |
| totals | gross_profit_usd 49.5, gross_profit_lbp 519386, net_profit_usd 49.02, net_profit_lbp 519386 |
| deferred | client_debt_profit_usd 3, client_debt_profit_lbp 589022, unpaid_sales_potential_profit_usd 18 |

Pending (held) profit: `{"rows": [{"sale_id": 111, "created_at": "2026-10-10 22:22:06", "client_name": "Claude Demo 1011", "client_phone": "03101011", "total_amount_usd": 33, "paid_usd": 0, "outstanding_usd": 33, "potential_profit_usd": 18, "items_summary": "1x Anker Braided USB-C Cable 2m, 1x Apple 20W USB-C Power Adapter"}], "totals": {"total_outstanding_usd": 33, "total_pending_profit_usd": 18, "count": 1}, "unsettled_commissions": [], "unsettled_totals": {"total_pending_commission_usd": 0, "total_pending_commission_lbp": 0, "count": 0, "awaiting_settlement_count": 4}, "deferred": {"partner_profit_usd": 0, "partne`

Baskets on account on the test shop that the per-item hold could change: "Claude Demo 1010" is fully repaid (no change expected) and "Claude Demo 1011" ($134, unpaid, its only non-sale item is the OMT send) has no partly-paid basket with two non-sale items — so **no change is expected** in these totals. After the deploy, re-run the same read and compare (T041).
