// =============================================================================
// Provider Types
// =============================================================================

export type TelecomProvider = "MTC" | "Alfa";
export type FinancialProvider = "iPick" | "Katsh" | "WISH_APP" | "OMT_APP";
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
}

export const PROVIDER_CONFIGS: ProviderConfig[] = [
  {
    key: "MTC",
    label: "MTC",
    module: "recharge",
    drawer: "MTC",
    formMode: "telecom",
    color: "text-cyan-400",
    bgTint: "bg-cyan-400/10",
    activeBg: "bg-cyan-600",
    activeText: "text-white",
    badgeCls: "bg-cyan-400/10 text-cyan-400",
    iconKey: "Signal",
    hasSupplier: false,
  },
  {
    key: "Alfa",
    label: "Alfa",
    module: "recharge",
    drawer: "Alfa",
    formMode: "telecom",
    color: "text-red-400",
    bgTint: "bg-red-400/10",
    activeBg: "bg-red-600",
    activeText: "text-white",
    badgeCls: "bg-red-400/10 text-red-400",
    iconKey: "Wifi",
    hasSupplier: false,
  },
  {
    key: "iPick",
    label: "iPick",
    module: "ipec_katch",
    drawer: "iPick",
    formMode: "financial",
    color: "text-sky-400",
    bgTint: "bg-sky-400/10",
    activeBg: "bg-sky-500",
    activeText: "text-white",
    badgeCls: "bg-sky-400/10 text-sky-400",
    iconKey: "Zap",
    hasSupplier: true,
  },
  {
    key: "Katsh",
    label: "Katsh",
    module: "ipec_katch",
    drawer: "Katsh",
    formMode: "financial",
    color: "text-orange-400",
    bgTint: "bg-orange-400/10",
    activeBg: "bg-orange-500",
    activeText: "text-white",
    badgeCls: "bg-orange-400/10 text-orange-400",
    iconKey: "Zap",
    hasSupplier: true,
  },
  {
    key: "WISH_APP",
    label: "Whish App",
    module: "ipec_katch",
    drawer: "Whish_App",
    formMode: "financial",
    color: "text-[#ff0a46]",
    bgTint: "bg-[#ff0a46]/10",
    activeBg: "bg-[#ff0a46]",
    activeText: "text-white",
    badgeCls: "bg-[#ff0a46]/10 text-[#ff0a46]",
    iconKey: "Zap",
    hasSupplier: true,
  },
  {
    key: "OMT_APP",
    label: "OMT App",
    module: "ipec_katch",
    drawer: "OMT_App",
    formMode: "financial",
    color: "text-[#ffde00]",
    bgTint: "bg-[#ffde00]/10",
    activeBg: "bg-[#ffde00]",
    activeText: "text-black",
    badgeCls: "bg-[#ffde00]/10 text-[#ffde00]",
    iconKey: "Zap",
    hasSupplier: true,
  },
  {
    key: "BINANCE",
    label: "Binance",
    module: "binance",
    drawer: "Binance",
    formMode: "crypto",
    color: "text-amber-400",
    bgTint: "bg-amber-400/10",
    activeBg: "bg-amber-600",
    activeText: "text-white",
    badgeCls: "bg-amber-400/10 text-amber-400",
    iconKey: "Bitcoin",
    hasSupplier: false,
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
  { id: "VOUCHER", label: "Voucher", iconKey: "CreditCard" },
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

export interface ProviderAnalytics {
  today: { commission: number; count: number };
  byProvider: { provider: string; commission: number; count: number }[];
}
