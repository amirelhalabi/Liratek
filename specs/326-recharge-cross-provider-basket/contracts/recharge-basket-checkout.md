# Contract: recharge-basket:checkout

- IPC: `recharge-basket:checkout` (payload) → `{ success, results?, checkoutTotalUsd?, checkoutTotalLbp?, sessionId?, error? }`
- REST: `POST /api/recharge-basket/checkout` (JSON payload), `authenticateJWT` → `requireRole(["admin","staff"])`, HTTP 200 with the same envelope.

Payload (`rechargeBasketCheckoutSchema`, `RechargeBasketCheckoutPayload = z.input<…>`):

| Field | Type | Notes |
|---|---|---|
| cartItems | `{ id, module: "ipick"\|"katsh"\|"whish_app", label, amount, currency: "LBP"\|"USD", ipcChannel: "financial:create", formData: { _batch: true, items: SubItem[] } }[]` (≥1) | one entry per provider |
| payments | session checkout payment legs | optional |
| paidByMethod, exchangeRate | as session checkout | |
| clientId?, clientName?, clientPhone? | | session customer |
| kept_change_usd/lbp, waived_usd/lbp, extra_usd/lbp | as session checkout | verified server-side |
| userId | number | overwritten by the authenticated operator |

Refusals (no writes): an empty cart; an item with another channel or module, or `formData._batch !== true`; an entry with no sub-items; a sub-item whose `provider` does not match its entry; a sub-item whose `currency` differs from its entry's (checkout buckets an entry's charge by the entry currency); any session-checkout refusal (the created session is deleted).

Note: the entry `amount` is what the customer is charged for that provider; it should equal the sum of its sub-items' `amount` (after any discount spread). The server does not enforce this today (same as session checkout).

Caveat: with a name AND phone, session checkout registers the client before its money transaction opens, so a checkout that fails after the shape checks can leave that new client behind (same as `session:start`).
