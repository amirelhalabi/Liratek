import {
  ArrowUpRight,
  ArrowDownLeft,
  User,
  Hash,
  DollarSign,
} from "lucide-react";
import { ServiceTypeTabs, type ServiceTypeOption } from "@liratek/ui";
import type {
  ProviderConfig,
  BinanceTransaction,
  FinancialTransaction,
} from "../types";
import { HistoryModal } from "./HistoryModal";

interface CryptoFormProps {
  activeConfig: ProviderConfig | undefined;
  cryptoType: "SEND" | "RECEIVE";
  setCryptoType: (type: "SEND" | "RECEIVE") => void;
  cryptoAmount: string;
  setCryptoAmount: (val: string) => void;
  cryptoClientName: string;
  setCryptoClientName: (val: string) => void;
  cryptoDescription: string;
  setCryptoDescription: (val: string) => void;
  handleCryptoSubmit: () => void;
  isSubmitting: boolean;
  binanceTransactions: BinanceTransaction[];
  loadCryptoData: () => void;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
}

export function CryptoForm({
  activeConfig,
  cryptoType,
  setCryptoType,
  cryptoAmount,
  setCryptoAmount,
  cryptoClientName,
  setCryptoClientName,
  cryptoDescription,
  setCryptoDescription,
  handleCryptoSubmit,
  isSubmitting,
  binanceTransactions,
  loadCryptoData,
  showHistory,
  setShowHistory,
}: CryptoFormProps) {
  if (!activeConfig) return null;

  const todayStats = binanceTransactions
    .filter(
      (tx) =>
        new Date(tx.created_at).toDateString() === new Date().toDateString(),
    )
    .reduce(
      (acc, tx) => ({
        sent: acc.sent + (tx.type === "SEND" ? tx.amount : 0),
        received: acc.received + (tx.type === "RECEIVE" ? tx.amount : 0),
        count: acc.count + 1,
      }),
      { sent: 0, received: 0, count: 0 },
    );

  return (
    <>
      <div className="flex flex-col gap-5 h-full">
        {/* Service Type Tabs */}
        <ServiceTypeTabs
          options={
            [
              { id: "SEND", label: "Send Crypto", iconKey: "Send" },
              { id: "RECEIVE", label: "Receive Crypto", iconKey: "Package" },
            ] as ServiceTypeOption[]
          }
          value={cryptoType}
          onChange={(val) => setCryptoType(val as "SEND" | "RECEIVE")}
          accentColor="amber"
        />

        {/* Form Card */}
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-6">
            <div className="max-w-2xl mx-auto space-y-6">
              {/* Amount */}
              <div>
                <label
                  htmlFor="crypto-amount"
                  className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider flex items-center gap-1"
                >
                  <DollarSign size={12} /> Amount (USDT)
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-amber-400 font-bold text-xl">
                    $
                  </span>
                  <input
                    id="crypto-amount"
                    type="number"
                    value={cryptoAmount}
                    onChange={(e) => setCryptoAmount(e.target.value)}
                    className="w-full bg-slate-900/80 border border-slate-600 rounded-xl pl-12 pr-4 py-4 text-2xl font-bold text-white focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 transition-all"
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              {/* Quick Amount Buttons */}
              <div className="grid grid-cols-4 gap-2">
                {[10, 50, 100, 500, 1000, 2000, 5000, 10000].map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setCryptoAmount(amt.toString())}
                    className={`py-2.5 rounded-xl font-bold text-sm transition-all border ${
                      cryptoAmount === amt.toString()
                        ? "bg-amber-500/15 text-amber-400 border-amber-500/40"
                        : "bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white"
                    }`}
                  >
                    ${amt.toLocaleString()}
                  </button>
                ))}
              </div>

              {/* Client */}
              <div>
                <label
                  htmlFor="crypto-client"
                  className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider flex items-center gap-1"
                >
                  <User size={12} /> Client Name
                </label>
                <input
                  id="crypto-client"
                  type="text"
                  value={cryptoClientName}
                  onChange={(e) => setCryptoClientName(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors"
                  placeholder="Optional"
                />
              </div>

              {/* Description */}
              <div>
                <label
                  htmlFor="crypto-description"
                  className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider flex items-center gap-1"
                >
                  <Hash size={12} /> Description / Notes
                </label>
                <textarea
                  id="crypto-description"
                  value={cryptoDescription}
                  onChange={(e) => setCryptoDescription(e.target.value)}
                  placeholder="Transaction notes, reference, wallet address, etc..."
                  rows={4}
                  className="w-full bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500 transition-colors resize-none"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Bottom Bar */}
        <div className="sticky bottom-0 bg-slate-800 rounded-xl border border-slate-700/50 p-4 shadow-2xl">
          <div className="flex items-center gap-4">
            {/* Stats Summary */}
            <div className="flex-1 grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-xs text-slate-400 mb-1">Sent Today</div>
                <div className="text-lg font-bold text-red-400">
                  $
                  {todayStats.sent.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}
                </div>
              </div>
              <div className="text-center border-x border-slate-700">
                <div className="text-xs text-slate-400 mb-1">
                  Received Today
                </div>
                <div className="text-lg font-bold text-emerald-400">
                  $
                  {todayStats.received.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                  })}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-slate-400 mb-1">Transactions</div>
                <div className="text-lg font-bold text-white">
                  {todayStats.count}
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleCryptoSubmit}
              disabled={isSubmitting || !cryptoAmount}
              className={`px-8 py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${
                isSubmitting || !cryptoAmount
                  ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                  : cryptoType === "SEND"
                    ? "bg-amber-600 hover:bg-amber-500 text-white shadow-lg shadow-amber-500/20"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
              }`}
            >
              {isSubmitting ? (
                "Processing..."
              ) : cryptoType === "SEND" ? (
                <>
                  <ArrowUpRight size={20} />
                  Send
                </>
              ) : (
                <>
                  <ArrowDownLeft size={20} />
                  Receive
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* History Modal */}
      {showHistory && (
        <HistoryModal
          transactions={binanceTransactions.map((tx) => {
            const result: FinancialTransaction = {
              id: tx.id,
              provider: "BINANCE",
              service_type: tx.type,
              amount: tx.amount,
              currency: tx.currency_code,
              cost: 0,
              commission: 0,
              client_name: tx.client_name ?? "",
              note: tx.description ?? "",
              created_at: tx.created_at,
            };
            return result;
          })}
          provider="Binance"
          onClose={() => setShowHistory(false)}
          onRefresh={loadCryptoData}
        />
      )}
    </>
  );
}
