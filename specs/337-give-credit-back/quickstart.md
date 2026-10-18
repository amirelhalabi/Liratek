# Quickstart: verify give credit back (LIRA-337)

## Automated (affected paths only)

```bash
yarn workspace @liratek/core jest src/utils/__tests__/lineGiveBack.test.ts src/services/__tests__/ResaleLineService.giveBack.test.ts
yarn workspace @liratek/frontend jest src/features/phoneLines
yarn workspace @liratek/backend jest src/api/__tests__/resaleLines
```

Expected: the worked example gives credit $9.00, shop line +$5.68, drawer +$5.68, price $18.30, cost $14.32. Void returns every figure to its prior value, so the drawer and shop line net to $0.00.

## Manual (web test tenant)

1. Inventory: create a line product in a lines category, cost $20, price $25. On Phone Lines → Edit, set carrier MTC and credit $15.
2. Check that an active MTC shop line exists and note its credit.
3. Phone Lines → For sale → **Give credit back**. Enter "keeps 9" and keep 100,000 LBP. The preview shows send $5.68, fee $0.32, price $18.30.
4. Save. The row shows $9 credit and the new price. The shop line shows +$5.68. Transactions shows a "Give credit back" entry.
5. Void that entry. The line returns to $15 / $25 / $20, and the shop line returns to its earlier credit.
