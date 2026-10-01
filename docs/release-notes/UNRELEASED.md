<!--
  LiraTek release notes — UNRELEASED (CLAUDE.md rule 30)

  Add ONE line per user-visible change, in the same change that makes it.
  - Group under "## <emoji> Area" headings (POS, Transactions, Profits, Suppliers / OMT, MTC / Alfa, …).
  - Write for shop owners and cashiers: what they now see or can do, and where. No ticket ids,
    no code terms. Say "web app" / "desktop app" when only one is affected.
  - Only what was really built; a fix for new entries says "from now on".
  - Tests, docs, CI and refactors with no behaviour change get no line.

  `yarn release` moves everything below this comment into docs/release-notes/vX.Y.Z.md. That file
  becomes the GitHub release body (shown by the desktop updater) and the in-app "What's new".
  WhatsApp copy: `yarn release-notes:whatsapp unreleased` (or a version).
-->

## 👥 Staff, users & login
- Staff can now sell MTC/Alfa credits (including buying credits back and using a shop line), add expenses, and create, start and update repair jobs. Deleting, voiding and shop-line settings stay admin-only.
- When something is refused, the screen now says why (for example "retail price below cost" on Inventory), instead of showing nothing or "An unexpected error occurred".
- Binance: a refused transaction no longer says "recorded successfully".
- The Audit Log no longer shows the Profits password when it is changed, older entries included, and a settings change that failed is no longer logged.

## 🛒 POS
- Pressing Escape during checkout closes only the open window (for example the receipt preview) and no longer empties the cart.

## 💳 Payment form
- A typed exchange rate more than 15% away from the shop rate now shows a warning instead of refusing the payment. The payment always goes through.
- OMT App / Whish App transfers: an exchange rate you edit on one transfer no longer carries over to the next; each starts at the shop rate.

## 💸 OMT / Whish & suppliers
- OMT sends such as Cash to Business can now be saved with a fee of 0.

## 📦 Inventory
- Editing a product no longer deletes its picture. Pictures lost to earlier edits need to be added again.
- Adjust Stock with unsaved changes now offers "Save & adjust", so you no longer have to discard your edits.
- Adjust Stock from the edit form works even when the product is hidden by the list's search or filter.
- A warranty change on the product form is kept when you minimize the form and reopen it.

## 🔁 Debts & repairs
- The Debts history has a User column showing who recorded each entry.
- Repair jobs accept phone numbers typed with spaces or +961 (e.g. "03 123 456").
- Web app: each repair status change now records who made it.
- A repair job without a phone number is no longer linked to a client just because the name matches.

## 🏠 Dashboard
- "Cash Collected (Today)" now matches what's in the drawer: it includes cash from customer-session checkouts, no longer counts a same-day debt repayment twice, and subtracts today's refunds and voids.

## 📱 MTC / Alfa
- The MTC/Alfa page's Count and Profit cards, and its Total Profit figure, now show today's real sales and their profit, and no longer read 0. Refunded recharges, drawer top-ups and credit buy-backs aren't counted.
- Refunding a line recharge after the days sale that came before it was already refunded is now refused with a clear message, instead of leaving the line's days wrong. To undo both, refund the recharge first.
- From now on, selling credits takes the SMS cost off the shop line as well as the drawer, so the line and the drawer stay equal.

## 🌙 Work done after midnight (00:00 – 03:00)
- Web app: Profits, the closing report and each page's "today" totals now put work done after midnight on the right day.

## 🧩 General
- Messages in the bottom corner no longer block clicks on the buttons under them, such as Pay.
- Audit Log times now match the Transactions page (they read 3 hours ahead). Entries recorded before this update keep the old time.
- On older installs, the sidebar lists Custom Services, Profits and Loto in the standard order.
