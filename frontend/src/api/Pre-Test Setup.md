Pre-Test Setup
Delete the database:
# LiraTek POS database location on macOS
rm -rf ~/Library/Application\ Support/liratek-pos/*.db
# Or specifically:
rm ~/Library/Application\ Support/liratek-pos/liratek.db
Start fresh:
yarn dev
---
Test Checklist
1. Initial State (Before Any Loto Actions)
- [ ] Navigate to Loto page (/loto)
- [ ] Check General drawer balance (note the starting amount)
- [ ] Check Activity/Transactions feed (should show no loto entries yet)
2. Sell Ticket Test
- [ ] Fill in sale amount (e.g., 50,000 LBP)
- [ ] Click Sell Ticket
- [ ] Expected:
  - ✅ Alert: "Ticket sold successfully!"
  - ✅ General drawer balance: +50,000 LBP
  - ✅ Transaction appears in activity feed
  - ✅ Stats cards update (tickets sold, total sales, commission)
3. Cash Prize Test
- [ ] Switch to Cash Prize tab
- [ ] Fill in prize amount (e.g., 500,000 LBP)
- [ ] Optionally add customer name and ticket number
- [ ] Click Record Cash Prize
- [ ] Expected:
  - ✅ Alert: "Cash prize recorded successfully!"
  - ✅ General drawer balance: -500,000 LBP
  - ✅ Transaction appears in activity feed (as outflow)
  - ✅ Stats cards update
4. Multiple Transactions
- [ ] Sell 2-3 more tickets (different amounts)
- [ ] Record 1-2 more cash prizes
- [ ] Expected:
  - ✅ Drawer balance reflects net (sales - prizes)
  - ✅ All transactions visible in activity feed
5. Create Checkpoint
- [ ] Click Checkpoint button
- [ ] Expected:
  - ✅ Checkpoint created with period from last checkpoint (or beginning)
  - ✅ Shows total sales, commission, prizes for the period
6. Settle Checkpoint
- [ ] Click Settle button
- [ ] Review the settlement verification dialog:
  - 4 summary cards: Total Sales, Commission, Total Prizes, Cash Prizes Paid
  - Comparison table: 4 rows (Sales, Commission, Prizes, Cash Prizes)
  - Net calculation: (commission + cashPrizes) - sales
- [ ] Click Confirm Settlement
- [ ] Expected:
  - ✅ Alert: "Settlement Successful!"
  - ✅ Checkpoint marked as settled
  - ✅ Cash prizes marked as reimbursed
  - ✅ Commission credited to drawer
  - ✅ Supplier ledger entry created
7. Verify Database (Optional)
If you want to inspect the database directly:
# Open SQLite browser or use CLI
sqlite3 ~/Library/Application\ Support/liratek-pos/liratek.db
-- Check transactions
SELECT * FROM transactions WHERE source_table IN ('loto_tickets', 'loto_cash_prizes', 'loto_checkpoints');
-- Check supplier ledger
SELECT * FROM supplier_ledger WHERE supplier_id = (SELECT id FROM suppliers WHERE provider = 'LOTO');
-- Check drawer balances
SELECT * FROM drawer_balances WHERE drawer_name = 'General';
---
## What to Watch For
### ✅ Should Happen:
- Drawer balances update on every sale and cash prize
- Transactions appear in activity feed
- Supplier ledger tracks what we owe LOTO and what they owe us
- Settlement creates proper accounting entries
### ❌ Should NOT Happen:
- Errors in console
- Drawer balance not changing
- Transactions missing from activity
- Settlement failing
---
If Something Fails
Check the logs:
# In the dev mode terminal, look for:
loto: Loto ticket sold: ...
loto: Cash prize recorded: ...
loto: Checkpoint ... settled
Report back with:
1. Which step failed
2. Any error messages
3. Console output (if any)
Good luck with the test! 🎯