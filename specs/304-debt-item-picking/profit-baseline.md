# Profit baseline for research D10 (LIRA-304)

**2026-10-11 — T002.** Local dev database (`~/Documents/LiraTek/liratek-web-dev.db`, copied to the session scratchpad) has **0** `'Session Debt'` rows and **0** `customer_session_transactions` rows, so the per-member profit hold (T040) cannot change any figure there. No baseline totals recorded.

**Who can be affected.** Only baskets checked out on Customer Account whose `'Session Debt'` row is partly covered (`0 < covered < amount` in a currency) and that hold two or more non-sale charge members. For those, today all non-sale profit stays held until the whole row is covered; after T040 a member is released once its own share is covered.

**To measure (T041).** On a copy of a real database (owner-provided, read with Python `sqlite3`, never the live file):
1. Count affected baskets with the condition above.
2. Before the migration: Profits-page totals per currency for the last 90 days (current release).
3. After migration v209 + T040: the same totals.
4. Record both and the difference here; add a release-note line if users would see a change.
