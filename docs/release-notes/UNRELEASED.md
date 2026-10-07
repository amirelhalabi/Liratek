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

## 🏠 Dashboard

- The Pending Settlement banner on the Dashboard now also lists partners you still need to settle
  with.

## 🤝 Partners

- Partners page: a transfer you do through a partner on OMT App or Whish App now shows as "OMT APP"
  or "WHISH APP" in the partner's history, instead of looking like a regular OMT or Whish transfer.
  From now on only.
- From now on, partner payments count against what the partner still owes after refunds, so profit on later partner sales is no longer held back by refunded ones.

## 🧾 Transactions

- Refunding a currency exchange now works: the refund simply swaps the money back.
- When refunding a sale or a debt payment in cash, you can now hand back a round amount: a leftover under $1 (or 100,000 LBP) in the refund's currency is kept as shop profit — for example, refund $20.12, hand back $20. Works on the Transactions page, POS "Refund Sale" and customer-session item refunds.

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

## 📱 MTC / Alfa

- MTC / Alfa: selling days now also lowers the line's credit balance by the days' cost, so the drawer
  and the lines stay equal. From now on only.
- iPick, Katsh and Whish App: the touch and Alfa prepaid card tiles now show a picture of the card,
  so you can spot the right one at a glance.
- Binance cash-outs, OMT App / Whish App receives, MTC/Alfa credit buy-backs and Whish App credit bought from a client: you can hand out a round amount a little under what's owed (less than $1 or 100,000 LBP) and the difference is shop profit. Payouts to a customer's account, from a wallet, for a partner or inside a customer session still need the exact amount.

## 🎟️ Loto

- Loto: a ticket's payment must now add up to its price. From now on, change kept as store credit
  is recorded on the customer's account.
- Loto settlement: the payment you record must now match the settlement amount.
- Loto tickets can now be paid with a customer's gift card.
- A Loto ticket paid in dollars is now accepted at the till's exchange rate.
- "Settle All" on the Loto page now records one payment covering all open checkpoints, and
  "Create Checkpoint & Settle" asks for the correct amount.

## 💱 Exchange

- Exchange: you can now keep the change — hand out the round amount (e.g. $101 instead of $101.12) and the leftover cents count as shop profit automatically; the form says so. On the Profits page those kept cents count as kept change instead of being added into the Currency Exchange profit, which now shows only the exchange margin; the total profit is the same.
- Exchange: the page now opens on USD → LBP.

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

## 💳 Debts

- Cashing out a client's credit: if you hand out slightly less than the credit (under $1 or 100,000 LBP), the credit now clears to zero and the difference counts as shop profit on the Profits page.
- Cashing out a credit now checks that the cash you hand out matches what comes off the client's credit, and only allows cash or wallet methods (not the client's account or a gift card).
- Repayments where you keep the extra change: from now on the kept amount is checked against what the customer actually paid, and it no longer counts as paying off the client's other items.
- Hold Money: when you hand back a held amount as a round figure (for example $50 of $50.12), the small leftover (under $1 or 100,000 LBP, same currency) is kept as shop profit and the hold is fully closed. It shows on the Profits page (its own Hold Money card and a By Module row) and in the day close; voiding the pickup takes it back out.

## 🌐 Web app

- Web app: a customer's gift cards now show up as a payment option (they were missing in the browser).
- liratek.shop now opens an information page about LiraTek, in English and Arabic. Shops keep logging in at their own address, as before, and the page has a box to jump to your shop's login.

## 🧾 Expenses

- Expenses: search and pick any inventory item or Katsh / iPick / Whish App product to record using it for the shop — it comes out of stock at its cost, no cash moves.
- Desktop app: an expense entered with an earlier date and time now keeps that time (it was saved as "now").
- Recording an expense now has a separate Bill amount. If you hand the vendor more than the bill, enter the change you got back — it goes back into your drawer, and any change the vendor kept is added to the expense. From now on.
