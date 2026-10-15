# Contract: Wrong-Number Card Recharge (LIRA-312)

The core is `WrongNumberService` over `WrongNumberRepository`, with SQL only in
repositories (rule 13). Schemas live in `packages/core/src/validators/wrongNumber.ts`
and are exported from both `index.ts` and `browser.ts`. Each operation also has:
- an IPC handler in `electron-app/handlers/wrongNumberHandlers.ts`, classified
  online-only in `channelPolicy.ts`;
- a REST route in `backend/src/api/wrongNumbers.ts`, mounted at `/api/wrong-numbers`;
- an adapter function typed as `z.input<…>`.

Every operation returns the envelope `{ success, data?, error? }`, and REST
answers HTTP 200 even when it refuses.

| # | Operation | Schema | IPC | REST | Roles | Adapter |
|---|---|---|---|---|---|---|
| 1 | Record a wrong number | `recordWrongNumberSchema` | `wrong-numbers:record` | `POST /api/wrong-numbers` | admin, staff | `recordWrongNumber` |
| 2 | Credits received | `wrongNumberCreditsSchema` | `wrong-numbers:credits` | `POST /api/wrong-numbers/:id/credits` | admin, staff | `recordWrongNumberCredits` |
| 3 | List / one record | `listWrongNumbersQuerySchema` `{ sale_transaction_id?, expense_transaction_id?, status? }` | `wrong-numbers:list` | `GET /api/wrong-numbers` | auth | `getWrongNumbers` |
| 4 | The card a sale sold (LIRA-325) | `wrongNumberSaleCardQuerySchema` `{ sale_transaction_id }` | `wrong-numbers:sale-card` | `GET /api/wrong-numbers/sale-card/:saleTransactionId` | auth | `getWrongNumberSaleCard` → card or `null` |

Undo uses the existing `transactions:void` / `POST /api/transactions/:id/void`
(admin). Nothing new is added for undo except one guard refusal.

## recordWrongNumberSchema

```
{
  provider: 'iPick' | 'Katsh' | 'WHISH_APP',
  mobile_service_item_id: int > 0,        // must be an MTC/Alfa prepaid card of that provider
  wrong_number?: string (phone-shaped) | null,   // optional (LIRA-325): missing/blank → null
  right_number?: string (phone-shaped),   // required when sale_transaction_id is set
  sale_transaction_id?: int > 0,          // path B: an ACTIVE FINANCIAL_SERVICE row of the same provider
  credits_received?: { amount_usd: number > 0, carrier_line_id: int > 0 },  // optional first entry
  expense_date: 'YYYY-MM-DD',             // client day (rule 27)
  note?: string ≤ 500
}
```

**Response data:** `{ id, expense_transaction_id, status, remaining_loss_lbp }`

## wrongNumberCreditsSchema

```
{ wrong_number_card_id: int > 0, amount_usd: number > 0, carrier_line_id: int > 0, client_day?: 'YYYY-MM-DD' }
```

**Response data:** `{ transaction_id, total_recovered_usd, remaining_loss_lbp, status }`

## Refusals (success:false, plain text)

| Case | error |
|---|---|
| right number equals wrong number (both entered) | "The right number is the same as the wrong one." |
| sale's own card is known and another card was sent (LIRA-325) | "This sale was for {Alfa 7.58} — record the wrong number for that card." |
| item not an active MTC/Alfa card of that provider | "Pick the MTC or Alfa card that was sent." |
| sale not an active card sale of that provider | "This sale is not a card recharge from {provider}." |
| shop line inactive or other carrier | "Pick an active {MTC/Alfa} shop line." |
| total credits would exceed card credit | "That is more credit than the card carried (${credit})." |
| void expense with active credits | "Undo the credits received first." |

## The card a sale sold (LIRA-325)

`WrongNumberService.getSaleCard(saleTransactionId)` answers the active MTC/Alfa
catalog card an ACTIVE card sale sold, or `null` when it cannot be told:

- a per-unit `financial_services` row names it by `item_key`
  (`provider/category/subcategory/label`, written by the Whish App form,
  session carts and partner orders) — matched in SQL against each catalog row;
- the walk-in Katsh/iPick cart writes no key; its `note` (`catalogCartNote`)
  is parsed back with `parseCatalogCartNote` and every entry must name the
  SAME card (`x2` of one card is one card), matched to exactly one active
  card by `formatCatalogItemName`;
- otherwise (older sale, card inactive/removed, several different cards,
  several catalog rows with the same name) → `null`.

`recordWrongNumber` on a sale refuses a `mobile_service_item_id` different from
the resolved card; when it resolves to `null`, the operator's pick is accepted
(previous behaviour).
