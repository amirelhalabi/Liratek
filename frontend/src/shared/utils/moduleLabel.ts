/**
 * LIRA-331 OD-3 — page names in the sidebar and Home grid come from the
 * shop's `modules` table. A name still equal to its seeded English label is
 * translated (layout:modules.<key>); a name the shop changed is shown as
 * written. This is the one place that decides it (rule 14).
 */
const SEEDED_MODULE_LABELS: Readonly<Record<string, string>> = {
  dashboard: "Dashboard",
  closing: "Closing",
  audit: "Audit & Transactions",
  settings: "Settings",
  pos: "Point of Sale",
  debts: "Accounts",
  inventory: "Inventory",
  clients: "Clients",
  exchange: "Exchange",
  omt_whish: "OMT/Whish",
  recharge: "MTC/Alfa",
  expenses: "Expenses",
  maintenance: "Maintenance",
  binance: "Binance",
  ipec_katch: "iPick/Katsh",
  custom_services: "Services",
  profits: "Profits",
  customer_sessions: "Sessions",
  partners: "Partners",
  loto: "Loto",
  suppliers: "Suppliers",
  vouchers: "Vouchers",
};

/** Any i18next `t` (namespaced or not); the key carries its namespace. */
type Translate = (key: string, options: { defaultValue: string }) => string;

export function moduleLabel(key: string, stored: string, t: Translate): string {
  if (SEEDED_MODULE_LABELS[key] !== stored) return stored;
  return t(`layout:modules.${key}`, { defaultValue: stored });
}
