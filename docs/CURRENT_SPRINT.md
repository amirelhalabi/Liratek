# Current Sprint (Dec 19–Dec 26, 2025)

Goal: Type-safe cross-layer contracts, UI polish (services/exchange), and event/logging consistency.

In Progress
- ProductRepository/Inventory typing propagation via InventoryService and UI
- Debts/Dashboard end-to-end typing in electron.d.ts and UI
- Reduce no-explicit-any: UI hotspots, preload edges, Sales/Client repositories

Ready for Testing
- Maintenance hooks cleanup (avoid set-state-in-effect)

Completed
- appEvents: typed overloads with generic fallback (keeps tests like "ping")
- Preload typing pass: Inventory, Clients, Debt, Exchange, OMT, Closing payloads
- Activity logs: unified to details_json across repositories (FinancialService, Exchange, Recharge, Maintenance)
- Services/Exchange layout: constrained cards to max-h-[80vh], reduced padding
- Debts/Dashboard: introduced concrete DTO types; tooltip formatter typed
- ClientForm: normalized whatsapp_opt_in to 0/1 and separated create/update payloads

Checks
- Lint/Typecheck/Tests/Coverage run daily; gate merges on passing status.

Notes
- Quotation template updated to reflect $1000 developer total (excluding hardware).

Checks
- Lint/Typecheck/Tests/Coverage run daily; gate merges on passing status.

Notes
- Quotation template updated to reflect $1000 developer total (excluding hardware).
