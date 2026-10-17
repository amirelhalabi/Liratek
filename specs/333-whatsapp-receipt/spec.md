# Feature Specification: Send the receipt on WhatsApp

**Feature Branch**: `main` (owner works on main)
**Ticket**: LIRA-333
**Created**: 2026-10-17
**Status**: Draft
**Input**: Owner decision (2026-10-17): send the receipt on WhatsApp through a free WhatsApp click-to-chat link with the receipt text already typed in; the cashier presses Send in WhatsApp. No paid WhatsApp business messaging service and no per-message cost. POS sales first, from right after the sale and from a past sale's details. The text carries the shop name, the items, the totals in USD and LBP as the printed receipt shows them, and the warranty lines when there are any. Lebanese phone numbers (+961) in local formats are accepted.

## Background

Competing shop systems advertise "WhatsApp receipts". LiraTek can print a receipt, and its Settings already hold fields for a paid WhatsApp business messaging account, but nothing sends a receipt to the customer. The owner does not want a paid messaging service: the shop's own WhatsApp (on the shop phone, the WhatsApp desktop app or WhatsApp Web) is enough, provided LiraTek opens the right chat with the receipt already written.

What exists today and shapes this feature:

- **Two receipt moments for a sale.** The checkout window can preview and print a receipt before the sale is saved, and a past sale's details window can reprint it. When the cashier presses "Complete Sale", the checkout window closes at once and a short "Sale completed" notice appears; there is no screen that stays open after a sale.
- **A new sale has no receipt number until it is saved.** The number printed on a receipt is the saved sale's number; a receipt printed from checkout before saving shows no number.
- **The printed receipt is laid out for a narrow paper roll** (fixed-width columns, ruled lines). That layout reads badly in a chat bubble.
- **The two existing printouts of a sale are not built the same way.** The checkout printout shows any part charged to the customer's account separately from cash paid; the reprint from a past sale does not show an on-account line.
- **Clients carry a "Receive updates via WhatsApp" switch.** Clients created from the client form default it ON; clients created automatically from a POS sale or a repair default it OFF. Nothing reads the switch today.
- **Which transactions get a customer receipt is already decided in one place**: product sales, mobile recharges, repairs, custom services, Loto, bill payments and catalogue cards are receiptable; OMT/Whish money transfers (system and app), Binance and debt repayments are not.

## Clarifications

### Owner decisions (2026-10-17, from the ticket)

- Free click-to-chat link only. No paid WhatsApp messaging service, no per-message cost, no message sent by LiraTek in the background: the cashier always presses Send in WhatsApp.
- POS sales come first.

### Decisions taken in this spec (owner may overturn)

- **The client's "Receive updates via WhatsApp" switch does NOT block sending a receipt.** A receipt is sent by the cashier, in front of the customer, about a purchase the customer just made, from the shop's own WhatsApp; the switch is about updates the shop might send on its own. Blocking on it would also disable the button for most customers, because clients created from a sale or a repair default to OFF. The switch keeps its current meaning and is not changed by this feature.
- **The WhatsApp message carries the same facts and figures as the printed receipt, in a layout made for a phone screen** (one fact per line, no paper-width padding), not a copy of the paper layout.
- **A number typed only to send one receipt is not saved** to the client or the sale. Changing a customer's phone stays where it is today (the client form, or editing the customer on the sale's details).
- **Scope by receipt type** (see "Scope"): POS sales in this feature; the other receiptable transactions in a later phase that reuses the same rules; money transfers and debt repayments out.

### Session 2026-10-17

- Q: Where does "Send on WhatsApp" appear right after a sale, given "Complete Sale" closes checkout at once? → A: A small non-blocking strip on the POS screen — "Sale completed — RCP-123 · Send on WhatsApp · Print" — that stays until the next sale starts (FR-001).
- Q: What happens to the unused WhatsApp business messaging (Cloud API) fields in Settings → Integrations and the "send test WhatsApp message" button on the client form? → A: Keep them unchanged in LIRA-333; a follow-up ticket will remove them (follow-up ticket to be opened) (FR-021, out of scope).

## Scope

| Receipt | In this feature? | Why |
|---|---|---|
| POS sale, right after completing it | **Yes (P1)** | Owner's first ask |
| POS sale, from a past sale's details (POS recent sales, Transactions page, Warranty lookup — wherever the sale's details window opens) | **Yes (P1)** | Owner's first ask; customers ask for a receipt later |
| Repair pickup, mobile recharge, custom service, Loto, bill payment, catalogue card (the transactions that already have a "Print" receipt in their History or on the Transactions page) | **Later phase (P3)** — same rules, separate ticket | Already receiptable; reuse the same "which transactions get a receipt" decision, not a new list |
| Customer session checkout receipt | **Later phase (P3)** | One receipt for many items; needs its own content check |
| OMT / Whish money transfers (system and app), Binance | **Out** | The shop has already decided these never get a customer receipt |
| Debt repayment | **Out** | No customer receipt exists for it today; creating one is a separate feature |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Send the receipt right after a sale (Priority: P1)

A customer buys a phone and a cover and gives their number. The cashier completes the sale. Right after, a "Send on WhatsApp" action is available for that sale. The cashier clicks it; WhatsApp opens on the customer's chat with the receipt already written (shop name, receipt number, date, the two items, the warranty line of the phone, totals in USD and LBP, what was paid and the change). The cashier presses Send in WhatsApp. The next customer can be served without waiting for anything.

**Why this priority**: it is the moment the customer is standing at the counter and the reason the owner asked for the feature.

**Independent Test**: complete a sale for a client with a Lebanese mobile number, use the action, and check that WhatsApp opens on that number with a message whose figures equal the sale's printed receipt.

**Acceptance Scenarios**:

1. **Given** a sale just completed for a client whose phone is `03 123 456`, **When** the cashier uses "Send on WhatsApp", **Then** WhatsApp opens a chat to `+961 3 123 456` with the receipt text filled in and not yet sent.
2. **Given** that sale had one item with a 12-month warranty, **When** the message opens, **Then** it shows that item's "Warranty until" date and the shop's warranty terms, exactly as the printed receipt does.
3. **Given** the sale was paid partly in LBP and partly charged to the customer's account, **When** the message opens, **Then** it shows the total in USD and its LBP equivalent, the cash paid in each currency, and the account portion on its own line, never as money paid.
4. **Given** the sale was completed with no phone (walk-in), **When** the cashier uses "Send on WhatsApp", **Then** the cashier is asked for a number first and may continue with it, or cancel; nothing is saved to any client.
5. **Given** the cashier does not use the action, **When** they start the next sale, **Then** nothing about the sale or the checkout flow differs from today (no extra step is forced on every sale).

---

### User Story 2 - Send the receipt of a past sale (Priority: P1)

A customer comes back a week later and asks for their receipt on WhatsApp. The cashier opens the sale's details (from POS recent sales, the Transactions page or the warranty lookup) and clicks "Send on WhatsApp" next to "Print". WhatsApp opens on the phone saved with that sale, with the receipt filled in, including the warranty date stamped at the time of sale.

**Why this priority**: customers lose paper receipts; warranty claims need the receipt.

**Independent Test**: open a sale saved last week, use the action, and compare the message with the reprint of the same sale: same receipt number, date, items, warranty dates and amounts.

**Acceptance Scenarios**:

1. **Given** a past sale saved with phone `+961 76 901 610`, **When** the cashier uses "Send on WhatsApp" in its details, **Then** WhatsApp opens on `96176901610` with that sale's receipt.
2. **Given** the cashier first corrects the customer's phone on the sale's details and saves it, **When** they then send, **Then** the corrected number is used.
3. **Given** a sale made at an old exchange rate, **When** its receipt is sent today, **Then** the LBP figures use the rate saved with the sale, not today's rate.
4. **Given** a sale that has been fully or partly refunded, **When** its details are open, **Then** the action is offered and the message shows exactly what that sale's reprint shows (see Assumptions on refunds).

---

### User Story 3 - The same action works on the desktop app, the web app and a phone browser (Priority: P1)

The same button behaves correctly wherever LiraTek runs: on the desktop app it opens the WhatsApp desktop app (or the browser's WhatsApp Web when the app is not installed); on the web app it opens WhatsApp in a new tab or the WhatsApp app; on a phone's browser it opens the WhatsApp app. LiraTek itself never navigates away from the screen the cashier was on.

**Why this priority**: every feature must work on both the desktop and the web app; a button that works on one only is a defect.

**Independent Test**: run User Story 1 once on the desktop app and once on the web app; in both, WhatsApp opens on the right chat with the same text, and the LiraTek screen is unchanged.

**Acceptance Scenarios**:

1. **Given** the desktop app, **When** the cashier uses the action, **Then** WhatsApp opens outside LiraTek (WhatsApp desktop app or the default browser), never inside a LiraTek window.
2. **Given** the web app, **When** the cashier uses the action, **Then** WhatsApp opens in a new tab or the WhatsApp app and the LiraTek tab stays on the same screen with its state intact.
3. **Given** the browser blocks the new tab, **When** the cashier uses the action, **Then** they see a message telling them so and can try again; the action is never silently ignored.

---

### User Story 4 - Other receipts on WhatsApp (Priority: P3, later phase)

Repairs at pickup, mobile recharges, custom services, Loto, bill payments and catalogue cards get the same "Send on WhatsApp" wherever they already have a "Print" receipt, with the same phone rules and the same message rules.

**Why this priority**: valuable, but each receipt type has its own content; POS first proves the approach.

**Independent Test**: for one of these types, the action appears exactly where "Print" appears and the message equals the printed receipt's figures.

**Acceptance Scenarios**:

1. **Given** an OMT or Whish money transfer, **When** its details or history row are shown, **Then** no "Send on WhatsApp" receipt action is offered (it gets no printed receipt either).

### Edge Cases

- **No phone on the sale or client**: the cashier types one for this send only; an empty or invalid number cannot be used (see phone rules).
- **A number that is clearly not a Lebanese mobile or an international number** (too short, letters): the cashier is told the number looks wrong and can fix it; LiraTek does not try to check whether the number has WhatsApp — WhatsApp itself reports that.
- **A landline number**: accepted as typed (LiraTek does not judge which Lebanese numbers have WhatsApp); WhatsApp reports if it has no account.
- **A foreign number** written with `+` or `00` and a country code other than 961: kept as that country's number, never prefixed with 961.
- **Very long sale** (many items, long warranty terms, long header text): the message is complete — totals and payment lines are never cut off. If a limit forces shortening, item details are shortened before totals, and the message says so.
- **Draft or unsaved sale**: no send; the action exists only for a saved sale (a receipt without its number would not match the reprint).
- **Sale saved while offline (desktop offline mode)**: sending still works if the device can reach WhatsApp; the message uses the sale as saved locally.
- **Sale linked to a customer session**: the action for that single sale behaves as for any sale; the session's combined receipt is the later phase.
- **Arabic or other non-Latin characters** in the shop name, item names or client name: they appear correctly in WhatsApp.
- **Amounts**: USD shown with two decimals and the currency sign, LBP as whole numbers with thousands separators, the same as the printed receipt.
- **The WhatsApp business messaging settings in Settings → Integrations are filled in**: this feature never uses them and never sends anything in the background.

## Requirements _(mandatory)_

### Functional Requirements

**Where the action appears**

- **FR-001**: Right after a POS sale is completed, the cashier MUST be able to send that sale's receipt on WhatsApp with one click, without reopening the sale, and without being forced through an extra step when they do not want to send. After "Complete Sale", a small non-blocking strip MUST appear on the POS screen reading "Sale completed — RCP-123 · Send on WhatsApp · Print" (with the saved sale's receipt number). The strip MUST stay until the next sale starts and MUST NOT block typing, scanning or starting the next sale.
- **FR-002**: The details window of a saved POS sale MUST offer "Send on WhatsApp" next to its existing "Print", wherever that window opens.
- **FR-003**: The action MUST be offered only for a saved sale; it MUST NOT appear for a draft or for a sale not yet saved.
- **FR-004**: WhatsApp MUST be opened only by a direct click of the cashier on the action. LiraTek MUST NOT open WhatsApp on its own (for example automatically after "Complete Sale"), because browsers block windows that open without a click and because the owner wants the cashier in control.

**What the message says**

- **FR-005**: The message MUST contain, when the printed receipt shows them: shop name, the shop's saved receipt header text, shop location and phone, receipt number, date and time, client name, each item with quantity, unit price when quantity is more than one, line amount, serial/IMEI with its label, "Warranty until" per item, the shop's warranty terms (only when a line has a warranty), subtotal, discount, extra charge, total in USD, total's LBP equivalent, amounts paid in USD and in LBP, the portion charged to the customer's account, change in USD and in LBP, the receipt note, and a closing thank-you line.
- **FR-006**: Every figure in the message MUST be identical to the same sale's printed receipt. The message and the printed receipt MUST take their figures from one shared description of the receipt, not from two separate calculations.
- **FR-007**: The message for a sale MUST be built from the sale as saved (its receipt number, its saved time, its saved exchange rate, its stamped warranty dates), both right after the sale and later, so that the two are identical for the same sale.
- **FR-008**: An amount charged to the customer's account MUST NOT be presented as paid; it MUST appear on its own line, as the checkout printout already does.
- **FR-009**: The message MUST be laid out for reading on a phone (one fact per line, readable labels), not padded to paper width, and MUST keep amounts and labels together on the same line.
- **FR-010**: The message MUST NOT contain cost, profit, supplier or any other internal figure. Its closing lines are the same as the printed receipt's (see Assumptions).
- **FR-011**: The message MUST be complete; if it ever has to be shortened, totals and payment lines MUST be kept and the message MUST say that it was shortened.

**Phone number**

- **FR-012**: The number used MUST be, in order: the phone saved with the sale; otherwise the phone of the sale's client; otherwise a number the cashier types for this send. The number MUST come from the sale itself, never from whatever client is selected elsewhere on screen at that moment.
- **FR-013**: A number typed only for one send MUST NOT be saved to the client or to the sale.
- **FR-014**: Numbers MUST be normalised to WhatsApp's international form (country code and number, digits only) by these rules:

  | Typed | Sent to | Rule |
  |---|---|---|
  | `03 123 456`, `03-123456`, `(03) 123456` | `9613123456` | spaces, dashes, dots and brackets removed; a leading `0` replaced by `961` |
  | `76901610` | `96176901610` | a local number without leading `0` gets `961` |
  | `+961 76 901 610` | `96176901610` | `+` removed, `961` kept |
  | `0096176901610` | `96176901610` | leading `00` removed, `961` kept |
  | `96176901610` | `96176901610` | already international |
  | `+33 6 12 34 56 78` / `0033612345678` | `33612345678` | other country kept, never prefixed with `961` |
  | `+961 03 123 456` | `9613123456` | a `0` typed after `961` is dropped |
  | `abc`, `12`, empty | — | refused with a message; the cashier can type another number or cancel |

- **FR-015**: The normalisation MUST be one shared rule used by every place that sends to WhatsApp.

**Opening WhatsApp — both apps**

- **FR-016**: On the desktop app, the action MUST open WhatsApp outside LiraTek: the WhatsApp desktop app when installed, otherwise WhatsApp in the default browser. It MUST NOT open WhatsApp inside a LiraTek window.
- **FR-017**: On the web app (computer or phone browser), the action MUST open WhatsApp in a new tab or in the WhatsApp app, leaving the LiraTek page where it was with its state intact.
- **FR-018**: If WhatsApp could not be opened (for example a blocked pop-up), the cashier MUST see a message saying so; the action MUST NOT fail silently.
- **FR-019**: The feature MUST cost nothing per message and MUST NOT require any WhatsApp account settings in LiraTek.

**Client WhatsApp switch and existing WhatsApp settings**

- **FR-020**: The client's "Receive updates via WhatsApp" switch MUST NOT hide, disable or block the receipt action.
- **FR-021**: Settings → Integrations' WhatsApp business messaging fields and the client form's "send test WhatsApp message" button MUST NOT be used by this feature, and MUST stay unchanged in LIRA-333. **Out of scope**: removing them is left to a follow-up ticket (follow-up ticket to be opened).

**Scope guards**

- **FR-022**: Money transfers (OMT/Whish system and app), Binance and debt repayments MUST NOT get a WhatsApp receipt action; any later phase MUST use the same "which transactions get a receipt" rule that decides "Print", not a new list.
- **FR-023**: Sending MUST NOT create, change or delete any transaction, payment, drawer or ledger entry, and MUST NOT change the sale or the client.

### Key Entities

- **Receipt content**: the customer-facing facts of one saved sale — shop identity, receipt number, time, client, item lines (name, quantity, prices, serial, warranty date), totals, LBP equivalent at the saved rate, payment lines in each currency, account portion, change, note. One description per sale, rendered either for paper or for WhatsApp.
- **Recipient number**: the customer's phone as stored or typed, and its normalised international form.
- **Client WhatsApp switch**: the existing "Receive updates via WhatsApp" flag on a client; read-only for this feature, and not a gate.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: From a completed sale, a cashier gets WhatsApp open on the customer's chat with the receipt filled in within 2 clicks and under 10 seconds (excluding WhatsApp's own load time).
- **SC-002**: For 100% of tested sales (including discount, extra charge, LBP payment, account portion, change in both currencies, serial items, warranty items), every figure in the WhatsApp message equals the same sale's printed receipt.
- **SC-003**: The message for a sale sent right after completing it and the message for the same sale sent later from its details are identical, word for word.
- **SC-004**: Every phone format in the FR-014 table produces the listed result, on both the desktop and the web app.
- **SC-005**: The action works on the desktop app and the web app; on neither does LiraTek leave the current screen or lose the cashier's work.
- **SC-006**: No message is ever sent without the cashier pressing Send in WhatsApp, and the shop pays nothing per receipt.
- **SC-007**: Completing a sale without sending takes no more steps than today.

## Assumptions

- The shop has WhatsApp on the counter computer (desktop app or WhatsApp Web signed in) or on a phone that runs the web app. If not, WhatsApp shows its own sign-in page; LiraTek does not manage that.
- WhatsApp's click-to-chat link remains free and accepts a pre-filled message of a full receipt's length. Likely, based on common use, but the exact length limit is unverified; the plan must measure it with a long sale (FR-011).
- The receipt stays in English, like the printed one. Arabic text typed by the shop (shop name, items) passes through unchanged.
- The "Powered by LiraTek" line printed on paper is kept in the message, like on paper (owner may remove it).
- The receipt time shown is the time saved with the sale, written the way the cashier's own device writes dates (as the printed receipt does today).
- A refunded sale's message follows the same rule as its reprint; if the reprint today ignores refunds, the plan raises it rather than inventing a different rule for WhatsApp.
- No record of "receipt sent" is kept: with a click-to-chat link LiraTek cannot know whether the cashier pressed Send.
- At implementation, the change adds its shop-owner release note (POS area, both apps) in the same change, per the project's release-note rule. Nothing ships with this spec.

## Dependencies and Risks

- **Opening an outside link from the desktop app** is not available to screens today (only the offline-mode code opens outside links). The plan must add it for both apps without screens checking which app they run in.
- **Two printouts disagree today.** The past-sale reprint does not show the account portion that the checkout printout shows. Whether the reprint's "paid" amounts include the account portion is unverified. FR-006/FR-008 require one shared receipt description, so the plan must reconcile the two before WhatsApp reuses either.
- **The existing phone formatting in the paid-WhatsApp code** turns any number not starting with `961` into a Lebanese one (it would mangle `0096…` and foreign numbers). FR-014's table supersedes it.

## Open Questions

None. Both earlier questions were answered by the owner on 2026-10-17 (see Clarifications → Session 2026-10-17):

1. **Where "Send on WhatsApp" appears right after a sale** — resolved: option A, the non-blocking "Sale completed — RCP-123 · Send on WhatsApp · Print" strip on the POS screen, kept until the next sale starts (FR-001).
2. **The WhatsApp business messaging fields in Settings → Integrations and the client form's "send test WhatsApp message" button** — resolved: option A, unchanged in LIRA-333; removal is out of scope (follow-up ticket to be opened) (FR-021).
