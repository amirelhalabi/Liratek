import {
  PROVIDER_BRANDS,
  type ProviderBrandKey,
} from "@/shared/brand/providerBrands";

// =============================================================================
// Provider Types
// =============================================================================

export type TelecomProvider = "MTC" | "Alfa";
export type FinancialProvider = "iPick" | "Katsh" | "WHISH_APP" | "OMT_APP";
export type CryptoProvider = "BINANCE";
export type AnyProvider = TelecomProvider | FinancialProvider | CryptoProvider;

export type RechargeType =
  | "CREDIT_TRANSFER"
  | "VOUCHER"
  | "DAYS"
  | "TOP_UP"
  | "ALFA_GIFT";

export type ServiceType = "SEND" | "RECEIVE";

export type FormMode = "telecom" | "financial" | "crypto";

// =============================================================================
// Data Interfaces
// =============================================================================

export interface SupplierOwed {
  usd: number;
  lbp: number;
}

export interface FinancialTransaction {
  id: number;
  provider: string;
  service_type: ServiceType;
  amount: number;
  currency: string;
  cost?: number;
  commission: number;
  client_name?: string;
  reference_number?: string;
  paid_by?: string | undefined;
  note?: string;
  created_at: string;
  is_refunded?: number;
  refunded_at?: string | null;
  /** Telecom-specific: phone number that received the recharge */
  phone_number?: string | null;
  /** Set when a record was edited post-save (non-financial metadata edit) */
  edited_by?: string | null;
  edited_at?: string | null;
  /** The auto-calculated default price before any manual override (theft detection) */
  default_price_to_client?: number | null;
  /** LIRA-185 #4 — MTC/Alfa only: the sale is charged to a customer's
   *  account that is not yet repaid, so the Profits page is not counting its
   *  profit yet (`RechargeRepository.getHistory`'s `profit_pending`, the
   *  same `notDebtPending` rule). History shows a "pending until paid" label. */
  profit_pending?: boolean;
  /** LIRA-069 W1.c — set for card-grid catalog items/bills (Katsh/iPick/Whish
   *  App Bills), null for a plain SEND/RECEIVE transfer. Already selected by
   *  the repository's standard column list; just wasn't typed here before.
   *  Drives the History-modal Print button's receipt gating. */
  item_key?: string | null;
  /** MTC/Alfa only — the `recharges.recharge_type` (sale, TOP_UP,
   *  CREDIT_BUYBACK, …). Lets the History totals count sales only. */
  recharge_type?: string;
}

export interface BinanceTransaction {
  id: number;
  type: "SEND" | "RECEIVE";
  amount: number;
  currency_code: string;
  description: string | null;
  client_name: string | null;
  commission: number;
  paid_by: string | null;
  created_at: string;
  is_refunded?: number;
  refunded_at?: string | null;
}

// =============================================================================
// Provider Configuration
// =============================================================================

export interface ProviderConfig {
  key: AnyProvider;
  label: string;
  module: string;
  drawer: string;
  formMode: FormMode;
  color: string;
  bgTint: string;
  activeBg: string;
  activeText: string;
  badgeCls: string;
  iconKey: string;
  hasSupplier: boolean;
  /** The provider's brand: the tab shows its logo, and the colour classes
   *  above come from `PROVIDER_BRANDS`. */
  brand?: ProviderBrandKey;
}

export const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    key: "MTC",
    label: "MTC",
    module: "recharge",
    drawer: "MTC",
    formMode: "telecom",
    color: PROVIDER_BRANDS.MTC.text,
    bgTint: PROVIDER_BRANDS.MTC.tint,
    activeBg: PROVIDER_BRANDS.MTC.solid,
    activeText: "text-white",
    badgeCls: PROVIDER_BRANDS.MTC.badge,
    iconKey: "Signal",
    hasSupplier: false,
    brand: "MTC",
  },
  {
    key: "Alfa",
    label: "Alfa",
    module: "recharge",
    drawer: "Alfa",
    formMode: "telecom",
    color: PROVIDER_BRANDS.ALFA.text,
    bgTint: PROVIDER_BRANDS.ALFA.tint,
    activeBg: PROVIDER_BRANDS.ALFA.solid,
    activeText: "text-white",
    badgeCls: PROVIDER_BRANDS.ALFA.badge,
    iconKey: "Wifi",
    hasSupplier: false,
    brand: "ALFA",
  },
  {
    key: "iPick",
    label: "iPick",
    module: "ipec_katch",
    drawer: "iPick",
    formMode: "financial",
    color: PROVIDER_BRANDS.IPICK.text,
    bgTint: PROVIDER_BRANDS.IPICK.tint,
    activeBg: PROVIDER_BRANDS.IPICK.solid,
    activeText: "text-white",
    badgeCls: PROVIDER_BRANDS.IPICK.badge,
    iconKey: "Zap",
    hasSupplier: true,
    brand: "IPICK",
  },
  {
    key: "Katsh",
    label: "Katsh",
    module: "ipec_katch",
    drawer: "Katsh",
    formMode: "financial",
    color: PROVIDER_BRANDS.KATSH.text,
    bgTint: PROVIDER_BRANDS.KATSH.tint,
    activeBg: PROVIDER_BRANDS.KATSH.solid,
    activeText: "text-[#0057b7]",
    badgeCls: PROVIDER_BRANDS.KATSH.badge,
    iconKey: "Zap",
    hasSupplier: true,
    brand: "KATSH",
  },
  {
    key: "WHISH_APP",
    label: "Whish App",
    module: "ipec_katch",
    drawer: "Whish_App",
    formMode: "financial",
    color: PROVIDER_BRANDS.WHISH.text,
    bgTint: PROVIDER_BRANDS.WHISH.tint,
    activeBg: PROVIDER_BRANDS.WHISH.solid,
    activeText: "text-white",
    badgeCls: PROVIDER_BRANDS.WHISH.badge,
    iconKey: "Zap",
    hasSupplier: true,
    brand: "WHISH",
  },
  {
    key: "OMT_APP",
    label: "OMT App",
    module: "ipec_katch",
    drawer: "OMT_App",
    formMode: "financial",
    color: PROVIDER_BRANDS.OMT.text,
    bgTint: PROVIDER_BRANDS.OMT.tint,
    activeBg: PROVIDER_BRANDS.OMT.solid,
    activeText: "text-black",
    badgeCls: PROVIDER_BRANDS.OMT.badge,
    iconKey: "Zap",
    hasSupplier: true,
    brand: "OMT",
  },
  {
    key: "BINANCE",
    label: "Binance",
    module: "binance",
    drawer: "Binance",
    formMode: "crypto",
    color: PROVIDER_BRANDS.BINANCE.text,
    bgTint: PROVIDER_BRANDS.BINANCE.tint,
    activeBg: PROVIDER_BRANDS.BINANCE.solid,
    activeText: "text-[#0b0e11]",
    badgeCls: PROVIDER_BRANDS.BINANCE.badge,
    iconKey: "Bitcoin",
    hasSupplier: false,
    brand: "BINANCE",
  },
];

// =============================================================================
// Telecom Constants
// =============================================================================

export const TELECOM_SERVICE_TYPES: {
  id: RechargeType;
  label: string;
  iconKey: string;
}[] = [
  { id: "CREDIT_TRANSFER", label: "Credit", iconKey: "DollarSign" },
  { id: "DAYS", label: "Days", iconKey: "Clock" },
  { id: "ALFA_GIFT", label: "Alfa Gift", iconKey: "Zap" },
];

export const ALFA_GIFT_TIERS = {
  "1GB": { label: "1 GB", usd: 3.5 },
  "3GB": { label: "3 GB", usd: 6.9 },
  "7GB": { label: "7 GB", usd: 9.0 },
  "22GB": { label: "22 GB", usd: 14.5 },
  "44GB": { label: "44 GB", usd: 21.0 },
  "77GB": { label: "77 GB", usd: 31.0 },
  "111GB": { label: "111 GB", usd: 40.0 },
  "444GB": { label: "444 GB", usd: 129.0 },
} as const;

export const FINANCIAL_SERVICE_ICONS: Record<ServiceType, string> = {
  SEND: "Send",
  RECEIVE: "ArrowDownToLine",
};

// =============================================================================
// Cart & Form Types
// =============================================================================

export interface CurrencyStats {
  currency: string;
  commission: number;
  count: number;
  /** LIRA-163: count of this currency's commission_model = 1 rows still
   *  awaiting settlement (FinancialServiceRepository.getAnalytics). */
  awaiting_settlement_count?: number;
}

export interface ProviderAnalytics {
  today: {
    commission: number;
    count: number;
    /** @see CurrencyStats.awaiting_settlement_count, aggregated across
     *  currencies for the whole "today" bucket. */
    awaiting_settlement_count?: number;
    byCurrency?: CurrencyStats[];
  };
  byProvider: { provider: string; commission: number; count: number }[];
}

/** The brand of a provider key (e.g. "iPick" → "IPICK"), from its config. */
export function providerBrandOf(
  key: string | null | undefined,
): ProviderBrandKey | undefined {
  return PROVIDER_CONFIGS.find((p) => p.key === key)?.brand;
}
