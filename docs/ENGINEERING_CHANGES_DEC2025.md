# Engineering Plan (Dec 2025)

Use this as a planning reference for current TODOs. Completed items removed for focus.

Planned Work (Prioritized)

1. ProductRepository and Inventory typing

- Define row interfaces: ProductDTO (search results), LowStockProduct, CategoryRow.
- Propagate types through InventoryService and into UI (ProductList, ProductForm) to eliminate any.
- Align preload inventory methods to these shapes.

2. Debts and Dashboard end-to-end typing

- Type electron.d.ts methods: getDebtors, getClientDebtHistory, getClientDebtTotal, getDebtSummary.
- Replace remaining any in Dashboard (tooltip inputs/derived data), ensure TodaySale/ChartPoint are used end-to-end.

3. appEvents typed map with fallback

- Add typed overloads for: notification:show/history, sale:completed, debt:repayment, inventory:updated, closing/opening events.
- Keep generic on/emit(event: string, ...) fallback for custom and test events (e.g., "ping").

4. Preload typing pass (quick wins)

- Inventory: createProduct/updateProduct payloads; getProductByBarcode return type.
- Clients: createClient/updateClient payloads.
- OMT: addOMTTransaction payload typed to Services UI.
- Exchange: addExchangeTransaction payload; getExchangeHistory rows.
- Maintenance: getMaintenanceJobs rows.

5. React hooks cleanup (remaining)

- Maintenance: avoid set-state-in-effect with microtask or event-driven trigger.
- Clear remaining exhaustive-deps warnings in minor pages.

6. Reduce high-signal no-explicit-any

- UI: Closing.tsx, Dashboard.tsx edges, Settings pages.
- Preload: remaining any signatures.
- Services/Repositories: add return row types in SalesRepository and ClientRepository.

Timeline

- Day 1: ProductRepository typing + InventoryService/UI + preload inventory/clients.
- Day 2: Debts/Dashboard e2e typing + preload OMT/Exchange + appEvents typed map.
- Day 3: Maintenance hooks + remaining any reductions + doc sync.

Risks / Notes

- Converting handler requires to imports can affect startup timing; prefer localized suppressions where needed.
- appEvents strict typing may require call-site updates; fallback ensures no breakage.
