# Feature Specification: Insurance expiry reminders

**Feature Branch**: `360-insurance-expiry-reminders` (work happens on `main`; ticket LIRA-360)

**Created**: 2026-10-29

**Status**: Draft

**Input**: Owner, 2026-10-29: "In services we have an insurance history; we can see the customers of each insurance. We can create a cron job to read that table each day and tell the system user whose customers' insurance will expire. To detect expiry: insurance service createdAt + 1 year. To tell the system user, showcase it in the dashboard in a small card in the 'Credits & Stock' section; it will show a list of customers, or a message if the list is empty, + via notification."

## Clarifications

### Session 2026-10-29 (owner decisions)

- Q: How long before expiry should a customer appear? → A: 7 days before the expiry date.
- Q: After expiry, if the customer did not renew, how long do they stay listed? → A: Until they renew (or staff mark "Won't renew"). No automatic drop-off.
- Q: Does a renewal remove the older insurance from the list? → A: Yes. A newer insurance for the same customer (same saved client, or same phone number) hides the older one.
- Q: What counts as a renewal when a shop sells different insurance types? → A: Same customer AND same insurance type. Today the sale has no type, so selling an insurance now asks for one: Compulsory (إلزامي), Third party (ضد الغير), Domestic worker (عاملة منزلية), All risk (شامل), Life (حياة).
- Q: Who sees the reminders? → A: Everyone with Dashboard access. No money figures are shown — only name, phone, type and dates.
- Q: How does the bell notify, given the list can grow? → A: One summary line per day, e.g. "Insurance: 3 expire this week, 12 expired". Clicking it opens the Dashboard.
- Q: Can staff take a customer off the list without a renewal? → A: Yes, a "Won't renew" action.
- Settled from the code map: the owner asked for a "cron job". Expiry follows from data already stored (sale day + 1 year), so the list is worked out each time the Dashboard or the bell checks, on both the desktop and web app. No scheduled server job is needed, and the desktop app (which has no server) behaves the same.

## User Scenarios & Testing

### User Story 1 - See whose insurance is expiring on the Dashboard (Priority: P1)

A cashier opens the Dashboard. In the "Credits & Stock" row, a small "Insurance renewals" card lists each customer whose insurance expires within the next 7 days or has already expired without renewal: name, phone, insurance type, expiry date, and "in N days" / "today" / "expired N days ago". Expired rows are shown first and in red; upcoming ones in amber. When nobody is due, the card shows "No insurance renewals due".

**Why this priority**: This is the core value — the shop calls the customer before the year is up and sells the renewal.

**Independent Test**: Sell an insurance backdated 360 days to a customer; open the Dashboard; the customer is listed with "in 5 days". With no due insurances the empty message shows.

**Acceptance Scenarios**:

1. **Given** an insurance sold to Ali (70 123 456) on 2025-11-03, **When** the Dashboard is opened on 2026-10-29, **Then** Ali is listed with expiry 2026-11-03, "in 5 days".
2. **Given** an insurance sold on 2025-11-06 (expiry 2026-11-06, 8 days away), **When** the Dashboard is opened on 2026-10-29, **Then** it is NOT listed.
3. **Given** an insurance sold on 2025-11-05 (expiry 2026-11-05, exactly 7 days away), **When** opened on 2026-10-29, **Then** it IS listed.
4. **Given** an insurance sold on 2025-06-01 and never renewed, **When** opened on 2026-10-29, **Then** it is listed as "expired 150 days ago" and stays listed on every later day.
5. **Given** no insurance is due, **When** the Dashboard is opened, **Then** the card shows the empty message.
6. **Given** the Custom Services module is disabled, **When** the Dashboard is opened, **Then** the card is not shown.

---

### User Story 2 - A renewal clears the reminder (Priority: P1)

When the shop sells the same customer a new insurance of the same type, the old one leaves the list automatically.

**Why this priority**: Without this the list fills with customers who already renewed, and staff stop trusting it.

**Independent Test**: With Ali's Compulsory insurance listed, sell Ali a new Compulsory insurance; the old one disappears from the card.

**Acceptance Scenarios**:

1. **Given** Ali's Compulsory insurance is listed, **When** a new Compulsory insurance is sold to saved client Ali, **Then** the old one leaves the list.
2. **Given** Ali's Compulsory insurance is listed and the new sale is a walk-in with Ali's phone number written differently (e.g. "+961 70 123 456" vs "70123456"), **When** the sale is saved, **Then** the old one leaves the list.
3. **Given** Ali's Compulsory insurance is listed, **When** Ali buys a Life insurance, **Then** the Compulsory one stays listed.
4. **Given** the renewal is later refunded or voided, **Then** the old insurance is listed again.
5. **Given** an older insurance with no type (sold before this feature), **When** the same customer buys any insurance afterwards, **Then** the untyped one leaves the list.

---

### User Story 3 - Pick the insurance type when selling (Priority: P1)

On Custom Services, choosing the Insurance category shows a required "Insurance type" picker: Compulsory (إلزامي), Third party (ضد الغير), Domestic worker (عاملة منزلية), All risk (شامل), Life (حياة). The sale cannot be saved without a type. The type appears in the insurance History and on the reminders card.

**Why this priority**: Renewal matching (Story 2) depends on it.

**Independent Test**: Select Insurance, try to save without a type → blocked with a message; pick "Domestic worker", save → History shows "Domestic worker".

**Acceptance Scenarios**:

1. **Given** the Insurance category is selected, **When** no type is picked, **Then** the sale cannot be submitted and the picker is highlighted.
2. **Given** type "All risk" is picked, **When** the sale is saved, **Then** History shows "All risk" for that row.
3. **Given** any other category is selected, **Then** no type picker is shown and nothing changes for those sales.

---

### User Story 4 - Daily bell summary (Priority: P2)

Once per day, the bell shows one line: "Insurance: 3 expire this week, 12 expired". Clicking it opens the Dashboard. When nothing is due, no line is added.

**Why this priority**: Staff who do not open the Dashboard still get reminded; the card remains the place to act.

**Independent Test**: With due insurances, load the app; one bell line appears; reload the same day → no second line.

**Acceptance Scenarios**:

1. **Given** 3 insurances expire within 7 days and 12 are expired, **When** the app checks for notifications, **Then** one bell line reads "Insurance: 3 expire this week, 12 expired".
2. **Given** the line was shown today, **When** the app checks again the same day, **Then** no second line is added.
3. **Given** only expired ones (0 upcoming), **Then** the line mentions only the expired count (and vice versa).
4. **Given** nothing is due, **Then** no line is added.

---

### User Story 5 - "Won't renew" (Priority: P2)

From the card, staff can mark a listed insurance "Won't renew" (after calling the customer, or if the customer left). It leaves the card and the bell count, after a confirmation.

**Why this priority**: "Until renewed" means a customer who never comes back stays forever; this is the only way out.

**Independent Test**: Mark Ali "Won't renew" → gone from the card and from tomorrow's bell count.

**Acceptance Scenarios**:

1. **Given** Ali is listed, **When** a user clicks "Won't renew" and confirms, **Then** Ali's insurance leaves the list for every user, on desktop and web.
2. **Given** Ali was marked "Won't renew" and later buys a new insurance of the same type, **Then** the new insurance is tracked normally and reminds again next year.
3. **Given** a user cancels the confirmation, **Then** nothing changes.

---

### Edge Cases

- Sale on 29 February: expiry is 28 February the next year.
- Sale made late at night (e.g. 01:00): expiry is computed from the shop's own calendar day, not the server's, so the web and desktop apps agree.
- Backdated sales: expiry uses the sale date as entered.
- Insurance with no name and no phone (walk-in): listed with the service description so it can still be identified; it cannot be matched as a renewal by anyone else.
- Two insurances of the same type for the same customer, both old and unrenewed: only the newest is listed.
- Refunded, voided or cancelled insurances are never listed, and never count as a renewal.
- Long list: the card shows the rows inside its own scroll area and a total count; it never stretches the Dashboard.
- A customer saved as a client AND matched by phone to a walk-in sale: treated as the same customer.

## Requirements

### Functional Requirements

- **FR-001**: The system MUST treat an insurance's expiry date as its sale day (shop calendar day) plus one calendar year.
- **FR-002**: The system MUST list an insurance when its expiry date is 7 days away or less, including already-expired ones, unless it is renewed, refunded, voided, cancelled, or marked "Won't renew".
- **FR-003**: An insurance MUST count as renewed when a later insurance exists for the same customer (same saved client, or same phone number after normalising its format) and the same type, and that later insurance is not refunded, voided or cancelled. An untyped older insurance is renewed by any later insurance for the same customer.
- **FR-004**: The Dashboard MUST show an "Insurance renewals" card in the Credits & Stock row with, per insurance: customer name (or description), phone, type, expiry date, and days left / days overdue; overdue first, then soonest first. When empty it MUST show "No insurance renewals due".
- **FR-005**: The card and bell MUST NOT show prices, costs or profit.
- **FR-006**: Selling an insurance MUST require one type from: Compulsory (إلزامي), Third party (ضد الغير), Domestic worker (عاملة منزلية), All risk (شامل), Life (حياة). The type MUST be shown in insurance History.
- **FR-007**: The bell MUST add at most one insurance summary line per day, with the upcoming and expired counts, linking to the Dashboard; none when nothing is due.
- **FR-008**: Users with Dashboard access MUST be able to mark a listed insurance "Won't renew" after confirming; the mark applies to every user and both apps, and records who marked it and when.
- **FR-009**: The card, bell line and type picker MUST be hidden when the Custom Services module is disabled.
- **FR-010**: "Today" MUST be the shop's own calendar day, so the desktop and web apps give the same list at any hour.
- **FR-011**: All of the above MUST work the same on the desktop app and the web app.

### Key Entities

- **Insurance sale**: an existing Custom Services sale in the Insurance category. Gains an **insurance type** (one of five; empty for older sales) and a **"won't renew" mark** (who, when).
- **Renewal reminder** (derived, not stored): an insurance sale, its expiry date, days left (negative when overdue), and the customer details to call.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of insurances due within 7 days or expired (not renewed, refunded or dismissed) appear on the card; none outside that rule appear — checked against a table of boundary cases (8, 7, 0, −1, −365 days).
- **SC-002**: The desktop and web apps show the identical list for the same shop at any hour of the day.
- **SC-003**: A renewal sale removes the old reminder by the next Dashboard refresh, with no manual step.
- **SC-004**: The bell never shows more than one insurance line per day.
- **SC-005**: A cashier can find who to call and their number in under 10 seconds from opening the Dashboard.

## Assumptions

- Q: Type names? → A (owner 2026-10-29): Compulsory / إلزامي, Third party / ضد الغير, Domestic worker / عاملة منزلية, All risk / شامل, Life / حياة.
- The list of types is fixed in this version (no settings screen to add types).
- Older insurances keep an empty type; there is no screen to set a type on past sales in this version.
- "Won't renew" cannot be undone from the card in this version (a later sale of the same type starts a new reminder anyway).
- The bell's per-day once-only rule follows the existing phone-line alerts (once per day per device session).
- No WhatsApp/SMS message to the customer is sent; reminders are for shop staff only.
- No real shop data was available locally to measure how many insurances will be listed on day one (dev databases hold none); the card's scroll area and total count cover a long list.
