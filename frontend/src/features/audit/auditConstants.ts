// Shared audit/transaction constants.
//
// These live in a non-component module so they can be imported by both the
// AuditLogViewer/TransactionsViewer pages and AuditPage without tripping the
// react-refresh/only-export-components lint rule (which forbids a component
// file from also exporting non-component values).

export const ACTION_OPTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "LOGIN",
  "LOGOUT",
  "VOID",
  "REFUND",
  "PROCESS",
  "SETTINGS_CHANGE",
  "IMPORT",
  "EXPORT",
  "BACKUP",
  "RESTORE",
  "SEED",
];

export const ENTITY_TYPE_OPTIONS = [
  "user",
  "product",
  "sale",
  "client",
  "debt",
  "financial_service",
  "recharge",
  "exchange",
  "loto_ticket",
  "loto_settings",
  "expense",
  "maintenance",
  "supplier",
  "rate",
  "currency",
  "module",
  "payment_method",
  "mobile_service_item",
  "settings",
  "backup",
  "session",
  "item_cost",
  "custom_service",
];

export type FilterOption = {
  label: string;
  type: string;
  provider?: string;
  service_type?: string;
  has_item_key?: boolean;
};

export const FILTER_GROUPS: { group: string; options: FilterOption[] }[] = [
  {
    group: "Financial — System",
    options: [
      { label: "OMT System", type: "FINANCIAL_SERVICE", provider: "OMT" },
      { label: "Whish System", type: "FINANCIAL_SERVICE", provider: "WHISH" },
    ],
  },
  {
    group: "Financial — App",
    options: [
      {
        label: "OMT App Send",
        type: "FINANCIAL_SERVICE",
        provider: "OMT_APP",
        service_type: "SEND",
      },
      {
        label: "OMT App Recv",
        type: "FINANCIAL_SERVICE",
        provider: "OMT_APP",
        service_type: "RECEIVE",
      },
      {
        label: "Whish App Send",
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        service_type: "SEND",
        has_item_key: false,
      },
      {
        label: "Whish App Recv",
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        service_type: "RECEIVE",
        has_item_key: false,
      },
      {
        label: "Whish App Bills",
        type: "FINANCIAL_SERVICE",
        provider: "WHISH_APP",
        has_item_key: true,
      },
      { label: "iPick", type: "FINANCIAL_SERVICE", provider: "iPick" },
      { label: "Katsh", type: "FINANCIAL_SERVICE", provider: "Katsh" },
      {
        label: "Binance Send",
        type: "FINANCIAL_SERVICE",
        provider: "BINANCE",
        service_type: "SEND",
      },
      {
        label: "Binance Recv",
        type: "FINANCIAL_SERVICE",
        provider: "BINANCE",
        service_type: "RECEIVE",
      },
    ],
  },
  {
    group: "Recharge",
    options: [
      { label: "MTC", type: "RECHARGE", provider: "MTC" },
      { label: "Alfa", type: "RECHARGE", provider: "Alfa" },
    ],
  },
  {
    group: "Top-ups",
    options: [
      { label: "MTC Top-up", type: "MTC_TOPUP" },
      { label: "Alfa Top-up", type: "ALFA_TOPUP" },
      { label: "iPick Top-up", type: "RECHARGE_TOPUP", provider: "iPick" },
      { label: "Katsh Top-up", type: "RECHARGE_TOPUP", provider: "Katsh" },
      {
        label: "Whish App Top-up",
        type: "RECHARGE_TOPUP",
        provider: "WHISH_APP",
      },
      { label: "OMT App Top-up", type: "RECHARGE_TOPUP", provider: "OMT_APP" },
      {
        label: "OMT System Top-up",
        type: "RECHARGE_TOPUP",
        provider: "OMT_SYSTEM",
      },
      {
        label: "Whish System Top-up",
        type: "RECHARGE_TOPUP",
        provider: "WHISH_SYSTEM",
      },
      { label: "General Top-up", type: "DRAWER_TOPUP" },
    ],
  },
  {
    group: "Loto",
    options: [
      { label: "Loto", type: "LOTO" },
      { label: "Loto Prize", type: "LOTO_CASH_PRIZE" },
      { label: "Loto Monthly Fee", type: "LOTO_MONTHLY_FEE" },
      { label: "Loto Settlement", type: "LOTO_SETTLEMENT" },
    ],
  },
  {
    group: "Other",
    options: [
      { label: "Sale", type: "SALE" },
      { label: "Exchange", type: "EXCHANGE" },
      { label: "Custom Service", type: "CUSTOM_SERVICE" },
      { label: "Maintenance", type: "MAINTENANCE" },
      { label: "Expense", type: "EXPENSE" },
      { label: "Debt Repayment", type: "DEBT_REPAYMENT" },
      { label: "Supplier Payment", type: "SUPPLIER_PAYMENT" },
      { label: "Supplier Settlement", type: "SUPPLIER_SETTLEMENT" },
      { label: "Checkpoint", type: "CHECKPOINT" },
      { label: "Refund", type: "REFUND" },
      { label: "Client Created", type: "CLIENT_CREATED" },
      { label: "Client Updated", type: "CLIENT_UPDATED" },
      { label: "Client Deleted", type: "CLIENT_DELETED" },
    ],
  },
];
