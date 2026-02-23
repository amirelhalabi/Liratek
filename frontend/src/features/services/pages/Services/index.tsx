import { useState, useEffect } from "react";
import logger from "../../../../utils/logger";
import {
  Send,
  ArrowDownToLine,
  History,
  TrendingUp,
  Calendar,
  User,
  Hash,
  Phone,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useSession } from "../../../sessions/context/SessionContext";
import { usePaymentMethods } from "../../../../hooks/usePaymentMethods";
import { Select, useApi } from "@liratek/ui";
import { DataTable } from "@/shared/components/DataTable";

type Provider = "OMT" | "WHISH";
type ServiceType = "SEND" | "RECEIVE";
type OmtServiceType =
  | "BILL_PAYMENT"
  | "CASH_TO_BUSINESS"
  | "MINISTRY_OF_INTERIOR"
  | "CASH_OUT"
  | "MINISTRY_OF_FINANCE"
  | "INTRA"
  | "ONLINE_BROKERAGE"
  | "WESTERN_UNION";

const OMT_SERVICE_OPTIONS: { value: OmtServiceType; label: string }[] = [
  { value: "BILL_PAYMENT", label: "Bill Payment" },
  { value: "CASH_TO_BUSINESS", label: "Cash To Business" },
  { value: "MINISTRY_OF_INTERIOR", label: "Ministry of Interior" },
  { value: "CASH_OUT", label: "Cash Out" },
  { value: "MINISTRY_OF_FINANCE", label: "Ministry of Finance" },
  { value: "INTRA", label: "INTRA" },
  { value: "ONLINE_BROKERAGE", label: "Online Brokerage" },
  { value: "WESTERN_UNION", label: "Western Union" },
];

const PROVIDERS: Provider[] = ["OMT", "WHISH"];
const SERVICE_TYPES: ServiceType[] = ["SEND", "RECEIVE"];

const PROVIDER_DEFAULT_METHOD: Record<Provider, string> = {
  OMT: "CASH",
  WHISH: "CASH",
};

const PROVIDER_COLORS: Record<
  Provider,
  { bg: string; activeBg: string; text: string }
> = {
  OMT: {
    bg: "bg-[#ffde00]/10",
    activeBg: "bg-[#ffde00]",
    text: "text-[#ffde00]",
  },
  WHISH: {
    bg: "bg-[#ff0a46]/10",
    activeBg: "bg-[#ff0a46]",
    text: "text-[#ff0a46]",
  },
};

const PROVIDER_BADGE_COLORS: Record<Provider, string> = {
  OMT: "bg-[#ffde00]/10 text-[#ffde00]",
  WHISH: "bg-[#ff0a46]/10 text-[#ff0a46]",
};

const SERVICE_TYPE_ICONS: Record<ServiceType, typeof Send> = {
  SEND: ArrowDownToLine,
  RECEIVE: Send,
};

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  SEND: "Money In",
  RECEIVE: "Money Out",
};

const INPUT_CLASS =
  "w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors";

function getBalanceColor(value: number): string {
  if (value > 0) return "text-red-400";
  if (value < 0) return "text-emerald-400";
  return "text-slate-500";
}

function getBalanceLabel(value: number, provider: string): string {
  if (value > 0) return `You owe ${provider}`;
  if (value < 0) return `${provider} owes you`;
  return "Settled";
}

function formatAmount(amount: number, currency: string): string {
  if (currency === "USD") return `$${amount.toFixed(2)}`;
  if (currency === "LBP") return `${amount.toLocaleString()} LBP`;
  if (currency === "EUR") return `\u20ac${amount.toFixed(2)}`;
  return `${amount} ${currency}`;
}

interface Analytics {
  today: { commission: number; count: number };
  month: { commission: number; count: number };
  byProvider: {
    provider: string;
    commission: number;
    currency: string;
    count: number;
  }[];
}

interface Transaction {
  id: number;
  provider: Provider;
  service_type: ServiceType;
  amount: number;
  currency: string;
  commission: number;
  client_name?: string;
  reference_number?: string;
  phone_number?: string;
  omt_service_type?: OmtServiceType;
  note?: string;
  created_at: string;
}

interface SupplierOwed {
  usd: number;
  lbp: number;
}

export default function Services() {
  const api = useApi();
  const { activeSession, linkTransaction } = useSession();
  const { drawerAffectingMethods } = usePaymentMethods();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [analytics, setAnalytics] = useState<Analytics>({
    today: { commission: 0, count: 0 },
    month: { commission: 0, count: 0 },
    byProvider: [],
  });
  const [owedByProvider, setOwedByProvider] = useState<
    Record<string, SupplierOwed>
  >({});

  // Form State
  const [provider, setProvider] = useState<Provider>("OMT");
  const [paidByMethod, setPaidByMethod] = useState("CASH");
  const [serviceType, setServiceType] = useState<ServiceType>("SEND");
  const [amount, setAmount] = useState<string>("");
  const currency = "USD"; // Fixed to USD only for now
  const [commission, setCommission] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [omtServiceType, setOmtServiceType] = useState<OmtServiceType | "">("INTRA");
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadData();

    // Auto-fill customer from active session
    if (activeSession && activeSession.customer_name) {
      setClientName(activeSession.customer_name);
    }
  }, [activeSession]);

  const loadData = async () => {
    try {
      const [history, stats, suppliers, balances] = await Promise.all([
        api.getOMTHistory(),
        api.getOMTAnalytics(),
        api.getSuppliers(),
        api.getSupplierBalances(),
      ]);
      setTransactions(
        history.map((h: any) => ({
          ...h,
          provider: h.provider as Provider,
          service_type: h.service_type as ServiceType,
        })),
      );
      setAnalytics(stats);

      // Build owed map by provider
      const owed: Record<string, SupplierOwed> = {};
      for (const s of suppliers) {
        if (s.provider && (s.provider === "OMT" || s.provider === "WHISH")) {
          const bal = balances.find((b: any) => b.supplier_id === s.id);
          owed[s.provider] = {
            usd: Number(bal?.total_usd || 0),
            lbp: Number(bal?.total_lbp || 0),
          };
        }
      }
      setOwedByProvider(owed);
    } catch (error) {
      logger.error("Failed to load data:", error);
    }
  };

  const handleSubmit = async () => {
    if (!amount) {
      alert("Please enter an amount.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.addOMTTransaction({
        provider,
        serviceType,
        amount: parseFloat(amount),
        currency,
        commission: parseFloat(commission) || 0,
        ...(clientName ? { clientName } : {}),
        ...(referenceNumber ? { referenceNumber } : {}),
        ...(phoneNumber ? { phoneNumber } : {}),
        ...(provider === "OMT" && omtServiceType ? { omtServiceType } : {}),
        note: note || `${provider} - ${serviceType}`,
        paidByMethod,
      });

      if (result.success) {
        // Link to active session if exists
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "financial_service",
              transactionId: result.id,
              amountUsd: parseFloat(amount),
              amountLbp: 0,
            });
          } catch (err) {
            logger.error("Failed to link service to session:", err);
            // Don't block the transaction completion
          }
        }

        // Reset form
        setAmount("");
        setCommission("");
        setClientName("");
        setReferenceNumber("");
        setPhoneNumber("");
        setOmtServiceType("INTRA");
        setNote("");
        loadData();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Operation failed", { error });
      alert("Transaction failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-6 animate-in fade-in duration-500">
      <h1 className="text-2xl font-bold text-white flex items-center gap-2">
        <Send className="text-[#ffde00]" />
        Financial Services
      </h1>

      {/* Stats Grid - Matching Dashboard style */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-[#ffde00]/10">
              <TrendingUp className="w-5 h-5 text-[#ffde00]" />
            </div>
          </div>
          <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
            Today's Earnings
          </h3>
          <p className="text-2xl font-bold text-white mt-1">
            ${analytics.today.commission.toFixed(2)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {analytics.today.count} transactions
          </p>
        </div>

        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="p-2 rounded-lg bg-blue-400/10">
              <Calendar className="w-5 h-5 text-blue-400" />
            </div>
          </div>
          <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
            Monthly Earnings
          </h3>
          <p className="text-2xl font-bold text-white mt-1">
            ${analytics.month.commission.toFixed(2)}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {analytics.month.count} transactions
          </p>
        </div>

        {/* Settlement cards — same card style */}
        {PROVIDERS.map((p) => {
          const owed = owedByProvider[p];
          const usd = owed?.usd ?? 0;
          const lbp = owed?.lbp ?? 0;
          const hasBalance = usd !== 0 || lbp !== 0;
          const usdLabel = getBalanceLabel(usd, p);
          const lbpLabel = getBalanceLabel(lbp, p);
          const usdColor = getBalanceColor(usd);
          const lbpColor = getBalanceColor(lbp);

          return (
            <div
              key={p}
              className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`p-2 rounded-lg ${PROVIDER_COLORS[p].bg}`}>
                  <AlertTriangle
                    className={`w-5 h-5 ${hasBalance ? PROVIDER_COLORS[p].text : "text-slate-500"}`}
                  />
                </div>
              </div>
              <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
                {p} Settlement
              </h3>
              <div className="mt-1 flex items-baseline gap-2">
                <span className={`text-2xl font-bold font-mono ${usdColor}`}>
                  ${Math.abs(usd).toFixed(2)}
                </span>
              </div>
              <p
                className={`text-[10px] uppercase tracking-wider mt-0.5 ${usdColor} opacity-75`}
              >
                {usdLabel}
              </p>
              {lbp !== 0 && (
                <p className={`text-xs font-mono mt-1 ${lbpColor}`}>
                  {Math.abs(lbp).toLocaleString()} LBP
                  <span className={`text-[10px] ml-1 opacity-75`}>
                    ({lbpLabel})
                  </span>
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 flex gap-6">
        {/* Left: Form */}
        <div className="w-1/3 min-w-[380px] bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg p-4 flex flex-col">
          {/* Provider Selector */}
          <div className="flex gap-2 p-1 bg-slate-900 rounded-xl mb-6">
            {PROVIDERS.map((p) => (
              <button
                key={p}
                onClick={() => {
                  setProvider(p);
                  setPaidByMethod(PROVIDER_DEFAULT_METHOD[p] || "CASH");
                }}
                className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all ${
                  provider === p
                    ? `${PROVIDER_COLORS[p].activeBg} ${p === "OMT" ? "text-black" : "text-white"} shadow-lg`
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Service Type */}
          <div className="flex gap-2 mb-6">
            {SERVICE_TYPES.map((type) => {
              const Icon = SERVICE_TYPE_ICONS[type];
              return (
                <button
                  key={type}
                  onClick={() => setServiceType(type)}
                  className={`flex-1 py-3 rounded-lg font-medium text-sm transition-all flex flex-col items-center gap-1 ${
                    serviceType === type
                      ? "bg-violet-600 text-white shadow-lg shadow-violet-900/20"
                      : "bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-700"
                  }`}
                >
                  <Icon size={18} />
                  {SERVICE_TYPE_LABELS[type]}
                </button>
              );
            })}
          </div>

          <div className="space-y-4 flex-1 min-h-0 overflow-y-auto">
            {/* Amount Field (USD Only) */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label
                  htmlFor="service-amount"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                >
                  Amount
                </label>
                <input
                  id="service-amount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="0.00"
                  step="0.01"
                />
              </div>
              <div>
                <span className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                  Currency
                </span>
                <div
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-slate-400 flex items-center justify-center font-medium"
                  aria-label="Currency: USD"
                >
                  USD
                </div>
              </div>
            </div>

            {/* Commission Field (USD only) */}
            <div className="p-4 rounded-xl bg-[#ffde00]/5 border border-[#ffde00]/20">
              <label
                htmlFor="service-commission"
                className="block text-xs font-medium text-[#ffde00] mb-3 uppercase tracking-wider"
              >
                Commission / Profit (USD)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#ffde00] font-bold">
                  $
                </span>
                <input
                  id="service-commission"
                  type="number"
                  value={commission}
                  onChange={(e) => setCommission(e.target.value)}
                  className="w-full bg-slate-900 border border-[#ffde00]/30 rounded-lg pl-8 pr-4 py-3 text-[#ffde00] font-bold focus:outline-none focus:border-[#ffde00] transition-colors"
                  placeholder="0.00"
                  step="0.01"
                />
              </div>
            </div>

            {/* Paid By */}
            <div>
              <label
                htmlFor="service-paid-by"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Paid By
              </label>
              <Select
                value={paidByMethod}
                onChange={setPaidByMethod}
                options={drawerAffectingMethods.map((m) => ({
                  value: m.code,
                  label: m.label,
                }))}
              />
            </div>

            {/* Client Info */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="service-client-name"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                >
                  <User size={12} /> Client Name
                </label>
                <input
                  id="service-client-name"
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="Optional"
                />
              </div>
              <div>
                <label
                  htmlFor="service-phone"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
                >
                  <Phone size={12} /> Phone #
                </label>
                <input
                  id="service-phone"
                  type="tel"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className={INPUT_CLASS}
                  placeholder="Optional"
                />
              </div>
            </div>

            {/* Reference # */}
            <div>
              <label
                htmlFor="service-reference"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
              >
                <Hash size={12} /> Reference #
              </label>
              <input
                id="service-reference"
                type="text"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                className={INPUT_CLASS}
                placeholder="Optional"
              />
            </div>

            {/* OMT Service Type - Only shown for OMT provider */}
            {provider === "OMT" && (
              <div>
                <label
                  htmlFor="service-omt-type"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                >
                  OMT Service
                </label>
                <Select
                  value={omtServiceType}
                  onChange={(v) => setOmtServiceType(v as OmtServiceType | "")}
                  options={[
                    { value: "", label: "— Select service —" },
                    ...OMT_SERVICE_OPTIONS,
                  ]}
                />
              </div>
            )}
          </div>

          {/* Submit Button - Matching Exchange style */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`w-full mt-6 py-4 rounded-xl font-bold text-lg shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 ${
              isSubmitting
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : `${PROVIDER_COLORS[provider].activeBg} text-white hover:opacity-90`
            }`}
          >
            {isSubmitting ? (
              "Processing..."
            ) : (
              <>
                {(() => {
                  const Icon = SERVICE_TYPE_ICONS[serviceType];
                  return <Icon size={20} />;
                })()}
                Record Transaction
              </>
            )}
          </button>
        </div>

        {/* Right: History - Matching Exchange table style */}
        <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg overflow-hidden flex flex-col">
          <div className="p-4 border-b border-slate-700 bg-slate-800 flex items-center justify-between">
            <h2 className="font-bold text-white flex items-center gap-2">
              <History className="text-slate-400" size={18} />
              Transaction History
            </h2>
            <button
              onClick={loadData}
              className="text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700"
            >
              <RefreshCw size={16} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            <DataTable<Transaction>
              columns={[
                { header: "Provider", className: "px-6 py-3" },
                { header: "Type", className: "px-6 py-3" },
                { header: "Amount", className: "px-6 py-3" },
                { header: "Commission", className: "px-6 py-3" },
                { header: "Client / Phone", className: "px-6 py-3" },
                { header: "Time", className: "px-6 py-3" },
              ]}
              data={transactions}
              exportExcel
              exportPdf
              exportFilename="services-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No transactions yet today."
              renderRow={(tx) => {
                const Icon = SERVICE_TYPE_ICONS[tx.service_type];
                const omtLabel = tx.omt_service_type
                  ? OMT_SERVICE_OPTIONS.find(
                      (o) => o.value === tx.omt_service_type,
                    )?.label
                  : null;
                return (
                  <tr
                    key={tx.id}
                    className="hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PROVIDER_BADGE_COLORS[tx.provider]}`}
                      >
                        {tx.provider}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-slate-300">
                        <Icon size={14} />
                        <span className="text-sm">
                          {SERVICE_TYPE_LABELS[tx.service_type]}
                        </span>
                      </div>
                      {omtLabel && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          {omtLabel}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-white">
                      {formatAmount(tx.amount, tx.currency)}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-emerald-400">
                      ${tx.commission.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-300">
                      {tx.client_name || "-"}
                      {tx.phone_number && (
                        <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                          <Phone size={10} />
                          {tx.phone_number}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      {new Date(tx.created_at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <div className="text-xs text-slate-500">
                        {new Date(tx.created_at).toLocaleDateString()}
                      </div>
                    </td>
                  </tr>
                );
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
