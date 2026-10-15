<!--
  LiraTek release notes — UNRELEASED (CLAUDE.md rule 30)

  Add ONE line per user-visible change, in the same change that makes it.
  - Group under "## <emoji> Area" headings (POS, Transactions, Profits, Suppliers / OMT, MTC / Alfa, …).
  - Write for shop owners and cashiers: what they now see or can do, and where. No ticket ids,
    no code terms. Say "web app" / "desktop app" when only one is affected.
  - Only what was really built; a fix for new entries says "from now on".
  - Tests, docs, CI and refactors with no behaviour change get no line.

  Highlights (optional, for a headline change — owner decisions 2026-10-03):
  put ONE "## ✨ Highlights" section at the very TOP of the file, above the grouped headings,
  holding 3-5 items, each written as:

    ### <Title>
    <One short paragraph.>
    ![<alt text>](whats-new/<version>/<file>.png)

  The image line is optional, but when present the file must already exist at
  frontend/public/whats-new/<version>/<file>.png — `node scripts/build-release-notes.cjs --check`
  FAILS the build if it's missing, or if the path isn't a plain relative whats-new/... path (no
  http(s)/data: URL, no ".." escape). Everything after the Highlights section is the normal
  grouped bullet list, unaffected by it. Highlight images must be .png (only PNG is supported) and
  ALWAYS LANDSCAPE (height smaller than width) — the card shows the whole image at card width, and
  the same --check FAILS, naming the file, on a portrait or square image. The in-app "What's new" renders Highlights as cards up
  top (with a "See all changes" toggle for the grouped list below); the WhatsApp copy
  (`yarn release-notes:whatsapp ...`) drops the images and turns each item into
  "• *Title*: sentence". A release with no Highlights section needs none of this — it renders
  exactly as before.

  `yarn release` moves everything below this comment into docs/release-notes/vX.Y.Z.md. That file
  becomes the GitHub release body (shown by the desktop updater) and the in-app "What's new".
  WhatsApp copy: `yarn release-notes:whatsapp unreleased` (or a version).
-->

## ✨ Highlights

### Card sent to the wrong number

Recharged an MTC or Alfa card onto the wrong number from iPick, Katsh or Whish App? Open the sale on the Transactions page and tap "Wrong number…". The sale stays as it is, because it is the recharge of the customer's right number. The wasted card is recorded as a loss, and the credits sent back lower that loss when they arrive.
![The Wrong number window on a card sale](whats-new/1.35.0/wrong-number-sale.png)

### Wrong number from Expenses

Noticed it before saving the sale? On Expenses, pick the card and tick "Wrong number". It comes out of the iPick, Katsh or Whish App balance as a loss, and you can enter the credits sent back later from the Transactions page.
![The Wrong number tick on Expenses](whats-new/1.35.0/wrong-number-expense.png)

### Customer pays part now, owes the rest

On Exchange, the payment window now shows what the customer pays on top and what you pay out under it. Pick the client right there, type what they actually handed over, and the rest goes on their account by itself. "Client will owe" shows how much, and it appears on the Debts page.
![Exchange: 87,600,000 LBP paid, 1,900,000 LBP on the client's account](whats-new/1.35.0/customer-pays-exchange.png)

### Cash-outs paid in several ways

On Whish App, OMT App and Binance cash-outs, "Customer pays" is filled in for you: the transfer, plus the fee when the customer pays it separately. Split it across Whish, OMT and cash, or put part on the client's account.
![Whish App cash-out: $90 by Whish, $5 fee in cash, $10 on the client's account](whats-new/1.35.0/customer-pays-whish-app.png)

## 💳 Payment window

- The change box is smaller: one line shows the change due and how you hand it back (cash, or OMT / Whish / Binance), the next has the $ and LBP fields with quick $, LBP and Account buttons, and the last line says where any change you don't hand back goes.
- On the POS, Maintenance, customer sessions, Loto, OMT/Whish send and Mobile Recharge sales: when a client with a phone number is picked, change you don't hand back now goes on the client's account (it lowers their debt or becomes credit). Tap Account to put all of it there. Custom Services does the same for a saved client. With no client picked, it is kept as profit, as before.
- POS: you can now put the change on the client's account in the same sale. Example: a client owes $50, buys $14 and pays $30. Hand back nothing and tap Account, and the client owes $34. No separate debt payment is needed.
- "Customer Account" is no longer in the change method list; the Account button replaces it.
- Inside a customer session, the Maintenance checkout, Loto and OMT/Whish send only hand change back; keeping it or putting it on the account happens at the session checkout, where it is booked.
- Paying out (OMT/Whish receive, Binance cash-out, Exchange): the kept change is shown once, in the green "Change kept" line.
- Debts, Settle Debt with some items ticked: one Remaining line shows what is left on the ticked items and the total.
- Paying by wallet with a fee: one Grand Total line names the wallet fee.
- The discount now sits in the same place on every payment window: one Discount line inside the payment box, under Total Amount. On the POS and Maintenance checkout it moved there from the order summary, and it says "Capped to max" when you type more than allowed.
- Paying out (Exchange, Whish App / OMT App receive, Binance cash-out, and Whish receive on the OMT/Whish page when the customer pays a fee on top): the payment window now shows what the customer pays ("Customer pays", IN) on top and what you pay out ("Shop pays", OUT) under it. "Customer pays" works like the rest of the box: one line, or tap Split to add more. Confirm stays off until what the customer pays adds up, and a "Still to settle" line shows what is missing. If the customer pays less and a client is picked, the rest goes on their account by itself; with no client, nothing is filled in as cash: the line asks you to pick a client, or to forgive a small leftover. Under the totals, the box also shows what the customer paid and, when part of it goes on their account, how much the client will owe.
- Whish App and OMT App receive: "Customer pays" now always shows what the customer sends you, filled in for you: the transfer by Whish (or OMT), plus the fee in Cash when the customer pays the fee separately on Whish App. You can split it, for example part by Whish, part by OMT or cash, and part on the client's account (the client then owes it), or forgive a small leftover. Changing who pays the fee updates the lines.
- Binance cash-out: "Customer pays" now always shows what the customer sends you, filled in for you: the USDT by Binance, plus the fee in Cash when the customer pays the fee separately. You can split it, for example part in USDT by Binance and the rest in cash ($ or LBP), or leave the rest on the client's account in $ (1 USDT counts as $1), or forgive a small leftover. Changing who pays the fee updates the lines.
- Exchange: the client name box now finds saved clients, and you can also pick or change the client right inside the payment window, without closing it. When you confirm the payout, "Customer pays — LBP" (or the currency you receive) shows the full amount. If the customer pays in $ or LBP and pays less, the rest goes on the picked client's account (it shows on the Debts page), or you can forgive a small leftover. When the customer pays in another currency (for example euros), they must pay the full amount: putting part on an account or forgiving it is not available yet. Confirm stays off until it adds up, and a client is needed to put money on an account. The Exchange history shows the client.
- Debts (Settle Debt) and Partners (Settle): the separate green Discount / Forgive box is gone. Forgiving is now a "Forgive (no cash)" line in the payment box, and typing an amount there no longer changes the payment you entered. A "Client will owe" (or "Partner will owe") line shows what is left after you confirm. To forgive part of it, lower the payment first.
- Dark mode: greyed-out buttons now show their text on the Mobile Recharge screens (MTC / Alfa, Katsh, Binance, Whish App / OMT App, card sales and money transfers) and on the OMT/Whish page. Before, a button that could not be pressed yet looked like an empty bar.

## ➕ Extra charges

- You can now charge a little more than the price: on the payment window's Discount line, switch to "+ Extra" and type the amount. Example: a case priced $6 sold for $7 — the case stays at $6 and the $1 is recorded as an extra, in the drawer of the payment method used.
- Works on the POS, Maintenance, Custom Services, Loto, MTC / Alfa sales, OMT / Whish send, Katsh, Binance send and at the customer session checkout (once for the whole basket). A sale has a discount or an extra, not both, and the extra can't be more than the sale itself.
- Profits shows a new "Extra charges" line with everything charged extra, so item profits stay what they were.
- Receipts show "Extra +$1.00" on its own line. Refunding one item gives back that item's share of the extra; voiding or refunding the whole sale gives it all back.

## 💸 OMT / Whish & suppliers

- On the Suppliers page, the Payments list is easier to read: notes show in full (up to two lines), dates fit on one line, and the LBP amount no longer runs into the note.
- Settle Account on the OMT card now takes what you actually paid OMT, in $ and/or LBP. The oldest transfers in that currency close first. You can settle only the $ or only the LBP, and the other currency stays as it is. A transfer the money doesn't fully cover stays open and shows what is still owed on it.
- Settle Account has one payment box with a $ line and an LBP line, already filled in with everything owed: confirm to settle it all, or lower a line to settle less. Its Total, Paid and Remaining to pay rows show $ and LBP side by side instead of one converted figure, and any change is worked out in each currency on its own.
- Before you confirm, each currency shows which transfers close, which one is part-paid, and what is still owed after. "Pick transfers" lets you settle only the transfers you tick.
- One settlement can pay OMT in one currency and collect from OMT in the other, for example pay OMT in $ and receive LBP from OMT.
- OMT, OMT App and iPick are now paid only from Settle Account. Their Pay / Receive tab and Commission settlement list are gone. Other suppliers are unchanged.
- On the Suppliers page, "Paid" and "Partial" on OMT transfers now follow real settlements, and "Partial" shows what was paid (for example "Partial · $47.00"). Transfers that showed "Paid" only because of an old Pay / Receive payment now show as owed, until the next settlement uses that payment.
- Settle Account: pay OMT the full amount owed. The commission you type no longer lowers the payment or closes transfers. Once the settlement is saved, the commission goes on OMT's account as money OMT owes you, and the next settlement uses it first. Undoing the settlement removes it again.
- A commission from a settlement made before this update no longer shows up a second time as a credit in Settle Account.
- "Which OMT shares does this statement include?" on Settle Account and on the OMT statement check is now a drop-down list with tick boxes. Nothing ticked means all types.
- Undoing OMT settlements goes newest first: if a later settlement also paid some of the same transfers, void that later one first.

## 🌐 Web app

- Refreshing the page no longer sends you back to the sign-in screen when several people use the same login at once. If the app can't check your sign-in right away, it tries again for a few seconds before showing the sign-in screen.

## 📱 MTC / Alfa

- Checkpoint for MTC or Alfa alone: Save works again. It used to stop with "At least one drawer amount is required" and save nothing.
- Checkpoint: the Credits box for each line now shows the amount rounded to cents (705.3), instead of a long number like 705.3000000000001.
- Card recharged onto the wrong number: on the Transactions page, an iPick, Katsh or Whish App card sale now has a "Wrong number…" button. Type the customer's right number; the wrong number is optional. The sale stays as it is (it counts as the recharge of the right number), and the wasted card is recorded as a loss from the iPick / Katsh / Whish App balance.
- Credits sent back for a wrong number: enter what arrived and on which shop line, now or later, in one or more parts. The shop line and the MTC / Alfa balance go up, and the loss goes down by the price of $1 of resold credit (Settings → Mobile Services). Example: a 770,000 LBP card with $6.68 back leaves a 102,000 LBP loss.
- To undo, an admin voids the credits first, then the wrong-number expense.
- Wrong number on a card sale: the card that was sold is now shown for you ("from this sale") and can't be swapped for another one. If the sale held several different cards, or the card is no longer in your list, you pick the card that was sent, as before.
- Wrong number: you no longer have to type the wrong number, on the Transactions page or on Expenses. When it is left empty, the record shows "—".
- Card pictures on many more items: when you pick an item for iPick, Katsh or Whish App, more tiles now show the real card. That includes the Alfa 1.22, 4.5 and 10 cards; the MTC 10, Smart, Super and Start SOS cards; Alfa data bundles; MTC validity; PlayStation, PUBG, Free Fire, Roblox, Steam, Razer, Nintendo, Xbox and Blizzard cards; and Terranet, Mobi and Wise packages. Items with no known card keep showing their name as before.
- Whish App: the Bills list now has everything the Whish app sells in LBP, not only the Alfa and MTC prepaid cards. That includes the Alfa 1.22 card, Alfa data bundles (Mobile Internet, Broadband, Alfa Go, Weekly, Boosters, Surf & Talk, Weekender), MTC validity days, internet (Terranet, Mobi, Wise, Connect), gaming, gift cards, streaming, DU / Etisalat / STC pins and ACTC tickets. Each new item starts with its selling price equal to its cost; change it in Settings → Mobile Services. Items you already had keep their prices.
- iPick, Katsh and Whish App items: cards of the same kind now sit together, for example all Terranet Army DSL cards, then all Fiber cards, each from smallest to biggest (500MB now comes before 1.5GB and 5GB).

## 🧾 Expenses

- When you use an MTC or Alfa card from iPick, Katsh or Whish App, a "Wrong number" tick records it as a card sent to the wrong number, so the credits sent back can be entered later from the Transactions page.

## 📊 Profits page

- New "Wrong-number credits recovered" line: credits sent back for cards recharged onto the wrong number, which lower the loss from those cards.

## 🛠️ Custom Services

- The For Partner / Via Partner boxes now sit on one line, with the partner picker (and Pay out) neatly on the line below them. The picker used to float between the boxes, lower than them.

## 🧾 Transactions

- On Transactions, filtering by an OMT App, Whish App or Binance type now also shows other transactions paid through that wallet: for example a repair or sale paid with OMT Wallet, a refund paid back by OMT Wallet, or a customer session paid by it. Transactions of that wallet's other types (for example OMT App Recv when you picked OMT App Send) still show only under their own filter.
