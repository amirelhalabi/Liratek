import { useState, useEffect } from "react";
import {
  ArrowUpRight,
  ArrowDownLeft,
  History,
  Plus,
  TrendingUp,
  TrendingDown,
  Hash,
} from "lucide-react";
import * as api from "../../../../api/backendApi";
import { useSession } from "../../../sessions/context/SessionContext";

type BinanceTx = {
  id: number;
  type: "SEND" | "RECEIVE";
  amount: number;
  currency_code: string;
  description: string | null;
  client_name: string | null;
  created_at: string;
};

type TodayStats = {
  totalSent: number;
  totalReceived: number;
  count: number;
};

export default function Binance() {
  const { activeSession, linkTransaction } = useSession();

  const [transactions, setTransactions] = useState<BinanceTx[]>([]);
  const [stats, setStats] = useState<TodayStats>({
    totalSent: 0,
    totalReceived: 0,
    count: 0,
  });

  // Form state
  const [type, setType] = useState<"SEND" | "RECEIVE">("SEND");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [clientName, setClientName] = useState("");

  useEffect(() => {
    loadData();
    if (activeSession?.customer_name) {
      setClientName(activeSession.customer_name);
    }
  }, [activeSession]);

  const loadData = async () => {
    try {
      const [history, todayStats] = await Promise.all([
        api.getBinanceHistory(),
        api.getBinanceTodayStats(),
      ]);
      setTransactions(history);
      if (todayStats) setStats(todayStats);
    } catch (error) {
      console.error("Failed to load Binance data:", error);
    }
  };

  const handleSubmit = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      alert("Please enter a valid amount.");
      return;
    }

    try {
      const payload: {
        type: "SEND" | "RECEIVE";
        amount: number;
        currencyCode: string;
        description?: string;
        clientName?: string;
      } = { type, amount: amt, currencyCode: "USDT" };
      if (description) payload.description = description;
      if (clientName) payload.clientName = clientName;

      const result = await api.addBinanceTransaction(payload);

      if (result.success) {
        // Link to active session if any
        if (activeSession && result.id) {
          try {
            await linkTransaction({
              transactionType: "binance",
              transactionId: result.id,
              amountUsd: amt,
              amountLbp: 0,
            });
          } catch (err) {
            console.error("Failed to link Binance tx to session:", err);
          }
        }

        // Reset form and reload
        setAmount("");
        setDescription("");
        setClientName("");
        loadData();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      console.error(error);
      alert("Transaction failed");
    }
  };

  return (
    <div className="flex gap-6 h-full p-6">
      {/* Left Panel — Form */}
      <div className="w-[340px] flex-shrink-0 flex flex-col gap-4">
        {/* Stats Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-800 p-3 rounded-xl border border-slate-700/50 text-center">
            <TrendingUp size={14} className="text-red-400 mx-auto mb-1" />
            <p className="text-xs text-slate-400">Sent</p>
            <p className="text-sm font-bold text-red-400">
              $
              {stats.totalSent.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          <div className="bg-slate-800 p-3 rounded-xl border border-slate-700/50 text-center">
            <TrendingDown size={14} className="text-emerald-400 mx-auto mb-1" />
            <p className="text-xs text-slate-400">Received</p>
            <p className="text-sm font-bold text-emerald-400">
              $
              {stats.totalReceived.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </p>
          </div>
          <div className="bg-slate-800 p-3 rounded-xl border border-slate-700/50 text-center">
            <Hash size={14} className="text-violet-400 mx-auto mb-1" />
            <p className="text-xs text-slate-400">Today</p>
            <p className="text-sm font-bold text-violet-400">{stats.count}</p>
          </div>
        </div>

        {/* Transaction Form */}
        <div className="bg-slate-800 p-5 rounded-xl border border-slate-700/50 flex flex-col gap-4">
          <h3 className="text-md font-bold text-white flex items-center gap-2">
            <Plus size={16} className="text-amber-400" />
            New Transaction
          </h3>

          {/* Type Toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setType("SEND")}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                type === "SEND"
                  ? "bg-red-500/20 text-red-400 border border-red-500/50"
                  : "bg-slate-700/50 text-slate-400 border border-slate-600/50 hover:bg-slate-700"
              }`}
            >
              <ArrowUpRight size={16} />
              Send
            </button>
            <button
              onClick={() => setType("RECEIVE")}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                type === "RECEIVE"
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/50"
                  : "bg-slate-700/50 text-slate-400 border border-slate-600/50 hover:bg-slate-700"
              }`}
            >
              <ArrowDownLeft size={16} />
              Receive
            </button>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Amount (USDT)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            />
          </div>

          {/* Client Name */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Client Name (optional)
            </label>
            <input
              type="text"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Client name"
              className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Notes, reference, reason..."
              rows={3}
              className="w-full bg-slate-700/50 border border-slate-600/50 rounded-lg px-3 py-2.5 text-white text-sm placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50 resize-none"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            className={`w-full py-3 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 ${
              type === "SEND"
                ? "bg-red-500 hover:bg-red-600 text-white"
                : "bg-emerald-500 hover:bg-emerald-600 text-white"
            }`}
          >
            {type === "SEND" ? (
              <ArrowUpRight size={16} />
            ) : (
              <ArrowDownLeft size={16} />
            )}
            Confirm {type === "SEND" ? "Send" : "Receive"}
          </button>
        </div>
      </div>

      {/* Right Panel — History */}
      <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700/50 flex flex-col overflow-hidden">
        <div className="p-5 border-b border-slate-700/50 flex items-center gap-2">
          <History size={16} className="text-amber-400" />
          <h3 className="text-md font-bold text-white">Transaction History</h3>
          <span className="text-xs text-slate-500 ml-auto">
            Last {transactions.length} transactions
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {transactions.length === 0 ? (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm">
              No transactions yet
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-800/95 backdrop-blur">
                <tr className="text-slate-400 text-xs border-b border-slate-700/50">
                  <th className="text-left px-5 py-3 font-medium">Time</th>
                  <th className="text-left px-3 py-3 font-medium">Type</th>
                  <th className="text-right px-3 py-3 font-medium">Amount</th>
                  <th className="text-left px-3 py-3 font-medium">Client</th>
                  <th className="text-left px-5 py-3 font-medium">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr
                    key={tx.id}
                    className="border-b border-slate-700/30 hover:bg-slate-700/20 transition-colors"
                  >
                    <td className="px-5 py-3 text-slate-300 whitespace-nowrap">
                      {new Date(tx.created_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full ${
                          tx.type === "SEND"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-emerald-500/20 text-emerald-400"
                        }`}
                      >
                        {tx.type === "SEND" ? (
                          <ArrowUpRight size={12} />
                        ) : (
                          <ArrowDownLeft size={12} />
                        )}
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right font-mono font-semibold text-white">
                      $
                      {Number(tx.amount).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-3 py-3 text-slate-300">
                      {tx.client_name || "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-400 max-w-[250px] truncate">
                      {tx.description || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
