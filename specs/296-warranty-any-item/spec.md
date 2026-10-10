# Feature Specification: Warranty for any item, not just phones

**Feature Branch**: `296-warranty-any-item` (work directly on local `main`, owner preference)

**Created**: 2026-10-10

**Status**: Draft

**Input**: User description: "--number 296 Warranty for any item, not just phones (LIRA-296, owner request 2026-10-10). Existing (LIRA-143): products.warranty_months on any product, stamped as sale_items.warranty_until on every completed sale line, printed on the receipt; lookup/acting only via phone IMEI (ImeiStoryCard). Build: G1 find a warranty without an IMEI (by customer, phone number, receipt/sale number, product); G2 serial numbers for non-phone items (generalise IMEI to Serial/IMEI per category); G3 warranty state on every sale line in sale detail; G4 warranty claim flow — repair (Maintenance job marked warranty, no charge to customer), replace (swap from stock linked to original sale) or refund, with claim history; G5 supplier warranty/RMA tracking until credit, replacement or rejection; G6 warranty rules — default per category, editable per line at sale time, warranty terms on the receipt; G7 warranty on repairs (maintenance jobs give their own warranty); G8 report of items under warranty and claim costs. Both desktop and web (dual transport). Plan doc: docs/plans/todo_plans/WARRANTY_ANY_ITEM_PLAN.md (owner decisions D1–D4 open)."

**Ticket**: LIRA-296. Plan: `docs/plans/done_plans/WARRANTY_ANY_ITEM_PLAN.md`.

## Background

A phone shop sells many things that carry a warranty: phones, but also chargers, earbuds,
speakers, smart watches, tablets, laptops, and its own repairs.

Today the shop can already give **any product** a warranty length in months, and every sale
records a "warranty until" date and prints it on the receipt. But after the sale, a warranty can
only be **found and acted on through a phone's IMEI**. When a customer comes back with broken
earbuds, staff cannot look the warranty up, see whether it is still valid, or record what was
done about it. Repairs, replacements and refunds under warranty are recorded by hand, if at all,
and the cost of honouring warranties is invisible.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Find a warranty without an IMEI (Priority: P1)

A customer brings back earbuds bought six weeks ago, with no receipt. The cashier searches by the
customer's name or phone number, or by receipt number, or by product, and sees every warranty
item that customer bought: the product, the sale date, "warranty until", and whether it is still
covered.

**Why this priority**: It turns the warranty data the shop already records into something staff
can use at the counter. Every other story starts from finding the item.

**Independent Test**: Sell a non-phone product with a 3-month warranty to a named customer. Search
by name, by phone number, by receipt number and by product, and check the item appears each time
with the right end date and status.

**Acceptance Scenarios**:

1. **Given** a sale of a product with a warranty to a customer, **When** staff search warranties by that customer's name or phone number, **Then** the sold item appears with its sale date, warranty end date and status (Covered / Expired).
2. **Given** a receipt number, **When** staff search by it, **Then** every line of that sale that carries a warranty is listed.
3. **Given** a walk-in sale (no customer), **When** staff search by receipt number or product and date, **Then** the item is found.
4. **Given** a sale that was voided or fully refunded, **When** it is found, **Then** its warranty shows "Void" and no claim can be started on it.

---

### User Story 2 - Warranty status on every sale line (Priority: P1)

When staff open any past sale, each line that carries a warranty shows "Covered until <date>",
"Expired on <date>" or "Void", not only the phone lines.

**Why this priority**: Very small, and it uses data that already exists.

**Independent Test**: Open a past sale that has a phone line and an accessory line, both with
warranties, and check both show their status.

**Acceptance Scenarios**:

1. **Given** a sale with a non-phone line under warranty, **When** staff open the sale's details, **Then** that line shows its warranty status and end date.
2. **Given** a line with no warranty, **When** the sale is opened, **Then** no warranty status is shown for that line.

---

### User Story 3 - Warranty defaults per category, editable at the sale (Priority: P1)

The owner sets a default warranty per category (for example accessories 1 month, phones 12 months,
used phones none). A product without its own warranty length uses its category's default. At the
till, staff can change the warranty of a line before completing the sale (for example a goodwill
extra month). The shop's warranty terms text prints on the receipt under the warranty lines.

**Why this priority**: Saves setting every product one by one, and puts clear terms in the
customer's hand.

**Independent Test**: Set a category default, sell a product of that category that has no own
warranty, change one line's warranty at the till, and check the stamped dates and the printed
terms.

**Acceptance Scenarios**:

1. **Given** a category default of 1 month and a product in it with no own warranty, **When** it is sold, **Then** its warranty ends 1 month after the sale date.
2. **Given** a product with its own warranty length, **When** it is sold, **Then** the product's length wins over the category default.
3. **Given** staff change a line's warranty at the till, **When** the sale completes, **Then** that line's end date reflects the change and the change is recorded with who made it.
4. **Given** the shop has warranty terms text, **When** a receipt with at least one warranty line prints, **Then** the terms appear on it; a receipt with no warranty lines shows no terms.

---

### User Story 4 - Handle a warranty claim: repair, replace or refund (Priority: P2)

From a found warranty that is still covered, staff start a claim and choose what the shop does:

- **Repair**: opens a repair job marked "warranty", with no charge to the customer.
- **Replace**: gives the customer the same product from stock, linked to the original sale.
- **Refund**: refunds the item through the existing refund path.

Each item keeps a claim history: date, staff member, action, outcome and notes.

**Why this priority**: The core of handling warranties, but it moves stock and money, so it comes
after the cheap visibility stories.

**Independent Test**: For a covered item, run each of the three actions once and check the
customer is not charged, stock and money move as expected, and the claim history shows all three.

**Acceptance Scenarios**:

1. **Given** a covered item, **When** staff choose Repair, **Then** a repair job is created marked "warranty", linked to the item and the claim, and the customer is not charged for it.
2. **Given** a covered item, **When** staff choose Replace, **Then** one unit of the product leaves stock, the customer pays nothing, and the replacement is linked to the original sale.
3. **Given** a covered item, **When** staff choose Refund, **Then** the existing refund flow runs for that line.
4. **Given** an expired warranty, **When** staff try to start a claim, **Then** they are told it is not covered, and only an admin can override with a reason. **Given** a void warranty (already refunded), **Then** no claim can be started, by anyone.
5. **Given** any claim, **When** it is voided, **Then** everything it moved (stock, money, repair job) is reversed.
6. **Given** a replacement under warranty, **Then** the replacement keeps the original sale's warranty end date; coverage does not restart (owner decision 2026-10-10).
7. **Given** a refund or replace claim, **Then** the faulty unit returned by the customer goes to a **defective** holding, not to sellable stock, unless staff mark it "Not faulty — back to stock".

---

### User Story 5 - Warranty on repairs (Priority: P2)

When a repair job is completed and paid, it can carry its own warranty (for example 3 months on a
screen replacement), shown on the repair receipt. If the same fault comes back within that time,
staff start a warranty claim on the repair (Story 4).

**Why this priority**: Repairs are a large part of a phone shop's work and customers ask for
repair warranties.

**Independent Test**: Complete a repair with a 3-month warranty, then find it by customer and start
a claim on it.

**Acceptance Scenarios**:

1. **Given** a repair with a warranty length, **When** it is completed and paid, **Then** its warranty end date is recorded and printed on its receipt.
2. **Given** a covered repair, **When** the fault returns, **Then** staff can find it (Story 1) and start a claim (Story 4).

---

### User Story 6 - Serial numbers for non-phone items (Priority: P3)

Categories that today track phone IMEIs can instead track **serial numbers** for any kind of item
(laptops, tablets, watches, consoles). The shop records each unit's serial on stock-in and sale,
so a warranty can be found by serial and proves *this* unit was sold by the shop.

**Why this priority**: Valuable for expensive items, but it changes stock handling, so it comes
later.

**Independent Test**: Mark a "Laptops" category as serial-tracked, receive two units with serials,
sell one, and find its warranty by serial.

**Acceptance Scenarios**:

1. **Given** a category set to track serials, **When** units are added to stock, **Then** each needs a serial, labelled "Serial" (or "IMEI" for phone categories).
2. **Given** a serial-tracked item is sold, **Then** the serial sold is recorded on the sale line and on the receipt.
3. **Given** a serial, **When** staff search warranties by it, **Then** the unit, its sale and its warranty are shown.
4. **Given** staff try to sell a serial-tracked item without choosing a serial, **Then** the category's own setting decides: the sale is blocked, or allowed with a warning (owner decision 2026-10-10: per category).

---

### User Story 7 - Return a faulty item to the supplier (Priority: P3)

When the shop honours a warranty, it can send the faulty item back to its supplier and track the
return until the supplier gives credit, a replacement, or rejects it.

**Why this priority**: Recovers the shop's cost, but depends on claims existing first.

**Independent Test**: From a claim, send the item to its supplier, then record each of the three
outcomes on separate returns and check the supplier balance and stock.

**Acceptance Scenarios**:

1. **Given** a claim, **When** staff send the item to a supplier, **Then** a supplier return is opened as "Sent", linked to the claim and the supplier.
2. **Given** a supplier return, **When** the supplier gives credit, **Then** the supplier's balance changes by that amount and the return is closed as "Credited".
3. **Given** a supplier return, **When** the supplier sends a replacement, **Then** the unit returns to stock and the return is closed as "Replaced".
4. **Given** a supplier return, **When** the supplier rejects it, **Then** it is closed as "Rejected" with a note, and the shop keeps the cost.

---

### User Story 8 - Warranty report (Priority: P3)

The owner sees a report of items currently under warranty (by category and end date), and of
claims over a period: how many, by action, and what they cost the shop versus what suppliers
covered.

**Why this priority**: Management insight; needs the earlier stories' data.

**Independent Test**: With claims of each type in a period, open the report and check counts and
costs match.

**Acceptance Scenarios**:

1. **Given** sold items with warranties, **When** the owner opens the report, **Then** items still covered are listed with end dates, filterable by category.
2. **Given** claims in a period, **Then** the report shows their count by action and their total cost to the shop and to suppliers.

### Edge Cases

- A sale line with quantity greater than 1 (e.g. 3 chargers): each claim covers exactly one unit; the remaining units stay covered. Two faulty chargers mean two claims.
- A partially refunded sale: refunded units show "Void"; the rest stay covered.
- Warranty length changed on the product after the sale: already-sold items keep their stamped end date.
- A claim on the last day of coverage: covered (end date inclusive, the shop's own calendar day).
- Replacing when the product is out of stock: staff are told; they can choose repair or refund instead.
- A customer with no saved details: findable by receipt number or by product and date only.
- Desktop and web: every story works the same in the desktop app and the web app.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Staff MUST be able to search warranties by customer name, customer phone number, receipt / sale number, product, and (Story 6) serial / IMEI.
- **FR-002**: Search results MUST show the product, sale date, warranty end date and status: Covered, Expired or Void.
- **FR-003**: A voided or refunded unit MUST show as Void and MUST NOT accept a claim.
- **FR-004**: Every past sale line with a warranty MUST show its status and end date in the sale's details.
- **FR-005**: The owner MUST be able to set a default warranty length per category; a product's own length MUST take precedence over its category's.
- **FR-006**: Staff MUST be able to change a line's warranty length before completing a sale; the change MUST be recorded with the staff member.
- **FR-007**: The shop MUST be able to set warranty terms text, printed on receipts that contain at least one warranty line.
- **FR-008**: Staff MUST be able to start a **repair** claim on a covered unit; **replace** and **refund** claims need an admin, as refunds do today. A claim on an **expired** unit needs an admin override with a reason. A **void** unit (already refunded or voided) can never be claimed (FR-003).
- **FR-009**: A repair claim MUST create a repair job marked as warranty, linked to the claim, with no charge to the customer.
- **FR-010**: A replace claim MUST take one unit of the same product from stock at no charge to the customer and link it to the original sale.
- **FR-011**: A refund claim MUST use the existing refund behaviour for that line.
- **FR-012**: Each unit MUST keep a claim history (date, staff, action, outcome, notes).
- **FR-013**: Voiding a claim MUST reverse everything the claim moved, so stock, drawers, customer balance, supplier balance and profit net to zero, per currency.
- **FR-014**: A completed repair MUST be able to carry its own warranty length, printed on its receipt and findable like a sale warranty.
- **FR-015**: A category MUST be able to track serial numbers for any kind of item; phone categories keep calling them IMEI.
- **FR-016**: Staff MUST be able to send a claimed item to a supplier and record the outcome: credited (adjusts the supplier balance), replaced (unit back to stock) or rejected.
- **FR-017**: The owner MUST be able to see items under warranty and claims over a period, with their cost to the shop and to suppliers.
- **FR-018**: Warranty costs MUST appear in Profits as one separate **"Warranty cost"** line, dated on the claim day, never by changing a past sale (owner decision 2026-10-10):
  - **Refund:** the sale is reversed as today (its revenue and profit go to zero); the faulty unit goes to the defective holding and its cost is a warranty cost.
  - **Repair:** a $0 repair job; the parts it uses are a warranty cost (not the repair module's profit).
  - **Replace:** the original sale is unchanged; the replacement unit's cost is a warranty cost; the faulty unit goes to the defective holding.
  - **Supplier return:** a supplier credit, or a replacement unit returned to stock at its cost, reduces the warranty cost.
  - **Not faulty:** a returned unit marked "Not faulty — back to stock" returns to sellable stock and costs nothing.
- **FR-021**: Faulty units MUST be held as **defective** (not sellable) until they are sent to a supplier, written off, or marked not faulty.
- **FR-022**: Each serial-tracked category MUST choose whether a sale without a serial is blocked or allowed with a warning.
- **FR-019**: Everything MUST work the same in the desktop app and the web app.
- **FR-020**: Warranty states and dates MUST use the shop's own calendar day (never the server's).

### Also fixed in P1 (owner decision 2026-10-10: same ticket)

- **SF-1**: On the web app, the recent-sales list on the POS page MUST show the day the user picks. Today the web server returns today's sales whatever day is asked; the desktop app is correct.
- **SF-2**: "Sales by date range" MUST be available on the web app as on the desktop app (today it is desktop-only).
- **SF-3**: The receipt header text the shop saves in Settings MUST print at the top of sale and repair receipts. Today it is saved but never printed.

### Key Entities

- **Warranty (per sold unit)**: the item sold, the sale and line, customer (if any), serial / IMEI (if tracked), end date, status (Covered / Expired / Void). Already partly recorded on every sale line.
- **Category warranty default**: a default length in months per category.
- **Warranty terms**: the shop's terms text for receipts.
- **Warranty claim**: the unit claimed, date, staff, action (repair / replace / refund), outcome, notes, links to the repair job, replacement unit or refund, and to any supplier return.
- **Repair warranty**: a warranty length and end date on a completed repair job.
- **Defective holding**: faulty units taken back from customers, not sellable; leave it by supplier return, write-off, or "not faulty".
- **Warranty cost**: the cost of honouring warranties (parts, replacement units, written-off faulty units), net of supplier credits; shown in Profits.
- **Supplier return (RMA)**: the item, the supplier, the claim, status (Sent / Credited / Replaced / Rejected), amounts and dates.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Staff can find any warranty item sold in the last 2 years by customer, phone, receipt number or product in under 30 seconds, without an IMEI.
- **SC-002**: 100% of sale lines and completed repairs that carry a warranty show their correct status and end date.
- **SC-003**: A warranty repair, replacement or refund can be completed in under 2 minutes from finding the item.
- **SC-004**: Voiding any claim leaves every ledger (stock, drawers, customer, supplier, profit) exactly as before the claim.
- **SC-005**: The owner can tell, for any month, how many warranty claims there were and what they cost net of supplier credits, from one report and one Profits line.
- **SC-006**: No step requires a phone IMEI for an item that is not a phone.

## Assumptions

- **Scope order (owner decision D4, 2026-10-10):** build in priority order — P1 (Stories 1–3: lookup, status on sale lines, category defaults and terms), then P2 (Stories 4–5: claims and repair warranty), then P3 (Stories 6–8: serials, supplier returns, report). Each priority level can ship on its own.
- Warranty is counted per unit; a line with quantity 3 has three warranties with the same end date.
- The end date is inclusive and uses the shop's calendar day.
- Changing a product's or category's warranty never changes items already sold.
- Repair warranties start on the day the repair is completed and paid.
- Claims, supplier returns and the report are visible to admins; staff can search warranties and start repair claims. Replace and refund follow the existing role rules for refunds.
- Existing LIRA-143 behaviour (IMEI story card, per-unit override) stays and is reused.
