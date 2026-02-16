# MTC & Alfa Recharge Credits

## Overview

The Recharge module handles MTC (Touch) and Alfa mobile credit transfers, vouchers, and days validity top-ups. Credit balances for MTC and Alfa are tracked via **drawer balances** — not as inventory products.

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

When a customer request a credit transfer:

1. Cashier selects provider (MTC/Alfa) and enters amount
2. System creates a sale record
3. **Customer payment** increases the "Paid By" drawer (e.g., CASH → General drawer)
4. **Telecom balance consumed** decreases the provider drawer (MTC or Alfa)
5. Activity log is recorded

### Balance Display

- **Recharge page**: Shows MTC Stock and Alfa Stock in the header (reads from drawer_balances)
- **Dashboard**: Drawer balances section shows MTC and Alfa drawers alongside other drawers

## Architecture

### Files

| Layer        | File                                                      | Purpose                                                                              |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Repository   | `packages/core/src/repositories/RechargeRepository.ts`    | `getVirtualStock()`, `processRecharge()`, `topUp()`                                  |
| Service      | `packages/core/src/services/RechargeService.ts`           | Business logic wrapper                                                               |
| IPC          | `electron-app/handlers/rechargeHandlers.ts`               | `recharge:get-stock`, `recharge:process`, `recharge:top-up`                          |
| Preload      | `electron-app/preload.ts`                                 | `recharge.getStock()`, `recharge.process()`, `recharge.topUp()`                      |
| Backend API  | `backend/src/api/recharge.ts`                             | `GET /api/recharge/stock`, `POST /api/recharge/process`, `POST /api/recharge/top-up` |
| Frontend API | `frontend/src/api/backendApi.ts`                          | `getRechargeStock()`, `processRecharge()`, `topUpRecharge()`                         |
| UI           | `frontend/src/features/recharge/pages/Recharge/index.tsx` | Recharge form + Top-Up panel                                                         |

### Data Flow

```
Top-Up:
  User → topUp() → drawer_balances +amount → MTC/Alfa drawer increases

Recharge Transaction:
  User → processRecharge() → sales record created
    → Paid-by drawer +price (customer payment)
    → MTC/Alfa drawer -amount (credit consumed)
    → activity_log entry
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
