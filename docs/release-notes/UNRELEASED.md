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

### See everything about a transaction

On the Transactions page, every row now has a Details button. It shows everything saved with that transaction in plain words: what was entered, how the customer paid, and any change handed back or kept. Voided and refunded rows carry a small tag, and the Excel export now opens on a Summary with money in and out per currency, while the PDF is a report grouped by day.
![Details of an OMT send: $210 paid in cash, $6 change handed back](whats-new/1.35.0/transaction-details.png)

### Try LiraTek free for 14 days

A new shop that signs up on the web app now gets a free 14-day trial, with no card needed. Every page shows how many days are left, with a button to message LiraTek on WhatsApp to activate. When the trial ends you can still sign in, see and export everything, and nothing is deleted; adding new sales and records waits until the shop is activated.

### Card sent to the wrong number

Recharged an MTC or Alfa card onto the wrong number from iPick, Katsh or Whish App? Open the sale on the Transactions page and tap "Wrong number…". The sale stays as it is, because it is the recharge of the customer's right number. The wasted card is recorded as a loss, and the credits sent back lower that loss when they arrive. Noticed it before saving the sale? On Expenses, pick the card and tick "Wrong number" instead.
![The Wrong number window on a card sale](whats-new/1.35.0/wrong-number-sale.png)

### Customer pays part now, owes the rest

On Exchange, the payment window now shows what the customer pays on top and what you pay out under it. Pick the client right there, type what they actually handed over, and the rest goes on their account by itself. "Client will owe" shows how much, and it appears on the Debts page.
![Exchange: 87,600,000 LBP paid, 1,900,000 LBP on the client's account](whats-new/1.35.0/customer-pays-exchange.png)

### Cash-outs paid in several ways

On Whish App, OMT App and Binance cash-outs, "Customer pays" is filled in for you: the transfer, plus the fee when the customer pays it separately. Split it across Whish, OMT and cash, or put part on the client's account.
![Whish App cash-out: $90 by Whish, $5 fee in cash, $10 on the client's account](whats-new/1.35.0/customer-pays-whish-app.png)

### Your accounts in one Excel file

On Accounts, tap "Export Excel" to save every client's account in one file, laid out like the sheet you import: a list of names and phones, then a page per client with what they bought, what they paid, and what they still owe in $ and LBP. You can import that file into another shop and every entry keeps its date. Importing it back into the same shop is refused, so nothing gets counted twice.
![The Export Excel button on Accounts](whats-new/1.35.0/accounts-export-excel.png)

### Send the receipt on WhatsApp

Right after a sale, the POS shows "Sale completed" with a Send on WhatsApp button, and every past sale's details have the same button next to Print. WhatsApp opens on the customer's chat with the receipt already written, and you press Send. No number on the sale? Type one for that send only. It costs nothing per message.

## 🛒 POS

- After a sale, and from any past sale's details, you can now send the receipt to the customer on WhatsApp. WhatsApp opens on their chat with the receipt already written; you press Send. Works on the desktop app and the web app.
- A reprinted sale receipt now shows the part put on the customer's account and any gift card on their own lines, and its "Paid" amount stays what the customer paid at the counter, even after they pay off the account later.

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
- Screen readers now call the currency picker next to the Extra amount "Extra currency". It used to say "Discount currency".

## ➕ Extra charges

- You can now charge a little more than the price: on the payment window's Discount line, switch to "+ Extra" and type the amount. Example: a case priced $6 sold for $7 — the case stays at $6 and the $1 is recorded as an extra, in the drawer of the payment method used.
- Works on the POS, Maintenance, Custom Services, Loto, MTC / Alfa sales, OMT / Whish send, Katsh, Binance send and at the customer session checkout (once for the whole basket). A sale has a discount or an extra, not both, and the extra can't be more than the sale itself.
- Profits shows a new "Extra charges" line with everything charged extra, so item profits stay what they were.
- Receipts show "Extra +$1.00" on its own line. Refunding one item gives back that item's share of the extra; voiding or refunding the whole sale gives it all back.

## 💸 OMT / Whish & suppliers

- OMT/Whish page: a send or receive no longer adds the sender (or receiver) to your clients when "Save as client" is unticked. If a client with that phone is already saved, the transaction is still linked to them. Paying on the customer's account still needs a client, so one is still saved in that case.
- OMT/Whish page, OMT send with "Online Brokerage": a BINANCE fee charged to the customer is now recorded with the send. Before, any such send with a fee was refused with "the payment is more than the total".
- OMT/Whish page: from now on each OMT or Whish send and receive keeps everything you enter on the transaction itself — service type, reference number, the customer's name and phone, OMT or Whish fee, whether the fee was included, the partner, the fee for paying by wallet, the note, and how the customer paid.
- OMT/Whish page: an OMT send paid by OMT Wallet or Whish Wallet with the wallet fee is no longer refused. The payment box now asks for the amount, the OMT fee and the wallet fee together (for example $102 on a $100 send), so the customer pays the right total.
- OMT/Whish page: when the sender's name and phone are filled in, picking OMT Wallet or Whish Wallet no longer puts the wallet fee on the customer's account. The wallet line now shows the full total (for example $102 on a $100 Intra send), and the send is recorded instead of refused.
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
- Undoing OMT settlements goes newest first: if a later settlement also paid some of the same transfers, void that later one first.
- OMT/Whish and Mobile Recharge (OMT App, Whish App, Binance, iPick, Katsh) History: from now on, when you correct a name or phone, the transaction in Transactions shows the new client name, phone and summary too. On OMT, Whish, OMT App and Whish App transfers, its Details also show the corrected sender, receiver or customer and note. On iPick and Katsh, correcting the note also changes the item text shown in Transactions. Before, Transactions kept showing the old name.

## 🌐 Web app

- The side menu's scroll bar only shows while your pointer is over the menu, and takes no space otherwise.
- Refreshing the page no longer sends you back to the sign-in screen when several people use the same login at once. If the app can't check your sign-in right away, it tries again for a few seconds before showing the sign-in screen.
- New shops now start with a free 14-day trial. You can see how many days are left at the top of every page and in the phone app, and contact us on WhatsApp to activate. When a trial ends you can still sign in, see and export everything; nothing is deleted.

## 🔒 Security & sign-in

- Staff can no longer read the shop's WhatsApp access key, including from the activity log. Only admins see it. Sending WhatsApp messages from the app works as before.
- When an admin changes someone's role, or sets a new password for them, that person is signed out and signs in again with the new role. A desktop app window already open on their PC picks up the change at their next sign-in.
- Web app: after 5 wrong passwords within 15 minutes when pairing a PC for offline use, or when unlocking the Profits page, further tries are refused until the 15 minutes are up.
- Web app: a PC paired for offline use stops sending and receiving while its shop is suspended, and starts again once the shop is active. The work it did offline is kept on the PC.

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
- Whish App: Bills now has a USD | LBP switch next to "Proceed to Pay", like the currency choice in the Whish app. In USD, each item shows and sells at its dollar price, and the cost comes out of your Whish App dollar balance. Items Whish sells only in dollars (for example Razer $1, Netflix $20, Yalla Live) show only in USD. MTC and Alfa prepaid cards stay in LBP. Each dollar price starts equal to its cost; change it in Settings → Mobile Services. The app remembers your last choice on each device. If you switch with items picked, it asks first, then clears them.
- iPick, Katsh and Whish App items: cards of the same kind now sit together, for example all Terranet Army DSL cards, then all Fiber cards, each from smallest to biggest (500MB now comes before 1.5GB and 5GB).
- Mobile Recharge, MTC and Alfa: your shop line now sits at the top, between the logos and the totals: the phone number with its credit. Your main line is picked when the page opens; the small arrow next to it lists your other lines, and the one you pick is the line the next sales send credits from (just for that screen; your main line stays the default). A small dot shows when something needs a look (a line running out of days, expired or burned, the balance not matching your lines, or days still owed to a customer).
- Mobile Recharge: click the phone number to record usage on that line straight away. Days still owed to customers (Mark sent) and a balance mismatch show in the same window. To edit or add a line, use Settings → Shop lines.
- Whish App top-up from a client: "Fee included in amount" now changes what you pay out. Ticked: the client sends $100 and you pay out $99 (the fee comes out of the credits). Not ticked: the client sends $101 and you pay out the full $100. The window shows what the client sends and what you pay out. Before, the payout was always the amount minus the fee, ticked or not.
- Mobile Recharge: the Top-Up window for OMT App, Whish App, iPick and Katsh now opens as soon as you click Top-Up. Drawer balances show "Loading..." for a moment, and if they can't be loaded you see why, with a Retry button.
- Wrong number: the window now says "Loading cards..." while your MTC and Alfa cards load, instead of "No MTC or Alfa card". If they can't be loaded, you see why, with a Retry button.
- Mobile Recharge: from now on every sale keeps what you entered on the transaction itself: the customer's name and phone, the shop line used, the Alfa Gift chosen, Days cost and price as typed in dollars, each iPick / Katsh / Whish App item picked, the discount as typed, the Whish / OMT App fee and who paid it, the Binance reference, a wrong number's right number and original sale, and how the customer paid. Items paid in one basket also keep which customer session paid for them.

## 📒 Accounts

- Accounts: new "Export Excel" button. It saves every client who has account history into one Excel file laid out like the import sheet: a list of names and phones, then one page per client with purchases on the left, payments and refunds on the right, totals, and the remaining balance in USD and LBP. Rows keep their real dates.
- Accounts: an exported file can be imported into another shop with Import Excel. Every entry keeps its original date and the balances come out the same. Importing it back into the shop it came from is refused, because it would double every balance. Old handwritten sheets import as before.
- Accounts: in the exported Excel file, each name on the first sheet is a link — click it to jump to that client's page, and "Back to list" at the top of each page takes you back.
- Accounts: the exported Excel file now works like your own debt sheet, so you can keep writing in it: each client page has 20 empty rows inside the totals (a line you add is counted in the totals and the remaining balance), the same look (grey headings, yellow totals, $ and LBP amounts, borders), and the first sheet shows each client's remaining balance, which updates when you change their page.
- Accounts: when you click another client, their account shows "Loading..." until it has loaded. Before, the previous client's charges and their Cash Out button stayed on screen for a moment under the new client's name.

## ⚙️ Settings

- Reset Data: if the list of what will be removed can't load, you now see why, with a Retry button. If it takes long, a Retry button appears too. Before, "Reset All Data" just stayed greyed out.
- Shop Config: if the shop settings can't load, you now see why, with a Retry button, instead of an empty form. If they take long, a Retry button appears too.

## 🧾 Expenses

- When you use an MTC or Alfa card from iPick, Katsh or Whish App, a "Wrong number" tick records it as a card sent to the wrong number, so the credits sent back can be entered later from the Transactions page.
- From now on, when a POS sale or a repair checkout hands back change in Lebanese pounds rounded up to the next 5,000 note, the extra is recorded as a small "Change rounding" expense, so your profits match the cash in the drawer. Example: a $26 sale paid with 2,400,000 LBP at 89,000 owes 86,000 LBP of change; you hand back 90,000, and the 4,000 LBP extra shows on the Expenses page. The drawer is not changed a second time. Voiding or refunding the sale removes the expense. On the Transactions page it shows only when you filter for Expenses.

## 📊 Profits page

- New "Wrong-number credits recovered" line: credits sent back for cards recharged onto the wrong number, which lower the loss from those cards.

## 🛠️ Custom Services

- From now on Custom Services and Hold Money keep every detail you enter on the transaction itself: category, product, insurance status, partner (For or Via), notes and how the customer paid.
- Services: from now on, text you type in "Search Item or Service" is saved as the service's description even if you press Submit without pressing Enter first. Before, it was dropped and the service was saved as plain "Custom Service".
- Hold Money: the payment method now shows Cash straight away when you hold money or return a hold. Before, the list could stay empty for a few seconds.

## 🧾 Transactions

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
- From now on, refunding one item of a sale from the POS takes whole cents and whole Lebanese pounds out of the drawer (before, it could take odd amounts like $679.587 and 11,164,641.555 LBP), and refunding every item of a sale one at a time gives back exactly what the customer paid.
- From now on, an item refund says which product was returned, for example "1x iPhone 15 128GB from Sale #182", instead of a product number.
- From now on, refunding an item from a customer session basket also says which product was returned, for example "1x USB-C cable from Sale #191", instead of an item number. Refunding the rest of the basket lists each product.
- Transactions: from now on, in a transaction's Details, money the shop pays out shows as Out: Loto prizes, Hold Money pickups, expenses, supplier and partner payments, cash advances and credit cash-outs, OMT / Whish / Whish App / Binance payouts, Exchange payouts, Custom Services pay-outs, credit buy-backs and Whish App top-ups paid to a client. Change a vendor or supplier hands back shows as In. Transactions saved before keep their old labels.
- Transactions: from now on, a top-up's Details shows the amount, the currency and the drawers it moved between. A top-up from a drawer also lists both lines: out of the drawer, into the wallet.
- Transactions: from now on, an iPick, Katsh or Whish App item paid in a basket, picked from the Whish App list or sent to a partner shows the item's name in Details (for example "4.5"), not only its category.

## 🧺 Customer sessions

- The session checkout window now has "Set custom time". The time you pick is used for everything in that checkout: every item, the extra, the kept change or forgiven amount, the payment, and any amount put on the customer's account. An item that already had its own custom time when you added it keeps that time. Before, a session checkout was always saved at the time you checked out.
- A Binance send or cash-out, an OMT App or Whish App transfer, and iPick, Katsh or Whish App items added to a customer session now keep the custom time you set on them. Before, that time was ignored and they were saved at checkout time.
- The session window under the top-bar session button now opens only when you click the button, and closes when you click it again, click anywhere else, or press Escape. Moving the pointer over the top bar no longer opens it, so it can't cover the page by accident (for example the MTC / Alfa / iPick tabs on Mobile Recharge). To start a new session or switch to another one, use the small arrow next to the session button.
- Mobile Recharge, MTC and Alfa Credit: in a customer session, the phone number now starts filled with the session customer's phone. A number you type is never replaced.

## 👥 Clients

- Web app: a phone typed with spaces or dashes, such as "03 123 456", is now accepted when adding or editing a client. It used to be refused with "Invalid phone number format". From now on both apps save the phone without the spaces or dashes.

## 🔧 Repairs

- The repair checkout now opens with the client name and phone you typed on the job. Before, the Customer fields were empty and you had to search for the client again.

## 🧮 Checkpoint

- Checkpoint: if a drawer's currencies or expected balances can't load (for example when the connection is busy), the drawer now says so with a Retry button, and its Save stays off until everything has loaded. Before, Save stayed on and could save a wrong or empty count.
- Initial Drawer Amounts: if the drawers can't load, you now see why, with a Retry button, instead of an empty window.
