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

## 💸 OMT / Whish & suppliers

- OMT account on the Suppliers page: a new check shows what OMT's balance SMS should say (your
  balance minus the commission OMT already deducted). Type the SMS figures to see any difference.
- Web app: shops created on the web now get OMT, iPick, Katsh, OMT App, Whish App and Loto Liban on
  the Suppliers page, like desktop shops always had. Existing web shops get the missing ones added
  automatically.
- Sending an OMT or Whish transfer for a partner now shows on the OMT/Whish supplier page as money
  you owe, and no longer takes cash out of a drawer. From now on only.
- Transfers you do through a partner on your second system no longer appear as waiting for a
  supplier settlement; your shop fee on them now counts as profit straight away. From now on only.
- Services page: a short hint explains that Amount is what the partner tells you to collect and Fee
  is your shop fee.
- Voiding an OMT or Whish transfer paid from a wallet with a card/wallet fee now puts the wallet
  back exactly as it was.
- Suppliers page: a voided transfer now shows as "Voided" in the supplier's transaction history (it used to say "Unpaid"), and it no longer counts toward the unpaid number or the Outstanding total.
- Services page, OMT/Whish receive: you can now hand out a round amount a little under what's owed (less than $1 or 100,000 LBP) and the shop keeps the difference as profit. The receive payment screen no longer asks for change. From now on.
- From now on, voiding or refunding a supplier payment also removes the discount you entered with it, so the supplier's balance and your profit go back to exactly where they were. Payments recorded before this update keep their discount after a void.
- OMT App and Whish App sends with a discount now go through: the customer pays less, and the discount comes out of your fee.
- On a Binance cash-out or an OMT App / Whish App receive, a discount now comes off your fee and the customer receives that much more, instead of the payout being refused.
- Binance sends: from now on, a discount lowers the shop fee recorded for the send (and shown on Profits), matching the cash you actually took in.
- The Services page no longer shows a discount box on OMT and Whish sends and receives, because a discount there was never applied.
- Custom services: when a service has no selling price saved, the price box now stays empty and you type the price before you can take payment or add it to a customer's basket. Before, the customer was charged the cost.
- From now on, a fee typed on a Whish App receive is no longer charged on a Whish App send. Switching between Send and Receive also clears the fee you typed.
- In a customer basket, an OMT receive line no longer shows a fee, and a For Partner transfer says it goes on the partner's account instead of listing fees the customer doesn't pay.
- Custom services: a For Partner service now needs a selling price, like a walk-in sale. Until you type one, "Submit to Partner" stays greyed out and the page asks for a price, so the partner is always charged the price.
- Desktop app: insurance services now start their fulfilment tracking (Ordered → Issued → Received → Delivered) like on the web app — before, the desktop app dropped it.
- Whish App receive: a fee typed while the amount was in dollars is no longer charged after switching to LBP, where the fee field is hidden. Switching between USD and LBP now clears the fee on OMT App and Whish App. From now on; receives already recorded keep their fee.
- When you settle a supplier and the payment you entered doesn't match the amount due, the error now tells you in plain words whether you paid too little or too much.
- Suppliers: Pay / Receive, Settle and OMT account Settle now use the rate you type in the payment box and save it with the transaction. On Pay / Receive, an LBP payment's share of your purchases is now worked out at that rate.

## 🏠 Dashboard

- The Pending Settlement banner on the Dashboard now also lists partners you still need to settle
  with.
- After you sign in, admins now get one Checkpoint window that lists all your drawers together (General first), when checkpoints are turned on and at least one drawer has not been counted today. Count each drawer and press its own Save — each drawer is saved on its own and then shows as "Counted today", while the others stay open for counting. Drawers already counted today are marked and can be counted again. The window stays open until you close it, opens once per sign-in, and closing it or refreshing the page does not bring it back. The clipboard button on each drawer card on the Dashboard still opens that one drawer's Checkpoint as before.

## 🤝 Partners

- Partners page: a transfer you do through a partner on OMT App or Whish App now shows as "OMT APP"
  or "WHISH APP" in the partner's history, instead of looking like a regular OMT or Whish transfer.
  From now on only.
- From now on, partner payments count against what the partner still owes after refunds, so profit on later partner sales is no longer held back by refunded ones.
- Settling a partner now saves the rate shown in the payment box with the transaction.

## 🧾 Transactions

- Refunding a currency exchange now works: the refund simply swaps the money back.
- Refunds: you can now hand back a round amount and keep a small leftover (under $1 or 100,000 LBP, in the refund's currency) as shop profit — for example, refund $20.12, hand back $20. Works for sales, debt payments, OMT/Whish and wallet transfers, recharges, custom services, repairs and Loto tickets, paid back in cash or through a wallet (not a customer account or gift card). It shows on the Profits page under Kept change on the day of the refund (not the day of the original sale or transfer), and in that day's close, so the close matches the drawer.
- Customer basket checkout: when a cash prize or payout covers the whole basket, a payment typed in earlier is no longer recorded as if the customer had paid it.
- Customer basket checkout: an OMT receive no longer asks the customer to pay the OMT fee — OMT never charges a fee on a receive.
- Customer basket checkout: a For Partner OMT or Whish transfer in the basket is no longer added to what the customer pays; it goes on the partner's account only. A For Partner receive is no longer paid out to the customer. From now on.
- Customer basket checkout: you can keep change as profit even when the basket includes a For Partner transfer.
- Customer basket: if an item can't be added to the basket, you now get a message saying why, and the item is not shown in the basket. Before, it showed for a moment even though it wasn't saved, then disappeared without explanation — or made the checkout fail later.
- The refund window now labels the amount "Hand back". When a refund can be slightly short, it says by how much (less than $1, or less than 100,000 LBP for LBP refunds) and that the difference is kept as profit.
- The Amount column now shows the sale's price instead of the cash the customer handed over. Voids and refunds show the amount reversed with a minus sign (−$4.25).
- Under each sale, void and refund, the cash is spelled out: "paid $5.00 · change $0.50", "handed back $4.00 · kept $0.25".
- The up/down arrows on voids and refunds now point the way the money actually moved.
- A basket that was voided or refunded as a whole shows its original payment and the reversal on separate lines.
- OMT/Whish supplier rows now say "Owed to OMT increased/reduced by …" instead of "Supplier TOP_UP".
- For items paid as part of a customer basket, the "@ rate" now shows the rate the customer actually paid at, not the rate when the item was added to the basket. Kept-change rows no longer show a rate on their own.
- From now on, change kept at session checkout is saved at the checkout's rate.
- From now on, voiding a held-money pickup, or voiding or refunding a supplier or partner payment that included a discount, saves the original entry's exchange rate on the reversal instead of today's rate.

## 🔧 Maintenance

- Saving a repair job that is already paid no longer charges the customer a second time.
- From now on, a repair job stays linked to its customer when you edit it or move it to In progress or Ready. Before, the link could be lost, so the payment showed no customer and "on account" payments were refused. Jobs that already lost their customer need the customer picked again at checkout.
- Reopening a repair job, and the History list, now show the customer's phone number.
- A walk-in customer's name now shows on the repair's line in Transactions, even with no phone number.
- From now on, the repair receipt prints the customer's name and phone number.
- More phone number formats are now accepted on repair jobs, such as "961 70 123 456" or "(03) 123456".
- An amber warning shows when a part's price is changed from its saved price — also for parts on a saved job.
- Maintenance: the phone you type is always saved — a job is linked to the client with that phone, or a new client is created, or the phone is kept on the job when no name is entered; picking a client from the search fills in their phone.
- From now on, change kept at a repair checkout is checked against what the customer actually paid; a checkout where it doesn't add up is refused instead of being booked as profit.
- A repair paid inside a customer session no longer adds kept change to the repair's profit — the session checkout records it once.

## 📊 Profits page

- A payout you make for a partner (for example a transfer you hand out on a partner's behalf) now
  counts its profit only as the partner pays you back, the same way "for partner" sales already
  do. This also applies to earlier payouts, but partner payments you recorded before this update
  do not count toward them.
- Profits: items in a customer basket put on the customer's account now count as profit only once
  the customer pays for them, same as outside a basket. From now on only.
- Binance transfers now show on the Profits page: the fee and any change you kept count in Overview, By Module, By Date, By Cashier and By Client, including past days. Binance amounts are counted as US dollars and now also count in revenue.
- Undoing a refund now brings Profits back to what it was before the refund, on every Profits tab and in the day close, including refunds undone on earlier days.
- In the Kept change details, change kept on a Debts credit cash-out is now labelled "Debts cash-out kept change".
- The Commissions tab now includes Binance, counted in dollars, so its total matches the Overview for the same period.
- Payment-method fees on Binance transactions now count as profit (in dollars) on every Profits tab.
- In a Binance or older OMT/Whish "Show transactions" list, a transfer with no commission now says "No commission was recorded on this transfer" instead of "counted when the supplier settles".
- The Kept change details no longer list voided entries, and an empty entry no longer says "repayment" when it wasn't one.
- By Cashier and By Client: the Transactions count now matches the number Avg Profit/Txn is worked out from, and clients or cashiers with nothing to show are hidden.
- The Product Sales card now says its count is net: voided, fully refunded and unpaid sales are not counted.
- The Custom Services card always shows a number of jobs, and zero costs or expenses now read "$0.00" instead of "-$0.00" on every card (including Mobile Services, Custom Services and Mobile Recharges).

## 📱 MTC / Alfa

- MTC / Alfa: selling days now also lowers the line's credit balance by the days' cost, so the drawer
  and the lines stay equal. From now on only.
- iPick, Katsh and Whish App: the touch and Alfa prepaid card tiles now show a picture of the card,
  so you can spot the right one at a glance.
- Binance cash-outs, OMT App / Whish App receives, MTC/Alfa credit buy-backs and Whish App credit bought from a client: you can hand out a round amount a little under what's owed (less than $1 or 100,000 LBP) and the difference is shop profit. Payouts to a customer's account, from a wallet, for a partner or inside a customer session still need the exact amount.
- Binance: the "≈ LBP" amount under the total now uses the rate you typed in the payment sheet, so it matches what is recorded.

## 🎟️ Loto

- Loto: a ticket's payment must now add up to its price. From now on, change kept as store credit
  is recorded on the customer's account.
- Loto settlement: the payment you record must now match the settlement amount.
- Loto tickets can now be paid with a customer's gift card.
- A Loto ticket paid in dollars is now accepted at the till's exchange rate.
- "Settle All" on the Loto page now records one payment covering all open checkpoints, and
  "Create Checkpoint & Settle" asks for the correct amount.
- Selling a ticket and settling with Loto now use the rate you type in the payment box: the payment is checked at that rate and the rate is saved with the transaction.

## 💱 Exchange

- Exchange: you can now keep the change — hand out the round amount (e.g. $101 instead of $101.12) and the leftover cents count as shop profit automatically; the form says so. On the Profits page those kept cents count as kept change instead of being added into the Currency Exchange profit, which now shows only the exchange margin; the total profit is the same.
- Exchange: the page now opens on USD → LBP.
- From now on, keeping change on an exchange payout is refused if the amount kept is more than what was actually left unpaid.

## 🛒 POS

- POS: a sale that was already completed can no longer be completed a second time (for example when the web app loses its connection right after you press Complete and you press it again) — before, it could take the stock, the customer's debt and a partner's charge twice.
- POS: refunding one item from a sale made for a partner now lowers what the partner owes by that item's price, and "Undo refund" puts it back. From now on only — earlier item refunds are not changed.
- POS: when the customer kept their change as store credit, refunding an item now also takes back that item's share of the credit, so the customer is not paid the change twice. From now on only.
- Customer sessions: if the change or a payout sent to the customer's account cannot be saved, the checkout now stops with an error instead of finishing without the customer's credit.
- Refunding a sale paid with a gift card now gives the gift card back.
- Payment form: new buttons under the change fields put the whole change in dollars or in LBP with one tap.
- Payment form: the remaining amount and the change now show in both dollars and LBP.
- Payment form: the Keep change button is gone — if you hand back less change than due, the difference is kept as shop profit automatically and the form says so (POS, maintenance, sessions, debts, services, Loto, MTC/Alfa, Katsh/iPick, OMT/Whish, Exchange).
- Debts: on a debt repayment, change you don't hand back is now kept as shop profit (the form says so) instead of being counted as extra payment off the customer's debt.
- Payment form: change you hand back in the other currency (for example LBP change from a dollar payment) while keeping the rest is now recorded as leaving the drawer — before, it was left out. From now on only.
- Prices: an amber warning now shows when you change a price away from its saved price — on MTC/Alfa credit, the Katsh/iPick "Only Days" days and credit prices, and Services presets and items — showing the saved price next to the new one. It is only a warning: the sale still goes through.
- POS and customer sessions: from now on, change you keep at checkout is checked against what the customer actually paid; a checkout claiming more kept change than was overpaid is refused instead of being booked as profit.
- Custom services: from now on, a payment that doesn't add up to the price is refused, and kept change is checked against the real change due. In a customer session, kept change is counted once, at checkout.
- Desktop app: custom services paid in another currency now save the exchange rate used in the payment window.
- Payment form: change can be kept as profit only from cash or wallet payments. If the customer paid by account or gift card, hand the change back in full.
- Payment error messages now start with a plain explanation of what's wrong (for example, "The payment doesn't add up to the total.").
- POS: when you refund a single item in cash, you can now keep a small leftover (under $1 or 100,000 LBP) as shop profit, the same as when refunding a whole sale. Undoing that item refund removes it again.
- Payment form: change warnings now show the dollar sign before the amount (for example "Returning $0.53 more…").
- Payment form: the Paid amount no longer turns red when change is due or kept. Red now only means something needs fixing, such as an underpayment or handing back too much change.
- When a payment doesn't match the total, the message now starts with a plain explanation ("The payment doesn't add up to the total." or "The payment is more than the total.") instead of technical text — on Loto, Exchange, OMT/Whish fees, Hold Money, supplier payments and other screens.
- At checkout, the screen now shows which drawer each payment goes into (for example Cash → General) instead of always saying Drawer B. The same applies when taking payment for a repair in Maintenance.
- POS and Maintenance checkout now convert Lira at the same rate as every other screen — a $10 item asks 890,000 LBP at a rate of 89,000. From now on, a POS cart added to a session is saved at the same rate it is paid at. Earlier sales keep their rate.

## 💳 Debts

- Cashing out a client's credit: if you hand out slightly less than the credit (under $1 or 100,000 LBP), the credit now clears to zero and the difference counts as shop profit on the Profits page.
- Cashing out a credit now checks that the cash you hand out matches what comes off the client's credit, and only allows cash or wallet methods (not the client's account or a gift card).
- Repayments where you keep the extra change: from now on the kept amount is checked against what the customer actually paid, and it no longer counts as paying off the client's other items.
- Hold Money: when you hand back a held amount as a round figure (for example $50 of $50.12), the small leftover (under $1 or 100,000 LBP, same currency) is kept as shop profit and the hold is fully closed. It shows on the Profits page (its own Hold Money card and a By Module row) and in the day close; voiding the pickup takes it back out.
- From now on, a debt repayment paid in lira against a dollar debt (or partly in each currency) counts once toward what the customer owed. Before, it could also mark recharges or services on the account as paid, so their profit showed up too early.
- From now on, voiding or refunding a debt repayment puts back exactly what that repayment paid off — it no longer marks an unrelated earlier sale, or a sale paid in cash, as unpaid again.
- Hold Money: when you return a hold in both dollars and lira, you can now hand back a little less in either currency (for example $50 + 950,000 LBP on a $50 + 1,000,000 LBP hold); the difference is kept as shop profit and the hold is closed. The return sheet shows how much is being kept before you confirm.
- The Cash Out window is now titled "Cash Out Credit" and its button says "Confirm Cash Out", so it no longer looks like a repayment.

## 🌐 Web app

- Web app: you can now sign in with Google. Connect your Google account once in Settings, then use "Continue with Google" on the login page. You can also create a new shop with Google. Your username and password keep working as before.
- Web app: a Google account can now be connected to one shop only. If it is already connected to another shop, "Connect Google" in Settings says so — disconnect it there first, or use a different Google account. Creating a new shop with a Google account that is already connected to a shop is refused too; sign in with Google instead. A connection to a suspended or archived shop, or to a deactivated user, does not count. Accounts already connected to more than one shop keep working until you disconnect one.
- Web app: a customer's gift cards now show up as a payment option (they were missing in the browser).
- liratek.shop now opens an information page about LiraTek, in English and Arabic. Shops keep logging in at their own address, as before, and the page has a box to jump to your shop's login.
- Web app: sign-up no longer uses an invite code. New shops join through an email invitation from LiraTek: open the link in the email to finish creating your shop.
- Web app (platform admin): you can now email a sign-up invitation from the Tenants page, see whether each invitation was used, and cancel one that went to the wrong address. "Add shop" also takes an optional contact email.
- Web app: LiraTek can now let new shops sign up on their own, without an invitation. When it is switched on, the sign-up page asks for your email and, if you like, your shop's name; we email you a link, and the shop name is already filled in when you open it. Platform admins can filter the Invitations list on the Tenants page to see only these sign-up requests.
- Web app: the login page has a "Forgot password?" link. Enter the email on your account (and your shop's address if asked) and you get an email with a link to choose a new password. It only works for users whose email address has been confirmed; anyone else should ask their shop admin to set a new password. Choosing a new password signs that account out on every device.
- Web app, Settings → Users: each user can now have an email address. When you add or change one, LiraTek emails a link to confirm it, and the list shows whether each email is confirmed. You can send the link again if it got lost.
- Web app, Settings → Users: "Invite by email" lets you add a staff member or admin by email. They get a link to choose their own username and password, with their email already confirmed. Invitations that are still waiting are listed with Resend and Revoke.
- Web app, Settings → Users: "Send password reset" emails a user a link to choose a new password. It works for users whose email is confirmed.
- Web app, Settings → Users: while a shop's subscription has lapsed, inviting users by email, changing a user's email and sending reset links are unavailable, like other staff changes. Revoking a waiting invitation still works.
- Web app: an email invitation can no longer be used to join a shop whose subscription has lapsed. The invite page says "This shop is not active right now. Ask the shop owner to renew, then use the link again." — the invitation is kept, so the same link works once the shop renews (before it expires).
- Several tills in the same shop no longer lock each other out with "Failed to load data" — each signed-in user now has their own allowance, and if it's ever reached the screen says to wait a minute and try again.
- Web app: your shop's own address (for example your-shop.liratek.shop) now shows only what your staff need: username and password, "Forgot password?" and "Continue with Google". It no longer offers to create a new shop; opening the sign-up page there takes you to www.liratek.shop.
- Web app: www.liratek.shop now asks "Sign in to your shop". Type your shop's address (just the name, like your-shop, is enough) and press Continue to go to your shop's sign-in page. "Continue with Google", "Forgot password?" and "Create your shop" are there too.
- Web app: the sign-in page no longer shows a stray dot after the version number.

## 🧾 Expenses

- Expenses: search and pick any inventory item or Katsh / iPick / Whish App product to record using it for the shop — it comes out of stock at its cost, no cash moves.
- Desktop app: an expense entered with an earlier date and time now keeps that time (it was saved as "now").
- Recording an expense now has a separate Bill amount. If you hand the vendor more than the bill, enter the change you got back — it goes back into your drawer, and any change the vendor kept is added to the expense. From now on.
- From now on, an expense saves the exchange rate shown in its payment box, including one you type by hand, instead of the day's market rate.

## ⚙️ Settings

- Settings → Mobile Services: "Category" now works. Type the new category's name and the new item form opens; the category is saved with its first item. You can now also change the subcategory in that form.
- Recharge page: admins can add a new category with the "New category" button under the cards (iPick, Katsh and Whish App), not only new items in existing categories.
- If you type a category or subcategory name that already exists with different capital letters (for example "ALFA"), the item goes into the existing one instead of a second copy.
- Items added or changed in Settings → Mobile Services now show on the Recharge page straight away, without reloading the app.
- Web app, Settings → Users: adding a user and inviting one by email now share one row. Pick "Create username/password" or "Send invitation" from the first dropdown.
- Reset Data no longer signs you out: you and everyone else in the shop stay signed in after a reset, and the "Done — rows removed" confirmation now shows. On the desktop app this applies from the next update.
- Settings › Reset Data now keeps your shop's setup: product categories, products (stock set to 0), Mobile Services items including the ones you added, service presets, and your partners and suppliers (balances set to 0). Sales, payments, clients, debts, stock history, closings and the audit log are still deleted.
- Reset Data now also sets each product's minimum stock to 0, so no low-stock warnings appear right after a reset. Set a minimum on a product again to get its warnings back.

## 📦 Inventory
- A product with a minimum stock of 0 no longer shows low-stock warnings (top-bar alert, Dashboard count, red stock figure on the Inventory list).
