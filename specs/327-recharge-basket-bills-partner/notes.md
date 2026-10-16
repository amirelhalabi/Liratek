# LIRA-327: Bills and For Partner in the Mobile Recharge basket

Owner decisions of 2026-10-16. The owner waived the full Spec Kit cycle, so these notes are the spec. This ticket builds on LIRA-326 (`specs/326-recharge-cross-provider-basket/`).

## A. Bills go into the shared basket

1. Each bill keeps the provider of the tab it was added on (iPick or Katsh). Bills live in the Mobile Recharge basket context, like cards. They survive switching tabs and leaving and returning to Mobile Recharge, but not a reload.
2. A bill is booked under its own provider on every path: single sale, session cart, partner and mixed basket.
3. Bills show in the one payment window, grouped under their provider with subtotals, and they count on their tab's badge.
4. A mixed basket with bills is paid through the combined basket checkout. Each bill is booked the way a bill paid on its own is booked today: a BILL row with cost = price = amount and no profit, whose commission is entered at settlement. It is booked in the same all-or-nothing transaction, with the one pooled payment. Whole-basket void and refund reverse bills to 0 on every ledger, per currency (rule 20).
5. The "Pay or remove the bill first" refusal is removed.

### How it is built

- A bill rides the basket as its **own cart entry**, not inside a provider's `_batch`. This is the same `financial:create` shape KatshForm already puts in a customer session for a bill. `RechargeBasketService` accepts such an entry when:
  - it is on `ipick` or `katsh` (`RECHARGE_BASKET_BILL_MODULES`);
  - its `serviceType` is `BILL`;
  - its provider, currency and amount match the entry;
  - cost = price = amount and the commission is 0.

  Anything else is refused before any write.

- The discount is spread over the card units only, because a bill earns nothing.
- The reversal owner is unchanged: the session-basket void and refund.

## B. For Partner is basket-wide

1. The For Partner toggle and the chosen partner live in the basket context. On in one basket tab (Katsh, iPick or Whish App Bills) means on in all of them, with the same partner. It stays on until it is turned off or the basket is submitted or cleared.
2. Turning it on when the basket already has items asks "Make all N items in the basket a partner order?". Cancel leaves it off. With an empty basket, nothing is asked.
3. Submit to Partner books the WHOLE basket: every provider's cards and bills. The rows are exactly the ones today's per-tab partner submit writes:
   - one aggregated SEND per iPick or Katsh provider;
   - one BILL per bill;
   - one SEND per Whish App unit.

   Each row is costed against its own provider, the partner owes the full price, and no counter payment is taken. The new server operation `recharge-basket:partner-order` / `POST /api/recharge-basket/partner-order` (core `RechargePartnerOrderService`) books every sale in one DB transaction. If one fails, nothing is booked.

4. The LIRA-326 "per tab only" partner filter is removed.
5. Inside an open customer session, nothing changes: a partner order still never enters the session cart.

### Reversal

Each partner sale is voided or refunded on its own through the generic per-transaction path, which reverses its `partner_ledger` rows and its drawer. Partner sales carry no pooled payment, so reversing one sale never strands money belonging to another. The core test voids each sale of a 4-sale, 3-provider order (with a bill) and every ledger nets to 0.
