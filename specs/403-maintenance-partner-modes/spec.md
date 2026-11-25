# Feature Specification: Partner switch on repair jobs (Maintenance)

**Feature Branch**: `403-maintenance-partner-modes` (work happens on `main`; ticket LIRA-403)

**Created**: 2026-11-24

**Status**: Implemented (not committed)

**Input**: Owner decisions 2026-11-24: add the Services page's `[ Customer | For Partner | Via Partner ]` switch to the Maintenance (repair jobs) page, same look, same meaning.

## Owner decisions (2026-11-24)

- **For Partner** = same as Services: the repair is done for the partner. No counter payment. The full job price is owed by the partner (`partner_ledger` DEBIT, type `FOR_MAINTENANCE`), settled later on the Partners page.
- **Via Partner** = same as Services: an outside technician (the partner) does the repair. The customer pays the shop the full price as usual (payment legs required, Customer Account leg allowed). The shop owes the partner the job's cost (`partner_ledger` CREDIT, type `THROUGH_MAINTENANCE`). Profit = price − cost.
- No "Pay out" for maintenance.
- In a customer session, "For Partner" is hidden (a session never has partner sales); "Via Partner" stays.

## Today

A repair job has a labour cost and price (one currency, USD or LBP) plus parts (always USD, from shop stock). Money moves only at checkout: the job is saved as `Delivered_Paid` with payment legs, `MaintenanceRepository.processPayments` writes one `MAINTENANCE` transaction (source `maintenance`/job id), the legs, change, kept change, rounding expense and any "Maintenance Debt". There is no partner involvement at all.

## Where the partner choice lives (decided here)

Services is a one-screen sale: the switch and the payment happen in one submit. A repair job lives over days (Received → In progress → Ready → checkout), and the choice "who is this repair for / who does it" is known when the device comes in. So:

- The switch sits on the **job form** (next to cost/price), with the partner picker under it, exactly like Services. It is saved on the job (`maintenance.partner_mode`, `maintenance.partner_id`, migration v234) by every save (draft, status step, checkout), so the jobs list and a reopened job show it.
- **Money moves only at checkout**, as today. The checkout reads the job's mode:
  - Customer → unchanged.
  - For Partner → the main button reads "Deliver to partner" and saves the job as Delivered_Paid with no payment window (nothing is collected). The partner is booked the full price.
  - Via Partner → the normal payment window opens; after payment the partner CREDIT is booked.
- Once the job is charged (live transaction, not refunded), its mode and partner are locked like its amounts (refund/void unlocks them).
- A save that does not send `partner_mode`/`partner_id` leaves the stored value alone (status steps, old clients, offline replays).

## Booking rules

| Mode        | Transaction                                                                                              | Drawer                                                  | Partner ledger (`reference_table='maintenance'`, `reference_id=job id`)                                                         | Profit                                                                                                                                           |
| ----------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer    | `MAINTENANCE`, unchanged                                                                                 | legs as today                                           | none                                                                                                                            | as today                                                                                                                                         |
| For Partner | `MAINTENANCE`, amount = labour final (job currency) + parts (USD); `client_name` = "<partner> [partner]" | none (no legs, no change, no rounding expense, no debt) | `FOR_MAINTENANCE` **DEBIT** per currency: job-currency labour final, and the USD parts price (an LBP job with parts → two rows) | stamped as today (labour margin + parts margin); **counted on Profits only as the partner settles** (same coverage rule as For-Partner services) |
| Via Partner | `MAINTENANCE`, unchanged                                                                                 | legs as today (Customer Account allowed)                | `THROUGH_MAINTENANCE` **CREDIT** of the **labour cost** in the job currency                                                     | stamped as today, counted at once                                                                                                                |

- **Via Partner owes only the labour cost.** Parts come out of the shop's own stock, so the partner is not owed their cost (the parts margin stays the shop's). A Via job with labour cost 0 books no partner row (same as Services, which also books nothing at cost 0).
- **No extra** ("+ Extra") on a For or Via job — same rule as Services (`NO_EXTRA_FOR_PARTNER_MESSAGE`). Discount stays allowed on Via (payment window); For Partner has no payment window, so its price is the job price (any discount already stored on the job still applies).
- **Session basket:** For Partner is refused server-side when the save is a basket item (`deferPayment`); Via Partner in a basket still books its CREDIT when the item is checked out (the basket owns the customer's money).
- **Refund / void:** the generic `_reversePartnerLedger` reverses every partner row whose reference is the job, so create + refund nets the partner ledger, drawers and profit to 0 per currency with no new reversal code (rule 20). A For job refunded after a partial partner settlement unwinds the coverage through the existing generic path.
- **When a For job is charged**: only on the save that moves the job INTO a paid status (new job delivered at once, or Received/In progress/Ready → Delivered_Paid). A resave of a job that is already Delivered_Paid (notes edit, a refunded job reopened) never bills the partner again.
- **Labels:** the Partners page and settle views label rows from the type itself ("FOR MAINTENANCE", "THROUGH MAINTENANCE"); no per-type map needed.

## Functional requirements

- **FR-001** The Maintenance job form shows the shared `[ Customer | For Partner | Via Partner ]` switch; For/Via show the partner picker (required).
- **FR-002** `partner_mode` ('FOR' | 'VIA' | null) and `partner_id` are accepted by `saveMaintenanceJobSchema` (both transports) and stored on the job; a mode needs a partner.
- **FR-003** For Partner checkout: no payment legs, change, kept change or extra accepted (schema + service); one `FOR_MAINTENANCE` DEBIT per currency of what the customer would have owed; no drawer movement.
- **FR-004** Via Partner checkout: the normal payment window (a checkout always sends its legs, as today), one `THROUGH_MAINTENANCE` CREDIT of the labour cost when the job is charged.
- **FR-005** For Partner is hidden in a session (UI) and refused for a basket item (server).
- **FR-006** Profits (By Module maintenance totals, by-day, drill-down) count a For job in proportion to partner coverage, like For-Partner services.
- **FR-007** Refund and void of either mode net partner ledger, drawers and profit to 0 per currency.
- **FR-008** The charged job's mode/partner cannot be changed until refunded.

## Open questions (logged for the owner, not blocking)

1. **Via Partner and parts cost.** Built: the partner is owed the labour cost only (parts are from shop stock). If the outside technician also supplies parts, the cashier should put that in the labour cost. Keep?
2. **For Partner and the transaction's client column.** Built like Services: the transaction reads "<partner> [partner]", the job keeps the customer's name and client link. Keep, or show the customer?
3. **Discount on For Partner.** There is no payment window, so no discount can be typed at delivery. A discount must be agreed with the partner as a lower price on the job. Keep?
4. **Via Partner with cost 0.** Books nothing for the partner (Services does the same). Should the page refuse it?
5. **Re-billing a refunded For job.** A refunded For job stays Delivered_Paid, and resaving it does not bill the partner again (that would re-bill on every notes edit). To bill again, enter a new job. Rare; keep?
