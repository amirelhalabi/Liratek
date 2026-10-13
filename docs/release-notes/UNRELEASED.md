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
- Paying out (OMT/Whish receive, Binance cash-out, Exchange): the kept change is shown once, in the green "Change kept" line.
- Debts, Settle Debt with some items ticked: one Remaining line shows what is left on the ticked items and the total.
- Paying by wallet with a fee: one Grand Total line names the wallet fee.
