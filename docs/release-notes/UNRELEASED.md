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

- Alfa Gift cards now use your sell rate from Shop Config.

## 💸 Expenses

- Split payment is no longer available when recording an expense, so the amount and payment method you see always match what gets saved.

## 🔧 Maintenance

- Maintenance: kept change at checkout now counts as profit, from now on.
- Backdating a repair checkout now works on the desktop app too, and moves the payment as well.
- A repair's profit now lands on the day it was paid (not the day the device was dropped off) across every Profits tab and the closing report, so a multi-day repair no longer goes missing from the day it was actually delivered and paid.
- Voiding a paid repair no longer leaves a negative revenue amount for that cashier or client on the Profits page.

## 📊 Profits page

- The commission total on the Overview card and the By Payment Method tab now always match for the same period.
- A supplier commission the shop has booked but the partner hasn't paid yet now shows up as deferred profit instead of disappearing from the page.
