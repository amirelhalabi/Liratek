# Feature Specification: Monthly KPI snapshot

**Feature Branch**: `364-monthly-kpi-snapshot` (work happens on `main`; ticket LIRA-364)

**Created**: 2026-10-30

**Status**: Draft

**Input**: Owner, 2026-10-30: "Create a system in our platform that takes a snapshot of the stock value and debt totals each month, so that after a year we can track our progress and see how we progressed over a year. The KPI list should have two types, generic and specific to phone shops."

## Clarifications

### Session 2026-10-30 (owner decisions)

- Q: Which figures? → A: Month-end balances only — no monthly totals such as revenue or profit. Eight KPIs: shop owes customers, shop owes suppliers, shop owes partners, customers owe shop, suppliers owe shop, partners owe shop, stock value, carrier total credits.
- Q: Currencies? → A: Every amount in USD and LBP separately, never combined into one figure.
- Q: Drawer cash? → A: Left out. Checkpoints already cover the drawers.
- Q: How is a snapshot taken? → A: Automatically only, for every shop, from the day this is deployed. No manual button.
- Q: Who sees it? → A: Admins only.
- Q: Fill past months from history? → A: No. The page starts empty; the first snapshot is the first month end after deploy.
- Q: Every shop, or chosen shops? → A (later the same day): a per-shop switch that super admin sets in the shop's Plan window (Features → Monthly progress). Off for every shop by default; Corner Tech first. While off, nothing is saved, and the start clock does not run either. A desktop shop follows the switch through its licence sync.
- Q: Generic vs phone shop? → A: Each KPI is tagged. Carrier credits is the only phone-shop KPI; a shop without the recharge module does not see it.

## User Scenarios & Testing

### User Story 1 - Month-end balances are saved automatically (Priority: P1)

At the end of every month, without anyone doing anything, the shop's eight balances are saved as they stand at that moment, together with the exchange rate of the day. Nothing is lost if nobody opens the page for months.

**Why this priority**: These balances cannot be worked out again later. A month that was not saved is gone for good, so the saving must start working the day this ships, before any page exists.

**Independent Test**: On a test shop with known debts, stock and carrier credit, let the month change; the saved snapshot for the month just ended holds exactly those balances, per currency.

**Acceptance Scenarios**:

1. **Given** a web shop at 23:59 Beirut time on 31 October, **When** the month ends, **Then** a snapshot for October is saved within the first hour of 1 November (Beirut time), whatever time zone the server runs in.
2. **Given** customer Ali owes the shop $120 and 900,000 LBP, and customer Rana has a $30 credit, **When** the snapshot is taken, **Then** "Customers owe shop" is $120 / 900,000 LBP and "Shop owes customers" is $30 / 0 LBP.
3. **Given** one customer owes $50 but holds a 450,000 LBP credit, **When** the snapshot is taken, **Then** the $50 counts in "Customers owe shop" (USD) and the 450,000 LBP counts in "Shop owes customers" (LBP). Each currency is judged on its own.
4. **Given** October's snapshot already exists, **When** the snapshot runs again for October (restart, second server, desktop paired with the web shop), **Then** nothing changes and no second October row appears.
5. **Given** a desktop shop that was closed from 29 October to 3 November, **When** it is first opened on 3 November, **Then** October's snapshot is taken at once, before the first sale can be saved.
6. **Given** that desktop shop was instead opened on 1 November and a sale was already saved before the snapshot could run (e.g. the app crashed on start), **When** the snapshot is taken later, **Then** it is saved and marked "taken late" with the time it was taken.

---

### User Story 2 - The owner sees progress month by month (Priority: P1)

An admin opens "Monthly progress". Each KPI is a row, each month a column, newest first. Each cell shows the USD and LBP amounts on their own lines, and the change from the previous month (up or down, by how much). The exchange rate of each month is shown under the month's heading.

**Why this priority**: Saving without a page gives the owner nothing to look at; the two together are the feature.

**Independent Test**: With two saved months, open the page as an admin; both months appear with every KPI and the change between them.

**Acceptance Scenarios**:

1. **Given** snapshots for September and October, **When** an admin opens Monthly progress, **Then** October and September are shown, with October's change against September for every KPI and currency.
2. **Given** stock value went from $8,000 to $9,500, **When** the page is shown, **Then** October's stock value cell shows $9,500 with "+$1,500".
3. **Given** no snapshot has been saved yet, **When** an admin opens the page, **Then** it says that the first snapshot will be taken at the end of this month.
4. **Given** a cashier or other non-admin user, **When** they look for the page, **Then** it is not in their menu and opening its address directly is refused, on both the desktop and web app.
5. **Given** a month marked "taken late", **When** it is shown, **Then** its column shows a "taken late" mark with the date it was taken.

---

### User Story 3 - A non-phone shop sees only generic KPIs (Priority: P3)

A shop that does not use carrier lines sees only the seven generic KPIs.

**Why this priority**: The platform may later serve other kinds of shops; this keeps the page clean for them. All current shops are phone shops.

**Independent Test**: Turn the recharge module off; the carrier credits row disappears from the page; turn it back on and the saved values show again.

**Acceptance Scenarios**:

1. **Given** the recharge module is off, **When** the page is shown, **Then** the carrier credits row is hidden.
2. **Given** the module was off for some months and then turned on, **When** the page is shown, **Then** the carrier credits row shows the values saved for every month (the value is always saved, only its display is hidden).

---

### Edge Cases

- A counterparty with a zero balance in a currency counts in neither direction for that currency.
- A balance that would round to under one cent (USD) or under one lira (LBP) counts as zero.
- Voided and refunded entries are excluded exactly as they are from the balances shown elsewhere in the app, so a snapshot agrees with the Debts, Suppliers and Partners pages at that moment.
- An archived supplier (LIRA-362) is settled at $0 by definition, so it never changes the totals.
- A new shop created mid-month gets its first snapshot at that month's end.
- A shop that is suspended or has no activity still gets its snapshot (the balances still exist).
- If the snapshot fails for one shop on the web, other shops' snapshots still complete, and the failed one is retried until it succeeds.
- Months are calendar months in Beirut time: a sale at 01:30 on 1 November Beirut time belongs to November even though the server's own clock still says 31 October.
- Stock value is in dollars only (cost prices are kept in dollars); its LBP amount is always 0.
- Carrier credits are in dollars only (line credits are kept in dollars); its LBP amount is always 0.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST save, once per shop per calendar month, a snapshot of these KPIs, each with a USD amount and an LBP amount:
  1. Shop owes customers — the sum of what the shop owes each customer who has a credit (customer account credit), per currency.
  2. Shop owes suppliers — the sum of every supplier's balance where the shop owes the supplier, per currency.
  3. Shop owes partners — the sum of every partner's balance where the shop owes the partner, per currency.
  4. Customers owe shop — the sum of every customer's debt to the shop, per currency.
  5. Suppliers owe shop — the sum of every supplier's balance where the supplier owes the shop, per currency.
  6. Partners owe shop — the sum of every partner's balance where the partner owes the shop, per currency.
  7. Stock value — the cost of all stock on hand (the same figure as the Dashboard's "Stock Budget").
  8. Carrier total credits — the credits on all active MTC and Alfa lines.
- **FR-002**: For KPIs 1–6, each counterparty MUST be judged per currency on its own: its USD balance goes to the "owes" side its sign says, and its LBP balance likewise, independently.
- **FR-003**: Amounts in different currencies MUST never be added together or converted into one figure.
- **FR-004**: Each snapshot MUST store the shop's exchange rate (buy and sell) at the moment it was taken, for reading old months only. No KPI is converted with it.
- **FR-005**: Each snapshot MUST store the month it describes, the moment it was taken, and whether it was taken late (after any money activity of the following month had already been saved).
- **FR-006**: On the web, the system MUST take the snapshot for every shop within the first hour after midnight Beirut time on the first day of each month, independent of the server's own time zone (rule 27).
- **FR-007**: On the desktop app, the system MUST check at start-up whether the previous month's snapshot is missing and, if so, take it before the first sale or money movement of the new month can be saved.
- **FR-008**: Taking a snapshot MUST be idempotent: a second attempt for a month that already has one changes nothing.
- **FR-009**: A failed snapshot MUST be retried automatically until it succeeds, and a failure for one shop MUST NOT stop the others.
- **FR-010**: There MUST be no button or action to take, edit or delete a snapshot by hand. Saved snapshots are read-only.
- **FR-011**: The system MUST provide a "Monthly progress" page showing every saved month (newest first) with each KPI's USD and LBP amounts and the change from the previous saved month per currency.
- **FR-012**: The page and the data behind it MUST be available to admins only, on both the desktop and the web app.
- **FR-013**: Each KPI MUST be tagged generic or phone-shop. Phone-shop KPIs MUST be hidden on the page when the recharge module is off, while still being saved.
- **FR-014**: Adding a new KPI later MUST NOT require changing the database structure; months saved before it was added show it as "not recorded".
- **FR-015**: The feature MUST work identically on the desktop app and the web app (rule 19), and every KPI MUST use the same balance definition the rest of the app already uses for that figure (rule 14), so the snapshot matches what the Debts, Suppliers, Partners and Dashboard pages showed at that moment.
- **FR-016**: Past months MUST NOT be filled in from history; the first snapshot is the first month end after deploy.
- **FR-017**: The feature MUST be off for every shop until super admin switches it on for that shop in its Plan window. While off, no snapshot is saved, the page is hidden and its data refused. Switching it on starts saving from that month's end. A desktop shop MUST follow the switch through its licence sync, and a missing or unreadable switch MUST read as off.

### Key Entities

- **Monthly snapshot**: one per shop per month. The month it describes, when it was taken, whether it was taken late, and the exchange rate at that moment.
- **Snapshot value**: one per KPI per snapshot. Which KPI, its USD amount and its LBP amount.
- **KPI definition**: the fixed list of KPIs: a stable key, a display name, the group (generic or phone shop) and the order on the page. Lives in the code, so adding one needs no database change.

## Success Criteria

### Measurable Outcomes

- **SC-001**: From the first month end after deploy, 100% of active shops have exactly one snapshot for every month, with no gaps and no duplicates.
- **SC-002**: For a test shop, every saved KPI equals, to the cent and to the lira, the matching total shown on the Debts, Suppliers, Partners and Dashboard pages at the moment of the snapshot.
- **SC-003**: An admin can see a year of month-end balances, and how each changed from the month before, on one page in under 3 seconds.
- **SC-004**: Non-admin users cannot reach the page or its data on either app.

## Assumptions

- "Shop owes customers" counts customer account credit only. Money held for customers (hold money) and unused gift cards are not included in v1; they can be added later as their own KPIs without a database change.
- The supplier KPIs include every supplier on the Suppliers page — companies (OMT, Whish, iPick, Katsh, Loto) as well as product suppliers — with the OMT account counted once, rolled up as the Suppliers page shows it.
- Partner balances held in USDT are not part of v1 (the owner asked for USD and LBP). They stay visible on the Partners page.
- "Stock value" is the cost value already shown as the Dashboard's "Stock Budget" (on-hand quantity × cost price, deleted/inactive and virtual carrier products excluded).
- A shop is treated as a phone shop when its recharge module is on.
- A desktop app that is paired with a web shop (offline fallback) does not take its own snapshot; the web server's snapshot is the shop's one.
- The exchange rate stored is the shop's current rate setting at the moment of the snapshot; LiraTek keeps no rate history.
- Snapshots are kept indefinitely; there is no retention limit.
