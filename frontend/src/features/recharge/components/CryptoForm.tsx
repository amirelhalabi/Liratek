import { User, Hash } from "lucide-react";
import { MultiPaymentInput, DoubleTab, type PaymentLine } from "@liratek/ui";
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
  cryptoFee: string;
  setCryptoFee: (val: string) => void;
  handleCryptoSubmit: () => void;
  isSubmitting: boolean;
  binanceTransactions: BinanceTransaction[];
  loadCryptoData: () => void;
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  paymentMethods: Array<{ code: string; label: string; drawer_name?: string }>;
  onPaymentLinesChange: (lines: PaymentLine[]) => void;
  exchangeRate: number;
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
  cryptoFee,
  setCryptoFee,
  handleCryptoSubmit,
  isSubmitting,
  binanceTransactions,
  loadCryptoData,
  showHistory,
  setShowHistory,
  paymentMethods,
  onPaymentLinesChange,
  exchangeRate,
}: CryptoFormProps) {
  if (!activeConfig) return null;

  const parsedAmount = parseFloat(cryptoAmount || "0");
  const fee = parseFloat(cryptoFee || "0");

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      {/* Send / Receive Tabs */}
      <DoubleTab
        leftOption={{ id: "SEND", label: "Send Crypto", iconKey: "Send" }}
        rightOption={{
          id: "RECEIVE",
          label: "Receive Crypto",
          iconKey: "Package",
        }}
        value={cryptoType}
        onChange={(val) => setCryptoType(val as "SEND" | "RECEIVE")}
        accentColor="amber"
        customColor="#f59e0b"
      />
      <p className="text-xs text-slate-400 text-center -mt-3 mb-1">
        {cryptoType === "SEND"
          ? "Sending USDT from shop Binance account"
          : "Receiving USDT to shop Binance account"}
      </p>

      {/* Amount Input */}
      <div>
        <label
          htmlFor="crypto-amount"
          className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
        >
          Amount (USDT)
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
            $
          </span>
          <input
            id="crypto-amount"
            type="number"
            value={cryptoAmount}
            onChange={(e) => setCryptoAmount(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-8 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-all"
            placeholder="0.00"
            min="0"
            step="0.01"
          />
        </div>
      </div>

      {/* Fee + Summary */}
      <div className="rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-2">
          Transaction Fee
        </h3>

        <div>
          <label
            htmlFor="crypto-fee"
            className="block text-xs text-slate-400 mb-1"
          >
            Fee Amount (USD) — Optional
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
              $
            </span>
            <input
              id="crypto-fee"
              type="number"
              value={cryptoFee}
              onChange={(e) => setCryptoFee(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-8 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-all"
              placeholder="0.00"
              min="0"
              step="0.01"
            />
          </div>
        </div>

        {/* Totals */}
        <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-700/50">
          <span className="text-slate-300 font-medium">Crypto Amount:</span>
          <span className="text-white font-mono font-bold">
            ${parsedAmount.toFixed(2)} USDT
          </span>
        </div>

        <div className="flex items-center justify-between text-xs pt-1">
          <span className="text-slate-400">Shop Profit (Fee):</span>
          <span
            className={`font-mono font-bold ${fee > 0 ? "text-emerald-400" : "text-slate-500"}`}
          >
            ${fee.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Client Name + Description */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label
            htmlFor="crypto-client"
            className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
          >
            <User size={12} /> Client Name
          </label>
          <input
            id="crypto-client"
            type="text"
            value={cryptoClientName}
            onChange={(e) => setCryptoClientName(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-all"
            placeholder="Optional"
          />
        </div>
        <div>
          <label
            htmlFor="crypto-description"
            className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
          >
            <Hash size={12} /> Notes
          </label>
          <input
            id="crypto-description"
            type="text"
            value={cryptoDescription}
            onChange={(e) => setCryptoDescription(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-all"
            placeholder="Wallet address, reference..."
          />
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Sticky Bottom Bar - Payment Method + Submit */}
      <div className="sticky bottom-0 bg-slate-800 rounded-xl border border-slate-700/50 p-4 shadow-2xl">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <MultiPaymentInput
              totalAmount={parsedAmount + fee}
              currency="USD"
              onChange={onPaymentLinesChange}
              requiresClientForDebt={true}
              hasClient={!!cryptoClientName}
              showPmFee={false}
              paymentMethods={paymentMethods}
              currencies={[
                { code: "USD", symbol: "$" },
                { code: "LBP", symbol: "LBP" },
              ]}
              exchangeRate={exchangeRate}
            />
          </div>

          <div className="text-right min-w-[150px]">
            <div className="text-xs text-slate-400">Total:</div>
            <div className="text-sm text-emerald-400 font-mono font-bold">
              ${(parsedAmount + fee).toFixed(2)}
            </div>
          </div>

          <button
            onClick={handleCryptoSubmit}
            disabled={isSubmitting || !cryptoAmount || parsedAmount <= 0}
            className={`px-6 py-3 rounded-lg font-bold text-white transition-all min-w-[140px] ${
              isSubmitting || !cryptoAmount || parsedAmount <= 0
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : "bg-amber-600 hover:bg-amber-500 shadow-lg shadow-amber-500/20"
            }`}
          >
            {isSubmitting ? "Processing..." : "Submit"}
          </button>
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
              commission: tx.commission ?? 0,
              client_name: tx.client_name ?? "",
              note: tx.description ?? "",
              paid_by: tx.paid_by ?? undefined,
              created_at: tx.created_at,
            };
            return result;
          })}
          provider="Binance"
          onClose={() => setShowHistory(false)}
          onRefresh={loadCryptoData}
          profitLabel="Fees"
        />
      )}
    </div>
  );
}
