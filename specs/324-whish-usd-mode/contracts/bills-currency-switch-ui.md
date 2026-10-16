# Contract — Whish App Bills currency switch (UI)

**Where**: Recharge → Whish App → Bills, next to the existing Transfer | Bills toggle (same segmented style). Not shown on iPick, Katsh, OMT App, Binance, or Whish App → Transfer.

**Control**: two options `LBP` | `USD`; selected option highlighted; accessible name "Currency".

**Default / memory**: first visit on a device → `LBP`. The last choice is remembered on that device (`liratek:whish-bills-currency`); unreadable storage → `LBP`.

**Grid**:
- LBP: items where `isLbpSellable`; cards show `Cost: 1,234,000 LBP`, `Sell: … LBP` (today).
- USD: items where `isUsdSellable`; cards show `Cost: $10.00`, `Sell: $10.00`; same names, images, product-line order.
- Empty state in USD (shop has no USD prices yet): "No Whish App items have a USD price yet. Add USD prices in Settings → Mobile Services."

**Switching with items selected**: dialog "Switching to USD clears the 2 selected items. Continue?" → Continue empties the selection and switches; Cancel keeps everything as it was.

**Payment window**: total shown and entered in the active currency (`totalAmountCurrency` = active currency); paying in the other currency uses the shop rate exactly as other USD/LBP sales do.

**Settings → Mobile Services** (all providers' editor, used for WHISH_APP): two extra fields "Cost (USD)" and "Sell (USD)" in the edit row and the add form; row summary shows the USD pair when set (e.g. `$10.00 / $10.00`).
