/**
 * LIRA-331: every translation namespace (data-model.md §6). One JSON file per
 * namespace per language under ./locales/{en,ar}/. `server` has no en file:
 * its English text is core's SERVER_MESSAGES (one source).
 *
 * Frozen after Foundational: module work never edits this list
 * (contracts/i18n-catalog.md). scripts/check-i18n.mjs checks it matches the
 * files on disk.
 */
export const NAMESPACES = [
  "common",
  "layout",
  "ui",
  "payment",
  "shared",
  "auth",
  "account",
  "admin",
  "audit",
  "clients",
  "closing",
  "customServices",
  "dashboard",
  "debts",
  "exchange",
  "expenses",
  "inventory",
  "loto",
  "maintenance",
  "offline",
  "partners",
  "phoneLines",
  "profits",
  "recharge",
  "rechargeFinancial",
  "sales",
  "services",
  "sessions",
  "settings",
  "settingsCatalog",
  "setup",
  "suppliers",
  "vouchers",
  "warranty",
  "wrongNumbers",
  "receipts",
  "reports",
  "mobile",
  "server",
] as const;

export type Namespace = (typeof NAMESPACES)[number];
