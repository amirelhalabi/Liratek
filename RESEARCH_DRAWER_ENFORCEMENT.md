# Multi-Drawer Enforcement Research Findings

## Executive Summary

The POS/Sales system currently **does NOT track drawer information** in transaction records. However, there is an established **drawer routing logic documented in the codebase**:
- **Drawer A (OMT)**: For OMT financial service transactions only
- **Drawer B (General)**: For regular sales, recharges, exchanges, and other operations

The system needs modifications to:
1. Add `drawer` field to the `sales` table
2. Implement drawer detection logic based on transaction type
3. Display drawer information in the CheckoutModal
4. Track drawer information throughout the checkout flow

---

## 1. Current Drawer System Implementation

### Status: **CONCEPTUAL ONLY** (Not enforced in code)

#### Documented Drawer Logic:
From `omtHandlers.ts`:
```typescript
// Determine which drawer this affects
const drawer = data.provider === 'OMT' ? 'OMT_Drawer_A' : 'General_Drawer_B';
```

From `rechargeHandlers.ts`:
```typescript
// All recharge transactions go to Drawer B (General)
drawer: 'General_Drawer_B'
```

#### Existing Database Table: `daily_closings`
```sql
CREATE TABLE daily_closings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closing_date DATE,
    drawer_name TEXT,  -- Currently stores drawer name, but not referenced from sales
    opening_balance_usd DECIMAL(15, 2),
    opening_balance_lbp DECIMAL(15, 2),
    physical_usd DECIMAL(15, 2),
    physical_lbp DECIMAL(15, 2),
    physical_eur DECIMAL(15, 2),
    system_expected_usd DECIMAL(15, 2),
    system_expected_lbp DECIMAL(15, 2),
    variance_usd DECIMAL(15, 2),
    notes TEXT
);
```

**Problem**: The `daily_closings` table has a `drawer_name` field, but the `sales` table has **NO drawer column**, so there's no way to attribute sales to specific drawers during transactions.

---

## 2. CheckoutModal.tsx Analysis

**File**: [src/pages/POS/components/CheckoutModal.tsx](src/pages/POS/components/CheckoutModal.tsx)

### Current Implementation:
- **Payment Information Tracked**: 
  - Client details (name/phone/ID)
  - Discount amount
  - Payment in USD and LBP
  - Change given in USD and LBP
  - Exchange rate

- **NO drawer tracking** in the modal
- **NO transaction type detection** (can't determine if OMT vs regular sale)

### Current `getPaymentData()` return:
```typescript
return {
    client_id: finalClientId,
    client_name: finalClientName,
    client_phone: finalClientPhone,
    total_amount: totalAmount,
    discount: discount,
    final_amount: finalAmount,
    payment_usd: paidUSD,
    payment_lbp: paidLBP,
    change_given_usd: changeGivenUSD,
    change_given_lbp: changeGivenLBP,
    exchange_rate: exchangeRate
    // NO drawer field
};
```

### Issue:
The CheckoutModal receives `cartItems` but does NOT have access to check if items are OMT-related. The modal is purely payment-focused and doesn't know about the transaction type.

---

## 3. POS index.tsx Analysis

**File**: [src/pages/POS/index.tsx](src/pages/POS/index.tsx)

### Cart Structure:
```typescript
interface CartItem extends Product {
    quantity: number;
}

// Items are added to cart like this:
setCartItems(prev => {
    const existing = prev.find(p => p.id === product.id);
    if (existing) {
        return prev.map(p => p.id === product.id ? { ...p, quantity: p.quantity + 1 } : p);
    }
    return [...prev, { ...product, quantity: 1 }];
});
```

### Products Come From:
- `ProductSearch` component which queries via `window.api.getProducts()`
- Products have a `category` field but **NO drawer designation**

### Current Sale Request:
```typescript
const saleRequest: SaleRequest = {
    ...paymentData,
    id: currentDraftId,
    status: 'completed',
    items: cartItems.map(item => ({
        product_id: item.id,
        quantity: item.quantity,
        price: item.retail_price
    }))
};
```

**Issue**: The sale request has NO way to identify drawer affiliation based on cart items.

---

## 4. Product Structure Analysis

**Database Schema** (`create_db.sql`):
```sql
CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    item_type TEXT NOT NULL,        -- Key field for type detection
    category TEXT DEFAULT 'General',
    description TEXT,
    cost_price_usd DECIMAL(10, 2),
    selling_price_usd DECIMAL(10, 2),
    min_stock_level INTEGER DEFAULT 5,
    stock_quantity INTEGER DEFAULT 0,
    imei TEXT,
    color TEXT,
    image_url TEXT,
    warranty_expiry DATE,
    status TEXT DEFAULT 'Active',
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Current `item_type` Values:
Based on code inspection:
- `'Product'` - Default for regular products
- `'Virtual_MTC'` - Virtual recharge credits for MTC provider
- `'Virtual_Alfa'` - Virtual recharge credits for Alfa provider

### Issue:
**Product categories do NOT distinguish OMT items**. The product table has no field to mark items as OMT-specific. This means:
- **OMT transactions are NOT product-based**, they're service transactions (financial_services table)
- Regular sales (stock items) always go to Drawer B
- Only OMT financial services go to Drawer A

---

## 5. Sales Handler Analysis

**File**: [electron/handlers/salesHandlers.ts](electron/handlers/salesHandlers.ts)

### Current `SaleRequest` Interface:
```typescript
interface SaleRequest {
    client_id: number | null;
    client_name?: string;
    client_phone?: string;
    items: SaleItem[];
    total_amount: number;
    discount: number;
    final_amount: number;
    payment_usd: number;
    payment_lbp: number;
    change_given_usd?: number;
    change_given_lbp?: number;
    exchange_rate: number;
    
    // Draft Support
    id?: number;
    status?: 'completed' | 'draft' | 'cancelled';
    note?: string;
    
    // NO drawer field
}
```

### Current `sales` Table Schema:
```sql
CREATE TABLE sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    total_amount_usd DECIMAL(10, 2),
    discount_usd DECIMAL(10, 2) DEFAULT 0,
    final_amount_usd DECIMAL(10, 2),
    paid_usd DECIMAL(10, 2) DEFAULT 0,
    paid_lbp DECIMAL(15, 2) DEFAULT 0,
    change_given_usd DECIMAL(10, 2) DEFAULT 0,
    change_given_lbp DECIMAL(15, 2) DEFAULT 0,
    exchange_rate_snapshot DECIMAL(15, 2),
    status TEXT DEFAULT 'completed',
    note TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
    
    -- NO drawer column
);
```

### Current Handler Logic:
1. **Transaction begins**: Uses SQLite transaction for data integrity
2. **Auto-creates client** if name provided but no ID
3. **Handles UPDATE** (existing draft) or **INSERT** (new sale)
4. **Processes items**: Inserts to `sale_items` table
5. **Updates stock**: Only if status = 'completed'
6. **Handles debt**: Creates debt ledger entry if partial payment

**NO drawer validation or logging**.

### Where Drawer Logic Would Go:
```typescript
// After determining sale is 'completed', before or during INSERT:
// 1. Determine drawer based on transaction type
// 2. Validate drawer has sufficient balance (future enforcement)
// 3. Store drawer in sales record
// 4. Update drawer balance (when multi-drawer accounting is added)
```

---

## 6. OMT Transaction Routing

**File**: [electron/handlers/omtHandlers.ts](electron/handlers/omtHandlers.ts)

### OMT Drawer Assignment Logic (Currently in logs only):
```typescript
// Determine which drawer this affects
const drawer = data.provider === 'OMT' ? 'OMT_Drawer_A' : 'General_Drawer_B';

// Log to activity logs
const logStmt = db.prepare(`
    INSERT INTO activity_logs (user_id, action, details, created_at)
    VALUES (1, 'Financial Service Transaction', ?, CURRENT_TIMESTAMP)
`);
logStmt.run(JSON.stringify({
    drawer,
    provider: data.provider,
    serviceType: data.serviceType,
    commission_usd: data.commissionUSD,
    commission_lbp: data.commissionLBP
}));
```

**Current Status**: OMT transactions are logged to `financial_services` table, NOT to `sales` table. They're separate from POS sales.

### Transaction Types:
- **OMT** → Drawer A (OMT_Drawer_A)
- **WHISH** → Drawer B (General_Drawer_B)
- **BOB** → Drawer B (General_Drawer_B)
- **OTHER** → Drawer B (General_Drawer_B)

---

## 7. Recharge Handler Implementation

**File**: [electron/handlers/rechargeHandlers.ts](electron/handlers/rechargeHandlers.ts)

### Drawer Assignment:
```typescript
// All recharge transactions explicitly marked for Drawer B
drawer: 'General_Drawer_B'
```

### How Recharges Work:
1. Creates a `sales` record with `note` containing provider info
2. Finds or creates virtual product bucket (Virtual_MTC, Virtual_Alfa)
3. Deducts stock from virtual product
4. Logs to activity_logs with drawer designation

**Observation**: Recharges create `sales` records, so drawer column should be populated here too.

---

## 8. Data Flow: Checkout to Database

### Current Flow (No Drawer Tracking):

```
User selects products in POS
    ↓
Products added to cartItems (Product[])
    ↓
User clicks "Checkout"
    ↓
CheckoutModal opens
    - Collects: client info, discount, payment amounts
    - NO drawer detection
    ↓
User clicks "Complete Sale"
    ↓
handleCompleteSale() in POS/index.tsx
    - Builds SaleRequest with items and payment data
    - NO drawer field added
    ↓
window.api.processSale(saleRequest)
    ↓
sales:process handler in salesHandlers.ts
    - Validates and processes transaction
    - Inserts into sales table WITHOUT drawer info
    - Updates products stock
    - Creates debt if needed
    ↓
Sale stored in database (drawer unknown)
```

---

## 9. Key Findings Summary

### What Currently Exists:
✅ `daily_closings` table has `drawer_name` field
✅ OMT handler has drawer routing logic (in comments/logs)
✅ Recharge handler marks drawer in logs
✅ Financial services stored separately in `financial_services` table
✅ Activity logs table can track drawer info (currently being used)
✅ Product schema has `item_type` field for type detection

### What's Missing:
❌ `drawer` column in `sales` table
❌ Drawer detection logic in CheckoutModal
❌ Drawer field in SaleRequest interface
❌ Drawer tracking in salesHandlers.ts
❌ Drawer validation/enforcement logic
❌ OMT product items (OMT is service-based, not product-based)
❌ Way to distinguish OMT sales in POS (they're handled via Services page)

---

## 10. How OMT vs Regular Sales Currently Work

### Regular Sales (Through POS):
- User selects **physical products** from inventory
- CheckoutModal collects payment
- Sales are saved to `sales` table with `sale_items`
- Stock is decremented
- **Should route to**: Drawer B (General)

### OMT Transactions (Through Services Page):
- User manually enters OMT transaction details
- Data saved to `financial_services` table (NOT sales)
- No products involved, no stock changes
- **Routes to**: Drawer A (per omtHandlers logic)
- **Separate from POS sales entirely**

### Recharge Transactions (Through POS):
- User processes virtual credit recharge
- Deducts from virtual product stock
- Creates `sales` record with note about provider
- **Routes to**: Drawer B (per rechargeHandlers logic)

### Key Insight:
**OMT transactions are handled through the Services page, not the POS checkout.** The POS system is for physical product sales and recharges, which should both go to Drawer B.

---

## 11. What Needs to Change for Multi-Drawer Enforcement

### Database Changes:
1. Add `drawer` column to `sales` table
   ```sql
   ALTER TABLE sales ADD COLUMN drawer TEXT DEFAULT 'Drawer_B';
   ```

### Enum/Constants Needed:
```typescript
export enum DrawerType {
    OMT = 'Drawer_A',
    GENERAL = 'Drawer_B'
}
```

### SaleRequest Interface Changes:
Add to `SaleRequest` interface:
```typescript
drawer?: 'Drawer_A' | 'Drawer_B'; // Or use enum
```

### CheckoutModal Changes:
1. Accept drawer information as prop
2. Display which drawer the sale will affect
3. Show any drawer-specific warnings/limits

### salesHandlers.ts Changes:
1. Determine drawer type based on transaction contents
2. Validate drawer assignment
3. Store drawer in INSERT/UPDATE statements
4. Add logging for drawer operations

### Drawer Detection Logic:
```typescript
function determineSaleDrawer(sale: SaleRequest, items: SaleItem[]): DrawerType {
    // Rule: Check if any items have OMT designation
    // For now: All regular sales go to Drawer B
    // OMT has separate flow through Services page
    return DrawerType.GENERAL;
}
```

### Activity Logging:
Enhance to include drawer in all transaction logs for audit trail

---

## 12. Current Daily Closing Flow

The `daily_closings` table tracks:
- Drawer name (manually selected)
- Opening/closing balances
- Physical cash counts
- System-calculated expected balance
- Variance tracking

**Current Disconnect**: Daily closings are manually entered with drawer name, but individual sales don't record which drawer they affected. This makes reconciliation impossible.

---

## Summary Table

| Component | Current State | Drawer Aware? | Changes Needed |
|-----------|---------------|---------------|-----------------|
| CheckoutModal | Collects payment data | ❌ No | Add drawer display/detection |
| POS index.tsx | Routes to checkout | ❌ No | Determine drawer from cart |
| CartItem/Product | Cart structure | ❌ No | Add drawer field if product-based |
| salesHandlers.ts | Processes sale | ❌ No | Store drawer, enforce rules |
| sales table | Payment + items | ❌ No | Add drawer column |
| daily_closings | Manual drawer entry | ✅ Yes | Link to individual sales |
| omtHandlers.ts | Routes to Drawer A | ✅ Yes | Already correct |
| rechargeHandlers.ts | Routes to Drawer B | ✅ Yes | Already correct |
| financial_services table | OMT transactions | ✅ Yes (separate flow) | N/A |
| activity_logs | Logs drawer info | ✅ Yes | Enhance logging |

---

## Next Steps for Implementation

1. **Database**: Add `drawer` column to `sales` table
2. **Constants**: Create drawer enum/constants
3. **Interface**: Update `SaleRequest` to include drawer field
4. **Detection**: Implement `determineSaleDrawer()` logic
5. **Handler**: Update `salesHandlers.ts` INSERT/UPDATE to use drawer
6. **Modal**: Show drawer info in CheckoutModal
7. **Logging**: Enhance activity logs with drawer tracking
8. **Testing**: Verify drawer attribution in daily closings reconciliation
