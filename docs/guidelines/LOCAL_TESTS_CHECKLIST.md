# Local Tests Checklist - Desktop & Web Mode

**Last Updated:** Feb 15, 2026  
**Purpose:** Comprehensive testing checklist for both Desktop (Electron) and Web modes.

---

## 🎯 Testing Approach

### Test Environments:

- **Desktop Mode:** Electron app (`npm run dev`)
- **Web Mode:** Browser + Backend server (`npm run dev:web`)

### Coverage:

- ✅ All migrated features (59 API calls across 23 files)
- ✅ Real-time updates (WebSocket)
- ✅ Electron-only features (Desktop only)

---

## 🔐 1. Authentication & Session Management

### Desktop Mode:

- [ ] Login with valid credentials
  - [ ] Session persists after app restart (restoreSession)
  - [ ] "Remember Me" functionality works
- [ ] Login with invalid credentials (error handling)
- [ ] Logout functionality
- [ ] Session token stored in localStorage
- [ ] Opening balance prompt shows after first login

### Web Mode:

- [ ] Login with valid credentials
  - [ ] Session cookie/token works
  - [ ] "Remember Me" functionality works
- [ ] Login with invalid credentials (error handling)
- [ ] Logout functionality
- [ ] Session persists on page refresh
- [ ] Opening balance prompt shows after first login

**Critical:** Session restore is Electron-specific - web mode uses standard session cookies.

---

## 📊 2. Dashboard

### Desktop Mode:

- [ ] Dashboard loads without errors
- [ ] All statistics display correctly:
  - [ ] Today's sales total
  - [ ] Drawer balances (General, OMT, Whish, Binance)
  - [ ] Low stock alerts
  - [ ] Profit/Sales chart
  - [ ] Monthly P&L
- [ ] Real-time updates when sale is processed

### Web Mode:

- [ ] Dashboard loads without errors
- [ ] All statistics display correctly
- [ ] Real-time updates via WebSocket when sale is processed
- [ ] Chart renders properly
- [ ] No console errors

---

## 💰 3. Sales / POS

### Desktop Mode:

- [ ] Product search works
- [ ] Add products to cart
- [ ] Checkout modal opens
- [ ] Client search/selection works
- [ ] Payment methods (CASH, OMT, WHISH, BINANCE)
- [ ] Multiple payment lines
- [ ] Process sale successfully
- [ ] Receipt preview generation
- [ ] Draft save/resume functionality
- [ ] Drafts list loads

### Web Mode:

- [ ] Product search works (via `/api/inventory/products`)
- [ ] Add products to cart
- [ ] Checkout modal opens
- [ ] Client search works (via `/api/clients`)
- [ ] Payment processing works
- [ ] Sale completes successfully
- [ ] Draft save/resume functionality
- [ ] Verify sale appears in database

---

## 👥 4. Clients Management

### Desktop Mode:

- [ ] Client list loads
- [ ] Search clients by name/phone
- [ ] Create new client
- [ ] Edit existing client
- [ ] Delete client
- [ ] View client details

### Web Mode:

- [ ] Client list loads (via `/api/clients`)
- [ ] Search functionality works
- [ ] Create new client (via POST `/api/clients`)
- [ ] Edit client (via PUT `/api/clients/:id`)
- [ ] Delete client (via DELETE `/api/clients/:id`)
- [ ] All CRUD operations successful

---

## 📦 5. Inventory Management

### Desktop Mode:

- [ ] Product list loads with search
- [ ] Create new product
- [ ] Edit product (including category via Select component)
- [ ] Delete product
- [ ] Stock levels display correctly
- [ ] Low stock warnings (if configured)

### Web Mode:

- [ ] Product list loads (via `/api/inventory/products`)
- [ ] Search works with debounce
- [ ] Create product (via POST `/api/inventory/products`)
- [ ] Edit product (via PUT `/api/inventory/products/:id`)
- [ ] Delete product (via DELETE `/api/inventory/products/:id`)
- [ ] Custom Select component works (no dropdown alignment issues)

---

## 💸 6. Expenses

### Desktop Mode:

- [ ] Today's expenses load
- [ ] Category selector works (via Select component)
- [ ] Type selector (Cash Out / Non-Cash) works
- [ ] Paid By selector works
- [ ] Add new expense
- [ ] Delete expense
- [ ] Expenses display with correct totals

### Web Mode:

- [ ] Expenses load (via `/api/expenses/today`)
- [ ] All Select components work properly
- [ ] Add expense (via POST `/api/expenses`)
- [ ] Delete expense (via DELETE `/api/expenses/:id`)
- [ ] No dropdown alignment issues

---

## 💱 7. Exchange

### Desktop Mode:

- [ ] Currency list loads
- [ ] Exchange rates load
- [ ] From/To currency selection works
- [ ] Amount calculation accurate
- [ ] Client selection optional
- [ ] Process exchange transaction
- [ ] Transaction history displays

### Web Mode:

- [ ] Currencies load (via `/api/currencies`)
- [ ] Rates load (via `/api/rates`)
- [ ] Currency Select components work
- [ ] Exchange calculation correct
- [ ] Process transaction (via POST `/api/exchange/transactions`)
- [ ] History loads (via `/api/exchange/history`)

---

## 📱 8. Recharge

### Desktop Mode:

- [ ] Provider selection (MTC/Alfa)
- [ ] Recharge type selection
- [ ] Stock levels display
- [ ] Paid By selector works (Select component — includes CASH, OMT, WHISH, BINANCE, DEBT)
- [ ] Process recharge transaction
- [ ] Stock updates after transaction
- [ ] Voucher image displays on item (if image uploaded)
- [ ] Cost auto-fills from saved `item_costs` data
- [ ] DEBT payment creates debt entry for selected client

### Web Mode:

- [ ] Stock loads (via `/api/recharge/stock`)
- [ ] Paid By Select component works
- [ ] Process recharge (via POST `/api/recharge/process`)
- [ ] Verify transaction saved
- [ ] Item costs load (via GET `/api/item-costs`)
- [ ] Save item cost (via POST `/api/item-costs`)
- [ ] Voucher images load (via GET `/api/voucher-images`)
- [ ] Upload voucher image (via POST `/api/voucher-images`)
- [ ] Delete voucher image (via DELETE `/api/voucher-images/:id`)

### Financial Services (IPEC/Katch/WishApp):

- [ ] IPEC/Katch/WishApp: select item from mobileServices.json → cost auto-fills if saved
- [ ] IPEC/Katch/WishApp: enter cost + price → profit displays correctly
- [ ] IPEC/Katch/WishApp: submit with CASH → provider drawer decreases by cost, General drawer increases by price
- [ ] IPEC/Katch/WishApp: submit with DEBT → provider drawer decreases by cost, debt_ledger shows price, client appears on Debts page
- [ ] IPEC/Katch/WishApp: "Custom" item → free-form amount works, no item_key saved
- [ ] Voucher image: upload image for an item → displays on next sale of that item
- [ ] Cost auto-save: first sale of new item with cost → item_costs record created
- [ ] Cost auto-save: second sale of same item → cost auto-fills from saved value
- [ ] Supplier owed amounts reflect actual cost, not price
- [ ] OMT/WHISH: existing SEND/RECEIVE flow unchanged (no regression)

---

## �️ 8b. Custom Services

### Desktop Mode:

- [ ] Custom services page loads
- [ ] Add a new service (description, cost, price, payment method)
- [ ] Profit calculates automatically (price − cost)
- [ ] Client selection works (optional)
- [ ] DEBT payment requires client selection
- [ ] Delete a service
- [ ] Today's summary stats display
- [ ] Filter by date works

### Web Mode:

- [ ] Services load (via GET `/api/custom-services`)
- [ ] Create service (via POST `/api/custom-services`) with Zod validation
- [ ] Get single service (via GET `/api/custom-services/:id`)
- [ ] Delete service (via DELETE `/api/custom-services/:id`)
- [ ] Summary loads (via GET `/api/custom-services/summary`)
- [ ] Date filtering works (via `?date=YYYY-MM-DD` query)
- [ ] Validation errors display for missing/invalid fields

---

## 📊 8c. Profits Module (Admin Only)

### Desktop Mode:

- [ ] Profits page loads (admin only — non-admin cannot access)
- [ ] Date range picker works (from/to)
- [ ] Tab 1 — Overview: total profit summary displays
- [ ] Tab 2 — By Module: breakdown per module (POS, Recharge, etc.)
- [ ] Tab 3 — By Date: daily profit trend chart/table
- [ ] Tab 4 — By Payment Method: breakdown by CASH, OMT, etc.
- [ ] Tab 5 — By Cashier: per-user profit breakdown
- [ ] Tab 6 — By Client: top clients by profit (limit configurable)

### Web Mode:

- [ ] Summary loads (via GET `/api/profits/summary?from=...&to=...`)
- [ ] By module loads (via GET `/api/profits/by-module?from=...&to=...`)
- [ ] By date loads (via GET `/api/profits/by-date?from=...&to=...`)
- [ ] By payment method loads (via GET `/api/profits/by-payment-method?from=...&to=...`)
- [ ] By user loads (via GET `/api/profits/by-user?from=...&to=...`)
- [ ] By client loads (via GET `/api/profits/by-client?from=...&to=...&limit=20`)
- [ ] Non-admin users get 403 Forbidden

---

## 📋 8d. Transactions & Reports

### Desktop Mode:

- [ ] Activity Log Viewer (Settings) loads recent transactions
- [ ] Transaction list filters by type, status, date range
- [ ] Reports page loads
- [ ] Reports: daily summaries display for date range
- [ ] Reports: client history shows transaction trail
- [ ] Reports: revenue by module breakdown
- [ ] Reports: overdue debts list

### Web Mode:

- [ ] Recent transactions load (via GET `/api/transactions/recent`)
- [ ] Single transaction loads (via GET `/api/transactions/:id`)
- [ ] Client transactions load (via GET `/api/transactions/client/:clientId`)
- [ ] Void transaction works (via POST `/api/transactions/:id/void`)
- [ ] Refund transaction works (via POST `/api/transactions/:id/refund`)
- [ ] Daily summary loads (via GET `/api/transactions/analytics/daily-summary?date=...`)
- [ ] Debt aging loads (via GET `/api/transactions/analytics/debt-aging/:clientId`)
- [ ] Overdue debts load (via GET `/api/transactions/analytics/overdue-debts`)
- [ ] Revenue by type loads (via GET `/api/transactions/analytics/revenue-by-type?from=...&to=...`)
- [ ] Revenue by user loads (via GET `/api/transactions/analytics/revenue-by-user?from=...&to=...`)
- [ ] Report: daily summaries (via GET `/api/transactions/reports/daily-summaries?from=...&to=...`)
- [ ] Report: client history (via GET `/api/transactions/reports/client-history/:clientId`)
- [ ] Report: revenue by module (via GET `/api/transactions/reports/revenue-by-module?from=...&to=...`)

---

## 📤 8e. Table Export (All Pages)

### Both Modes:

- [ ] ExportBar component appears on data tables
- [ ] Excel export downloads `.xlsx` file with correct data
- [ ] PDF export downloads `.pdf` file with correct data
- [ ] Export respects current date filters / search
- [ ] Export works on all 24 table instances across the app

---

## �💳 9. Debts Management

### Desktop Mode:

- [ ] Debtors list loads
- [ ] Filter: Ongoing/Closed/All (Select component works)
- [ ] Client debt history displays
- [ ] Eye icon opens sale details modal
  - [ ] Sale info displays correctly
  - [ ] Items list shows products with prices
  - [ ] Amounts display: paid*usd, paid_lbp (not payment*\*)
  - [ ] LBP shows "-" when 0
  - [ ] USD shows "-" when 0
- [ ] Add repayment
- [ ] Mark debt as closed
- [ ] "Service Debt" entries appear correctly on Debts page
- [ ] Repaying a Service Debt updates drawer + clears debt

### Web Mode:

- [ ] Debtors load (via `/api/debts/debtors`)
- [ ] Filter Select component works
- [ ] Client debt history loads (via `/api/debts/:clientId/history`)
- [ ] **Eye icon works** (via `/api/sales/:id` and `/api/sales/:id/items`) ✅ Fixed today
- [ ] Sale details modal displays correctly
- [ ] Add repayment (via POST `/api/debts/repayments`)

---

## 🔒 10. Closing / Opening

### Desktop Mode:

- [ ] Opening modal shows on first login
- [ ] All drawer amounts can be entered
- [ ] Currency amounts for each drawer
- [ ] Set opening balances
- [ ] Closing modal shows system expected vs physical
- [ ] Variance alerts display correctly
- [ ] Complete closing process
- [ ] Closing report generates (PDF)

### Web Mode:

- [ ] Opening modal works (via POST `/api/closing/opening-balances`)
- [ ] Closing process works (via POST `/api/closing/daily-closing`)
- [ ] System expected balances load (via `/api/closing/system-expected-balances`)
- [ ] Daily stats snapshot retrieval
- [ ] Closing report generation
- [ ] Update closing with report path

---

## ⚙️ 11. Settings

### Desktop Mode:

- [ ] **Currency Manager**
  - [ ] List currencies
  - [ ] Add new currency
  - [ ] Toggle active/inactive
  - [ ] Delete currency
- [ ] **Notifications Config**
  - [ ] Settings load
  - [ ] Update poll interval
  - [ ] Toggle low stock warnings
  - [ ] Toggle drawer limit warnings
  - [ ] Auto-backup settings
- [ ] **Drawer Config**
  - [ ] Load drawer limits
  - [ ] Update General drawer limit
  - [ ] Update OMT drawer limit
  - [ ] Update variance threshold
- [ ] **Supplier Ledger**
  - [ ] Suppliers list loads
  - [ ] Supplier balances display
  - [ ] View ledger for supplier
  - [ ] Create new supplier
  - [ ] Add ledger entry (TOP_UP/PAYMENT/ADJUSTMENT)
  - [ ] Drawer selection works (if withdrawing)
- [ ] **Users Manager**
  - [ ] Non-admin users list
  - [ ] Create new user with role Select
  - [ ] Toggle user active/inactive
  - [ ] Change user role
  - [ ] Set user password
- [ ] **Rates Manager**
  - [ ] Rates list loads
  - [ ] Set/update exchange rate
- [ ] **Activity Log Viewer**
  - [ ] Recent transactions load (unified `transactions` table)
  - [ ] Filter by type, status, date range
  - [ ] Void/refund actions work
  - [ ] Activity displays with correct amounts and summaries
- [ ] **Integrations Config**
  - [ ] WhatsApp integration settings load
  - [ ] Test WhatsApp message button works

### Web Mode:

- [ ] **All Settings pages work via:**
  - Currencies: `/api/currencies/*`
  - Settings: `/api/settings/*`
  - Suppliers: `/api/suppliers/*`
  - Users: `/api/users/*`
  - Rates: `/api/rates/*`
  - Activity: `/api/activity/*`
- [ ] All Select components work without alignment issues
- [ ] CRUD operations successful
- [ ] No console errors

---

## 🎨 12. UI Components (Both Modes)

### Custom Select Component (Headless UI):

- [ ] Dropdown opens on click
- [ ] Dropdown list perfectly aligns with button (no offset to left)
- [ ] Selected item shows checkmark
- [ ] Hover states work
- [ ] Keyboard navigation works
- [ ] No focus ring/outline issues
- [ ] Chevron icon rotates on open/close
- [ ] Works in all pages:
  - [ ] Debts filter
  - [ ] Recharge Paid By
  - [ ] Expenses (Category, Type, Paid By)
  - [ ] Inventory Category
  - [ ] Settings pages (multiple)

### Notifications:

- [ ] Top bar notifications display
- [ ] Low stock warnings
- [ ] Drawer limit warnings
- [ ] Success/error messages

---

## 🔄 13. Real-Time Updates (WebSocket)

### Desktop Mode:

- [ ] Not applicable (uses Electron IPC events)

### Web Mode:

- [ ] WebSocket connects on login
  - Check browser console for: `socket.io connection established`
- [ ] WebSocket disconnects on logout
- [ ] Real-time events work:
  - [ ] `sales:processed` - Dashboard updates when sale completes
  - [ ] Dashboard stats refresh automatically
- [ ] Reconnection works if connection drops
- [ ] No WebSocket errors in console

**How to Test:**

1. Open two browser windows
2. Window 1: Dashboard
3. Window 2: POS - Process a sale
4. Window 1: Dashboard should update automatically (no refresh needed)

---

## 🖥️ 14. Electron-Only Features (Desktop Mode Only)

These should NOT work in web mode:

### Updates Panel (Settings > Updates):

- [ ] Check for updates button
- [ ] Download update
- [ ] Install update
- [ ] Update status displays

### Diagnostics (Settings > Diagnostics):

- [ ] Database backup
- [ ] Database restore
- [ ] View backups list
- [ ] Delete backup
- [ ] File operations work

**Expected in Web Mode:** These features gracefully fail or are hidden.

---

## 🐛 15. Error Handling

### Desktop Mode:

- [ ] Network errors show user-friendly messages
- [ ] Invalid input validation
- [ ] Electron IPC errors handled

### Web Mode:

- [ ] 401 Unauthorized redirects to login
- [ ] 404 Not Found shows appropriate error
- [ ] 500 Server Error shows error message
- [ ] Network timeout handling
- [ ] API errors display clearly

---

## 🔍 16. Console & Network Inspection

### Desktop Mode:

- [ ] Open DevTools (Ctrl+Shift+I / Cmd+Opt+I)
- [ ] No console errors during normal operation
- [ ] No uncaught promise rejections
- [ ] Electron IPC messages working

### Web Mode:

- [ ] Open browser DevTools
- [ ] Network tab shows:
  - [ ] API calls to correct endpoints
  - [ ] WebSocket connection established
  - [ ] No 404s for expected resources
- [ ] Console shows:
  - [ ] No errors during normal operation
  - [ ] WebSocket events logging (if debug enabled)
- [ ] Application tab:
  - [ ] Session tokens stored correctly
  - [ ] LocalStorage has expected data

---

## 📈 17. Performance

### Both Modes:

- [ ] Pages load within 2 seconds
- [ ] Search has debounce (not instant)
- [ ] Large lists paginate or virtualize
- [ ] No memory leaks (check Task Manager after 30 min use)
- [ ] Smooth animations (Select dropdowns, modals)

---

## 💱 19. Dynamic Currencies & Modules

### Both Modes:

- [ ] New currencies can be added via Settings > Currency Manager without code changes
- [ ] All currency dropdowns load from the database
- [ ] Currency symbols and formatting come from DB data
- [ ] Financial services accept any active currency
- [ ] Exchange module works with any currency pair
- [ ] Modules can be toggled on/off from Settings > Modules tab
- [ ] System modules (Dashboard, Settings, Closing) cannot be toggled
- [ ] Sidebar reflects module enablement dynamically
- [ ] Closing system works with dynamic currency list
- [ ] Dashboard shows data for all active currencies
- [ ] Reports format all currencies correctly
- [ ] `useExchangeRate()` hook loads rate from DB, falls back to constant
- [ ] Drawer currency config filters Dashboard, Closing, and Opening correctly
- [ ] Drawer currency assignments editable in Settings > Currencies & Rates
- [ ] Regression: existing USD/LBP workflows unaffected

---

## 🔌 20. API Validation

### Web Mode (Postman/Thunder Client):

- [ ] Test each endpoint with valid payloads — 200/201 responses
- [ ] Verify error messages are helpful and field-specific on invalid input
- [ ] Test edge cases (empty strings, negative numbers, invalid enums)
- [ ] Verify existing functionality still works after validation changes

---

## ✅ 18. Final Verification

### Desktop Mode Checklist:

- [ ] All features work
- [ ] Electron-specific features work
- [ ] No regressions from migration
- [ ] App feels responsive

### Web Mode Checklist:

- [ ] Login/logout works
- [ ] All migrated features work (59 API calls)
- [ ] WebSocket real-time updates work
- [ ] No window.api errors in console
- [ ] Select components work perfectly
- [ ] Electron-only features gracefully disabled

### Both Modes:

- [ ] Build succeeds (`npm run build`)
- [ ] Tests pass (`npm test`)
- [ ] No TypeScript errors
- [ ] Documentation updated

---

## 🎯 Critical Test Cases (Must Pass)

1. **✅ Desktop App Works** - No regressions
2. **✅ Web Mode Works** - All business logic functional
3. **✅ Debts Eye Icon** - Sale details display (Fixed Feb 1)
4. **✅ Select Dropdowns** - No alignment issues (Fixed Feb 1)
5. **✅ WebSocket Updates** - Real-time dashboard refresh
6. **✅ Authentication** - Both modes handle sessions correctly
7. **✅ Settings Pages** - All CRUD operations work
8. **✅ Custom Services** - Full CRUD + debt support
9. **✅ Profits Module** - All 6 tabs load (admin only)
10. **✅ Transactions/Reports** - Unified ledger queries work
11. **✅ Table Export** - Excel/PDF on all data tables
12. **✅ Voucher Images** - Upload/display per recharge item

---

## 📝 Test Results Log

**Tester:** **\*\*\*\***\_**\*\*\*\***  
**Date:** **\*\*\*\***\_**\*\*\*\***  
**Mode Tested:** Desktop / Web (circle one)

### Issues Found:

| Issue # | Severity | Description | Status |
| ------- | -------- | ----------- | ------ |
| 1       |          |             |        |
| 2       |          |             |        |
| 3       |          |             |        |

### Overall Status:

- [ ] **PASS** - Ready for production
- [ ] **FAIL** - Critical issues found
- [ ] **PARTIAL** - Non-critical issues found

**Notes:**

---

**End of Checklist**
