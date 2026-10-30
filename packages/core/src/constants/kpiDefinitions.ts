/**
 * LIRA-364 — the monthly KPI snapshot's fixed list. Stored as one row per KPI
 * (`kpi_snapshot_values.kpi_key`), so adding a KPI here needs no migration;
 * months saved before it show it as "not recorded". Display names live in the
 * `kpi` i18n namespace. Browser-safe leaf (rule 29).
 */

export const KPI_KEYS = [
  "customers_owe_shop",
  "suppliers_owe_shop",
  "partners_owe_shop",
  "shop_owes_customers",
  "shop_owes_suppliers",
  "shop_owes_partners",
  "stock_value",
  "carrier_credits",
] as const;

export type KpiKey = (typeof KPI_KEYS)[number];

export interface KpiDefinition {
  key: KpiKey;
  /** `phone_shop` KPIs are hidden for a shop that does not use them. */
  group: "generic" | "phone_shop";
  /** Module that must be on for the row to show. The value is saved anyway. */
  requiresModule?: "recharge";
}

/** In page order. */
export const KPI_DEFINITIONS: readonly KpiDefinition[] = [
  { key: "customers_owe_shop", group: "generic" },
  { key: "suppliers_owe_shop", group: "generic" },
  { key: "partners_owe_shop", group: "generic" },
  { key: "shop_owes_customers", group: "generic" },
  { key: "shop_owes_suppliers", group: "generic" },
  { key: "shop_owes_partners", group: "generic" },
  { key: "stock_value", group: "generic" },
  { key: "carrier_credits", group: "phone_shop", requiresModule: "recharge" },
];

/** One saved month, as both transports return it. */
export interface KpiSnapshotView {
  /** The Beirut month described, `YYYY-MM`. */
  month: string;
  /** UTC `YYYY-MM-DD HH:MM:SS`. */
  taken_at: string;
  /** Taken after the next month's first money activity was saved. */
  is_late: boolean;
  usd_lbp_buy_rate: number | null;
  usd_lbp_sell_rate: number | null;
  /** A missing key means the KPI did not exist yet: "not recorded". */
  values: Partial<Record<KpiKey, { usd: number; lbp: number }>>;
}
