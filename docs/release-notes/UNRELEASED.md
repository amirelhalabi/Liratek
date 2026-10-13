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
- Debts (Settle Debt) and Partners (Settle): the separate green Discount / Forgive box is gone. Forgiving is now a "Forgive (no cash)" line in the payment box, and typing an amount there no longer changes the payment you entered. A "Client will owe" (or "Partner will owe") line shows what is left after you confirm. To forgive part of it, lower the payment first.

## ➕ Extra charges

- You can now charge a little more than the price: on the payment window's Discount line, switch to "+ Extra" and type the amount. Example: a case priced $6 sold for $7 — the case stays at $6 and the $1 is recorded as an extra, in the drawer of the payment method used.
- Works on the POS, Maintenance, Custom Services, Loto, MTC / Alfa sales, OMT / Whish send, Katsh, Binance send and at the customer session checkout (once for the whole basket). A sale has a discount or an extra, not both, and the extra can't be more than the sale itself.
- Profits shows a new "Extra charges" line with everything charged extra, so item profits stay what they were.
- Receipts show "Extra +$1.00" on its own line. Refunding one item gives back that item's share of the extra; voiding or refunding the whole sale gives it all back.

## 🌐 Web app

- Refreshing the page no longer sends you back to the sign-in screen when several people use the same login at once. If the app can't check your sign-in right away, it tries again for a few seconds before showing the sign-in screen.

## 📱 MTC / Alfa

- Checkpoint for MTC or Alfa alone: Save works again. It used to stop with "At least one drawer amount is required" and save nothing.
- Checkpoint: the Credits box for each line now shows the amount rounded to cents (705.3), instead of a long number like 705.3000000000001.

## 🛠️ Custom Services

- The For Partner / Via Partner boxes now sit on one line, with the partner picker (and Pay out) neatly on the line below them. The picker used to float between the boxes, lower than them.
