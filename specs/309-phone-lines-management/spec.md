# Feature Specification: Phone Lines Management — Shop Lines, For-Sale Lines, Expiry Alerts and Internal Recharge

**Feature Branch**: `309-phone-lines-management` (work happens on `main`; no branch)

**Created**: 2026-10-11

**Status**: Draft

**Ticket**: LIRA-309 (`current_sprint.md`)

**Input**: User description: "Phone Lines management. One place to manage the shop's phone numbers, in two kinds: shop lines (existing carrier_lines, used to charge other lines) and for-sale lines (inventory products in a "Phone Lines" category, LIRA-207). Every line carries an expiry date and a credit amount. Expiry alerts: amber 3 days before expiry, then red through the 5-day revival grace until the line is lost, shown on the Dashboard "needs attention" panel and the notification bell. Mobile Recharge detects any typed number that is one of ours (shop line or for-sale line). Recharging a for-sale line is an internal recharge with no customer payment. Source can be a cash card from stock, credit transferred from a shop line, MTC/Alfa days, or bought for cash from a drawer. The recharge's cost is added to the line's cost (capitalized, no expense that day), and the line's selling price rises automatically by the same amount, still editable in Inventory. Example: a $15/$25 line plus $3 of days becomes $18/$28, and profit at sale stays $10. For-sale line credit/expiry must not count in the MTC/Alfa drawer, closing counts, or shop-line buy-back matching. Must work on desktop and web."

**Owner decisions (2026-10-11, answered through selectable questions)**:

1. For-sale lines warn **3 days** before expiry; shop lines keep today's **7-day** warning (owner, 2026-10-11).
2. A recharge on a for-sale line is **added to that line's cost** — no expense is booked on the recharge day.
3. The selling price **rises automatically** by the recharge cost and stays editable.
4. Three recharge sources: MTC/Alfa days, credit from a shop line, and a card from the iPick/Katsh balance. "Paid in cash" was dropped by the owner as unnecessary.
5. A lost for-sale line stays in stock with a "write off?" alert; the owner decides, and only their Write off books the loss.

## Background — what exists today

- **Shop lines** (Settings → Carrier Lines) already have a phone number, carrier (MTC/Alfa), credit, an expiry date, and a 5-day revival grace after expiry. Their credits make up the MTC/Alfa drawer. Mobile Recharge already recognises a shop line's number when charging or buying back credit.
- **For-sale lines** (LIRA-207) are inventory products in a category whose name contains "line"/"lines". Each number is its own product with its own cost and price, bought from a dealer on credit and sold at the POS. They have **no** expiry date, **no** credit amount, and are **not** recognised by Mobile Recharge.
- **Nothing** warns the shop that a line is about to expire.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See every line and its expiry in one place (Priority: P1)

The owner opens a Phone Lines page and sees all the shop's numbers in two groups: **Shop lines** (used to charge customers) and **For sale**. Each row shows the number, carrier, credit, expiry date, days left and a status colour. The owner can add, edit, archive and reactivate lines, and set or correct the expiry date and credit of any line, including for-sale lines that were added before this feature and have no expiry yet.

**Why this priority**: Every other story depends on lines having an expiry date and credit, and on a single place to see them. On its own it already lets the owner spot a line about to expire by looking.

**Independent Test**: Add one shop line and one for-sale line with expiry dates, open the Phone Lines page, and check both appear in the right group with the right days left and colour.

**Acceptance Scenarios**:

1. **Given** a shop line expiring in 10 days and a for-sale line expiring in 2 days, **When** the owner opens the Phone Lines page, **Then** the shop line shows under Shop lines as green with "10 days left" and the for-sale line shows under For sale as amber with "2 days left".
2. **Given** a for-sale line created before this feature with no expiry date, **When** the owner opens the page, **Then** the line shows as "No expiry set" (grey) and the owner can enter its expiry date and credit.
3. **Given** the owner edits a for-sale line's expiry date and credit, **When** they save, **Then** the new values show on the page and on the line's inventory record, and the MTC/Alfa drawer total does not change.
4. **Given** a for-sale line that has been sold, **When** the owner opens the page, **Then** the line no longer appears under For sale (it can be found under a "Sold" filter).

---

### User Story 2 - Get warned before a line expires (Priority: P1)

The shop is warned in time to save a line. A for-sale line turns **amber** 3 days before its expiry date (a shop line 7 days before, as today). After the expiry date it turns **red** with "in grace — N days left to save it" during the 5-day revival grace. After the grace runs out it shows as **lost** (grey, struck). Amber and red lines appear in the Dashboard's "needs attention" panel and in the notification bell, for both shop lines and for-sale lines.

**Why this priority**: Losing a line is losing money (a for-sale line's cost, or a working shop line). This is the main reason the owner asked for the feature.

**Independent Test**: Set a line's expiry to 2 days from today, open the Dashboard, and check that a warning naming the number appears in "needs attention" and in the bell.

**Acceptance Scenarios**:

1. **Given** a for-sale line expiring in exactly 3 days, **When** the Dashboard loads, **Then** "needs attention" lists it as "expires in 3 days" and the bell shows a matching alert.
2. **Given** a for-sale line expiring in 4 days, **When** the Dashboard loads, **Then** no alert is shown for it; **given** a shop line expiring in 6 days, it is listed (7-day window).
3. **Given** a line whose expiry was 2 days ago, **When** the Dashboard loads, **Then** it is listed in red as "expired — 3 days left to save it".
4. **Given** a **shop line** whose expiry was 6 days ago, **When** the Dashboard loads, **Then** it is no longer an alert and shows as lost on the Phone Lines page.
5. **Given** an unsold **for-sale line** whose expiry was 6 days ago, **When** the Dashboard loads, **Then** it is listed in red as "lost — write off?" until the owner writes it off (FR-016).
6. **Given** the shop is in Beirut and the server is in another time zone, **When** the day changes at midnight Beirut time, **Then** days left and alerts follow the shop's own calendar day, never the server's.
7. **Given** a line with an alert is recharged so its expiry moves 30 days ahead, **When** the Dashboard refreshes, **Then** the alert disappears.

---

### User Story 3 - Recharge a for-sale line and carry the cost into its price (Priority: P1)

A for-sale line is about to expire. On Mobile Recharge the cashier types its number; the screen recognises it as **one of our lines for sale** and switches to an internal recharge — there is no customer and no customer payment. The cashier picks what the recharge comes from (MTC/Alfa days, credit transferred from a shop line, or a card from the iPick/Katsh balance) and the amount. On save, the line's expiry and/or credit go up, the cost of the recharge is added to the line's cost, and its selling price rises by the same amount.

**Why this priority**: This is the owner's money rule. Without it, recharge spend on a for-sale line is either lost from view or shows up as a loss on the recharge day while the eventual sale over-reports profit.

**Independent Test**: Take a for-sale line at cost $15 / price $25, recharge it with 30 days costing $3, then check: cost $18, price $28, no expense row for that day, the days' source reduced by $3, and selling the line books $10 profit.

**Acceptance Scenarios**:

1. **Given** a for-sale line at cost $15 and price $25, **When** the cashier recharges it with MTC days that cost the shop $3, **Then** the line's cost becomes $18, its price becomes $28, its expiry moves forward by the days added, and no expense is recorded for the recharge.
2. **Given** that recharged line, **When** it is later sold at $28, **Then** the sale's profit is $10.
3. **Given** a recharge with an **MTC card from the iPick balance** costing 356,000 LBP ($4 at 89,000), **When** it is saved, **Then** 356,000 LBP leaves the iPick drawer, the card's days and credit go onto the line, and the line's cost and price each go up by $4.
4. **Given** a recharge by **transferring credit from a shop line** worth $2 at cost, **When** it is saved, **Then** the shop line's credit goes down (and with it the MTC/Alfa drawer, as for any shop-line credit use), the for-sale line's credit goes up, and the for-sale line's cost and price each go up by $2.
5. **Given** the owner later edits the line's price in Inventory to $27, **When** they save, **Then** $27 is kept; the automatic raise does not override a later manual edit.
6. **Given** the recharge is voided or refunded from Transactions, **When** the reversal completes, **Then** the line's cost, price, expiry and credit return to their values before the recharge, and the source (iPick/Katsh balance, shop-line credit or days) is given back — every ledger touched nets to zero.
7. **Given** a for-sale line that has already been sold, **When** its number is typed on Mobile Recharge, **Then** it is treated as a normal customer number, not as one of ours.

---

### User Story 4 - Mobile Recharge recognises every number that is ours (Priority: P2)

Whatever number the cashier types on Mobile Recharge, the screen says whether it is one of the shop's lines — a shop line or an unsold for-sale line — however the number is written (spaces, dashes, +961 or 00961). Shop lines keep today's behaviour (charging the shop's own line, buying back credit). For-sale lines get the internal recharge from User Story 3.

**Why this priority**: Prevents a cashier from charging a shop's own for-sale line as if it were a customer sale, which would book fake revenue. It mostly reuses detection that already exists for shop lines.

**Independent Test**: Type an unsold for-sale line's number as "+961 3 555 101" on Mobile Recharge and check that the "our line for sale" banner appears and the customer-payment section is replaced by the internal-recharge choices.

**Acceptance Scenarios**:

1. **Given** an unsold for-sale line 03555101, **When** the cashier types "+961 3 555 101", **Then** the screen shows "This is your line for sale: MTC line 03 555 101".
2. **Given** a shop line, **When** its number is typed, **Then** the screen behaves exactly as today.
3. **Given** a number that is neither, **When** it is typed, **Then** the normal customer recharge flow is unchanged.
4. **Given** the cashier is on an MTC tab and types an Alfa for-sale line's number, **When** the number is recognised, **Then** the screen says it is an Alfa line and does not let it be recharged from the MTC tab.

---

### Edge Cases

- **Line already lost** (more than 5 days past expiry): it shows as lost; an internal recharge is refused with a plain message, matching how shop lines are treated today. A lost for-sale line keeps a "write off?" alert until the owner writes it off (FR-016).
- **No expiry entered**: the line shows "No expiry set" and never raises an expiry alert; the Phone Lines page offers a filter for these so they can be filled in.
- **Same number in both groups**: a number cannot be both a shop line and an unsold for-sale line; saving the second one is refused with "This number is already one of your lines."
- **Partially-known cost**: a recharge from a source with no known cost (for example days whose cost was never set) is refused until a cost is entered, so the line's cost and price are never raised by a guess.
- **Recharge after a manual price edit**: each new recharge adds its cost on top of whatever the price is at that moment.
- **Archived shop line / deleted for-sale product**: neither appears in alerts or in recharge detection.
- **For-sale line credit**: its credit is the line's own balance that goes to the buyer with the line; it is never part of the MTC/Alfa drawer, closing counts or checkpoint totals.
- **Time zone**: "today", days left and the grace boundary are always the shop's calendar day (desktop and web alike).

## Requirements *(mandatory)*

### Functional Requirements

**Lines and the Phone Lines page**

- **FR-001**: System MUST provide one Phone Lines page listing shop lines and for-sale lines in two separate groups, each row showing number, carrier, credit, expiry date, days left and status.
- **FR-002**: Users MUST be able to set and edit the expiry date and credit of a for-sale line, from the Phone Lines page and from the line's inventory record, with the same values shown in both places.
- **FR-003**: Shop lines MUST keep all of today's behaviour (credits, expiry, grace, primary line per carrier, drawer total, checkpoints); the Phone Lines page shows and edits them through the same rules as Settings → Carrier Lines.
- **FR-004**: For-sale lines MUST continue to be sold through the existing inventory and POS flow; a sold line leaves the For sale group.
- **FR-005**: A phone number MUST NOT exist as both a shop line and an unsold for-sale line at the same time, compared in its normalised form.

**Status and alerts**

- **FR-006**: Each line MUST have one status derived from its expiry date and the shop's current calendar day: OK (more than the warning window left), Expiring soon (0 to window days left — 3 for for-sale lines, 7 for shop lines), In grace (1–5 days past expiry), Lost (more than 5 days past expiry), or No expiry set.
- **FR-007**: Lines that are Expiring soon or In grace MUST appear in the Dashboard "needs attention" panel and as notification-bell alerts, each naming the number, carrier, kind (shop / for sale) and days left (or days left to save it).
- **FR-007a**: A for-sale line that is Lost MUST keep a red "lost — write off?" alert until the owner writes it off (FR-016); a lost shop line shows as lost on the Phone Lines page only.
- **FR-008**: Alerts MUST clear by themselves once the line's expiry moves out of the warning window (recharge or manual edit), is archived, or is sold.
- **FR-009**: The warning window MUST be 3 days for for-sale lines and 7 days for shop lines (each a named constant), and the grace MUST be the existing 5-day revival grace, defined once for both kinds.
- **FR-010**: "Today" for status and alerts MUST be the shop's own calendar day as reported by the device in use, on desktop and web; the server's clock is only a fallback.

**Detection on Mobile Recharge**

- **FR-011**: Mobile Recharge MUST recognise a typed number as a shop line or an unsold for-sale line however it is formatted (spaces, dashes, +961, 00961) and show which line it is.
- **FR-012**: A recognised for-sale line MUST switch the screen to an internal recharge with no customer and no customer payment; it MUST NOT be possible to book it as a customer sale.

**Internal recharge of a for-sale line**

- **FR-013**: The internal recharge MUST offer three sources: MTC/Alfa days taken from a shop line, credit transferred from a shop line of the same carrier, and a card of the same carrier from the iPick/Katsh catalog paid from that balance. Each source MUST reduce what it consumes (shop-line days/credit, iPick/Katsh balance) by the right amount.
- **FR-014**: The recharge's cost to the shop MUST be added to the for-sale line's cost, and the line's selling price MUST rise by the same amount; no expense is recorded on the recharge day, and the line's profit when sold stays what it was before the recharge.
- **FR-015**: The recharge MUST update the line's expiry and/or credit according to what was added (days extend the expiry following the existing stacking and grace rules; credit raises the line's credit).
- **FR-016**: When a for-sale line becomes Lost, it MUST stay in stock and be shown as a red "lost — write off?" alert until the owner acts. Nothing changes in the books on its own. When the owner taps **Write off**, the line's stock goes to 0 and its full cost (including any capitalized recharges, e.g. $18) is booked as a loss on that day. The write-off MUST be reversible in the same way as other stock write-offs, netting to zero. (Owner decision 2026-10-11.)
- **FR-017**: Every internal recharge MUST appear in Transactions as one row identifying the line and the source, and MUST be reversible; voiding or refunding it MUST restore the line's cost, price, expiry and credit and give back the source, with every ledger touched netting to zero per currency. A void MUST be refused, with a plain message and no change, when (a) the line has been sold, (b) a newer recharge of the same line is still active, or (c) for a days recharge, the source shop line has had a newer days movement since (the existing shop-line rule: "Undo the newer days sale on that shop line first.").
- **FR-018**: The selling price raised by a recharge MUST remain editable in Inventory, and a later manual edit MUST be kept.

**Separation and parity**

- **FR-019**: For-sale line credit and expiry MUST NOT count toward the MTC/Alfa drawer, closing or checkpoint totals, primary-line selection, or shop-line credit buy-back matching.
- **FR-020**: Every capability in this feature MUST work the same on the desktop app and the web app, with the same roles: the same people who can use Mobile Recharge can recharge a line; only owners/admins can add, edit or archive lines.

### Key Entities

- **Line**: a phone number the shop owns. Attributes: number (stored normalised), carrier (MTC/Alfa), kind (shop line / for sale), credit, expiry date, status, active/archived. A shop line is today's carrier line; a for-sale line is linked one-to-one to the inventory product it is sold as.
- **For-sale line details**: the expiry date and credit of a for-sale line, attached to its inventory product and kept apart from shop-line totals.
- **Internal line recharge**: one recharge of a for-sale line. Attributes: line, source (iPick/Katsh card / shop-line credit / days), amount added (days and/or credit), cost to the shop, cost and price before and after, who and when, reversal state.
- **Expiry alert**: a derived item for any line that is Expiring soon or In grace, plus any unsold for-sale line that is Lost (write-off prompt); not stored, recomputed from the line and the shop's calendar day.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner can find every line inside its warning window (3 days for-sale, 7 days shop) from the Dashboard alone, in one look, without opening any other page.
- **SC-002**: 100% of lines inside their warning window or 1–5 days past expiry show an alert; 0 lines outside that window do.
- **SC-003**: For a recharged for-sale line, profit at sale equals profit before any recharge, to the cent (e.g. $15/$25 + $3 recharge → $18/$28 → $10 profit).
- **SC-004**: Recharging a for-sale line and then voiding that recharge leaves the iPick/Katsh balance, shop-line credit, the line's cost/price/expiry/credit, and the MTC/Alfa drawer exactly as they were.
- **SC-005**: Adding, editing or recharging for-sale lines never changes the MTC/Alfa drawer total or a closing/checkpoint count.
- **SC-006**: A cashier can complete an internal recharge of a for-sale line in under 1 minute from typing the number.
- **SC-007**: Every story above passes the same checks on both the desktop app and the web app.

## Assumptions

- Lines are MTC or Alfa only, as today.
- Alfa days can be sold today (the Days tab is not limited to MTC — likely based on the code, to be confirmed on screen during planning); if not, Alfa days as a recharge source is added within this feature.
- A "card" recharge uses the iPick/Katsh catalog and balance; the shop keeps no separate card count (owner, 2026-10-11).
- "Credit" on a for-sale line is informational for the owner and the buyer (what the line holds); it carries no money of the shop's.
- The warning windows (3 days for-sale, 7 days shop) are fixed for this version; making it a shop setting is a possible later addition.
- The phone (mobile) app does not show these alerts in this version.
- Recharging a shop line itself keeps today's flows; this feature only adds the internal recharge for for-sale lines.
- "Any recharge" means the MTC/Alfa recharge form, the only screen that takes a target phone number. iPick/Katsh card and Only-Days sales record just the customer's phone and are out of scope for detection.
- The existing number normalisation (strip spaces, dashes, +961/00961, keep the leading 0) is the single rule for comparing numbers across both kinds.
