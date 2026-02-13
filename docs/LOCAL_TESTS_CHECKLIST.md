# Local Tests Checklist - Desktop & Web Mode

**Last Updated:** Feb 1, 2026  
**Purpose:** Comprehensive testing checklist for both Desktop (Electron) and Web modes after T-20 Phase 1 migration completion.

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
- [ ] Paid By selector works (Select component)
- [ ] Process recharge transaction
- [ ] Stock updates after transaction

### Web Mode:

- [ ] Stock loads (via `/api/recharge/stock`)
- [ ] Paid By Select component works
- [ ] Process recharge (via POST `/api/recharge/process`)
- [ ] Verify transaction saved

---

## 💳 9. Debts Management

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
  - [ ] Recent activity loads with limit
  - [ ] Activity displays correctly

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

---

## 📝 Test Results Log

**Tester:** ********\_********  
**Date:** ********\_********  
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
