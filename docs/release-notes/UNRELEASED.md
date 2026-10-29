<!--
  LiraTek release notes — UNRELEASED (CLAUDE.md rule 30)

  Add ONE line per user-visible change, in the same change that makes it.
  - Group under "## <emoji> Area" headings (POS, Transactions, Profits, Suppliers / OMT, MTC / Alfa, …).
  - Write for shop owners and cashiers: what they now see or can do, and where. No ticket ids,
    no code terms. Say "web app" / "desktop app" when only one is affected.
  - Only what was really built; a fix for new entries says "from now on".
  - Tests, docs, CI and refactors with no behaviour change get no line.

  Highlights (owner decisions 2026-10-03; since 2026-10-18 REQUIRED for every new or visibly
  changed UI — page, panel, window, button or field — with a screenshot, CLAUDE.md rule 30):
  put ONE "## ✨ Highlights" section at the very TOP of the file, above the grouped headings,
  one item per UI change, each written as:

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

### Merge a supplier entered twice

If the same supplier was typed in two ways (for example "reacall" and "recall"), you can now merge them. In Settings → Categories & Suppliers, delete the wrong one: if it has products or a balance, a **Merge into** window opens instead. It shows how many products and how much balance will move. Pick the right supplier and press Merge. Its products, stock, debt and payments all move over, and its balance is added to the other supplier's. Renaming a supplier to a name that already exists offers the same merge.
![Merging "Aaa Reacall" into "Aaa Recall": 2 products and $50 move](whats-new/1.35.0/supplier-merge.png)

### Settle Loto by day

Loto is now settled like every other supplier: Suppliers → Loto → **Settle Account** opens the day calendar. Each day shows what you owe Loto for that day's tickets (after your commission), minus any cash prizes you paid out that day. Pick the days, pay, and they turn green. Everything you already settled through Loto checkpoints counts as paid, so only newer days show. The Pay / Receive tab for Loto and the Settle button on the Loto page are gone, so every Loto payment is tied to the days it pays.
![Settle Loto Liban account: 3 tickets on Oct 28, 343,980 LBP to pay](whats-new/1.35.0/loto-settle-calendar.png)

### Discount the whole session basket

At a customer session checkout, the line under "Total Amount" now has a **− Discount | + Extra** switch. Pick Discount and type an amount to take it off the whole basket: the payment box then expects the lower total. A basket takes a discount, an extra or a waived amount, one at a time. The discount can't be more than the shop's profit on the basket; if it is, the checkout says so and shows the limit. Discounts given this way show on the Profits page as "Session discounts".
![Session checkout: $8 discount on a $294 basket, the customer pays $286](whats-new/1.35.0/session-basket-discount.png)

### Keep the change, or put it on the account

When a customer leaves their change and a client is picked, the change box now has a **Keep** button next to **Account**. Tap Keep to keep the change as shop profit (it shows under kept change on the Profits page), or Account to put it on the customer's account as before. This works on the Accounts repayment window and on every payment window that already had the Account button.
![Change box with Keep pressed: keeping $2.00 as profit](whats-new/1.35.0/keep-change.png)

### See everything about a transaction

On the Transactions page, every row now has a Details button. It shows everything saved with that transaction in plain words: what was entered, how the customer paid, and any change handed back or kept. Voided and refunded rows carry a small tag, and the Excel export now opens on a Summary with money in and out per currency, while the PDF is a report grouped by day.
![Details of an OMT send: $210 paid in cash, $6 change handed back](whats-new/1.35.0/transaction-details.png)

### Checkpoint differences stay open until explained

When a checkpoint shows Over or Short, the difference now stays open on the Checkpoints page until it is explained. Found the missed sale or expense on camera? Enter it with "Set custom time" before the checkpoint: the difference turns Resolved and the drawer is not counted twice, so your next checkpoint comes out balanced. "Open differences only" lists what is still unexplained, and a Short nobody can explain can be closed as a "Drawer shortage" expense.
![Checkpoints: Over $50 resolved by the re-entered sale, Short $20 partly resolved, Short $3 closed](whats-new/1.35.0/checkpoint-open-differences.png)

### Try LiraTek free for 14 days

A new shop that signs up on the web app now gets a free 14-day trial, with no card needed. Every page shows how many days are left, with a button to message LiraTek on WhatsApp to activate. When the trial ends you can still sign in, see and export everything, and nothing is deleted; adding new sales and records waits until the shop is activated.

### Card sent to the wrong number

Recharged an MTC or Alfa card onto the wrong number from iPick, Katsh or Whish App? Open the sale on the Transactions page and tap "Wrong number…". The sale stays as it is, because it is the recharge of the customer's right number. The wasted card is recorded as a loss, and the credits sent back lower that loss when they arrive. Noticed it before saving the sale? On Expenses, pick the card and tick "Wrong number" instead.
![The Wrong number window on a card sale](whats-new/1.35.0/wrong-number-sale.png)

### Customer pays part now, owes the rest

On Exchange and on Whish App, OMT App and Binance cash-outs, the payment window shows what the customer pays and what you pay out. "Customer pays" is filled in for you: split it across cash, Whish and OMT, or type what the customer actually handed over and the rest goes on their account by itself. "Client will owe" shows how much, and it appears on the Debts page.
![Exchange: 87,600,000 LBP paid, 1,900,000 LBP on the client's account](whats-new/1.35.0/customer-pays-exchange.png)

### Your accounts in one Excel file

On Accounts, tap "Export Excel" to save every client's account in one file, laid out like the sheet you import: a list of names and phones, then a page per client with what they bought, what they paid, and what they still owe in $ and LBP. You can import that file into another shop and every entry keeps its date. Importing it back into the same shop is refused, so nothing gets counted twice.
![The Export Excel button on Accounts](whats-new/1.35.0/accounts-export-excel.png)

### Give back part of a line's credit before selling it

Selling a phone line with more credit than the buyer wants? On Phone Lines → For sale, tap "Give credit back", type how much credit the buyer keeps, and pick the shop line that gets the rest. You see what is sent, the SMS fee, and the line's new price and cost before you save. The credit lands on your shop line, and the line's price and cost drop. Changed your mind? Void it on the Transactions page, as long as the line hasn't been sold.
![Give credit back: the buyer keeps $9 of $15, $5.68 goes to the shop line](whats-new/1.35.0/give-credit-back.png)

### Round amounts on payouts

Paying out and short of coins? Hand over a little more (for example $103.00 on $102.90) and the difference is recorded under Expenses as "Change rounding". Or ask the customer for a few dollars or pounds: tap "+ Customer gives change", enter what they give you, and the payment window expects the round amount ($197 owed + $3 = $200). Both drawers stay right. Up to $5 or 450,000 LBP.
![OMT receive: $197 owed, the customer gives $3, you pay out $200](whats-new/1.35.0/customer-gives-change.png)

### Pick the line a card is charged to

"Charge to shop line" on the iPick, Katsh and now Whish App card lists now asks which line gets the card. Your main line is picked for you; pick any other shop line instead, or one of your lines for sale. A shop line gets the card's credit and days. A line for sale also gets them, and the card's cost is added to its cost and selling price.
![Charge to a line: two shop lines and a line for sale to choose from](whats-new/1.35.0/charge-line-picker.png)

### Send the receipt on WhatsApp

Right after a sale, the POS shows "Sale completed" with a Send on WhatsApp button, and every past sale's details have the same button next to Print. WhatsApp opens on the customer's chat with the receipt already written, and you press Send. No number on the sale? Type one for that send only. It costs nothing per message.

### Gift cards are now paid for

On the Vouchers page, creating a gift card now asks how the customer pays: cash, a wallet, or the customer's account, with change handed back as usual. The money goes into the drawer. Cancelling a gift card that was not used opens a window that refunds what the customer paid. Both show on the Transactions page.
![Vouchers page: a $25 gift card paid in cash](whats-new/1.35.0/voucher-sale.png)

### A partner's transactions and payments, each in its own window

On the Partners page, open a partner and tap "Transactions" or "Payments", the same way as on the Suppliers page. Transactions lists what you did with or for the partner, with the date, mode, provider and direction filters. Payments lists settlements (a Cash + Whish one reads "via SPLIT"), write-offs and credit / debt entries, with a date filter. The count is on each button, so the partner's panel stays short.
![Partners: the Payments window with a settlement, a write-off and a credit/debt entry](whats-new/1.35.0/partner-ledger.png)

### The customer gives the change back on a refund

When a sale was paid in dollars and the change was given in Lebanese pounds (or the other way round), the refund window now offers what the customer really paid. Example: paid $55, got 250,000 LBP change at 90,000 — the refund window fills in $52.22 cash. If the customer brings the 250,000 LBP back, tap **+ Customer gives change**, enter it, and the window asks you to hand back the full $55. This works on Audit & Transactions, on the POS Refund Sale button and when refunding an item from a customer session.
![Refund window: the customer gives back 250,000 LBP, the shop hands back $55](whats-new/1.35.0/refund-customer-gives-change.png)

### Settle OMT by day

Settle Account on the OMT card now opens on a calendar of the month. Settled days are green; open days show what is still owed in $ and LBP. Every open day before today is already picked: add or remove days, choose how much OMT credit to use, and only the picked days are settled. Tap a day to pick or skip it; "See transactions" lists the picked days' transfers, where you can untick one.
![Settle Account: the month calendar with settled days in green and open days with what is left](whats-new/1.35.0/omt-settle-calendar.png)

### Insurance renewals on the Dashboard

A new "Insurance renewals" card on the Dashboard lists every customer whose insurance ends within a week, or has ended and was not renewed, with their phone number, the insurance type and how many days are left. Once a day the bell sums it up ("Insurance: 3 expire this week, 2 expired"). Selling a new insurance of the same type to the same customer takes them off the list; "Won't renew" takes them off by hand.
![Dashboard: Insurance renewals card with Ali Haddad's Compulsory insurance ending in 5 days, and the bell's daily summary](whats-new/1.35.0/insurance-renewals.png)

## 🛒 POS

- After a sale, and from any past sale's details, you can now send the receipt to the customer on WhatsApp. WhatsApp opens on their chat with the receipt already written; you press Send. Works on the desktop app and the web app.
- A reprinted sale receipt now shows the part put on the customer's account and any gift card on their own lines, and its "Paid" amount stays what the customer paid at the counter, even after they pay off the account later.
- From now on, when you put part of a sale on the customer's account in LBP, the customer owes it in LBP. Their LBP balance on the Accounts page goes up, not their $ balance. Paying it back in LBP closes that sale.

## 💳 Payment window

- When a customer leaves their change and a client is picked, the change box now has a **Keep** button next to **Account**: keep the change as shop profit, or put it on the customer's account as before.
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
- Screen readers now call the currency picker next to the Extra amount "Extra currency". It used to say "Discount currency".
- Paying out a little more than owed because you have no coins (for example $103.00 on $102.90) is now accepted, up to $5 or 450,000 LBP. The payment window shows "Rounded up", and the difference is recorded on the Expenses page as "Change rounding". This works on OMT/Whish receive, Binance cash-out, Whish App / OMT App receive and "From client", Exchange, Hold Money pickups in one currency, and MTC / Alfa credit buy-back. Voiding the payout removes it. Above $5 / 450,000 LBP the payment is still refused.
- When a customer pays a little more than the total (up to $5 or 450,000 LBP), the Discount line switches to "+ Extra" and fills in the difference, so the extra is kept as an extra charge. To give the change back instead, clear the extra and the change box appears.
- When paying out, if the customer hands you a few dollars or pounds so you can give a round amount (for example $197 owed, the customer gives $3, you give $200), tap "+ Customer gives change" (or add a line under "Customer pays") and enter it. The payment window then expects you to pay out that much more, and both drawers are recorded correctly, with nothing booked as rounding. Up to $5 or 450,000 LBP; use the Exchange page for more. This works on OMT/Whish receive, Binance cash-out, Whish App / OMT App receive and "From client", Exchange, Hold Money pickups in one currency, and MTC / Alfa credit buy-back.
- "+ Customer gives change" now also works on OMT/Whish receive done through your partner, and when you pay the customer out by wallet (for example $200 from Whish, $3 back in cash).
- OMT/Whish page: a Whish receive done through your partner with the fee paid on top can be saved again. Before, it was refused.

## ➕ Extra charges

- You can now charge a little more than the price: on the payment window's Discount line, switch to "+ Extra" and type the amount. Example: a case priced $6 sold for $7 — the case stays at $6 and the $1 is recorded as an extra, in the drawer of the payment method used.
- Works on the POS, Maintenance, Custom Services, Loto, MTC / Alfa sales, OMT / Whish send, Katsh, Binance send and at the customer session checkout (once for the whole basket). A sale has a discount or an extra, not both, and the extra can't be more than the sale itself.
- Profits shows a new "Extra charges" line with everything charged extra, so item profits stay what they were.
- Receipts show "Extra +$1.00" on its own line. Refunding one item gives back that item's share of the extra; voiding or refunding the whole sale gives it all back.

## 💸 OMT / Whish & suppliers

- OMT/Whish: typing 0 in "OMT fee (charged by OMT)" now really waives the fee. Before, 0 was ignored and the automatic fee was still added. Leave the box empty to use the automatic fee.
- Loto: settled from Suppliers → Loto → Settle Account with the day calendar. Cash prizes count against the day they were paid. Days already settled through Loto checkpoints show as paid. The Loto page no longer has its own Settle button, and Loto has no Pay / Receive tab.
- Suppliers: on Settle Account, product suppliers, Katsh, Whish and Loto can now be paid in dollars or lira, whatever the amount's currency, converted at the rate shown on the payment box. A "Total" line shows what you pay in all. OMT is unchanged: its dollars are paid in dollars and its lira in lira.
- Settle Account: when the chosen time is too early for the days picked, the message now names the day the way you read it (for example "Sun 25 Oct").
- Suppliers: "Check against OMT's statement" with "Up to" a past day now shows the account as it stood at the end of that day, even after later payments were recorded.
- Suppliers: Add Credit / Debt has "Set custom time", so an entry can be dated to the day it really belongs to. A cash entry dated before a drawer count explains that count's Short or Over instead of moving the money a second time.
- Suppliers: an OMT or Whish transfer, or a Loto entry, saved with "Set custom time" now also shows on that day in the supplier's ledger, not on the day it was typed (from now on).
- Partners page: a partner's ledger now opens in two windows, "Transactions" and "Payments", from buttons that show how many entries each has, like on the Suppliers page. Payments holds settlements, write-offs and credit / debt entries; everything else is under Transactions.
- OMT/Whish page: the partner picked on the partner system's tab (for example Whish through your Whish partner) no longer carries over when you switch to the other tab. Before, an OMT send or receive done right after opening Whish could be saved as going through the Whish partner, and the "+ Customer gives change" link vanished from OMT receive.
- OMT/Whish page: a send or receive no longer adds the sender (or receiver) to your clients when "Save as client" is unticked. If a client with that phone is already saved, the transaction is still linked to them. Paying on the customer's account still needs a client, so one is still saved in that case.
- OMT/Whish page, OMT send with "Online Brokerage": a BINANCE fee charged to the customer is now recorded with the send. Before, any such send with a fee was refused with "the payment is more than the total".
- OMT/Whish page: from now on each OMT or Whish send and receive keeps everything you enter on the transaction itself — service type, reference number, the customer's name and phone, OMT or Whish fee, whether the fee was included, the partner, the fee for paying by wallet, the note, and how the customer paid.
- OMT/Whish page: from now on, an entry saved with "Set custom time" that puts an amount on the customer's account (owed, or change and payouts kept as credit) shows on the account at that time, not at the time you saved it. The same goes for sales, recharges, repairs, custom services and loto tickets put on an account with an earlier time.
- OMT/Whish page: an OMT send paid by OMT Wallet or Whish Wallet with the wallet fee is no longer refused. The payment box now asks for the amount, the OMT fee and the wallet fee together (for example $102 on a $100 send), so the customer pays the right total.
- OMT/Whish page: when the sender's name and phone are filled in, picking OMT Wallet or Whish Wallet no longer puts the wallet fee on the customer's account. The wallet line now shows the full total (for example $102 on a $100 Intra send), and the send is recorded instead of refused.
- OMT/Whish page: from now on, an OMT or Whish send put on the customer's account shows on Accounts what is owed, fee included, for example "OMT send $20 + $1 fee = $21, ref OMT-REF-2610". Before, the line read "$20" while $21 was owed. These sends also now record how the customer really paid (the customer's account, or several methods) instead of "Cash".
- Partners page: from now on, a settlement paid in more than one way (for example $200 cash + $100 Whish) shows "via SPLIT" in the partner's history instead of only the first method.
- On the Suppliers page, the Payments list is easier to read: notes show in full (up to two lines), dates fit on one line, and the LBP amount no longer runs into the note.
- Suppliers: the Transactions and Payments lists open in their own window from two buttons, so the supplier page stays short. The tab for picking transactions to settle is now called "Settle".
- Mobile Recharge: items you pick on iPick, Katsh and Whish App now stay picked when you switch tabs. Picking from more than one of them makes one basket: Proceed to Pay shows every item grouped by provider, the customer pays once, and it is saved as a walk-in customer session with one sale per provider, each taken from its own provider's balance. Refund it as a whole from Transactions. Before, a basket with both iPick and Katsh items was all saved under the tab you paid from.
- Mobile Recharge: a bill you add on the iPick or Katsh tab now stays in the basket when you switch tabs or leave the page, counts on its tab, and is always saved under the tab you added it on, whichever tab you pay from. Bills now show in the one payment window under their provider and are paid together with items from other providers, all at once.
- Mobile Recharge: "For Partner" now covers the whole basket. Tick it on iPick, Katsh or Whish App and it stays ticked on the other two, with the same partner. If the basket already has items, you are asked first whether to make them all a partner order. "Submit to Partner" sends everything in the basket, from every tab, in one go: each item is taken from its own provider's balance, and the partner owes the full price. If one item fails, nothing is saved.
- "For Partner" is now a button instead of a tick box everywhere it appears (Mobile Recharge, Point of Sale, Exchange, Loto, OMT/Whish). On iPick, Katsh and Whish App it sits in the top bar, in the provider's colour, with the partner picker right next to it. The partner notes that appear when it is on are now easy to read in light mode, and most are shorter. On Custom Services, Customer / For Partner / Via Partner is now one switch.
- During a customer session, the "For Partner" option is hidden everywhere it appears (Point of Sale, Exchange, Loto, OMT/Whish, Mobile Recharge, Custom Services), because a customer's visit never includes partner sales. If it was on when the session started, it is turned off. On Custom Services, "Via Partner" is still available.
- "For Partner" partner picker (Mobile Recharge, Point of Sale, Exchange, Loto, OMT/Whish): while the partner list is loading it now says "Loading partners…", and if the list can't be loaded it says so with the reason and a Retry button. Before, both cases wrongly said "No partners available. Add a partner first." even when partners were set up.
- Mobile Recharge, Whish App: the tab now remembers whether you were on Transfer or Bills, so coming back from another tab keeps you on Bills instead of sending you to Transfer.
- Mobile Recharge: the selected provider at the top is bigger and easier to read. Moving the mouse along the other logos now slides a soft highlight in each provider's colour from one to the next, shaped like the logo.
- Mobile Recharge: the provider tabs (MTC, Alfa, iPick, Katsh, Whish App, OMT App, Binance) now show each provider's logo; the selected tab also shows its name. Each provider's screen now uses that provider's own colours (Katsh lime, iPick green-to-blue, MTC teal, Alfa red, Binance yellow).
- The real Whish and OMT logos and colours now appear across the app: on the Mobile Recharge Whish App and OMT App tabs, on the OMT/Whish page, on Partners, next to the Whish and OMT drawers on the Dashboard and the checkpoint screens, in the Transactions "Method" column, in Settings → Payment Methods, and on the "Select shop base" setup step. OMT buttons use OMT's own yellow.
- Dashboard "Drawer Balances" and the checkpoint drawer cards: the iPick, Katsh, MTC, Alfa and Binance drawers now show their logo too (also in the checkpoint history), and every provider drawer card (including OMT and Whish) now uses that provider's colour for its border and title — OMT yellow, Whish red, and so on. The General drawer is unchanged. Binance payments also show the Binance logo in the Transactions "Method" column and in Settings → Payment Methods.
- Settle Account on the OMT card now takes what you actually paid OMT, in $ and/or LBP. The oldest transfers in that currency close first. You can settle only the $ or only the LBP, and the other currency stays as it is. A transfer the money doesn't fully cover stays open and shows what is still owed on it.
- Settle Account has one payment box with a $ line and an LBP line, already filled in with everything owed: confirm to settle it all, or lower a line to settle less. Its Total, Paid and Remaining to pay rows show $ and LBP side by side instead of one converted figure, and any change is worked out in each currency on its own.
- Before you confirm, each currency shows which transfers close, which one is part-paid, and what is still owed after. "Pick transfers" lets you settle only the transfers you tick.
- One settlement can pay OMT in one currency and collect from OMT in the other, for example pay OMT in $ and receive LBP from OMT.
- OMT, OMT App and iPick are now paid only from Settle Account. Their Pay / Receive tab and Commission settlement list are gone. Other suppliers are unchanged.
- On the Suppliers page, "Paid" and "Partial" on OMT transfers now follow real settlements, and "Partial" shows what was paid (for example "Partial · $47.00"). Transfers that showed "Paid" only because of an old Pay / Receive payment now show as owed, until the next settlement uses that payment.
- Settle Account: pay OMT the full amount owed. The commission you type no longer lowers the payment or closes transfers. Once the settlement is saved, the commission goes on OMT's account as money OMT owes you, and the next settlement uses it first. Undoing the settlement removes it again.
- A commission from a settlement made before this update no longer shows up a second time as a credit in Settle Account.
- "Which OMT shares does this statement include?" on Settle Account and on the OMT statement check is now a drop-down list with tick boxes. Nothing ticked means all types.
- Suppliers page, "Check against OMT's statement": the figures now count up to the end of yesterday, like OMT's own message, so today's transfers no longer throw the check off. Tap the "Up to" chip to pick an earlier day (not today). What later days still have open shows on a grey line under the expected figure, not counted.
- Settle Account on the OMT card now opens on a calendar of the month. Settled days are green; open days show what is still owed on them in $ and LBP, in short form ($6.5k, 1.17B LBP): red when you owe OMT, green when OMT owes you. Point at a day to see the exact amounts.
- Every day still open before today is already picked when Settle Account opens. Add or remove days, and only the picked days are settled; days you leave out stay open and are marked.
- Dashboard: moving cash between General and the OMT drawer (Top Up → Transfer) can now be dated with "Set custom time", for a move that happened on an earlier day. A move dated before a drawer count now explains that count's Short or Over instead of moving the money a second time.
- Settle calendars: a day where OMT (or the other side) still owes you part of the money now shows as partly paid, and a day where a receive only cancels out a send shows as unpaid. Before, both could show the green "paid" badge.
- Settle Account: you choose how much of your OMT credit the settlement uses. It is filled in with what the picked days need, and you can lower it, down to nothing.
- Settle Account: a **See transactions** button under "… left this month" opens a table of the picked days' transactions next to the calendar: each one's number, type, part (OMT, OMT App, iPick), name or reference, amount and what is left, with a total per day. Paid ones are greyed. Untick a line to leave it out of the settlement, or search by reference, name or number to check OMT's statement line by line. On a phone the table opens full screen; close it to go back with your picks kept.
- Suppliers: the Transactions window can now be filtered by date (from and to, or Today, Yesterday, This month).
- Suppliers: on the OMT card, the Payments window can now be filtered by date too (from and to, or Today, Yesterday, This month). Other suppliers' Payments windows are unchanged.
- Any OMT settlement can now be undone, in any order, and a transfer already paid to OMT can be voided. Later settlements stay as they are; any difference shows on the OMT account as owed to OMT or as OMT credit.
- Settle Account: a one-time "Settle old history up to…" uses old OMT credit to close old days, with no new money. Anything the old credit doesn't cover stays open.
- Settle Account (admins): an OMT credit that OMT will never accept (for example a miscalculation, or really the shop's own cost) can now be removed with **Remove credit**, next to that credit. You type a reason, the credit is closed, and its amount is recorded on the Expenses page as "OMT credit not accepted". No money leaves a drawer. To undo it, void it in Transactions: the credit comes back and the expense is removed.
- Suppliers: Katsh, product suppliers and Whish (when it is turned on) now have a **Settle Account** button that opens the same day calendar as OMT. Pick the days you are paying for and how much to pay; each currency is settled on its own, so a $ payment never pays an LBP debt.
- Suppliers: product suppliers now have the same **Add Credit / Debt** button as company suppliers, next to Record Debt.
- Suppliers: a supplier page with only one section no longer shows a tab bar above it; product suppliers show their purchase history straight under the header.
- Settle calendars (suppliers, partners, client debts): weeks with no day you can tap are hidden, so the month is shorter. With "See transactions" open, the calendar and the table are the same width.
- Suppliers: Katsh, product suppliers and Whish no longer have a Pay / Receive tab; pay them from Settle Account. Money paid to them before (and any discount given with it) stays on their account as credit that Settle Account can use, and "Settle old history up to…" closes old days with it. Katsh bill commission is still settled from the "Settle" list, which now shows bills only.
- Suppliers, Whish: the commission you type in Settle Account goes on Whish's account as money Whish owes you, and the next settlement uses it first.
- Suppliers, Katsh and Whish: "Paid" and "Partial" in the Transactions window now follow real settlements, like OMT. A transfer that showed "Paid" only because of an old Pay / Receive payment shows as owed until a settlement uses that payment.
- Settle Account (OMT, Katsh, Whish and product suppliers) now has "Set custom time", next to the note. Use it when you record a payment later than it happened, for example OMT paid on Monday but entered on Wednesday: the payment, what it settles and the drawer movement are all saved on Monday, so each day's balance, the settle calendar and your checkpoints stay right. With a custom time, the days picked by default are the open days before that day, and a payment can't be dated before a day it pays for. If a checkpoint after that time was short (or over) by this payment, the difference is resolved instead of the drawer moving twice.
- OMT/Whish and Mobile Recharge (OMT App, Whish App, Binance, iPick, Katsh) History: from now on, when you correct a name or phone, the transaction in Transactions shows the new client name, phone and summary too. On OMT, Whish, OMT App and Whish App transfers, its Details also show the corrected sender, receiver or customer and note. On iPick and Katsh, correcting the note also changes the item text shown in Transactions. Before, Transactions kept showing the old name.

## 🎨 Look & feel

- Sign-in page: less empty space between the shop name and the Username field.
- Light mode: cards and input boxes now use a soft warm grey instead of bright white, and the dark text on OMT's yellow buttons and tabs is a softer charcoal instead of pure black.
- Exchange: the form and the Rates list now fill the whole page width, with the same margins at any window size. Before, wide windows left an empty strip on the right.
- Accounts: a client's balance in $ and LBP now stays on one line, and the Settle Debt, Cash Out and Write off buttons are never cut off. On narrower windows they move under the balance.
- Profits: the tabs show only their icons, except the one you are on, so the tabs and the From / To dates fit on one line. Point at an icon to see its name.

## 🌐 Web app

- The side menu's scroll bar only shows while your pointer is over the menu, and takes no space otherwise.
- Refreshing the page no longer sends you back to the sign-in screen when several people use the same login at once. If the app can't check your sign-in right away, it tries again for a few seconds before showing the sign-in screen.
- New shops now start with a free 14-day trial. You can see how many days are left at the top of every page and in the phone app, and contact us on WhatsApp to activate. When a trial ends you can still sign in, see and export everything; nothing is deleted.

## 📲 Phone app

- Home: each drawer lists only the currencies it holds, one per line, so balances are easier to read on a small screen.
- Debts: a client who owes you shows in red and a client with credit shows in green, the same as on the computer.
- Amounts use the same money format as the rest of LiraTek (no decimals for LBP).
- The shop address box on the sign-in screen no longer shows an example shop name.

## 🔒 Security & sign-in

- Settings → Signed-in devices: admins now see every user's signed-in devices, grouped by person with their role, and can sign any of them out. Each device shows a readable name like "Chrome on macOS", when it was last used ("Active now", "7 days ago"), and whether it is remembered or signs out after 8 hours idle. Devices not used for more than 3 days are faded. Staff still see only their own devices, and "Sign out everywhere else" still signs out only your own other devices.
- Staff can no longer read the shop's WhatsApp access key, including from the activity log. Only admins see it. Sending WhatsApp messages from the app works as before.
- When an admin changes someone's role, or sets a new password for them, that person is signed out and signs in again with the new role. A desktop app window already open on their PC picks up the change at their next sign-in.
- Web app: after 5 wrong passwords within 15 minutes when pairing a PC for offline use, or when unlocking the Profits page, further tries are refused until the 15 minutes are up.
- Web app: a PC paired for offline use stops sending and receiving while its shop is suspended, and starts again once the shop is active. The work it did offline is kept on the PC.

## 📱 MTC / Alfa

- Mobile Recharge: a price changed in Settings → Mobile services now reaches recharge screens already open on other tills (web app), within moments, instead of only after they reload.
- Checkpoint for MTC or Alfa alone: Save works again. It used to stop with "At least one drawer amount is required" and save nothing.
- Checkpoint: the Credits box for each line now shows the amount rounded to cents (705.3), instead of a long number like 705.3000000000001.
- Card recharged onto the wrong number: on the Transactions page, an iPick, Katsh or Whish App card sale now has a "Wrong number…" button. Type the customer's right number; the wrong number is optional. The sale stays as it is (it counts as the recharge of the right number), and the wasted card is recorded as a loss from the iPick / Katsh / Whish App balance.
- Credits sent back for a wrong number: enter what arrived and on which shop line, now or later, in one or more parts. The shop line and the MTC / Alfa balance go up, and the loss goes down by the price of $1 of resold credit (Settings → Mobile Services). Example: a 770,000 LBP card with $6.68 back leaves a 102,000 LBP loss.
- To undo, an admin voids the credits first, then the wrong-number expense.
- Wrong number on a card sale: the card that was sold is now shown for you ("from this sale") and can't be swapped for another one. If the sale held several different cards, or the card is no longer in your list, you pick the card that was sent, as before.
- Wrong number: you no longer have to type the wrong number, on the Transactions page or on Expenses. When it is left empty, the record shows "—".
- Card pictures on many more items: when you pick an item for iPick, Katsh or Whish App, more tiles now show the real card. That includes the Alfa 1.22, 4.5 and 10 cards; the MTC 10, Smart, Super and Start SOS cards; Alfa data bundles; MTC validity; PlayStation, PUBG, Free Fire, Roblox, Steam, Razer, Nintendo, Xbox and Blizzard cards; and Terranet, Mobi and Wise packages. Items with no known card keep showing their name as before.
- Whish App: the Bills list now has everything the Whish app sells in LBP, not only the Alfa and MTC prepaid cards. That includes the Alfa 1.22 card, Alfa data bundles (Mobile Internet, Broadband, Alfa Go, Weekly, Boosters, Surf & Talk, Weekender), MTC validity days, internet (Terranet, Mobi, Wise, Connect), gaming, gift cards, streaming, DU / Etisalat / STC pins and ACTC tickets. Each new item starts with its selling price equal to its cost; change it in Settings → Mobile Services. Items you already had keep their prices.
- Whish App: Bills now has a USD | LBP switch next to "Proceed to Pay", like the currency choice in the Whish app. In USD, each item shows and sells at its dollar price, and the cost comes out of your Whish App dollar balance. Items Whish sells only in dollars (for example Razer $1, Netflix $20, Yalla Live) show only in USD. MTC and Alfa prepaid cards stay in LBP. Each dollar price starts equal to its cost; change it in Settings → Mobile Services. The app remembers your last choice on each device. If you switch with items picked, it asks first, then clears them.
- iPick, Katsh and Whish App items: cards of the same kind now sit together, for example all Terranet Army DSL cards, then all Fiber cards, each from smallest to biggest (500MB now comes before 1.5GB and 5GB).
- Mobile Recharge, MTC and Alfa: your shop line now sits at the top, between the logos and the totals: the phone number with its credit. Your main line is picked when the page opens; the small arrow next to it lists your other lines, and the one you pick is the line the next sales send credits from (just for that screen; your main line stays the default). A small dot shows when something needs a look (a line running out of days, expired or burned, the balance not matching your lines, or days still owed to a customer).
- Mobile Recharge: click the phone number to record usage on that line straight away. Days still owed to customers (Mark sent) and a balance mismatch show in the same window. To edit or add a line, use Settings → Shop lines.
- Whish App top-up from a client: "Fee included in amount" now changes what you pay out. Ticked: the client sends $100 and you pay out $99 (the fee comes out of the credits). Not ticked: the client sends $101 and you pay out the full $100. The window shows what the client sends and what you pay out. Before, the payout was always the amount minus the fee, ticked or not.
- Mobile Recharge: the Top-Up window for OMT App, Whish App, iPick and Katsh now opens as soon as you click Top-Up. Drawer balances show "Loading..." for a moment, and if they can't be loaded you see why, with a Retry button.
- Wrong number: the window now says "Loading cards..." while your MTC and Alfa cards load, instead of "No MTC or Alfa card". If they can't be loaded, you see why, with a Retry button.
- Mobile Recharge: from now on every sale keeps what you entered on the transaction itself: the customer's name and phone, the shop line used, the Alfa Gift chosen, Days cost and price as typed in dollars, each iPick / Katsh / Whish App item picked, the discount as typed, the Whish / OMT App fee and who paid it, the Binance reference, a wrong number's right number and original sale, and how the customer paid. Items paid in one basket also keep which customer session paid for them.
- Phone Lines → For sale: a new "Give credit back" button. Use it when a buyer wants a line for sale with less credit than it has. Type the credit the buyer keeps and pick the shop line that gets the rest. The credit price per $1 starts at your Shop Config price and can be changed. Before you save, you see what is sent, the SMS fee, and the line's new price and cost. Example: a $15 line where the buyer keeps $9 sends $5.68 plus a $0.32 SMS fee to your shop line, and its price drops by $6.70 at 100,000 LBP per $1. To undo, void it on the Transactions page; this works only before the line is sold.
- Mobile Recharge, iPick / Katsh / Whish App: "Charge to shop line" now opens a window where you pick the line: any of your active MTC or Alfa shop lines (your main line is picked for you) or a line you hold for sale. Whish App MTC and Alfa cards have the button too, paid from your Whish App balance. Lines that are turned off are no longer offered or accepted.
- Phone Lines → Recharge → Card: Whish App MTC and Alfa cards are in the list too.
- MTC / Alfa: the Days tab now has a phone number field. From now on the number is saved with the sale and shown on the customer's account. If you type one of your own shop lines there, a "Clear the number" button lets you start again.

## 🤝 Partners

- OMT / Whish: on a "For Partner" receive, the note now says what really happens: no drawer moves, and the shop owes the partner the full amount received (the fee is not taken off). It used to say the drawer is credited and the fee is deducted.
- Partners: when the partner list can't load on a form ("For Partner"), the message now says why (for example "Too many requests") instead of "[object Object]".
- Partners: Settle now opens a calendar of the month. Settled days are green, open days show what is still owed in $ and LBP (short form, red or green by who owes whom; point at a day for the exact amounts), and the open days before today are already picked. Tap a day to add or skip it; to leave single entries out, untick them under "See transactions". Only the picked days are settled, and what the partner owes you and what you owe the partner on those days count against each other.
- Partners / Profits: a sale made for a partner now counts its profit as soon as a settlement clears it against what you owe that partner, not only when the partner pays cash. Undoing the settlement moves that profit back to pending.
- Partners: when the partner pays more than the picked days need, the extra stays on the partner's account as credit. Next time, "Use partner credit" takes it off what the partner pays.
- Partners: when you void a sale the partner already settled, the calendar shows what the partner paid for it as partner credit, ready for the next settlement, with a small ↺ mark on the day of the void.
- Partners: any settlement can be undone, in any order. Days a later settlement also paid stay as they are, and the difference shows on the partner's account.
- Partners: "Settle old history up to…" (admins) closes old days with the payments already on the account, without moving any money.
- Partners: the old way of settling, by amount (including a settlement on paper with no cash moved), is still there: "Settle by amount (old way)" at the bottom of the calendar.
- Partners: in a partner's Transactions and Payments windows, the From / To dates now include the whole "To" day and follow your shop's own day.
- Partners: on the settle calendar, "See transactions" opens a table of the picked days' entries next to the calendar (For / Through, notes, amount, what is left). Untick an entry there to leave it out of this settlement.
- Partners: on the settle calendar, each payment box can now be paid in dollars or lira: a dollar amount can be paid in LBP (and the other way round), converted at the rate shown on the box. A "Total" line under the boxes shows what you pay in all, for example "$2,984.00 + 710,000 LBP".

## 📒 Accounts

- Accounts: new "Export Excel" button. It saves every client who has account history into one Excel file laid out like the import sheet: a list of names and phones, then one page per client with purchases on the left, payments and refunds on the right, totals, and the remaining balance in USD and LBP. Rows keep their real dates.
- Accounts: an exported file can be imported into another shop with Import Excel. Every entry keeps its original date and the balances come out the same. Importing it back into the shop it came from is refused, because it would double every balance. Old handwritten sheets import as before.
- Accounts: in the exported Excel file, each name on the first sheet is a link — click it to jump to that client's page, and "Back to list" at the top of each page takes you back.
- Accounts: the exported Excel file now works like your own debt sheet, so you can keep writing in it: each client page has 20 empty rows inside the totals (a line you add is counted in the totals and the remaining balance), the same look (grey headings, yellow totals, $ and LBP amounts, borders), and the first sheet shows each client's remaining balance, which updates when you change their page.
- Accounts: the Excel and PDF buttons on a client's purchases and payments lists now include the Date column and select all columns by default. The note's label (for example "Imported Debt") is kept apart from the note text.
- Accounts: in a session basket's details window, tap a paid line (for example a Whish transfer or a sale) to open its details: what it was, its items and how it was paid. Cost prices, product numbers and other internal data are not shown there, and lines are named in words ("Recharge") instead of codes like "recharge_mtc".
- Accounts: when you click another client, their account shows "Loading..." until it has loaded. Before, the previous client's charges and their Cash Out button stayed on screen for a moment under the new client's name.
- Accounts: in Settle Debt, "Pick days on a calendar" shows the client's month. Paid days are green, unpaid days show what is left in $ and LBP (short form, red while owed, green for credit; point at a day for the exact amounts). Tap the days the customer is paying for: their items are ticked and the amount fills in. If something on those days was paid meanwhile, the payment is refused so you can reload and pick again.
- Accounts: when the customer has credit on the account, the calendar offers "Use credit" (filled in with what the picked days need, and you can change it). The credit pays those days and the amount to collect drops by the same figure. Voiding the payment gives the credit back.
- Accounts: debts that belong to no sale or service (manual debt, imported or opening balance) show under the calendar as "Earlier balance", not on a day.
- Accounts: in Settle Debt, the calendar's **See transactions** button opens a table of the picked days' items under the calendar, paid ones greyed, with what is left on each and a total per day. Untick an item there to leave it out of the payment, or search by name or number.
- Accounts: a charge that was refunded or voided no longer counts as unpaid, so a later payment goes to the customer's real debts instead.
- Accounts: several Whish App items (or several iPick / Katsh bills) sold together and put on the account now show every item. The account row lists each one with its price, Settle Debt names them all with the full total, and the details window lists each item and its title names the app and what was sold (for example "Whish App 2 items" or "Katsh Bill") instead of "WHISH_APP SEND". Amounts in that window now show as 355,000 LBP instead of 355000.00 LBP.

- Accounts: every row on a client's account now says what it was, in words the client understands, from what was saved with the sale. A repair shows the job number, device, repair, total, what was paid and what is on the account. An exchange shows both amounts and the rate. A voucher shows its code, value, status, expiry and your note. A loto ticket shows its amount (no more "CUSTOMER ACCOUNT"). A recharge shows the number, a custom service your note, and a basket each item and whether it was paid or put on the account. Settle Debt names the items the same way.
- Accounts: every row now has a details button (the eye). The window shows what was sold, the items, how each part was paid (method and currency) and what went on the account. It never shows cost prices, so you can turn the screen to the client.
- Accounts: the "All" filter now also lists clients who have never had anything on their account, so you can open a new client to start an account or check a zero balance.
- Accounts: the Excel and PDF buttons on a client's lists now save a statement for that client: name and phone at the top, the balance, purchases and payments with totals in $ and LBP, the date and the time in separate columns, and amounts Excel can add up. The file is named after the client, and arrows print correctly in the PDF.
- Accounts: a charge that was voided or fully refunded stays in the client's list but is crossed out with a "Voided" tag, and the line that cancels it now reads "Cancelled: …" with a minus amount (for example −5,630,000) instead of looking like another charge. A cancelled credit is marked the same way on the payments side, with its cancellation next to it.
- Accounts: the totals under a client's purchases and payments no longer count a voided charge or credit, so they match the balance and the client statement (for example 5,630,000 instead of 11,260,000).
- Accounts: the client statement (Excel / PDF) and the "Export Excel" file mark voided charges and their cancellations too. In the "Export Excel" file the cancellation stays on the paid side as a positive amount, so the file still imports correctly.
- Accounts: in a money transfer's details window, amounts in other currencies (for example USDT) now show with their own currency ("20.00 USDT") instead of a dollar sign.

## ⚙️ Settings

- Product suppliers: a supplier that still has products or a balance can no longer be deleted by mistake (which used to leave its debt behind). You are offered to merge it into another supplier instead.
- Settings → Users now lists admin users too, so an admin account can be seen, deactivated or given a new password there.
- Reset Data: if the list of what will be removed can't load, you now see why, with a Retry button. If it takes long, a Retry button appears too. Before, "Reset All Data" just stayed greyed out.
- Shop Config: if the shop settings can't load, you now see why, with a Retry button, instead of an empty form. If they take long, a Retry button appears too.

## 🧾 Expenses

- When you use an MTC or Alfa card from iPick, Katsh or Whish App, a "Wrong number" tick records it as a card sent to the wrong number, so the credits sent back can be entered later from the Transactions page.
- From now on, when a POS sale or a repair checkout hands back change in Lebanese pounds rounded up to the next 5,000 note, the extra is recorded as a small "Change rounding" expense, so your profits match the cash in the drawer. Example: a $26 sale paid with 2,400,000 LBP at 89,000 owes 86,000 LBP of change; you hand back 90,000, and the 4,000 LBP extra shows on the Expenses page. The drawer is not changed a second time. Voiding or refunding the sale removes the expense. On the Transactions page it shows only when you filter for Expenses.

## 📊 Profits page

- Dashboard: profit is no longer shown there, for any user. The "Net profit — last 30 days" tile and the trend chart's Profit view are gone; the chart shows product and telecom sales. Profit stays on the Profits page.
- New "Wrong-number credits recovered" line: credits sent back for cards recharged onto the wrong number, which lower the loss from those cards.

## 🛠️ Custom Services

- Selling an insurance now asks for its type: Compulsory, Third party, Domestic worker, All risk or Life. The type shows in History.
- New "Insurance renewals" card on the Dashboard: customers whose insurance ends within 7 days or has ended without renewal, with a daily reminder in the bell and a "Won't renew" button. Insurance sold before this update is matched by customer only.
- From now on Custom Services and Hold Money keep every detail you enter on the transaction itself: category, product, insurance status, partner (For or Via), notes and how the customer paid.
- Services: from now on, text you type in "Search Item or Service" is saved as the service's description even if you press Submit without pressing Enter first. Before, it was dropped and the service was saved as plain "Custom Service".
- Hold Money: the payment method now shows Cash straight away when you hold money or return a hold. Before, the list could stay empty for a few seconds.
- Services: new "Free — no charge" tick next to the selling price. The job saves at price 0 with nothing to collect. If a partner did the job, the partner is still owed the cost and it shows on their account.

## 🧾 Transactions

- Audit & Transactions: both tabs now open on today's entries and show 50 at a time. Scroll down and the next 50 load on their own (there is also a "Load more" button). The day filter sits above the table, with Today, Yesterday, This week, This month and All. The Rows box is gone.
- Transactions: a new Vouchers filter group shows gift card sales, gift card cancellations, and sales paid with a gift card.
- Transactions: the Method column now shows how the main money moved: what the customer paid with on a sale, how they were paid on a payout (for example an OMT or Whish receive). Change handed back and fees no longer count. Items paid in a customer session show the session (for example "Session #42").
- Transactions: exports are now easy to read (before, they could come out with empty cells). The Excel file opens on a Summary sheet: the period, your filters, who exported it and when, money in, out and net for each currency, and a count per type. The Transactions sheet has one row per transaction, with In and Out columns for each currency that Excel can add up, a totals row, the status and a few key details. The header stays in view when you scroll, and every column can be filtered. Two more sheets list every payment line (paid, change returned or received, change kept, refunds) and every saved detail. The PDF is a report grouped by day with each day's totals: each transaction on a bold line with its key details under it, money in green and money out red, voided ones struck through. In and Out add up the cash and wallet payments of the exported transactions, so a $823 sale paid with $700 and Lebanese pounds shows the $700 and the pounds. Money in other currencies, such as the euros of an exchange or USDT, is listed on the Payments sheet but not in these columns. Costs are included for admins only. Other pages' exports are unchanged.
- Transactions: the Ret. Credits, Status and Reverses columns are gone from the table. A voided or refunded row, a reversal, and credits returned on an Only Days sale now show as a small tag in the summary, and all three are listed in Details. The Excel export has the status in its own column, and the reversal and credits in the key details.
- Transactions: a new Details button on each row shows everything saved with that transaction: what was entered, how the customer paid, and any change returned or kept (on an expense or a supplier payment, change the vendor handed back shows as "Change received", and change the vendor kept as "Change kept by them"). Everything reads in words: dates as "16 Oct 2026", every amount with its currency ("$18.50", "500,000 LBP"), a commission rate as a percentage ("4.45%"), exchange rates exactly, and suppliers, partners and clients by name instead of a number. Older transactions show whatever was saved with them at the time. Costs, profits and commissions are shown to admins only. The same wording is used in the Excel and PDF exports.
- Transactions: a supplier, partner or client write-off now shows the amount forgiven in the Amount column (for example "$15 forgiven") instead of "—", and every exchange shows what the customer gave and got (for example "$100 → 8,850,000 LBP"; a euro exchange read "$1 + −5,162,000 LBP" before and now reads "50 EUR → 5,162,000 LBP").
- Transactions: a sale with an item refunded from the POS is now tagged "PARTLY REFUNDED" ("REFUNDED" once every item is back), and it no longer offers Void and Refund for the whole sale, which could not be done anyway. The item refund itself is tagged with the sale it came from (for example "↩ #10895"), and its Details say which transaction it reverses.
- From now on, debts, suppliers, partners and expenses keep what you type on the transaction itself: notes in full, the reason for a write-off or discount (including a partner write-off, whose reason only showed on the partner statement before), the client's name and phone on debt entries, an expense's bill as you typed it before the vendor kept the change, and how the money was paid.
- From now on POS sales, repairs and warranty claims keep what you entered on the transaction itself: each item's price, cost, serial number or unit and warranty, the gift card used, the discount, the partner, and the picked client's name and phone; a repair's device, its full issue text, status, repair cost, price before the discount (an LBP repair's discount too), warranty and parts; a warranty claim's unit, replacement, notes and override reason; and how the customer paid.
- From now on Exchange and Loto keep what you entered on the transaction itself: an exchange's rate and market rate for each step, whether you typed your own rate, each step's profit, the rate the payout was worked out at, the partner, and the picked client's phone; a Loto ticket's number, commission rate, discount, partner, and the customer's name and phone, even when no client was saved; a Loto prize's ticket number and date; and how the money was paid, handed out or kept as change. A name typed on a Loto ticket without picking a saved client now also shows in Loto's Ticket History and in the Transactions client column.
- From now on, searching Transactions by a client's name also finds the transactions where you picked that saved client (for example a POS sale), because the client's name and phone are now kept on the transaction itself.
- From now on a void, a refund or an undone refund keeps the original transaction's client name and phone and says which transaction it reverses, with how each returned phone was marked (faulty, warranty date). At a customer session checkout, the extra, the kept change and the forgiven amount keep the customer's name and phone and how the customer paid, and items paid in the basket from the POS, repairs, Custom Services and Loto keep which session paid for them.
- The type filter on Audit & Transactions is now grouped: OMT App, Whish App, Binance, Recharge, Drawer & Top-ups, Loto, Suppliers, Partners, Expenses and Other open and close, and the box next to a group ticks or clears everything in it. Nothing ticked still means all types.
- On Transactions, filtering by an OMT App, Whish App or Binance type now also shows other transactions paid through that wallet: for example a repair or sale paid with OMT Wallet, a refund paid back by OMT Wallet, or a customer session paid by it. Transactions of that wallet's other types (for example OMT App Recv when you picked OMT App Send) still show only under their own filter.
- On Transactions, the type filter has a new Debts group: Debt Repayment, Account Adjustment, Account Credit, Cash Advance and Credit Cash Out. Each one also shows other transactions put on a customer's account: for example a sale or repair charged to the account, change kept as credit, or a customer session left on the account.
- From now on, refunding one item of a sale from the POS takes whole cents and whole Lebanese pounds out of the drawer (before, it could take odd amounts like $679.587 and 11,164,641.555 LBP), and refunding every item of a sale one at a time gives back exactly what the customer paid.
- From now on, an item refund says which product was returned, for example "1x iPhone 15 128GB from Sale #182", instead of a product number.
- From now on, refunding an item from a customer session basket also says which product was returned, for example "1x USB-C cable from Sale #191", instead of an item number. Refunding the rest of the basket lists each product.
- Transactions: from now on, in a transaction's Details, money the shop pays out shows as Out: Loto prizes, Hold Money pickups, expenses, supplier and partner payments, cash advances and credit cash-outs, OMT / Whish / Whish App / Binance payouts, Exchange payouts, Custom Services pay-outs, credit buy-backs and Whish App top-ups paid to a client. Change a vendor or supplier hands back shows as In. Transactions saved before keep their old labels.
- Transactions: from now on, a top-up's Details shows the amount, the currency and the drawers it moved between. A top-up from a drawer also lists both lines: out of the drawer, into the wallet.
- Transactions: from now on, an iPick, Katsh or Whish App item paid in a basket, picked from the Whish App list or sent to a partner shows the item's name in Details (for example "4.5"), not only its category.
- Refunds: when a sale's change was given in another currency, the refund window now fills in the real amount the customer paid, in the currency they paid with. Example: paid $55, got 250,000 LBP change at 90,000 — the refund fills in $52.22, not $55 plus 250,000 LBP.
- Refunds: a new "+ Customer gives change" link in the refund window. If the customer brings back the change they got (for example the 250,000 LBP), enter it there and hand back the full amount ($55).

## 🧺 Customer sessions

- A till or laptop no longer joins another cashier's open customer session by itself, so a sale there stays a normal walk-in sale instead of landing in that customer's basket. Each device goes back to its own open session after a refresh; to work on someone else's, pick it from the Sessions list.
- Session checkout: you can now give one discount on the whole basket (the "− Discount" side of the line under Total Amount), up to the shop's profit on the basket. It cannot be combined with an extra or a waived amount. The Profits page shows these under a new "Session discounts" line.
- The session checkout window now has "Set custom time". The time you pick is used for everything in that checkout: every item, the extra, the kept change or forgiven amount, the payment, and any amount put on the customer's account. An item that already had its own custom time when you added it keeps that time. Before, a session checkout was always saved at the time you checked out.
- A Binance send or cash-out, an OMT App or Whish App transfer, and iPick, Katsh or Whish App items added to a customer session now keep the custom time you set on them. Before, that time was ignored and they were saved at checkout time.
- The session window under the top-bar session button now opens only when you click the button, and closes when you click it again, click anywhere else, or press Escape. Moving the pointer over the top bar no longer opens it, so it can't cover the page by accident (for example the MTC / Alfa / iPick tabs on Mobile Recharge). To start a new session or switch to another one, use the small arrow next to the session button.
- Mobile Recharge, MTC and Alfa Credit: in a customer session, the phone number now starts filled with the session customer's phone. A number you type is never replaced.
- From now on, when part of a session basket goes on the customer's account in Lebanese pounds, Accounts and Settle Debt show it on the item that is priced in pounds (for example an MTC recharge of 600,000 LBP), in pounds. Before, it could show on an item the customer had already paid in cash, as a dollar amount, and Settle Debt did not pick it when the customer paid in pounds. Baskets checked out before this update keep the old split.

## 🎁 Vouchers

- Vouchers: from now on, selling a gift card takes payment (cash, a wallet, or the customer's account) and puts the money in the drawer. Cancelling an unused gift card refunds the customer: the cash part back from the drawer and the account part taken off their account. Gift cards created before this update were not paid for, so cancelling them refunds nothing.

## 👥 Clients

- Web app: a phone typed with spaces or dashes, such as "03 123 456", is now accepted when adding or editing a client. It used to be refused with "Invalid phone number format". From now on both apps save the phone without the spaces or dashes.

## 🔧 Repairs

- The repair checkout now opens with the client name and phone you typed on the job. Before, the Customer fields were empty and you had to search for the client again.

## 🧮 Checkpoint

- An OMT shop no longer sees an empty "Whish cash drawer" on the Dashboard, and is no longer asked to count it at a checkpoint or when entering opening drawer amounts (and the same for the OMT cash drawer in a Whish shop). Whish cash in an OMT shop already goes into the General drawer. If that drawer still holds money, it stays visible until you move the money to General with "From Drawer" in the Dashboard's "Top Up General Drawer" window.
- Checkpoint: if a drawer's currencies or expected balances can't load (for example when the connection is busy), the drawer now says so with a Retry button, and its Save stays off until everything has loaded. Before, Save stayed on and could save a wrong or empty count.
- Initial Drawer Amounts: if the drawers can't load, you now see why, with a Retry button, instead of an empty window.
- Checkpoint: from now on, an Over or Short stays open until it is explained. When you find the missed sale, expense or other entry and save it with "Set custom time" before that checkpoint, the difference shows as Resolved and the drawer is not counted twice, so your next checkpoint comes out balanced. Turn on "Open differences only" on the Checkpoints page to see what is still unexplained.
- Checkpoint: this works for sales, expenses, debts, exchange, OMT/Whish, recharges, services, repairs, Loto and Hold Money. It does not yet work for session checkout, drawer top-ups and cash-outs, or MTC and Alfa: there the entry still moves the drawer, and a difference on MTC or Alfa can only be closed by hand.
- Set custom time: when the time you pick is before a checkpoint that still has an open difference, a note under the time tells you which drawer and difference the entry will resolve.
- Checkpoint: a difference nobody can explain can be closed from the checkpoint's details. A Short is then listed under Expenses as "Drawer shortage" on the checkpoint's day; an Over records nothing. Reopen undoes it.
