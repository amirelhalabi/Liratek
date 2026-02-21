import { useState, useEffect, useRef } from "react";
import logger from "../../../../utils/logger";
import {
  Send,
  ArrowDownToLine,
  Receipt,
  History,
  TrendingUp,
  Calendar,
  User,
  Hash,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useSession } from "../../../sessions/context/SessionContext";
import { usePaymentMethods } from "../../../../hooks/usePaymentMethods";
import { Select, useApi } from "@liratek/ui";
import { ExportBar } from "@/shared/components/ExportBar";

type Provider = "OMT" | "WHISH";
type ServiceType = "SEND" | "RECEIVE" | "BILL_PAYMENT";

const PROVIDER_DEFAULT_METHOD: Record<Provider, string> = {
  OMT: "OMT",
  WHISH: "WHISH",
};

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
  const tableRef = useRef<HTMLTableElement>(null);
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
  const [paidByMethod, setPaidByMethod] = useState("OMT");
  const [serviceType, setServiceType] = useState<ServiceType>("SEND");
  const [amount, setAmount] = useState<string>("");
  const currency = "USD"; // Fixed to USD only for now
  const [commission, setCommission] = useState<string>("");
  const [clientName, setClientName] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
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

  const providerColors: Record<
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

  const providerBadgeColors: Record<Provider, string> = {
    OMT: "bg-[#ffde00]/10 text-[#ffde00]",
    WHISH: "bg-[#ff0a46]/10 text-[#ff0a46]",
  };

  const serviceTypeIcons: Record<ServiceType, typeof Send> = {
    SEND: Send,
    RECEIVE: ArrowDownToLine,
    BILL_PAYMENT: Receipt,
  };

  const formatAmount = (amount: number, currency: string) => {
    if (currency === "USD") {
      return `$${amount.toFixed(2)}`;
    } else if (currency === "LBP") {
      return `${amount.toLocaleString()} LBP`;
    } else if (currency === "EUR") {
      return `€${amount.toFixed(2)}`;
    }
    return `${amount} ${currency}`;
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

        {/* Provider breakdown - Show up to 2 */}
        {analytics.byProvider.slice(0, 2).map((p) => (
          <div
            key={p.provider}
            className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 shadow-lg hover:border-slate-600 transition-colors"
          >
            <div className="flex items-center justify-between mb-3">
              <div
                className={`p-2 rounded-lg ${providerColors[p.provider as Provider].bg}`}
              >
                <Send
                  className={`w-5 h-5 ${providerColors[p.provider as Provider].text}`}
                />
              </div>
            </div>
            <h3 className="text-slate-500 text-xs font-medium uppercase tracking-wider">
              {p.provider} Today
            </h3>
            <p className="text-2xl font-bold text-white mt-1">
              ${p.commission.toFixed(2)}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {p.count} transactions
            </p>
          </div>
        ))}
      </div>

      {/* Owed to Suppliers */}
      <div className="grid grid-cols-2 gap-4">
        {(["OMT", "WHISH"] as Provider[]).map((p) => {
          const owed = owedByProvider[p];
          const hasDebt = owed && (owed.usd !== 0 || owed.lbp !== 0);
          return (
            <div
              key={p}
              className="bg-slate-800 border border-slate-700/50 rounded-xl p-4 flex items-center gap-4"
            >
              <div className={`p-2 rounded-lg ${providerColors[p].bg}`}>
                <AlertTriangle
                  className={`w-5 h-5 ${hasDebt ? "text-red-400" : "text-slate-500"}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">
                  Owed to {p}
                </div>
                <div className="flex items-baseline gap-3 mt-1">
                  <span
                    className={`text-lg font-bold font-mono ${hasDebt ? "text-red-400" : "text-slate-500"}`}
                  >
                    ${(owed?.usd ?? 0).toFixed(2)}
                  </span>
                  <span
                    className={`text-sm font-mono ${hasDebt ? "text-red-400/70" : "text-slate-600"}`}
                  >
                    {(owed?.lbp ?? 0).toLocaleString()} LBP
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex-1 min-h-0 flex gap-6">
        {/* Left: Form */}
        <div className="w-1/3 min-w-[380px] bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg p-4 flex flex-col">
          {/* Provider Selector */}
          <div className="flex gap-2 p-1 bg-slate-900 rounded-xl mb-6">
            {(["OMT", "WHISH"] as Provider[]).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setProvider(p);
                  setPaidByMethod(PROVIDER_DEFAULT_METHOD[p] || "CASH");
                }}
                className={`flex-1 py-2.5 rounded-lg font-bold text-sm transition-all ${
                  provider === p
                    ? `${providerColors[p].activeBg} ${p === "OMT" ? "text-black" : "text-white"} shadow-lg`
                    : "text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                {p}
              </button>
            ))}
          </div>

          {/* Service Type */}
          <div className="flex gap-2 mb-6">
            {(["SEND", "RECEIVE", "BILL_PAYMENT"] as ServiceType[]).map(
              (type) => {
                const Icon = serviceTypeIcons[type];
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
                    {type === "BILL_PAYMENT"
                      ? "Bill"
                      : type.charAt(0) + type.slice(1).toLowerCase()}
                  </button>
                );
              },
            )}
          </div>

          <div className="space-y-4 flex-1">
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
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors"
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
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors"
                  placeholder="Optional"
                />
              </div>
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
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 transition-colors"
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>

          {/* Submit Button - Matching Exchange style */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`w-full mt-6 py-4 rounded-xl font-bold text-lg shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 ${
              isSubmitting
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : `${providerColors[provider].activeBg} text-white hover:opacity-90`
            }`}
          >
            {isSubmitting ? (
              "Processing..."
            ) : (
              <>
                {serviceType === "SEND" && <Send size={20} />}
                {serviceType === "RECEIVE" && <ArrowDownToLine size={20} />}
                {serviceType === "BILL_PAYMENT" && <Receipt size={20} />}
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
            <ExportBar
              exportExcel
              exportPdf
              exportFilename="services-history"
              tableRef={tableRef}
              rowCount={transactions.length}
            />
            <table ref={tableRef} className="w-full">
              <thead className="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0">
                <tr>
                  <th className="px-6 py-3">Provider</th>
                  <th className="px-6 py-3">Type</th>
                  <th className="px-6 py-3">Amount</th>
                  <th className="px-6 py-3">Commission</th>
                  <th className="px-6 py-3">Client</th>
                  <th className="px-6 py-3">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {transactions.map((tx) => {
                  const Icon = serviceTypeIcons[tx.service_type];
                  return (
                    <tr
                      key={tx.id}
                      className="hover:bg-slate-700/20 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${providerBadgeColors[tx.provider]}`}
                        >
                          {tx.provider}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2 text-slate-300">
                          <Icon size={14} />
                          <span className="text-sm">
                            {tx.service_type === "BILL_PAYMENT"
                              ? "Bill"
                              : tx.service_type.charAt(0) +
                                tx.service_type.slice(1).toLowerCase()}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-white">
                        {formatAmount(tx.amount, tx.currency)}
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-emerald-400">
                        ${tx.commission.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-300">
                        {tx.client_name || "-"}
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
                })}
                {transactions.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-6 py-8 text-center text-slate-500 text-sm"
                    >
                      No transactions yet today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
