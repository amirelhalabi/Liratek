# Contract: For-Sale (Resale) Lines (LIRA-309)

One core service, `ResaleLineService`, sits on top of `ResaleLineRepository`.
Repositories own the SQL (rule 13).

Each write operation has:
- one Zod schema in `packages/core/src/validators/resaleLine.ts`, exported
  from **both** `index.ts` and `browser.ts` (rule 21);
- an IPC handler in `electron-app/handlers/resaleLineHandlers.ts`, registered
  in `main.ts` and classified in `offline/channelPolicy.ts`;
- a REST route in `backend/src/api/resaleLines.ts`, mounted at
  `/api/resale-lines`, using `authenticateJWT` and then `requireRole` where
  noted;
- a `backendApi.ts` `ipcOrHttp` function, exposed on `ElectronApiAdapter`,
  typed in `packages/ui/src/api/types.ts` with `z.input<typeof schema>`.

The envelope is `{ success, data?, error? }`, and REST returns HTTP 200 on
failure (rule 6). Reads return the raw shape; writes return the envelope.

| # | Operation | Schema | IPC channel | REST | Role | Adapter fn |
|---|---|---|---|---|---|---|
| 1 | List for-sale lines (+ status inputs) | `listResaleLinesQuerySchema` `{ carrier?, include_sold? }` | `resale-lines:list` | `GET /api/resale-lines` | auth | `getResaleLines(q?)` |
| 2 | Unsold lines for detection | (same, `include_sold=false`) | `resale-lines:list` | `GET /api/resale-lines?carrier=` | auth | `getUnsoldResaleLines(carrier)` |
| 3 | Save details (create or update) | `saveResaleLineSchema` `{ product_id, carrier, validity_expires_at?: 'YYYY-MM-DD' \| null, credits? }` | `resale-lines:save` | `PUT /api/resale-lines/:productId` | admin | `saveResaleLine(input)` |
| 4 | Internal recharge | `rechargeResaleLineSchema` (below) | `resale-lines:recharge` | `POST /api/resale-lines/:productId/recharge` | auth | `rechargeResaleLine(input)` |
| 5 | Write off a lost line | `writeOffResaleLineSchema` `{ product_id, note?, client_day? }` | `resale-lines:write-off` | `POST /api/resale-lines/:productId/write-off` | admin | `writeOffResaleLine(input)` |

Shop lines use the **existing** carrier-line contract unchanged (scout 3 §5):
`getAdminCarrierLines`, `createCarrierLine`, `updateCarrierLine`,
`archiveCarrierLine` and so on. The only addition is that carrier-line
create/update refuses a number that is an unsold for-sale line (FR-005).

## rechargeResaleLineSchema

```
{
  product_id: int > 0,
  source: 'CARD' | 'SHOP_LINE_CREDIT' | 'DAYS',
  // CARD
  mobile_service_item_id?: int > 0,           // required when source = CARD
  // SHOP_LINE_CREDIT
  credits?: number > 0,                        // required when source = SHOP_LINE_CREDIT
  // DAYS
  days?: int > 0,                              // required when source = DAYS
  days_cost_usd?: number > 0,                  // required when source = DAYS
  // SHOP_LINE_CREDIT and DAYS
  source_carrier_line_id?: int > 0,            // default: primary line of the carrier
  exchange_rate: number > 0,
  client_day?: 'YYYY-MM-DD'                    // rule 27; server localDay() fallback
}
```

A `superRefine` enforces the per-source required fields. The actor
(`userId`) comes from the JWT or session, never from the body.

**Response `data`** (write):

```
{ transaction_id, recharge_id, cost_usd,
  line: { cost_usd, price_usd, validity_expires_at, credits } }
```

**Refusals** (`success:false`, plain messages):

| Case | error |
|---|---|
| line sold / not a line product | "This line is not in stock." |
| line LOST (BURNED) | "This line has expired past its grace period and can no longer be recharged." |
| carrier mismatch (card or shop line of the other carrier) | "Use an {MTC/Alfa} card or line for this {MTC/Alfa} number." |
| source line short of credit | existing CREDIT_TRANSFER insufficiency message |
| more than one open batch / qty_remaining > 1 | "This line has more than one unit in stock; fix its stock first." |
| no known cost (DAYS `days_cost_usd` missing, or CARD catalog `cost_lbp ≤ 0`) | "Enter what this recharge cost before saving." |

## Changed existing contract

- **`processRecharge`** (customer recharge, IPC `recharge:process`, REST
  `POST /api/recharge/process`) now refuses a customer recharge whose number
  matches an unsold for-sale line of the tenant: "This is your line for sale
  — use Recharge line on the Phone Lines or Mobile Recharge page." This is
  the same position and style as the `isShopOwnLine` re-check (RR:975-983).
- **Void/refund** (`transactions:void` / `refund`, both transports, no new
  route). `LINE_RECHARGE` becomes voidable, and two refusals are added:
  "Refund the sale of this line first." and "Undo the newer recharge of this
  line first." A later days sale on the source shop line does NOT block the
  undo: days taken from a shop line are added back onto its current expiry
  (corrected 2026-10-13, verified by test).
