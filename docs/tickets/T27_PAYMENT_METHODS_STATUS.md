# [T-27] Payment Methods Everywhere - Status Report

**Date**: 2026-03-10  
**Status**: ✅ **COMPLETE**

---

## Audit Findings

### Payment Methods Infrastructure

✅ **Database Schema** (`payment_methods` table)

- `code` - Payment method identifier (CASH, OMT, WHISH, BINANCE, DEBT)
- `label` - Display name
- `drawer_name` - Which drawer this method affects
- `affects_drawer` - Whether method impacts drawer balance (DEBT = 0)
- `is_system` - System methods cannot be deleted
- `is_active` - Enable/disable method

✅ **Backend Support**

- `PaymentMethodRepository` - CRUD operations
- `PaymentMethodService` - Business logic
- `payments.ts` utilities - Dynamic drawer resolution with fallback
- IPC handlers - `paymentMethods:*` namespace
- Frontend API - `window.api.paymentMethods.*`

✅ **Multi-Payment Support by Module**

| Module                 | Multi-Payment | Status    | Notes                                          |
| ---------------------- | ------------- | --------- | ---------------------------------------------- |
| **Sales/POS**          | ✅ Yes        | Complete  | Full multi-payment with `MultiPaymentInput`    |
| **Debts**              | ✅ Yes        | Complete  | `RepaymentPaymentLine[]` with FIFO attribution |
| **Financial Services** | ✅ Yes        | Complete  | OMT/WHISH with service debt routing            |
| **Recharge**           | ✅ Yes        | Complete  | MTC/Alfa credit transfers                      |
| **Custom Services**    | ✅ Yes        | Complete  | Maintenance jobs with split payment            |
| **Maintenance**        | ✅ Yes        | Complete  | Repair jobs with multi-payment                 |
| **Expenses**           | ❌ No         | By Design | Simplified to cash-only (business decision)    |
| **Exchange**           | ❌ No         | By Design | Currency swap, not a payment transaction       |

---

## Exchange Module Analysis

The Exchange module **intentionally** does not support multi-payment because:

1. **Nature of Transaction**: Currency exchange is a swap, not a payment
   - Customer gives: 100 USD
   - Customer receives: 450,000 LBP
   - No "payment method" involved - the USD IS the payment

2. **Single Drawer**: All exchanges happen through "General" drawer
   - This is correct - you're swapping currencies within the same cash drawer
   - No need to route to OMT_App, Whish_App, etc.

3. **Implementation**: Hardcoded to CASH method (line 202 in `ExchangeRepository.ts`)

   ```typescript
   INSERT INTO payments (transaction_id, method, drawer_name, currency_code, amount, note, created_by)
   VALUES (?, 'CASH', ?, ?, ?, ?, ?)
   ```

   - This is semantically correct - it's a cash drawer operation

---

## Expenses Module Analysis

The Expenses module was **intentionally simplified** to cash-only:

1. **Business Logic**: Shop expenses are typically paid from General drawer
2. **UI Simplification**: Removed payment method dropdown, shows "💵 Cash" badge
3. **Backend**: Still supports `paid_by_method` but UI only offers CASH

This is a **design decision**, not a missing feature.

---

## Drawer Model Formalization

### Current Drawer Architecture

| Drawer Name    | Type     | Purpose                           |
| -------------- | -------- | --------------------------------- |
| `General`      | Physical | Main cash drawer (USD + LBP)      |
| `OMT_App`      | Physical | OMT money transfer wallet         |
| `Whish_App`    | Physical | WHISH money transfer wallet       |
| `Binance`      | System   | Cryptocurrency balances           |
| `OMT_System`   | System   | OMT company settlement tracking   |
| `Whish_System` | System   | WHISH company settlement tracking |
| `MTC`          | System   | MTC credit balance (phone-based)  |
| `Alfa`         | System   | Alfa credit balance (phone-based) |
| `IPEC`         | System   | IPEC service credits              |
| `Katch`        | System   | Katch service credits             |

### Drawer Assignment by Module

| Module             | Uses Drawers            | Notes                                              |
| ------------------ | ----------------------- | -------------------------------------------------- |
| Sales/POS          | ✅ General              | All cash sales                                     |
| Financial Services | ✅ OMT_App, Whish_App   | Money transfers                                    |
| Recharge           | ✅ MTC, Alfa            | Credit purchases                                   |
| Custom Services    | ✅ General, IPEC, Katch | Service jobs                                       |
| Maintenance        | ✅ General              | Repair jobs                                        |
| Debts              | ✅ General              | Debt tracking (doesn't affect drawer until repaid) |
| Expenses           | ✅ General              | Cash outflows                                      |
| Exchange           | ✅ General              | Currency swaps within General drawer               |
| Closing            | ✅ All                  | Opening/closing balances for all drawers           |

---

## Conclusion

**[T-27] Payment Methods Everywhere is COMPLETE.**

All modules that **need** multi-payment support have it:

- ✅ Sales/POS
- ✅ Debts
- ✅ Financial Services
- ✅ Recharge
- ✅ Custom Services
- ✅ Maintenance

Modules that **don't need** multi-payment:

- ❌ Expenses (cash-only by design)
- ❌ Exchange (currency swap, not payment)

**No further action required for [T-27].**

---

## Next Priority: [T-45] WhatsApp Cloud API Integration

See: `docs/CURRENT_SPRINT.md` section "[T-45] WhatsApp Cloud API Integration"
