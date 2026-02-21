# MTC & Alfa Recharge Credits

## Overview

The Recharge module handles MTC (Touch) and Alfa mobile credit transfers, vouchers, and days validity top-ups. Credit balances for MTC and Alfa are tracked via **drawer balances** — not as inventory products.

**Recent changes (T-46, Feb 18 2026):**
- Voucher images per recharge item
- Full payment methods (CASH, OMT, WHISH, BINANCE, DEBT)
- Per-item cost tracking with auto-save
- `mobileServices.ts` data file integration
- Service Debt visible on Debts page

## How Balances Work

### Drawer-Based Tracking

Each telecom provider has its own drawer in `drawer_balances`:

| Provider | Drawer Name | Purpose                    |
| -------- | ----------- | -------------------------- |
| MTC      | `MTC`       | Shop's MTC credit balance  |
| Alfa     | `Alfa`      | Shop's Alfa credit balance |

### Top-Up (Adding Credits)

When the shop owner loads credits onto their MTC or Alfa account:

1. Shop owner purchases credits from the telecom provider
2. Uses the **Top Up** panel in the Recharge module
3. Enters the amount loaded
4. The system increases the provider's drawer balance

**Future**: Top-up drawer effects (which payment drawer decreases) will be configurable.

### Recharge Transaction (Sending Credits to a Customer)

When a customer requests a credit transfer:

1. Cashier selects provider (MTC/Alfa) and enters amount
2. Cashier selects payment method (CASH, OMT, WHISH, BINANCE, or DEBT)
3. System creates a sale record
4. **Customer payment** increases the "Paid By" drawer (e.g., CASH → General drawer)
5. **Telecom balance consumed** decreases the provider drawer (MTC or Alfa)
6. Transaction is recorded in the unified `transactions` table
7. If payment method is DEBT, a `debt_ledger` entry is created for the client

### Payment Methods

All recharge transactions support these payment methods:

| Method   | Drawer Effect                         |
| -------- | ------------------------------------- |
| `CASH`   | General drawer increases              |
| `OMT`    | OMT_System drawer increases           |
| `WHISH`  | Whish_System drawer increases         |
| `BINANCE`| Binance drawer increases              |
| `DEBT`   | No drawer effect; debt ledger updated |

### Balance Display

- **Recharge page**: Shows MTC Stock and Alfa Stock in the header (reads from drawer_balances)
- **Dashboard**: Drawer balances section shows MTC and Alfa drawers alongside other drawers

## Voucher Images

Each recharge item can have a voucher image associated with it. Images are stored as base64 data in the `voucher_images` table, keyed by `(provider, category, item_key)`.

- Images are managed via the `/api/voucher-images` endpoint (or `window.api.voucherImages.*` in Electron)
- The frontend displays voucher images in the recharge item list
- Images can be uploaded, viewed, and deleted per item

## Cost Tracking

Per-item costs are stored in the `item_costs` table, keyed by `(provider, category, item_key, currency)`. Costs auto-save when edited in the UI, enabling profit margin visibility.

- Managed via `/api/item-costs` endpoint (or `window.api.itemCosts.*` in Electron)
- Used by the Profits module to compute recharge margins

## Mobile Services Data

Recharge items (providers, categories, denominations) are defined in `frontend/src/data/mobileServices.ts`. This data file replaces hardcoded item lists with a structured JSON format. The `useMobileServiceItems` hook (`frontend/src/features/recharge/hooks/useMobileServiceItems.ts`) loads and enriches this data with saved costs and voucher images.

## Architecture

### Files

| Layer        | File                                                              | Purpose                                                                              |
| ------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Repository   | `packages/core/src/repositories/RechargeRepository.ts`            | `getVirtualStock()`, `processRecharge()`, `topUp()`                                  |
| Service      | `packages/core/src/services/RechargeService.ts`                   | Business logic wrapper                                                               |
| Item Costs   | `packages/core/src/repositories/ItemCostRepository.ts`            | Per-item cost CRUD                                                                   |
| Item Costs   | `packages/core/src/services/ItemCostService.ts`                   | Cost management service                                                              |
| Voucher Imgs | `packages/core/src/repositories/VoucherImageRepository.ts`        | Voucher image CRUD                                                                   |
| Voucher Imgs | `packages/core/src/services/VoucherImageService.ts`               | Image management service                                                             |
| IPC          | `electron-app/handlers/rechargeHandlers.ts`                       | `recharge:get-stock`, `recharge:process`, `recharge:top-up`                          |
| IPC          | `electron-app/handlers/itemCostHandlers.ts`                       | `item-costs:get-all`, `item-costs:set`                                               |
| IPC          | `electron-app/handlers/voucherImageHandlers.ts`                   | `voucher-images:get-all`, `voucher-images:set`, `voucher-images:delete`              |
| Preload      | `electron-app/preload.ts`                                         | `recharge.*`, `itemCosts.*`, `voucherImages.*`                                       |
| Backend API  | `backend/src/api/recharge.ts`                                     | `GET /api/recharge/stock`, `POST /api/recharge/process`, `POST /api/recharge/top-up` |
| Backend API  | `backend/src/api/item-costs.ts`                                   | `GET /api/item-costs`, `POST /api/item-costs`                                        |
| Backend API  | `backend/src/api/voucher-images.ts`                               | `GET /api/voucher-images`, `POST /api/voucher-images`, `DELETE /api/voucher-images/:id` |
| Data         | `frontend/src/data/mobileServices.ts`                             | Provider/category/item definitions                                                   |
| Hook         | `frontend/src/features/recharge/hooks/useMobileServiceItems.ts`   | Loads items + costs + images                                                         |
| Frontend API | `frontend/src/api/backendApi.ts`                                  | `getRechargeStock()`, `processRecharge()`, `topUpRecharge()`, item cost/image APIs   |
| UI           | `frontend/src/features/recharge/pages/Recharge/index.tsx`         | Recharge form + Top-Up panel                                                         |

### Data Flow

```
Top-Up:
  User → topUp() → drawer_balances +amount → MTC/Alfa drawer increases

Recharge Transaction:
  User → processRecharge() → sales record created
    → Paid-by drawer +price (customer payment)
    → MTC/Alfa drawer -amount (credit consumed)
    → transactions table entry
    → debt_ledger entry (if DEBT payment)
```

## Important: No Inventory Products

MTC/Alfa credits are **not** tracked as inventory products. Previously, `Virtual_MTC` and `Virtual_Alfa` product rows existed in the `products` table, but this was removed because:

1. Credits are not physical inventory items
2. Product-based tracking caused false "low stock" notifications
3. Drawer balances already accurately track credit balances
4. The `findLowStock()` query now excludes `Virtual_MTC`/`Virtual_Alfa` item types as a safety net

## Sign Convention

| Operation | MTC/Alfa Drawer Effect    |
| --------- | ------------------------- |
| Top-Up    | **+** (balance increases) |
| Recharge  | **-** (balance decreases) |
