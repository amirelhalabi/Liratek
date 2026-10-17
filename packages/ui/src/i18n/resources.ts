/**
 * LIRA-331: the translation resources (research R1/R2). English is imported
 * statically (every app bundles it; it is also the jest default). Arabic is
 * loaded on demand per namespace, so English users download nothing extra.
 *
 * Generated once in Foundational; module work never edits this file.
 * Pure: no React, no Node built-ins (Metro maps @liratek/ui/<file>).
 */
import type { Namespace } from "./namespaces";
import { SERVER_MESSAGES } from "@liratek/core";
import en_common from "./locales/en/common.json";
import en_layout from "./locales/en/layout.json";
import en_ui from "./locales/en/ui.json";
import en_payment from "./locales/en/payment.json";
import en_shared from "./locales/en/shared.json";
import en_auth from "./locales/en/auth.json";
import en_account from "./locales/en/account.json";
import en_admin from "./locales/en/admin.json";
import en_audit from "./locales/en/audit.json";
import en_clients from "./locales/en/clients.json";
import en_closing from "./locales/en/closing.json";
import en_customServices from "./locales/en/customServices.json";
import en_dashboard from "./locales/en/dashboard.json";
import en_debts from "./locales/en/debts.json";
import en_exchange from "./locales/en/exchange.json";
import en_expenses from "./locales/en/expenses.json";
import en_inventory from "./locales/en/inventory.json";
import en_loto from "./locales/en/loto.json";
import en_maintenance from "./locales/en/maintenance.json";
import en_offline from "./locales/en/offline.json";
import en_partners from "./locales/en/partners.json";
import en_phoneLines from "./locales/en/phoneLines.json";
import en_profits from "./locales/en/profits.json";
import en_recharge from "./locales/en/recharge.json";
import en_rechargeFinancial from "./locales/en/rechargeFinancial.json";
import en_sales from "./locales/en/sales.json";
import en_services from "./locales/en/services.json";
import en_sessions from "./locales/en/sessions.json";
import en_settings from "./locales/en/settings.json";
import en_settingsCatalog from "./locales/en/settingsCatalog.json";
import en_setup from "./locales/en/setup.json";
import en_suppliers from "./locales/en/suppliers.json";
import en_vouchers from "./locales/en/vouchers.json";
import en_warranty from "./locales/en/warranty.json";
import en_wrongNumbers from "./locales/en/wrongNumbers.json";
import en_receipts from "./locales/en/receipts.json";
import en_reports from "./locales/en/reports.json";
import en_mobile from "./locales/en/mobile.json";

/** English resources, keyed by namespace. `server` is core's catalog. */
export const EN_RESOURCES = {
  common: en_common,
  layout: en_layout,
  ui: en_ui,
  payment: en_payment,
  shared: en_shared,
  auth: en_auth,
  account: en_account,
  admin: en_admin,
  audit: en_audit,
  clients: en_clients,
  closing: en_closing,
  customServices: en_customServices,
  dashboard: en_dashboard,
  debts: en_debts,
  exchange: en_exchange,
  expenses: en_expenses,
  inventory: en_inventory,
  loto: en_loto,
  maintenance: en_maintenance,
  offline: en_offline,
  partners: en_partners,
  phoneLines: en_phoneLines,
  profits: en_profits,
  recharge: en_recharge,
  rechargeFinancial: en_rechargeFinancial,
  sales: en_sales,
  services: en_services,
  sessions: en_sessions,
  settings: en_settings,
  settingsCatalog: en_settingsCatalog,
  setup: en_setup,
  suppliers: en_suppliers,
  vouchers: en_vouchers,
  warranty: en_warranty,
  wrongNumbers: en_wrongNumbers,
  receipts: en_receipts,
  reports: en_reports,
  mobile: en_mobile,
  server: SERVER_MESSAGES as Record<string, string>,
} as const;

type Catalog = Record<string, unknown>;

/** Arabic loaders, one per namespace (lazy chunks in Vite). */
export const AR_LOADERS: Record<Namespace, () => Promise<Catalog>> = {
  common: () => import("./locales/ar/common.json").then((m) => m.default as Catalog),
  layout: () => import("./locales/ar/layout.json").then((m) => m.default as Catalog),
  ui: () => import("./locales/ar/ui.json").then((m) => m.default as Catalog),
  payment: () => import("./locales/ar/payment.json").then((m) => m.default as Catalog),
  shared: () => import("./locales/ar/shared.json").then((m) => m.default as Catalog),
  auth: () => import("./locales/ar/auth.json").then((m) => m.default as Catalog),
  account: () => import("./locales/ar/account.json").then((m) => m.default as Catalog),
  admin: () => import("./locales/ar/admin.json").then((m) => m.default as Catalog),
  audit: () => import("./locales/ar/audit.json").then((m) => m.default as Catalog),
  clients: () => import("./locales/ar/clients.json").then((m) => m.default as Catalog),
  closing: () => import("./locales/ar/closing.json").then((m) => m.default as Catalog),
  customServices: () => import("./locales/ar/customServices.json").then((m) => m.default as Catalog),
  dashboard: () => import("./locales/ar/dashboard.json").then((m) => m.default as Catalog),
  debts: () => import("./locales/ar/debts.json").then((m) => m.default as Catalog),
  exchange: () => import("./locales/ar/exchange.json").then((m) => m.default as Catalog),
  expenses: () => import("./locales/ar/expenses.json").then((m) => m.default as Catalog),
  inventory: () => import("./locales/ar/inventory.json").then((m) => m.default as Catalog),
  loto: () => import("./locales/ar/loto.json").then((m) => m.default as Catalog),
  maintenance: () => import("./locales/ar/maintenance.json").then((m) => m.default as Catalog),
  offline: () => import("./locales/ar/offline.json").then((m) => m.default as Catalog),
  partners: () => import("./locales/ar/partners.json").then((m) => m.default as Catalog),
  phoneLines: () => import("./locales/ar/phoneLines.json").then((m) => m.default as Catalog),
  profits: () => import("./locales/ar/profits.json").then((m) => m.default as Catalog),
  recharge: () => import("./locales/ar/recharge.json").then((m) => m.default as Catalog),
  rechargeFinancial: () => import("./locales/ar/rechargeFinancial.json").then((m) => m.default as Catalog),
  sales: () => import("./locales/ar/sales.json").then((m) => m.default as Catalog),
  services: () => import("./locales/ar/services.json").then((m) => m.default as Catalog),
  sessions: () => import("./locales/ar/sessions.json").then((m) => m.default as Catalog),
  settings: () => import("./locales/ar/settings.json").then((m) => m.default as Catalog),
  settingsCatalog: () => import("./locales/ar/settingsCatalog.json").then((m) => m.default as Catalog),
  setup: () => import("./locales/ar/setup.json").then((m) => m.default as Catalog),
  suppliers: () => import("./locales/ar/suppliers.json").then((m) => m.default as Catalog),
  vouchers: () => import("./locales/ar/vouchers.json").then((m) => m.default as Catalog),
  warranty: () => import("./locales/ar/warranty.json").then((m) => m.default as Catalog),
  wrongNumbers: () => import("./locales/ar/wrongNumbers.json").then((m) => m.default as Catalog),
  receipts: () => import("./locales/ar/receipts.json").then((m) => m.default as Catalog),
  reports: () => import("./locales/ar/reports.json").then((m) => m.default as Catalog),
  mobile: () => import("./locales/ar/mobile.json").then((m) => m.default as Catalog),
  server: () => import("./locales/ar/server.json").then((m) => m.default as Catalog),
};
