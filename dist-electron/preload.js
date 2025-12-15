"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('api', {
    // Database operations
    getSettings: () => electron_1.ipcRenderer.invoke('db:get-settings'),
    getSetting: (key) => electron_1.ipcRenderer.invoke('db:get-setting', key),
    updateSetting: (key, value) => electron_1.ipcRenderer.invoke('db:update-setting', key, value),
    // Auth operations
    login: (username, password) => electron_1.ipcRenderer.invoke('auth:login', username, password),
    logout: (userId) => electron_1.ipcRenderer.invoke('auth:logout', userId),
    getCurrentUser: (userId) => electron_1.ipcRenderer.invoke('auth:get-current-user', userId),
    // Inventory operations
    getProducts: (search) => electron_1.ipcRenderer.invoke('inventory:get-products', search),
    getProduct: (id) => electron_1.ipcRenderer.invoke('inventory:get-product', id),
    getProductByBarcode: (barcode) => electron_1.ipcRenderer.invoke('inventory:get-product-by-barcode', barcode),
    createProduct: (product) => electron_1.ipcRenderer.invoke('inventory:create-product', product),
    updateProduct: (product) => electron_1.ipcRenderer.invoke('inventory:update-product', product),
    deleteProduct: (id) => electron_1.ipcRenderer.invoke('inventory:delete-product', id),
    adjustStock: (id, quantity) => electron_1.ipcRenderer.invoke('inventory:adjust-stock', id, quantity),
    // Client operations
    getClients: (search) => electron_1.ipcRenderer.invoke('clients:get-all', search),
    getClient: (id) => electron_1.ipcRenderer.invoke('clients:get-one', id),
    createClient: (client) => electron_1.ipcRenderer.invoke('clients:create', client),
    updateClient: (client) => electron_1.ipcRenderer.invoke('clients:update', client),
    deleteClient: (id) => electron_1.ipcRenderer.invoke('clients:delete', id),
    // Sales operations
    processSale: (saleData) => electron_1.ipcRenderer.invoke('sales:process', saleData),
    getDashboardStats: () => electron_1.ipcRenderer.invoke('sales:get-dashboard-stats'),
    getDrafts: () => electron_1.ipcRenderer.invoke('sales:get-drafts'),
    getSalesChart: () => electron_1.ipcRenderer.invoke('sales:get-sales-chart'),
    getRecentActivity: () => electron_1.ipcRenderer.invoke('sales:get-recent-activity'),
    getTopProducts: () => electron_1.ipcRenderer.invoke('sales:get-top-products'),
    // Debt
    getDebtors: () => electron_1.ipcRenderer.invoke('debt:get-debtors'),
    getClientDebtHistory: (clientId) => electron_1.ipcRenderer.invoke('debt:get-client-history', clientId),
    addRepayment: (data) => electron_1.ipcRenderer.invoke('debt:add-repayment', data),
    // Exchange
    addExchangeTransaction: (data) => electron_1.ipcRenderer.invoke('exchange:add-transaction', data),
    getExchangeHistory: () => electron_1.ipcRenderer.invoke('exchange:get-history'),
    // OMT/Whish Financial Services
    addOMTTransaction: (data) => electron_1.ipcRenderer.invoke('omt:add-transaction', data),
    getOMTHistory: (provider) => electron_1.ipcRenderer.invoke('omt:get-history', provider),
    getOMTAnalytics: () => electron_1.ipcRenderer.invoke('omt:get-analytics'),
    // Recharge (Alfa/MTC)
    getRechargeStock: () => electron_1.ipcRenderer.invoke('recharge:get-stock'),
    processRecharge: (data) => electron_1.ipcRenderer.invoke('recharge:process', data),
    // Maintenance
    saveMaintenanceJob: (job) => electron_1.ipcRenderer.invoke('maintenance:save', job),
    getMaintenanceJobs: (statusFilter) => electron_1.ipcRenderer.invoke('maintenance:get-jobs', statusFilter),
    deleteMaintenanceJob: (id) => electron_1.ipcRenderer.invoke('maintenance:delete', id),
});
