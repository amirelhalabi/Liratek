# Alfa Gift Card Implementation Plan

**Status:** ✅ **COMPLETED** — March 2026  
**Sprint Task:** T-63

## Overview ✅

Add an **Alfa Gift** tab within the existing Recharge module for selling Alfa data gift cards. The feature uses a simple exchange-rate spread profit model: credits cost a configurable LBP amount per USD (default 85,000 LBP/$1) and are sold at a higher rate (default ~100,000 LBP/$1), generating ~15,000 LBP profit per $1 of credit.

**Implementation Status:**

- ✅ Alfa Gift tab added to TelecomForm (Alfa provider only)
- ✅ 8 gift tiers hardcoded (1GB/$3.50 through 444GB/$129)
- ✅ Tier dropdown with auto-fill pricing
- ✅ Price field editable for manual override
- ✅ Profit calculation: `(giftAmountUsd * sellRate) - (giftAmountUsd * costRate)`
- ✅ Stock deducted from Alfa drawer
- ✅ Uses existing `RECHARGE` transaction type
- ✅ Integrated into Recharge page refactoring (March 16, 2026)

---

## Requirements Summary

| Requirement          | Detail                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| **Gift Tiers**       | 8 hardcoded tiers (1GB/$3.50 through 444GB/$129) — frontend map        |
| **Profit Model**     | Exchange rate spread: configurable cost vs sell rate in LBP per $1 USD |
| **Storage**          | All amounts in LBP in `recharges` table                                |
| **Stock**            | Deducted from Alfa drawer (USD denomination)                           |
| **Tab Placement**    | After "Days" tab: Credit \| Days \| **Alfa Gift** \| Voucher \| Top Up |
| **Provider Scope**   | Alfa only — tab hidden when MTC is selected                            |
| **Payment**          | Any configured payment method + currency                               |
| **Activity Logs**    | Uses existing `RECHARGE` transaction type (already has color mapping)  |
| **Profit Reporting** | Auto-captured by ProfitService via `SUM(price - cost)`                 |

---

## Gift Tiers

Hardcoded frontend map (tier key → USD amount):

| Tier Key | Label  | USD Amount |
| -------- | ------ | ---------- |
| `1GB`    | 1 GB   | $3.50      |
| `3GB`    | 3 GB   | $6.90      |
| `7GB`    | 7 GB   | $9.00      |
| `22GB`   | 22 GB  | $14.50     |
| `44GB`   | 44 GB  | $21.00     |
| `77GB`   | 77 GB  | $31.00     |
| `111GB`  | 111 GB | $40.00     |
| `444GB`  | 444 GB | $129.00    |

**Implementation:**

- Dropdown selection UI — user picks tier, price auto-fills
- Price field remains editable (allows manual override/discount)
- Tier map defined in `Recharge/index.tsx` (frontend only, no backend storage needed)

---

## Architecture

### How It Fits Into the Existing System

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend: Recharge Module                                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Provider Tabs: [MTC] [Alfa]                             │   │
│  │  Service Tabs: [Credit] [Days] [Alfa Gift] [Voucher] [Top Up] │
│  │                                                           │   │
│  │  Alfa Gift Tab:                                           │   │
│  │  - Tier dropdown (8 options)                              │   │
│  │  - Auto-fill price (editable)                             │   │
│  │  - Payment method + currency selector                     │   │
│  │  - Submit → backend                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Backend                                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  RechargeRepository.processRecharge()                     │   │
│  │  - Accepts type: "ALFA_GIFT"                              │   │
│  │  - Creates recharge row (carrier="Alfa", recharge_type="ALFA_GIFT") │
│  │  - cost = amount_usd * credit_cost_lbp                    │   │
│  │  - price = amount_usd * sell_rate_lbp                     │   │
│  │  - currency_code = "LBP"                                  │   │
│  │  - Deducts amount_usd from Alfa drawer (USD)              │   │
│  │  - Creates RECHARGE transaction                           │   │
│  └──────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  Database                                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  recharges table:                                         │   │
│  │  - carrier: "Alfa"                                        │   │
│  │  - recharge_type: "ALFA_GIFT"                             │   │
│  │  - amount: 3.50 (USD value of tier)                       │   │
│  │  - cost: 297,500 (LBP) = 3.50 * 85,000                    │   │
│  │  - price: 350,000 (LBP) = 3.50 * 100,000                  │   │
│  │  - currency_code: "LBP"                                   │   │
│  │  - paid_by: "CASH" (or other method)                      │   │
│  │                                                           │   │
│  │  drawer_balances table:                                   │   │
│  │  - Alfa drawer: -3.50 USD (stock deduction)               │   │
│  │  - Cash drawer: +350,000 LBP (customer payment)           │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Profit Flow

```
Customer buys 7GB gift card ($9 tier):

1. Frontend calculates:
   - amount_usd = 9.00
   - cost_lbp = 9.00 * 85,000 = 765,000 LBP
   - price_lbp = 9.00 * 100,000 = 900,000 LBP
   - profit_lbp = 135,000 LBP

2. Backend creates:
   - recharge row: carrier="Alfa", type="ALFA_GIFT", amount=9, cost=765000, price=900000, currency="LBP"
   - RECHARGE transaction: amount_lbp=900000
   - Payment entries:
     * Cash drawer: +900,000 LBP (customer payment)
     * Alfa drawer: -9 USD (stock deduction)

3. ProfitService.getSummary() automatically captures:
   - recharges.profit_lbp += SUM(price - cost) = 135,000 LBP
```

---

## Phase 1: Database & Backend

### 1.1 System Setting

**Key:** `alfa_credit_cost_lbp`
**Default:** `85000` (85,000 LBP per $1 USD credit)
**Purpose:** Configurable cost basis for Alfa gift credits. When changed, all future calculations use the new value.

**Optional Setting:** `alfa_credit_sell_rate_lbp`
**Default:** `100000` (100,000 LBP per $1 USD credit)
**Purpose:** Configurable sell rate. Can be hardcoded or made configurable.

No migration needed — settings can be seeded on first use or added to existing settings table.

### 1.2 Repository Update: `RechargeRepository.ts`

**File:** `packages/core/src/repositories/RechargeRepository.ts`

Update the `RechargeData.type` union to include `ALFA_GIFT`:

```typescript
export interface RechargeData {
  provider: "MTC" | "Alfa";
  type: "CREDIT_TRANSFER" | "VOUCHER" | "DAYS" | "TOP_UP" | "ALFA_GIFT";
  amount: number;
  cost: number;
  price: number;
  currency?: string;
  // ... rest unchanged
}
```

No logic changes needed — `processRecharge()` already handles arbitrary cost/price values and multi-currency payments.

---

## Phase 2: Frontend

### 2.1 Recharge Page: Add Alfa Gift Tab

**File:** `frontend/src/features/recharge/pages/Recharge/index.tsx`

#### A. Add `ALFA_GIFT` to `RechargeType`

```typescript
type RechargeType =
  | "CREDIT_TRANSFER"
  | "VOUCHER"
  | "DAYS"
  | "TOP_UP"
  | "ALFA_GIFT";
```

#### B. Add Gift Tiers Map

```typescript
const ALFA_GIFT_TIERS = {
  "1GB": { label: "1 GB", usd: 3.5 },
  "3GB": { label: "3 GB", usd: 6.9 },
  "7GB": { label: "7 GB", usd: 9.0 },
  "22GB": { label: "22 GB", usd: 14.5 },
  "44GB": { label: "44 GB", usd: 21.0 },
  "77GB": { label: "77 GB", usd: 31.0 },
  "111GB": { label: "111 GB", usd: 40.0 },
  "444GB": { label: "444 GB", usd: 129.0 },
} as const;
```

#### C. Add State for Gift Tab

```typescript
const [giftTierKey, setGiftTierKey] = useState<
  keyof typeof ALFA_GIFT_TIERS | ""
>("");
const [giftAmountUsd, setGiftAmountUsd] = useState("");
const [giftPriceLbp, setGiftPriceLbp] = useState("");
```

#### D. Add Alfa Gift Tab to Telecom Service Tabs

Update `TELECOM_SERVICE_TYPES` array to include the new tab:

```typescript
const TELECOM_SERVICE_TYPES = [
  { id: "CREDIT_TRANSFER", label: "Credit", icon: DollarSign },
  { id: "DAYS", label: "Days", icon: Clock },
  { id: "ALFA_GIFT", label: "Alfa Gift", icon: Zap }, // NEW
  { id: "VOUCHER", label: "Voucher", icon: CreditCard },
  { id: "TOP_UP", label: "Top Up", icon: ArrowUpCircle },
];
```

#### E. Add Alfa Gift Form Section

Render a new form section when `rechargeType === "ALFA_GIFT"`:

```tsx
{
  rechargeType === "ALFA_GIFT" && (
    <div className="bg-slate-800 rounded-2xl border border-slate-700/50 p-6">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Tier Dropdown */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
            Gift Tier
          </label>
          <Select
            value={giftTierKey}
            onChange={(val) => {
              setGiftTierKey(val);
              const tier = ALFA_GIFT_TIERS[val as keyof typeof ALFA_GIFT_TIERS];
              if (tier) {
                setGiftAmountUsd(tier.usd.toString());
                // Calculate price: usd * sell_rate (fetch from settings or use default)
                const sellRate = 100000; // or from settings
                setGiftPriceLbp((tier.usd * sellRate).toString());
              }
            }}
            options={[
              { value: "", label: "— Select Tier —" },
              ...Object.entries(ALFA_GIFT_TIERS).map(([key, tier]) => ({
                value: key,
                label: `${tier.label} - $${tier.usd}`,
              })),
            ]}
            buttonClassName="py-3 text-sm rounded-xl"
          />
        </div>

        {/* Amount (read-only preview) */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
            Credit Value (USD)
          </label>
          <input
            type="text"
            value={giftAmountUsd}
            readOnly
            className="w-full bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-white"
          />
        </div>

        {/* Price in LBP (editable) */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
            Price (LBP)
          </label>
          <input
            type="number"
            value={giftPriceLbp}
            onChange={(e) => setGiftPriceLbp(e.target.value)}
            className="w-full bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-emerald-400 font-bold focus:outline-none focus:border-emerald-500"
          />
        </div>

        {/* Profit Preview */}
        {giftAmountUsd && giftPriceLbp && (
          <div className="bg-slate-900/60 rounded-xl p-3 border border-slate-700/50">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">Profit</span>
              <span className="font-bold font-mono text-emerald-400">
                {(
                  parseFloat(giftPriceLbp) -
                  parseFloat(giftAmountUsd) * 85000
                ).toLocaleString()}{" "}
                LBP
              </span>
            </div>
          </div>
        )}

        {/* Payment Method */}
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
            Paid By
          </label>
          <Select
            value={paidBy}
            onChange={setPaidBy}
            options={methods.map((m) => ({ value: m.code, label: m.label }))}
            buttonClassName="py-3 text-sm font-bold rounded-xl"
          />
        </div>

        {/* Submit Button */}
        <button
          onClick={handleAlfaGiftSubmit}
          disabled={isSubmitting || !giftTierKey}
          className="w-full py-4 rounded-xl font-bold text-lg text-white shadow-lg bg-red-600 hover:bg-red-500"
        >
          {isSubmitting ? "Processing..." : "Confirm Alfa Gift Sale"}
        </button>
      </div>
    </div>
  );
}
```

#### F. Add Submit Handler

```typescript
const handleAlfaGiftSubmit = useCallback(async () => {
  if (!giftTierKey || !giftAmountUsd || !giftPriceLbp) {
    alert("Please select a tier and confirm the price");
    return;
  }

  const amountUsd = parseFloat(giftAmountUsd);
  const priceLbp = parseFloat(giftPriceLbp);
  const costRate = 85000; // or fetch from settings
  const costLbp = amountUsd * costRate;

  try {
    await window.api.recharge.process({
      provider: "Alfa",
      type: "ALFA_GIFT",
      amount: amountUsd,
      cost: costLbp,
      price: priceLbp,
      currency: "LBP",
      paid_by_method: paidBy,
      // Multi-payment support if needed
      payments: [
        {
          method: paidBy,
          currencyCode: "LBP",
          amount: priceLbp,
        },
      ],
    });

    // Reset form
    setGiftTierKey("");
    setGiftAmountUsd("");
    setGiftPriceLbp("");
  } catch (error) {
    alert("Failed to process Alfa Gift sale");
  }
}, [giftTierKey, giftAmountUsd, giftPriceLbp, paidBy]);
```

### 2.2 Settings: Add Alfa Credit Cost Configuration

**Option A:** Add to `ModulesManager.tsx` (when Alfa/recharge module is enabled)
**Option B:** Add to `ShopConfig.tsx` (general shop settings)

**Recommended:** Option B — simpler, no module dependency.

**File:** `frontend/src/features/settings/pages/Settings/ShopConfig.tsx`

Add two new fields:

```typescript
const [alfaCreditCost, setAlfaCreditCost] = useState("85000");
const [alfaCreditSellRate, setAlfaCreditSellRate] = useState("100000");

// Load on mount
useEffect(() => {
  const loadSettings = async () => {
    const settings = await window.api.settings.getAll();
    setAlfaCreditCost(settings.alfa_credit_cost_lbp?.toString() || "85000");
    setAlfaCreditSellRate(
      settings.alfa_credit_sell_rate_lbp?.toString() || "100000",
    );
  };
  loadSettings();
}, []);

// Save on config save
const handleSave = async () => {
  await window.api.settings.update("alfa_credit_cost_lbp", alfaCreditCost);
  await window.api.settings.update(
    "alfa_credit_sell_rate_lbp",
    alfaCreditSellRate,
  );
  // ... rest of save logic
};
```

Render UI:

```tsx
<div className="grid grid-cols-2 gap-4">
  <div>
    <label className="block text-xs font-medium text-slate-400 mb-1.5">
      Alfa Credit Cost (LBP per $1)
    </label>
    <input
      type="number"
      value={alfaCreditCost}
      onChange={(e) => setAlfaCreditCost(e.target.value)}
      className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
    />
  </div>
  <div>
    <label className="block text-xs font-medium text-slate-400 mb-1.5">
      Alfa Credit Sell Rate (LBP per $1)
    </label>
    <input
      type="number"
      value={alfaCreditSellRate}
      onChange={(e) => setAlfaCreditSellRate(e.target.value)}
      className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white"
    />
  </div>
</div>
```

---

## Phase 3: Integration Verification

### 3.1 Profit Service Verification

**File:** `packages/core/src/services/ProfitService.ts`

**No changes needed.** The existing `getSummary()` and `getByModule()` methods already query:

```sql
SELECT
  currency_code,
  COALESCE(SUM(price), 0) AS revenue,
  COALESCE(SUM(cost), 0) AS cost,
  COALESCE(SUM(price - cost), 0) AS profit,
  COUNT(*) AS count
FROM recharges
WHERE created_at >= ? AND created_at <= ?
GROUP BY currency_code
```

Since Alfa Gift rows use `currency_code = "LBP"`, they will automatically be included in `recharges.profit_lbp`.

### 3.2 Activity Log Verification

**File:** `frontend/src/features/settings/pages/Settings/ActivityLogViewer.tsx`

**No changes needed.** Alfa Gift uses the existing `RECHARGE` transaction type, which already has:

- Color mapping: `RECHARGE: "text-purple-400"`
- Included in `TRANSACTION_TYPES` filter array
- Included in `ACTIONABLE_TYPES` (void/refund buttons show)

---

## Files Summary

### Files to Modify (3)

| File                                                           | Change                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------- |
| `frontend/src/features/recharge/pages/Recharge/index.tsx`      | Add `ALFA_GIFT` type, gift tiers map, gift tab UI, submit handler   |
| `packages/core/src/repositories/RechargeRepository.ts`         | Add `"ALFA_GIFT"` to `RechargeData.type` union                      |
| `frontend/src/features/settings/pages/Settings/ShopConfig.tsx` | Add `alfa_credit_cost_lbp` and `alfa_credit_sell_rate_lbp` settings |

### No New Files Needed

All functionality uses existing infrastructure — no new repositories, services, handlers, or tables required.

---

## Testing Checklist

- [ ] Alfa Gift tab only visible when Alfa provider is selected (hidden for MTC)
- [ ] Tier dropdown shows all 8 tiers with correct labels and USD amounts
- [ ] Selecting a tier auto-fills amount (read-only) and price (editable)
- [ ] Price field can be manually overridden
- [ ] Profit preview shows correct calculation: `price - (amount * cost_rate)`
- [ ] Submit creates recharge row with `carrier="Alfa"`, `recharge_type="ALFA_GIFT"`, `currency_code="LBP"`
- [ ] Alfa drawer balance decreases by USD amount (stock deduction)
- [ ] Payment drawer balance increases by LBP price (customer payment)
- [ ] Transaction created with type `RECHARGE`
- [ ] Profit page shows LBP profit from Alfa Gift sales
- [ ] Activity log shows transaction with purple "RECHARGE" label
- [ ] Settings persist `alfa_credit_cost_lbp` and `alfa_credit_sell_rate_lbp`
- [ ] Changing cost rate immediately affects new sales (existing rows unchanged)

---

## Deferred / Future Enhancements

- **Custom gift amounts**: Allow manual USD amount entry (not limited to predefined tiers)
- **MTC gift cards**: If MTC introduces similar gift products, replicate the feature
- **Gift card inventory tracking**: Track physical gift card serials if needed
- **Bulk gift card purchases**: Discount tiers for large purchases
- **Gift card sales reporting**: Separate breakdown for gift vs regular recharges

(End of document)
