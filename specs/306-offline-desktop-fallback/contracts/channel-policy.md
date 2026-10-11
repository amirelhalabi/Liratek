# Contract — desktop channel policy (414 existing channels + 8 new `offline:*` = 422)

Source of truth at implement time: `packages/core/src/offline/channelPolicy.ts`, generated from this list and guarded by
`channelPolicy.complete.test.ts` (every registered channel classified exactly once). Inventory taken 2026-10-11 from
`electron-app/handlers/*.ts` (45 files, 414 `ipcMain.handle` registrations, no dynamic names; 115 more in `__tests__`).

| Class | Count | Offline-mode behaviour |
| --- | --- | --- |
| `offline` | 70 | runs on the working copy; write + event in one transaction (R1) |
| `checkpoint` | 7 | runs on the working copy; event recorded; **held** on replay (N8) |
| `online_only` | 106 | refused: `{ success:false, code:"OFFLINE_NOT_AVAILABLE", error:"Not available while offline — do this on the web app when the internet is back" }` |
| `local` | 24 (16 existing + 8 new `offline:*`, see `ipc-offline.md`) | runs; never recorded (sign-in bookkeeping, print, dialogs, voice, offline controls) |
| `read` | 215 | runs under the write guard; any write it attempts is refused and logged (FR-036) |

Changes vs the raw inventory: `voucher:create` → `online_only` (O-new-6); `voucher:cancel` → `online_only` too (O-impl-C-1, 2026-10-11 — counts now 70 offline / 106 online-only / 7 checkpoint = 77 recordable). Classes for channels N2 does not name
(drawer top-up / cash-out / transfer, hold money, warranty claims, debt write-off, carrier-line usage, admin deletes,
`*:update-metadata` edits) follow O-new-11 (offline-allowed: they are till actions on the shop's own money/records).
Catalog channels (`inventory:create/update/delete-product`, batch edits, categories, product suppliers) are
`online_only` (O-new-9).

"Schema today": `core X` = already a shared core schema; `HAND-WRITTEN` / `NONE` = must be lifted to core before the
channel can record events (rule 23); these 23 form the policy's `pendingLift` list, which must be empty before release. "Ids" = id positions found today (positional args become named keys via
`argNames`). "Time" = original-time field accepted today (optional and normally empty) — replay relies on `effectiveNow` for every
channel regardless (R11).


## `offline` (70)

| Channel | Handler | Roles | Schema today | Ids | Time | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `carrier-lines:record-usage` | `handlers/carrierLineHandlers.ts:195` | [admin, staff] | RecordCarrierLineUsageSchema (core recordCarrierLineUsageSchema) | carrierLineId | no | Line usage (operator reads SIM balance and records consumption) — writes the Line_Usage expense; decided `offline` (O-new-11), not a checkpoint |
| `carrier-lines:mark-owed-delivery-sent` | `handlers/carrierLineHandlers.ts:318` | [admin, staff] | MarkCarrierLineOwedDeliverySentSchema (core markCarrierLineOwedDeliverySentSchema) | deliveryId | no | Marks an owed credit delivery as sent (state transition on existing row deliveryId) |
| `clients:create` | `handlers/clientHandlers.ts:40` | [admin, staff] | ClientCreateSchema (HAND-WRITTEN electron) | id | no | Client create |
| `clients:update` | `handlers/clientHandlers.ts:67` | [admin, staff] | ClientCreateSchema (HAND-WRITTEN electron) | id | no | Client update (id) |
| `custom-services:add` | `handlers/customServiceHandlers.ts:63` | [admin] | core createCustomServiceSchema (lifted, T095) | client_id, partnerId, product_id | transaction_time — forwarded | Custom service sale |
| `custom-services:delete` | `handlers/customServiceHandlers.ts:91` | [admin] | NONE | id (positional) | no | Admin delete of a custom-service row (void-like) |
| `custom-services:update-metadata` | `handlers/customServiceHandlers.ts:110` | [admin, staff] | CustomServiceUpdateMetadataSchema (core customServiceUpdateMetadataSchema) | id | no | Edits note/client of existing row (id) |
| `custom-services:advance-fulfillment` | `handlers/customServiceHandlers.ts:183` | [admin, staff] | CustomServiceUpdateFulfillmentSchema (core updateCustomServiceFulfillmentSchema) | id | no | State transition on existing row (id) |
| `custom-services:set-work-status` | `handlers/customServiceHandlers.ts:217` | [admin, staff] | CustomServiceUpdateWorkStatusSchema (core updateCustomServiceWorkStatusSchema) | id | no | State transition on existing row (id) |
| `db:add-expense` | `handlers/dbHandlers.ts:102` | [admin, staff] | AddExpenseSchema (HAND-WRITTEN electron) | none | expense_date, transaction_time — forwarded | Expense |
| `expenses:add-stock-use` | `handlers/dbHandlers.ts:143` | [admin, staff] | CreateStockExpenseSchema (core createStockExpenseSchema) | item_id | expense_date, transaction_time — forwarded | Expense from stock (stock movement) |
| `db:delete-expense` | `handlers/dbHandlers.ts:173` | [admin] | NONE | id (positional) | no | Admin delete of expense (void-like) |
| `expenses:update-metadata` | `handlers/dbHandlers.ts:188` | [admin, staff] | ExpenseUpdateMetadataSchema (core expenseUpdateMetadataSchema) | id | no | Edits existing expense row (id) |
| `debt:add-repayment` | `handlers/debtHandlers.ts:77` | [admin, staff] | DebtRepaymentSchema (core addRepaymentSchema) | clientId, id, userId | transaction_time — forwarded | Repayment (may target debt rows) |
| `debt:cash-out` | `handlers/debtHandlers.ts:110` | [admin, staff] | DebtCashOutSchema (core debtCashOutSchema) | clientId | transaction_time — forwarded | Debt cash-out |
| `debt:add-account-entry` | `handlers/debtHandlers.ts:162` | [admin, staff] | DebtAccountEntrySchema (core debtAccountEntrySchema) | clientId | transaction_time — forwarded | Customer-account cash entry |
| `debts:update-metadata` | `handlers/debtHandlers.ts:219` | [admin, staff] | NONE | id | no | Edits existing debt row (id); NO validatePayload |
| `debt:add-credit` | `handlers/debtHandlers.ts:268` | [admin, staff] | DebtAddCreditSchema (HAND-WRITTEN electron) | clientId | transactionTime — forwarded | Adds customer credit |
| `debt:use-credit` | `handlers/debtHandlers.ts:311` | [admin, staff] | DebtUseCreditSchema (core debtUseCreditSchema) | clientId | transactionTime — forwarded | Uses customer credit |
| `debt:write-off` | `handlers/debtHandlers.ts:372` | [admin] | DebtWriteOffSchema (core debtWriteOffSchema) | clientId | transaction_time — forwarded | Admin-only write-off — owner may want online-only |
| `drawer-cashout:create` | `handlers/drawerCashoutHandlers.ts:35` | [admin] | DrawerCashoutSchema (core createDrawerCashoutSchema) | none | transaction_time — forwarded | Admin drawer cash-out (owner '?') |
| `drawer-topup:create` | `handlers/drawerTopUpHandlers.ts:32` | [admin, staff] | DrawerTopUpCreateSchema (core drawerTopUpCreateSchema) | none | transaction_time — forwarded | Drawer top-up (owner '?') |
| `drawer-topup:create-from-drawer` | `handlers/drawerTopUpHandlers.ts:109` | [admin, staff] | DrawerTopUpFromDrawerSchema (core drawerTopUpFromDrawerSchema) | none | transaction_time — forwarded | Drawer→drawer top-up (owner '?') |
| `drawer-topup:transfer` | `handlers/drawerTopUpHandlers.ts:164` | [admin, staff] | DrawerTransferSchema (core createDrawerTransferSchema) | none | transaction_time — forwarded | Drawer transfer (owner '?') |
| `exchange:add-transaction` | `handlers/exchangeHandlers.ts:33` | [admin, staff] | ExchangeTransactionSchema (core exchangeSubmitSchema) | partnerId | transaction_time — forwarded | Currency exchange |
| `exchange:update-metadata` | `handlers/exchangeHandlers.ts:73` | [admin, staff] | UpdateExchangeMetadataSchema (core updateExchangeMetadataSchema) | id | no | Edits existing exchange row (id) |
| `hold-money:create` | `handlers/holdMoneyHandlers.ts:60` | [admin, staff] | HoldMoneyCreateSchema (core holdMoneyCreateSchema) | client_id | transaction_time — forwarded | Hold money (owner '?') |
| `hold-money:collect` | `handlers/holdMoneyHandlers.ts:118` | [admin, staff] | HoldMoneyCollectSchema (core holdMoneyCollectSchema) | id (hold) | transaction_time — forwarded | Collect against existing hold (id) |
| `hold-money:void-pickup` | `handlers/holdMoneyHandlers.ts:147` | [admin, staff] | HoldMoneyVoidPickupSchema (core holdMoneyVoidPickupSchema) | pickup_id | no | Void a pickup row (pickup_id) |
| `inventory:adjust-stock` | `handlers/inventoryHandlers.ts:357` | [admin, staff] | StockAdjustSchema (core stockAdjustSchema) | id | no | Stock movement (product id) |
| `inventory:receive-stock` | `handlers/inventoryHandlers.ts:406` | [admin, staff] | ReceiveStockSchema (core receiveStockSchema) | attach_to_recorded_debt_id, product_id | no | Stock in with cost; can attach to a supplier recorded debt (attach_to_recorded_debt_id) → supplier-ledger side effect |
| `loto:sell` | `handlers/lotoHandlers.ts:35` | [admin] | LotoSellSchema (core lotoSellSchema) | clientId, partnerId | sale_date, transaction_time — forwarded | Loto ticket sale |
| `loto:update` | `handlers/lotoHandlers.ts:120` | [admin] | PositiveIdSchema (HAND-WRITTEN electron); LotoTicketUpdateSchema (core lotoTicketUpdateSchema) | id (positional) | no | Edits existing ticket (id positional) — admin-only |
| `loto:cash-prize:create` | `handlers/lotoHandlers.ts:704` | [admin] | LotoCashPrizeSchema (core lotoCashPrizeSchema) | clientId | no | Cashier pays a prize (admin-only today) |
| `loto:update-metadata` | `handlers/lotoHandlers.ts:855` | [admin, staff] | LotoUpdateMetadataSchema (core lotoUpdateMetadataSchema) | id | no | Edits existing ticket metadata (id); also triggers checkAndRecordMonthlyFee |
| `maintenance:save` | `handlers/maintenanceHandlers.ts:23` | [admin, staff] | MaintenanceJobSchema (core saveMaintenanceJobSchema) | client_id, id, product_id | client_day, transaction_time — forwarded | Repair job create/update (id optional) |
| `maintenance:delete` | `handlers/maintenanceHandlers.ts:82` | [admin] | core maintenanceIdParamSchema (lifted, T093) | id (positional) | no | Admin delete of job; NO validatePayload |
| `maintenance:update-metadata` | `handlers/maintenanceHandlers.ts:99` | [admin, staff] | core maintenanceUpdateMetadataSchema (lifted, T093) | id | no | Edits existing job (id); NO validatePayload |
| `omt:add-transaction` | `handlers/omtHandlers.ts:32` | [admin, staff] | FinancialServiceSchema (HAND-WRITTEN electron) | clientId, mobileServiceItemId, partnerId, receiverClientId, senderClientId, userId | transaction_time — forwarded | OMT/Whish/financial transfer |
| `financial:update-metadata` | `handlers/omtHandlers.ts:97` | [admin, staff] | FinancialUpdateMetadataSchema (core financialUpdateMetadataSchema) | id | no | Edits existing financial row (id) |
| `financial:self-charge-telecom-item` | `handlers/omtHandlers.ts:172` | [admin, staff] | SelfChargeTelecomItemSchema (core selfChargeTelecomItemSchema) | carrierLineId, mobileServiceItemId | client_day, transaction_time — forwarded | Shop self-charges a telecom item onto own carrier line; handler calls REPOSITORY directly (no service) |
| `product-units:register` | `handlers/productUnitHandlers.ts:44` | [admin, staff] | RegisterProductUnitsSchema (core registerProductUnitsSchema) | product_id | no | Registers serial units for a product (stock movement) |
| `product-units:delete` | `handlers/productUnitHandlers.ts:145` | [admin, staff] | ProductUnitIdSchema (core productUnitIdSchema) | id | no | Deletes a unit (id) — stock movement |
| `recharge:process` | `handlers/rechargeHandlers.ts:69` | [admin, staff] | RechargeSchema (core createRechargeSchema) | clientId, partnerId | client_day, transaction_time — forwarded | Recharge sale |
| `recharge:top-up-from-client` | `handlers/rechargeHandlers.ts:302` | [admin, staff] | TopUpFromClientSchema (core topUpFromClientSchema) | clientId | no | Customer funds the Whish app drawer (client-facing) — cashier action |
| `recharge:update-metadata` | `handlers/rechargeHandlers.ts:376` | [admin, staff] | UpdateRechargeMetadataSchema (core updateRechargeMetadataSchema) | id | no | Edits existing recharge row (id) |
| `sales:process` | `handlers/salesHandlers.ts:34` | [admin, staff] | SaleProcessSchema (core saleProcessSchema) | id (draft/sale being completed), client_id, items[].product_id, items[].product_unit_id, partnerId | client_day, transaction_time — forwarded | POS sale; also saves DRAFTS (status=draft) through the same channel |
| `sales:delete-draft` | `handlers/salesHandlers.ts:67` | [admin, staff] | NONE | saleId (positional) | no | Deletes a draft (saleId) |
| `sales:refund` | `handlers/salesHandlers.ts:162` | [admin] | SaleRefundSchema (core saleRefundSchema) | saleId (positional), unit_id (unit extras) | no | Refund of sale id (state-dependent) |
| `sales:refund-item` | `handlers/salesHandlers.ts:227` | [admin] | SaleRefundItemSchema (core saleRefundItemSchema) | saleId, saleItemId, unit_id | no | Partial refund of saleItemId |
| `sales:undo-item-refund` | `handlers/salesHandlers.ts:294` | [admin] | SaleUndoItemRefundSchema (core saleUndoItemRefundSchema) | refundTransactionId | no | Reverses a refund (refundTransactionId) |
| `sales:update-metadata` | `handlers/salesHandlers.ts:362` | [admin, staff] | SaleUpdateMetadataSchema (core saleUpdateMetadataSchema) | id | no | Edits existing sale row (id) |
| `session:start` | `handlers/sessionHandlers.ts:24` | [admin, staff] | StartSessionIpcSchema (core startSessionIpcSchema) | none | no | Customer session open |
| `session:update` | `handlers/sessionHandlers.ts:80` | [admin, staff] | UpdateSessionSchema (core updateSessionSchema) | sessionId (positional) | no | Customer session edit (sessionId) |
| `session:close` | `handlers/sessionHandlers.ts:96` | [admin, staff] | NONE | sessionId (positional) | no | Close session (sessionId); actor `closedBy` comes from renderer, not the auth session; NO validatePayload |
| `session:delete` | `handlers/sessionHandlers.ts:113` | [admin, staff] | NONE | sessionId (positional) | no | Delete session (sessionId); NO validatePayload |
| `session:linkTransaction` | `handlers/sessionHandlers.ts:161` | [admin, staff] | LinkSessionTransactionSchema (core linkSessionTransactionSchema) | sessionId, transactionId | no | Links existing transaction to session |
| `session:checkout` | `handlers/sessionHandlers.ts:210` | [admin, staff] | SessionCheckoutSchema (core sessionCheckoutSchema) | sessionId, clientId, cartItems[].formData (opaque, module-specific ids) | no | Basket checkout |
| `session:cart:add` | `handlers/sessionHandlers.ts:247` | [admin, staff] | SessionCartAddSchema (core sessionCartAddSchema) | sessionId (positional), item_id | no | Basket add |
| `session:cart:remove` | `handlers/sessionHandlers.ts:283` | [admin, staff] | NONE | sessionId (positional), itemId (positional) | no | Basket remove (itemId); NO validatePayload |
| `session:cart:clear` | `handlers/sessionHandlers.ts:301` | [admin, staff] | NONE | sessionId (positional) | no | Basket clear; NO validatePayload |
| `transactions:void` | `handlers/transactionHandlers.ts:102` | [admin] | PositiveIdSchema (HAND-WRITTEN electron) | id (positional) | no | Void of transaction id (state-dependent) |
| `transactions:refund` | `handlers/transactionHandlers.ts:139` | [admin] | PositiveIdSchema (HAND-WRITTEN electron); RefundLegsSchema (core refundLegsSchema); RefundUnitExtrasSchema (core refundUnitExtrasSchema); RefundExchangeRateSchema (core refundExchangeRateSchema); RefundKeptChangeSchema (core refundKeptChangeSchema) | id (positional), unit_id (unit extras) | no | Refund of transaction id (state-dependent) |
| `transactions:void-checkout-group` | `handlers/transactionHandlers.ts:232` | [admin] | VoidCheckoutGroupSchema (core voidCheckoutGroupSchema) | groupId | no | Void checkout group (groupId) |
| `transactions:void-session-basket` | `handlers/transactionHandlers.ts:270` | [admin] | SessionBasketReversalSchema (core sessionBasketReversalSchema) | sessionId | no | Void basket (sessionId) |
| `transactions:refund-session-basket` | `handlers/transactionHandlers.ts:303` | [admin] | SessionBasketReversalSchema (core sessionBasketReversalSchema) | sessionId | no | Refund basket (sessionId) |
| `transactions:refund-session-basket-item` | `handlers/transactionHandlers.ts:348` | [admin] | SessionItemRefundSchema (core sessionItemRefundSchema) | saleItemId, sessionId, transactionId, unit_id | clientDay | Refund basket item |
| `wallet-exchange:create` | `handlers/walletExchangeHandlers.ts:47` | [admin, staff] | WalletExchangeSchema (core createWalletExchangeSchema) | none | transaction_time — forwarded | Wallet exchange |
| `warranty:claim` | `handlers/warrantyHandlers.ts:63` | [admin, staff] | CreateWarrantyClaimSchema (core createWarrantyClaimSchema) | maintenance_id, replacement_unit_id, sale_item_id, unit_id | client_day | Warranty claim (owner '?'); may swap a replacement unit (stock) |
| `warranty:void-claim` | `handlers/warrantyHandlers.ts:99` | [admin] | VoidWarrantyClaimSchema (core voidWarrantyClaimSchema) | claim_id | no | Admin void of claim (claim_id) |

## `checkpoint` (7)

| Channel | Handler | Roles | Schema today | Ids | Time | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `carrier-lines:update-balance` | `handlers/carrierLineHandlers.ts:149` | [admin, staff] | CarrierLineUpdateBalanceSchema (core carrierLineUpdateBalanceSchema) | id (positional) | no | Carrier-line balance reading/correction |
| `closing:create-checkpoint` | `handlers/dbHandlers.ts:382` | [admin] | NONE | carrier_lines[].carrier_line_id, drawer_name (existing drawer) | closing_date (client day) — no transaction_time | Drawer count / opening / closing checkpoint |
| `closing:update-daily-closing` | `handlers/dbHandlers.ts:556` | [admin, staff] | UpdateDailyClosingIpcSchema (core updateDailyClosingIpcSchema) | id | no | Edits an existing closing (id) |
| `loto:checkpoint:create` | `handlers/lotoHandlers.ts:313` | [admin] | LotoCheckpointCreateSchema (core lotoCheckpointCreateSchema) | none | checkpoint_date | Loto checkpoint |
| `loto:checkpoint:update` | `handlers/lotoHandlers.ts:423` | [admin] | LotoCheckpointUpdateSchema (core lotoCheckpointUpdateSchema) | id (positional), settlement_id | checkpoint_date | Edits checkpoint (id) |
| `loto:checkpoint:create-scheduled` | `handlers/lotoHandlers.ts:641` | [admin] | NONE | none | checkpointDate (positional) | Auto/scheduled checkpoint (system-triggered?); NO validatePayload |
| `loto:checkpoint:delete` | `handlers/lotoHandlers.ts:671` | [admin] | NONE | id (positional) | no | Deletes checkpoint (id); NO validatePayload |

## `online_only` (106)

| Channel | Handler | Roles | Schema today | Ids | Time | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `auth:revoke-session` | `handlers/authHandlers.ts:507` | [admin, staff] | NONE | id (positional) | no | User-session admin (another device's session) — users/permissions |
| `auth:revoke-other-sessions` | `handlers/authHandlers.ts:557` | [admin, staff] | NONE | none | no | User-session admin — users/permissions |
| `auth:change-own-password` | `handlers/authHandlers.ts:616` | [admin, staff] | ChangeOwnPasswordSchema (core coreChangeOwnPasswordSchema) | none | no | users/permissions |
| `users:create` | `handlers/authHandlers.ts:657` | [admin] (requireAdminRole) | CreateUserSchema (core coreCreateUserSchema) | none | no | users |
| `users:set-password` | `handlers/authHandlers.ts:711` | [admin] (requireAdminRole) | SetPasswordSchema (core coreSetUserPasswordSchema) | none | no | users |
| `users:set-active` | `handlers/authHandlers.ts:775` | [admin] (requireAdminRole) | SetUserActiveSchema (core coreSetUserActiveSchema) | none | no | users |
| `users:set-role` | `handlers/authHandlers.ts:833` | [admin] (requireAdminRole) | SetUserRoleSchema (core coreSetUserRoleSchema) | none | no | users |
| `backup:create` | `handlers/backupHandlers.ts:65` | [admin] | NONE | none | no | Backups (local file write, but owner rule = online-only) |
| `backup:delete` | `handlers/backupHandlers.ts:129` | [admin] | NONE | none | no | Backups (deletes local file) |
| `backup:setDir` | `handlers/backupHandlers.ts:205` | [admin] | NONE | none | no | Writes a setting |
| `carrier-lines:create` | `handlers/carrierLineHandlers.ts:93` | [admin] | CarrierLineCreateSchema (core carrierLineCreateSchema) | none | no | Carrier-line config |
| `carrier-lines:update` | `handlers/carrierLineHandlers.ts:117` | [admin] | CarrierLineUpdateSchema (core carrierLineUpdateSchema) | id (positional) | no | Carrier-line config (id of existing line) |
| `carrier-lines:archive` | `handlers/carrierLineHandlers.ts:232` | [admin] | NONE | id (positional) | no | Config |
| `carrier-lines:toggle-active` | `handlers/carrierLineHandlers.ts:254` | [admin] | NONE | id (positional) | no | Config |
| `carrier-lines:set-primary` | `handlers/carrierLineHandlers.ts:362` | [admin] | NONE | id (positional) | no | Config |
| `clients:delete` | `handlers/clientHandlers.ts:97` | [admin] | NONE | id (positional) | no | Admin delete of client — not in owner list; destructive |
| `clients:import-debts` | `handlers/clientHandlers.ts:116` | [admin] | NONE | none | no | Admin bulk import of clients+debts (data migration) |
| `currencies:create` | `handlers/currencyHandlers.ts:27` | [admin] | CurrencyCreateSchema (core createCurrencySchema) | none | no | Settings |
| `currencies:update` | `handlers/currencyHandlers.ts:54` | [admin] | CurrencyUpdateSchema (core updateCurrencySchema) | none | no | Settings |
| `currencies:delete` | `handlers/currencyHandlers.ts:82` | [admin] | NONE | id (positional) | no | Settings |
| `currencies:setModules` | `handlers/currencyHandlers.ts:115` | [admin] | NONE | none | no | Settings |
| `currencies:setDrawerCurrencies` | `handlers/currencyHandlers.ts:164` | [admin] | NONE | none | no | Settings |
| `service-presets:create` | `handlers/customServiceHandlers.ts:268` | [admin] | NONE | none | no | Config |
| `service-presets:update` | `handlers/customServiceHandlers.ts:282` | [admin] | NONE | none | no | Config |
| `service-presets:delete` | `handlers/customServiceHandlers.ts:299` | [admin] | NONE | id (positional) | no | Config |
| `database:reset` | `handlers/databaseResetHandlers.ts:56` | [admin] | DatabaseResetSchema (core databaseResetSchema) | none | no | Reset Data |
| `db:update-setting` | `handlers/dbHandlers.ts:54` | [admin] | NONE | none | no | Settings |
| `settings:update` | `handlers/dbHandlers.ts:78` | [admin] | NONE | none | no | Settings |
| `closing:recalculate-drawer-balances` | `handlers/dbHandlers.ts:313` | [admin] | NONE | none | no | Admin maintenance recompute of drawer balances — must not run on a stale replica |
| `database:changePath` | `handlers/dbHandlers.ts:669` | [admin] | NONE | none | no | Repoints DB file (setup-class); local device state |
| `exchange-lots:adjust` | `handlers/exchangeLotHandlers.ts:121` | [admin] | AdjustLotPositionSchema (core adjustLotPositionSchema) | none | no | Admin correction of exchange-lot position (owner '?'); not a cashier action |
| `inventory:create-product` | `handlers/inventoryHandlers.ts:138` | [admin, staff] | ProductCreateSchema (core productFormCreateSchema) | none | no | Catalog admin (admin+staff role!) — catalog edit vs stock |
| `inventory:update-product` | `handlers/inventoryHandlers.ts:209` | [admin, staff] | ProductUpdateSchema (core productFormUpdateSchema) | id | no | Catalog edit; may change stock_quantity field too (check) |
| `inventory:batch-update` | `handlers/inventoryHandlers.ts:271` | [admin, staff] | BatchUpdateSchema (core batchUpdateProductsSchema) | ids | no | Catalog bulk edit |
| `inventory:delete-product` | `handlers/inventoryHandlers.ts:310` | [admin, staff] | NONE | id (positional) | no | Catalog delete; NO validatePayload |
| `inventory:batch-delete` | `handlers/inventoryHandlers.ts:327` | [admin, staff] | BatchDeleteProductIdsSchema (core batchDeleteProductIdsSchema) | ids[] | no | Catalog bulk delete |
| `inventory:create-category` | `handlers/inventoryHandlers.ts:524` | [admin, staff] | NONE | none | no | Catalog config; NO validatePayload |
| `inventory:update-category` | `handlers/inventoryHandlers.ts:547` | [admin, staff] | UpdateCategorySchema (core updateCategorySchema) | id (positional) | no | Catalog config |
| `inventory:delete-category` | `handlers/inventoryHandlers.ts:588` | [admin, staff] | NONE | id (positional) | no | Catalog config; NO validatePayload |
| `inventory:create-product-supplier` | `handlers/inventoryHandlers.ts:621` | [admin, staff] | NONE | none | no | Supplier catalog; NO validatePayload |
| `inventory:update-product-supplier` | `handlers/inventoryHandlers.ts:642` | [admin, staff] | NONE | id (positional) | no | Supplier catalog; NO validatePayload |
| `inventory:delete-product-supplier` | `handlers/inventoryHandlers.ts:665` | [admin, staff] | NONE | id (positional) | no | Supplier catalog; NO validatePayload |
| `item-costs:set` | `handlers/itemCostHandlers.ts:24` | [admin] | SetItemCostSchema (core setItemCostSchema) | none | no | Cost config |
| `license:setKey` | `handlers/licenseHandlers.ts:74` | [admin] | NONE | none | no | Licensing (writes setting + subscription row) |
| `license:check` | `handlers/licenseHandlers.ts:109` | [admin] | NONE | none | no | Licensing (network) |
| `loto:fees:create` | `handlers/lotoHandlers.ts:191` | [admin] | LotoFeeSchema (core lotoFeeSchema) | none | no | Monthly fee to loto operator (supplier-side) |
| `loto:fees:pay` | `handlers/lotoHandlers.ts:238` | [admin] | NONE | id (positional) | no | Pays monthly fee (supplier payment); NO validatePayload |
| `loto:settings:update` | `handlers/lotoHandlers.ts:284` | [admin] | NONE | none | no | Settings; NO validatePayload |
| `loto:checkpoint:mark-settled` | `handlers/lotoHandlers.ts:452` | [admin] | NONE | id, settlementId | settledAt (positional) | Settlement state on checkpoint (supplier settlement); NO validatePayload |
| `loto:checkpoint:settle` | `handlers/lotoHandlers.ts:485` | [admin] | LotoCheckpointSettleSchema (core lotoCheckpointSettleSchema) | id | no | Loto settlement with operator (supplier settlement) |
| `loto:checkpoints:settle-batch` | `handlers/lotoHandlers.ts:528` | [admin] | LotoCheckpointsSettleBatchSchema (core lotoCheckpointsSettleBatchSchema) | checkpointIds | no | Batch settlement (checkpointIds) |
| `loto:cash-prize:mark-reimbursed` | `handlers/lotoHandlers.ts:776` | [admin] | NONE | id, settlementId | reimbursedDate (positional) | Operator reimbursement = settlement; NO validatePayload |
| `mobile-service-items:create` | `handlers/mobileServiceItemHandlers.ts:146` | [admin] | MobileServiceItemCreateSchema (core mobileServiceItemCreateSchema) | none | no | Catalog config |
| `mobile-service-items:update` | `handlers/mobileServiceItemHandlers.ts:181` | [admin] | MobileServiceItemUpdateSchema (core mobileServiceItemUpdateSchema) | id (positional) | no | Catalog config |
| `mobile-service-items:toggle-active` | `handlers/mobileServiceItemHandlers.ts:218` | [admin] | NONE | id (positional) | no | Catalog config |
| `mobile-service-items:delete` | `handlers/mobileServiceItemHandlers.ts:244` | [admin] | NONE | id (positional) | no | Catalog config |
| `mobile-service-items:seed` | `handlers/mobileServiceItemHandlers.ts:267` | [admin, staff] | MobileServiceItemSeedSchema (core mobileServiceItemSeedSchema) | none | no | Catalog seed (admin+staff) |
| `modules:setEnabled` | `handlers/moduleHandlers.ts:44` | [admin] | NONE | none | no | Module toggles |
| `modules:bulkSetEnabled` | `handlers/moduleHandlers.ts:63` | [admin] | NONE | none | no | Module toggles |
| `modules:reorder` | `handlers/moduleHandlers.ts:85` | [admin] | NONE | none | no | Module toggles |
| `partners:create` | `handlers/partnerHandlers.ts:65` | [admin, staff] | NONE | none | no | Partner config; NO validatePayload |
| `partners:update` | `handlers/partnerHandlers.ts:102` | [admin, staff] | NONE | id (positional) | no | Partner config; NO validatePayload |
| `partners:deactivate` | `handlers/partnerHandlers.ts:142` | [admin, staff] | NONE | id (positional) | no | Partner config |
| `partners:activate` | `handlers/partnerHandlers.ts:170` | [admin, staff] | NONE | id (positional) | no | Partner config |
| `partners:record-transaction` | `handlers/partnerHandlers.ts:250` | [admin, staff] | PartnerRecordTransactionSchema (core partnerRecordTransactionSchema) | partnerId, referenceId | no | Partner ledger entry — partner payments are online-only by rule |
| `partners:settle` | `handlers/partnerHandlers.ts:288` | [admin, staff] | PartnerSettleSchema (core partnerSettleSchema) | partnerId | no | Partner settlement |
| `partners:write-off` | `handlers/partnerHandlers.ts:324` | [admin] | PartnerWriteOffSchema (core partnerWriteOffSchema) | partnerId | no | Partner write-off |
| `payment-methods:create` | `handlers/paymentMethodHandlers.ts:33` | [admin] | PaymentMethodCreateSchema (core createPaymentMethodSchema) | none | no | Payment method config |
| `payment-methods:update` | `handlers/paymentMethodHandlers.ts:51` | [admin] | PaymentMethodUpdateSchema (core updatePaymentMethodSchema) | id (positional) | no | Payment method config |
| `payment-methods:delete` | `handlers/paymentMethodHandlers.ts:73` | [admin] | NONE | id (positional) | no | Payment method config |
| `payment-methods:reorder` | `handlers/paymentMethodHandlers.ts:88` | [admin] | NONE | ids (positional) | no | Payment method config |
| `profits:set-password` | `handlers/profitHandlers.ts:119` | [admin] | SetProfitsPasswordSchema (core coreSetProfitsPasswordSchema) | none | no | Settings |
| `rates:set` | `handlers/rateHandlers.ts:24` | [admin] | NONE | none | no | Exchange RATE setting = settings; NO validatePayload |
| `rates:delete` | `handlers/rateHandlers.ts:58` | [admin] | NONE | none | no | Settings |
| `recharge:top-up-app` | `handlers/rechargeHandlers.ts:105` | [admin, staff] | TopUpAppSchema (core topUpAppSchema) | none | no | App/provider balance top-up paid from drawer (supplier-side payment) |
| `recharge:top-up-from-supplier` | `handlers/rechargeHandlers.ts:165` | [admin, staff] | TopUpFromSupplierSchema (core topUpFromSupplierSchema) | none | no | Supplier payment |
| `recharge:cashout-to-supplier` | `handlers/rechargeHandlers.ts:212` | [admin] | RechargeCashoutSchema (core rechargeCashoutSchema) | none | no | Supplier settlement (OMT open-credit cashout), admin |
| `recharge:top-up-from-partner` | `handlers/rechargeHandlers.ts:256` | [admin, staff] | TopUpFromPartnerSchema (core topUpFromPartnerSchema) | partnerId | no | Partner payment |
| `report:backup-db` | `handlers/reportHandlers.ts:23` | [admin] | NONE | none | no | Backups |
| `report:restore-db` | `handlers/reportHandlers.ts:74` | [admin] | NONE | none | no | Restore |
| `service-providers:create` | `handlers/serviceProviderHandlers.ts:57` | [admin] | CreateServiceProviderSchema (core createServiceProviderSchema) | none | no | Config |
| `service-providers:update` | `handlers/serviceProviderHandlers.ts:87` | [admin] | UpdateServiceProviderSchema (core updateServiceProviderSchema) | id (positional) | no | Config |
| `service-providers:delete` | `handlers/serviceProviderHandlers.ts:118` | [admin] | NONE | id (positional) | no | Config |
| `setup:complete` | `handlers/setupHandlers.ts:51` | none | NONE | none | no | Setup; raw SQL in handler; no requireRole (pre-auth) |
| `setup:reset` | `handlers/setupHandlers.ts:300` | none | NONE | none | no | Setup reset; NO requireRole and NO validation |
| `setup:joinExistingShop` | `handlers/setupHandlers.ts:386` | none | NONE | none | no | Setup |
| `suppliers:create` | `handlers/supplierHandlers.ts:94` | [admin] | SupplierCreateSchema (core supplierCreateSchema) | none | no | Supplier admin |
| `suppliers:update-account-link` | `handlers/supplierHandlers.ts:121` | [admin] | SupplierAccountLinkSchema (core supplierAccountLinkSchema) | account_supplier_id, supplier_id | no | Supplier admin |
| `suppliers:add-ledger-entry` | `handlers/supplierHandlers.ts:144` | [admin] | SupplierLedgerEntrySchema (core supplierLedgerEntrySchema) | supplier_id | no | Supplier payment/ledger |
| `suppliers:settle-transactions` | `handlers/supplierHandlers.ts:188` | [admin] | SupplierSettleSchema (core supplierSettleSchema) | financial_service_ids, supplier_id | no | Supplier settlement |
| `suppliers:settle-account` | `handlers/supplierHandlers.ts:217` | [admin] | SupplierSettleAccountSchema (core supplierSettleAccountSchema) | account_supplier_id, id | no | Supplier settlement |
| `suppliers:purchase-create` | `handlers/supplierHandlers.ts:260` | [admin] | SupplierPurchaseCreateSchema (core supplierPurchaseCreateSchema) | supplier_id | no | Supplier purchase |
| `suppliers:record-debt` | `handlers/supplierHandlers.ts:286` | [admin] | SupplierRecordDebtSchema (core supplierRecordDebtSchema) | supplier_id | no | Supplier debt |
| `suppliers:record-cashflow` | `handlers/supplierHandlers.ts:322` | [admin] | SupplierCashflowSchema (core supplierCashflowSchema) | supplier_id | no | Supplier cashflow |
| `updater:check` | `handlers/updaterHandlers.ts:202` | [admin] | NONE | none | no | Updater |
| `updater:download` | `handlers/updaterHandlers.ts:245` | [admin] | NONE | none | no | Updater |
| `updater:quit-and-install` | `handlers/updaterHandlers.ts:283` | [admin] | NONE | none | no | Updater |
| `voucher:cancel` | `handlers/voucherHandlers.ts:103` | [admin] | NONE | id (positional) | no | Admin void of voucher (id) — moved to online_only (O-impl-C-1: vouchers are online-only, owner O-new-6 confirmation) |
| `voucher:create` | `handlers/voucherHandlers.ts:26` | [admin, staff] | VoucherCreateSchema (core voucherCreateSchema) | clientId | no | O-new-6: offline code would not match the server-made code |
| `voucher-images:set` | `handlers/voucherImageHandlers.ts:22` | [admin] | SetVoucherImageSchema (core setVoucherImageSchema) | none | no | Config |
| `voucher-images:delete` | `handlers/voucherImageHandlers.ts:49` | [admin] | NONE | id (positional) | no | Config |
| `warranty:defective-resolve` | `handlers/warrantyHandlers.ts:138` | [admin] | ResolveDefectiveSchema (core resolveDefectiveSchema) | defective_item_id | no | Resolves defective stock (admin back-office) |
| `warranty:supplier-return-create` | `handlers/warrantyHandlers.ts:160` | [admin] | CreateSupplierReturnSchema (core createSupplierReturnSchema) | defective_item_id, supplier_id | no | Supplier return |
| `warranty:supplier-return-close` | `handlers/warrantyHandlers.ts:183` | [admin] | CloseSupplierReturnSchema (core closeSupplierReturnSchema) | supplier_return_id | no | Supplier return |
| `whatsapp:send-test` | `handlers/whatsappHandlers.ts:14` | none | NONE | none | no | Network send (no DB write); no requireRole |
| `whatsapp:send-message` | `handlers/whatsappHandlers.ts:38` | none | NONE | none | no | Network send (no DB write); no requireRole |

## `local` (16 existing; plus `offline:status`, `offline:pair`, `offline:unpair`, `offline:go-offline`, `offline:back-to-web`, `offline:send-now`, `offline:open-web-app`, `offline:install-update`)

| Channel | Handler | Roles | Schema today | Ids | Time | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `auth:login` | `handlers/authHandlers.ts:75` | none | - | - | - | Writes user_sessions/activity rows via authService.login; needs local credential check offline |
| `auth:logout` | `handlers/authHandlers.ts:161` | none | - | - | - | Session bookkeeping |
| `auth:restore-session` | `handlers/authHandlers.ts:213` | none | - | - | - | Session bookkeeping (may call login) |
| `backup:pickDir` | `handlers/backupHandlers.ts:183` | none | - | - | - | File dialog only |
| `database:browse` | `handlers/dbHandlers.ts:638` | [admin] | - | - | - | File dialog |
| `print:silent` | `handlers/printHandlers.ts:19` | none | - | - | - | Print |
| `print:with-dialog` | `handlers/printHandlers.ts:94` | none | - | - | - | Print |
| `profits:unlock` | `handlers/profitHandlers.ts:160` | [admin, staff] | UnlockProfitsSchema (core coreUnlockProfitsSchema) | - | - | In-memory session unlock |
| `profits:lock` | `handlers/profitHandlers.ts:198` | [admin, staff] | - | - | - | In-memory session lock |
| `report:generate-pdf` | `handlers/reportHandlers.ts:9` | [admin] | - | - | - | Writes a PDF file |
| `setup:browseForDatabase` | `handlers/setupHandlers.ts:484` | none | - | - | - | File dialog |
| `setup:relaunch` | `handlers/setupHandlers.ts:543` | none | - | - | - | App relaunch |
| `voicebot:qwen:connect` | `handlers/voiceBotHandlers.ts:280` | none | - | windowId (positional) | - | Opens external realtime-voice websocket (needs network); no role |
| `voicebot:qwen:disconnect` | `handlers/voiceBotHandlers.ts:382` | none | - | - | - |  |
| `voicebot:qwen:send-audio` | `handlers/voiceBotHandlers.ts:413` | none | - | - | - |  |
| `voicebot:qwen:stop` | `handlers/voiceBotHandlers.ts:443` | none | - | - | - |  |

## `read` (215) — by handler file

| Handler file | Read channels |
| --- | --- |
| `handlers/auditHandlers.ts` | 3 |
| `handlers/authHandlers.ts` | 3 |
| `handlers/backupHandlers.ts` | 2 |
| `handlers/carrierLineHandlers.ts` | 5 |
| `handlers/clientHandlers.ts` | 2 |
| `handlers/currencyHandlers.ts` | 9 |
| `handlers/customServiceHandlers.ts` | 4 |
| `handlers/databaseResetHandlers.ts` | 1 |
| `handlers/dbHandlers.ts` | 20 |
| `handlers/debtHandlers.ts` | 6 |
| `handlers/drawerCashoutHandlers.ts` | 1 |
| `handlers/drawerTopUpHandlers.ts` | 2 |
| `handlers/exchangeHandlers.ts` | 1 |
| `handlers/exchangeLotHandlers.ts` | 3 |
| `handlers/financialHandlers.ts` | 1 |
| `handlers/holdMoneyHandlers.ts` | 3 |
| `handlers/inventoryHandlers.ts` | 14 |
| `handlers/itemCostHandlers.ts` | 1 |
| `handlers/licenseHandlers.ts` | 1 |
| `handlers/lotoHandlers.ts` | 18 |
| `handlers/maintenanceHandlers.ts` | 2 |
| `handlers/mobileServiceItemHandlers.ts` | 7 |
| `handlers/moduleHandlers.ts` | 3 |
| `handlers/omtHandlers.ts` | 4 |
| `handlers/partnerHandlers.ts` | 5 |
| `handlers/paymentMethodHandlers.ts` | 2 |
| `handlers/printHandlers.ts` | 1 |
| `handlers/productUnitHandlers.ts` | 5 |
| `handlers/profitHandlers.ts` | 10 |
| `handlers/rateHandlers.ts` | 1 |
| `handlers/rechargeHandlers.ts` | 4 |
| `handlers/reportHandlers.ts` | 2 |
| `handlers/salesHandlers.ts` | 11 |
| `handlers/serviceProviderHandlers.ts` | 2 |
| `handlers/sessionHandlers.ts` | 9 |
| `handlers/setupHandlers.ts` | 2 |
| `handlers/supplierHandlers.ts` | 15 |
| `handlers/transactionHandlers.ts` | 18 |
| `handlers/updaterHandlers.ts` | 1 |
| `handlers/voiceBotHandlers.ts` | 2 |
| `handlers/voucherHandlers.ts` | 2 |
| `handlers/voucherImageHandlers.ts` | 1 |
| `handlers/walletExchangeHandlers.ts` | 1 |
| `handlers/warrantyHandlers.ts` | 5 |

The read channels are listed individually in the generated `channelPolicy.ts`; their classification is by name plus a scan of the service methods they call (not every service body audited — the FR-036 write guard catches a read that writes).
