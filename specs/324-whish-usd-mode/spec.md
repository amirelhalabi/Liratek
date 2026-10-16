# Feature Specification: Whish App items in USD (LBP | USD switch)

**Feature Branch**: `324-whish-usd-mode` (work happens on `main`; ticket LIRA-324)

**Created**: 2026-10-16

**Status**: Draft

**Input**: User description (owner, 2026-10-15, paraphrased): "I want to introduce the Whish items in USD. Remember the Whish app on the Android phone — on its home page there was a currency selector. I want the same thing on our page."

**Builds on**: the full Whish App catalog added from the Whish app crawl of 2026-10-14 (389 items, card pictures, migration v216) and the product-line ordering of the item grid. USD prices for the same items were crawled the same day (`docs/whish-prices/`).

## Clarifications

### Session 2026-10-15 (owner decisions recorded with the request)

- Q: MTC / Alfa Prepaid cards in USD mode? → A: Left out of this release; they stay LBP-only. Their "only days" / credits-back handling is LBP-only and will be revisited later (deferred TODO: `docs/plans/todo_plans/WHISH_USD_PREPAID_CARDS.md`).
- Q: When an item is sold in USD mode, how does Whish charge the shop? → A: In USD — the cost comes out of the Whish App balance in USD.
- Q: What does a USD item's selling price start at? → A: Equal to its cost (same rule as the LBP catalog, owner rule 2026-10-10); the owner changes it in Settings → Mobile Services.

### Session 2026-10-16

- Q: When items are selected and the cashier flips LBP ↔ USD, what happens? → A: Confirm, then clear — the cashier is told the selected items will be cleared; confirming empties the selection and shows the other currency. A basket is always one currency.
- Q: Does USD mode cover "For Partner" sales and adding the item to a customer's session basket, or only walk-in sales? → A: All three in this release — walk-in, For Partner and session basket all work in USD the same way they work in LBP.
- Q: If the Whish App USD balance is lower than a USD item's cost, does the sale go through? → A: Same as LBP today — a USD sale treats the Whish App USD balance exactly as an LBP sale treats the LBP balance; no new rule.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sell a Whish App item at its USD price (Priority: P1)

A cashier opens Recharge → Whish App → Bills, flips the switch from LBP to USD, and sees the Whish App items with their USD prices — the same cards, names and pictures as in LBP mode. They pick, for example, "PSN $10 - LEBANON" ($10.00), take the customer's payment and save. The sale is recorded in USD, the cost leaves the Whish App balance in USD, and the profit is in USD.

**Why this priority**: This is the whole point of the feature — the shop can sell what Whish sells in USD, at Whish's USD price, without converting by hand.

**Independent Test**: With a shop whose catalog has USD prices, switch to USD, sell one item, and check the sale's amount and profit are in USD and the Whish App balance went down in USD by the item's USD cost.

**Acceptance Scenarios**:

1. **Given** the switch is on LBP, **When** the cashier picks USD, **Then** every visible card shows its USD cost and USD selling price, and only items that have a USD price are shown.
2. **Given** USD mode, **When** the cashier sells one $10.00 item (cost $10.00) paid in USD cash, **Then** the sale is recorded at $10.00, the Whish App balance in USD goes down by $10.00, and the cash drawer goes up by $10.00.
3. **Given** USD mode, **When** the customer pays the USD sale in LBP (or splits LBP and USD), **Then** the payment window accepts it at the shop's exchange rate exactly as it does for other USD sales today.
4. **Given** a USD sale was saved, **When** it is voided or refunded, **Then** every amount it moved (Whish App USD balance, drawers, profit) is reversed in USD and nets to zero.

---

### User Story 2 - The switch remembers and keeps LBP as today (Priority: P1)

The switch defaults to LBP, so nothing changes for a shop that never touches it. Once a cashier picks USD, the page opens in USD next time on that device until they switch back.

**Why this priority**: The LBP flow is the shop's daily work; it must stay exactly as it is unless someone deliberately switches.

**Independent Test**: Open Bills on a fresh device → LBP. Switch to USD, leave and reopen the page → USD. Switch back → LBP, and LBP sales behave exactly as before this feature.

**Acceptance Scenarios**:

1. **Given** a device that never used the switch, **When** Bills opens, **Then** it is in LBP mode and shows today's LBP items and prices.
2. **Given** the cashier picked USD, **When** they leave and come back to Bills on the same device, **Then** it opens in USD.
3. **Given** items are already selected in the current mode, **When** the cashier switches currency, **Then** they are told the selection will be cleared and must confirm; on confirm the selection is emptied and the other currency's items are shown; on cancel nothing changes.

---

### User Story 3 - Which items appear in which currency (Priority: P2)

Whish does not sell every item in both currencies. In LiraTek an item appears in a mode only if it has a price in that currency: 341 items have both, 50 only LBP, 35 only USD (Whish crawl 2026-10-14). The MTC / Alfa Prepaid cards appear in LBP mode only.

**Why this priority**: Showing an item without a price (or at a converted, wrong price) would let a cashier sell at a price Whish does not offer.

**Independent Test**: In USD mode, a USD-only item (e.g. Razer $1) is shown and an LBP-only item (e.g. Genshin Impact $5) is not; in LBP mode the opposite; MTC / Alfa Prepaid cards never show in USD mode.

**Acceptance Scenarios**:

1. **Given** USD mode, **When** the grid loads, **Then** items with no USD price and all MTC / Alfa Prepaid cards are hidden.
2. **Given** LBP mode, **When** the grid loads, **Then** items with no LBP price (USD-only items) are hidden, and everything else shows as it does today.
3. **Given** either mode, **When** cards are shown, **Then** each item keeps the same name, picture and product-line order in both currencies.

---

### User Story 4 - Existing shops get the USD prices; owners can change them (Priority: P2)

Shops that already run LiraTek get the USD prices for their existing Whish App items and the USD-only items, without losing anything they changed. New shops get them in their starting catalog. In Settings → Mobile Services the owner sees and edits each Whish App item's USD cost and USD selling price next to the LBP ones.

**Why this priority**: Without it, USD mode would be empty for every existing shop.

**Independent Test**: On a copy of an existing shop's data, after the update every Whish App item that Whish sells in USD has a USD cost and a USD selling price equal to it, the 35 USD-only items exist, and every LBP price and any item the shop renamed or repriced is unchanged.

**Acceptance Scenarios**:

1. **Given** an existing shop with the Whish App catalog, **When** the update runs, **Then** each Whish App item Whish sells in USD gets its USD cost, a USD selling price equal to it, and the USD-only items are added.
2. **Given** the shop had already changed an item's LBP price or name, **When** the update runs, **Then** that LBP price and name are untouched.
3. **Given** a shop with no catalog yet, **When** it starts, **Then** its starting catalog already contains the USD prices and USD-only items.
4. **Given** Settings → Mobile Services, **When** the owner edits a Whish App item, **Then** they can set or clear its USD cost and USD selling price; clearing both hides the item from USD mode.

### Edge Cases

- An item has a USD selling price but no USD cost (or the reverse): it is not shown in USD mode until both are set.
- The Whish App USD balance is lower than the item's USD cost: same behaviour as an LBP sale with a low LBP balance today (no new blocking rule; owner decision 2026-10-16).
- A shop renamed or created an item itself before the update: the update cannot tell which Whish product it is, so it gets no USD price automatically; the owner can set one in Settings → Mobile Services.
- The cashier switches currency while items are selected: confirmation, then the selection is cleared (US2 scenario 3); a basket never mixes LBP and USD items.
- iPick, Katsh, OMT App and Binance pages show no switch and do not change.
- Desktop and web behave the same.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Recharge → Whish App → Bills MUST show an LBP | USD switch; no other provider page gets one.
- **FR-002**: The switch MUST default to LBP and MUST remember the last choice on each device.
- **FR-003**: In USD mode the grid MUST show only Whish App items that have both a USD cost and a USD selling price, and MUST exclude MTC / Alfa Prepaid cards; each card MUST show its USD cost and USD selling price.
- **FR-004**: In LBP mode the grid MUST show only items that have an LBP price, and MUST otherwise behave exactly as today.
- **FR-005**: An item MUST keep one name, one picture and one position in the product-line order across both currencies.
- **FR-006**: A sale made in USD mode MUST be recorded in USD: its price, the cost taken from the Whish App balance (in USD), and its profit are USD amounts.
- **FR-007**: A USD sale MUST accept payment in USD, LBP or a split, with the same payment window and exchange-rate rules as other USD sales.
- **FR-008**: Voiding or refunding a USD sale MUST reverse every amount it moved, in USD, so that sale plus reversal nets to zero on every balance it touched.
- **FR-009**: A selection MUST never mix LBP and USD items; switching currency with a non-empty selection MUST ask for confirmation and clear it.
- **FR-010**: Existing shops MUST receive USD costs (with USD selling price equal to cost) for the Whish App items Whish sells in USD, plus the USD-only items, without changing any existing LBP price, name or item.
- **FR-011**: New shops MUST get the same USD prices and USD-only items in their starting catalog.
- **FR-012**: Settings → Mobile Services MUST let the owner set and clear a Whish App item's USD cost and USD selling price.
- **FR-013**: Profits and the Transactions page MUST show USD sales of Whish App items in USD, the same way they show other USD sales.
- **FR-014**: Everything above MUST work the same on the desktop app and the web app.
- **FR-015**: Walk-in sales, "For Partner" sales and items added to a customer's session basket MUST all be available in USD mode, behaving as they do in LBP mode with amounts in USD; History MUST show USD sales in USD.

### Key Entities

- **Catalog item (Whish App)**: one product sold through Whish (name, group, picture). It now carries up to two price pairs: LBP cost / LBP selling price (as today) and USD cost / USD selling price (new, optional). The pair that exists decides which modes show the item.
- **USD sale of a Whish App item**: a sale whose price, Whish App cost and profit are in USD; it moves the Whish App balance's USD side.
- **Currency choice (per device)**: the last mode picked on the Bills page.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A cashier can switch to USD and complete a USD sale of a Whish App item in under 30 seconds, with no manual price conversion.
- **SC-002**: After the update, every one of the Whish App items that Whish sells in USD (crawl of 2026-10-14) is sellable in USD mode in an existing shop, and the 35 USD-only items are present.
- **SC-003**: 0 LBP prices or item names change in existing shops because of this feature.
- **SC-004**: For every USD sale, sale plus void nets to exactly 0 on the Whish App USD balance, the drawers and profit.
- **SC-005**: LBP-mode sales give identical results to before the feature (same amounts, same balances moved).
- **SC-006**: 0 MTC / Alfa Prepaid cards can be sold in USD mode.

## Assumptions

- USD prices come from the Whish app crawl of 2026-10-14 (`docs/whish-prices/`); later Whish price changes are applied by the owner in Settings or by a new crawl.
- The Whish App drawer already holds USD and LBP balances (as shown on the Dashboard); no new drawer is needed.
- "Remember per device" uses the same kind of per-device preference the app already uses for display choices; it is not shared between devices or users.
- The update matches items by group and name as they were added from the Whish crawl; an item a shop renamed or created itself gets no USD price automatically.
- The USD selling price starting equal to cost means a USD sale makes zero profit until the owner sets a selling price — accepted (owner rule 2026-10-10).
