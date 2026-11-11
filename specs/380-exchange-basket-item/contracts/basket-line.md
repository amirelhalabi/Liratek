# Contract — exchange basket line (LIRA-380)

No new endpoint. Two existing operations carry the line on both transports:

| step | IPC | REST |
|---|---|---|
| add | `session:cart:add` | `POST /api/sessions/:id/cart` (`sessionCartAddSchema`) |
| checkout | `session:checkout` | `POST /api/sessions/:id/checkout` (`sessionCheckoutSchema`, cart items opaque) |

## form_data (`ExchangeSubmitPayload`, `exchangeSubmitSchema`)

Sent: `fromCurrency, toCurrency, amountIn, amountOut, leg1Rate, leg1MarketRate,
leg1ProfitUsd, leg2Rate?, leg2MarketRate?, leg2ProfitUsd?, viaCurrency?,
totalProfitUsd, clientName?, clientId?, clientPhone?, note, typedNote?,
fromCurrencyName, toCurrencyName, transaction_time?, leg1RateOverridden,
leg2RateOverridden?`.

Never sent in a basket line (refused at replay if present): `payments`,
`customerPayments`, `customer_waived_amount`, `kept_change_*`,
`rounding_given_*`, `added_change_*`, `tender_exchange_rate`,
`customer_account_usd_rate`, `payout_account_usd_rate`, `partnerId`,
`partnerMode`.

Server-injected at replay only (not schema keys): `deferPayment: true`,
`paid_in_session: <sessionId>`; the checkout's time when the line has none;
the session customer's name/id when the line has none.

## Checkout legs for an exchange line

- given side (USD/LBP) → part of the basket charge, collected by the pooled IN legs;
- received side (USD/LBP) → one gross OUT leg `{ kind: "PAYOUT", payoutOrigin: "GENERAL" }`
  of exactly `amountOut` in its currency, never netted at the checkout rate.

## Shared rule (`@liratek/core`, browser-safe)

`EXCHANGE_CART_CHANNEL`, `isExchangeBasketLine(item)`,
`sessionExchangeLineSides(formData) → { charge, payout }`,
`sessionExchangeLineLink(formData) → { amountUsd, amountLbp }`,
`sessionExchangeCartAmount(formData) → { amount, currency }`.
