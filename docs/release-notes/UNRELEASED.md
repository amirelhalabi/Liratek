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

## 📱 MTC / Alfa

- A Checkpoint that would have set the MTC or Alfa drawer to an amount with no shop line behind it is now refused, instead of quietly saving a wrong drawer total.
- Checkpoint and the Setup wizard now count MTC and Alfa credits per SIM line — if a carrier has more than one active line, each gets its own credits field, and the drawer total is always their sum. A carrier with no active line shows a prompt to add one (phone number + starting credits) right there, instead of a plain dollar field.
- Setup now requires a phone number before it will accept starting MTC or Alfa credits, so a typed balance can never be silently dropped.
- Adding, editing, archiving or re-activating a shop SIM line in Settings → Carrier Lines (or quick-updating its balance from the Recharge tab) now moves that carrier's drawer to match, automatically — so the drawer always equals your lines' credits added together.
- Changing an MTC or Alfa line's credits by hand now shows as a "Line Adjustment" on the Transactions page and on the Checkpoint Timeline, with who did it — so a drawer change from a SIM-line edit is no longer a mystery when the next checkpoint doesn't match what you expected.
- Alfa Gift cards now use your sell rate from Shop Config.
- Refunded MTC and Alfa sales now show as Refunded in the History window, instead of looking like normal sales.
- The Discount in the MTC and Alfa payment window now works: the customer pays the lower price, and the sale's profit goes down by the discount. A discount can't be bigger than the sale's profit, so a discounted sale never loses money — for a Credit Transfer, the cap also leaves room for the SMS cost the shop pays to send the credit. Before, the sale was refused, or the discount was added to the customer's debt.
- In the MTC and Alfa History window, a sale charged to a customer's account shows "Pending until paid" next to its profit until the customer pays. The Profits page counts that profit only after payment.
- The Discount field no longer appears when buying credits back on the shop's own line.
- When an MTC or Alfa sale has a discount, its receipt now shows the full price, the discount, and the total charged — instead of just the amount paid.

## 💸 Expenses

- Split payment is no longer available when recording an expense, so the amount and payment method you see always match what gets saved.
- The Total USD / Total LBP at the top of the Expenses page no longer counts an expense that was voided from the Transactions page, so it matches the Profits page and the closing report.
- In the Expense History window, filtering by date now shows an expense under the day it was recorded on your clock, so a line-usage expense recorded between midnight and 3 a.m. no longer disappears from that day.

## 🎟️ Loto

- From now on, a loto ticket sold with an earlier Transaction Time counts on that earlier day on the Loto page and in Ticket History, the same day the Profits page shows it.
- In the Settle window, "Unchecked Activity" now shows exactly the tickets the next checkpoint will include: tickets sold after a checkpoint taken earlier today now appear, and voided tickets no longer raise the amount you owe Loto.
- The Commission card at the top of the Loto page now has a "Kept change" line under it, showing the change you kept from customers on today's tickets (in LBP, and in dollars if any). For tickets paid at the counter, commission plus kept change is the loto profit the Profits page shows.

## 🔧 Maintenance

- Maintenance: kept change at checkout now counts as profit, from now on.
- Backdating a repair checkout now works on the desktop app too, and moves the payment as well.
- A repair's profit now lands on the day it was paid (not the day the device was dropped off) across every Profits tab and the closing report, so a multi-day repair no longer goes missing from the day it was actually delivered and paid.
- Voiding a paid repair no longer leaves a negative revenue amount for that cashier or client on the Profits page.
- When a paid repair was given a discount, the jobs list and the Maintenance History window now show the original price crossed out next to the amount actually charged (for example 300,000 → 250,000 LBP), matching what the Profits page counts.

## 📊 Profits page

- The commission total on the Overview card and the By Payment Method tab now always match for the same period.
- A supplier commission the shop has booked but the partner hasn't paid yet now shows up as deferred profit instead of disappearing from the page.

## 💱 Exchange

- When exchanging between two currencies that have no rate set in Exchange Rates, the profit preview now shows the profit that will actually be recorded, instead of $0.
- The realized-profit preview when selling a currency you hold now matches the recorded profit to the cent.

## 🛠️ Custom Services

- On the Services page, the profit in the history list, on the Today's Profit card and in the form preview now includes change the cashier chose to keep, so it matches the Profits page.
- The Services page's Today's cards no longer count voided or refunded services, and the Today's Profit card counts a for-partner or on-account service the same way the Profits page does (only the part already paid).
- A service sold at a loss now shows its negative profit (for example -$6.00) on the Services page, instead of $0.00.

## 💸 OMT / Whish & suppliers

- In the OMT / Whish history list, the Fee and Profit of an LBP transfer now show in LBP (for example 5,000 LBP) instead of a dollar amount, and a commission that is only counted once the supplier settles is marked "est.".
- On the OMT App and Whish App confirm screen, Shop Profit now shows the profit after the discount you give, which is the amount that gets recorded.

## 🌐 Web app

- Reprinting a service receipt from the Transactions page now works in the web app.
