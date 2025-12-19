import React, { useState, useEffect, useMemo } from "react";
import { Search, User, ArrowDownLeft, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "@/features/auth/context/AuthContext";
import { EXCHANGE_RATE } from "@/config/constants";
import { roundLBPUp } from "@/config/denominations";

type DebtFilter = "ongoing" | "closed" | "all";
type SortOrder = "desc" | "asc";

export default function Debts() {
  const { user } = useAuth();
  type Debtor = { id: number; full_name: string; phone_number?: string; total_debt: number };
  type DebtHistoryItem = { id: number; created_at: string; amount_usd: number; amount_lbp: number; note?: string; is_paid: boolean };
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [selectedClient, setSelectedClient] = useState<Debtor | null>(null);
  const [history, setHistory] = useState<DebtHistoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showRepaymentModal, setShowRepaymentModal] = useState(false);
  const [totalDebt, setTotalDebt] = useState(0);
  const [debtFilter, setDebtFilter] = useState<DebtFilter>("ongoing"); // New state for filter
  const [dateSortOrder, setDateSortOrder] = useState<SortOrder>("desc"); // Default: most recent first

  // Repayment State
  const [repayAmountUSD, setRepayAmountUSD] = useState<string>("");
  const [repayAmountLBP, setRepayAmountLBP] = useState<string>("");
  const [repayNote, setRepayNote] = useState("");

  useEffect(() => {
    loadDebtors();
    // Fetch exchange rate on mount if possible
  }, []);

  useEffect(() => {
    if (selectedClient) {
      loadHistory(selectedClient.id);
      loadClientTotal(selectedClient.id);
    }
  }, [selectedClient]);

  const loadDebtors = async () => {
    try {
      // Now getDebtors returns all clients with debt history
      const data = await window.api.getDebtors();
      setDebtors(data);
    } catch (error) {
      console.error("Failed to load debtors:", error);
    }
  };

  const loadHistory = async (clientId: number) => {
    try {
      const data = await window.api.getClientDebtHistory(clientId);
      setHistory(data);
      // Reset sort to default (desc) when loading new client
      setDateSortOrder("desc");
    } catch (error) {
      console.error("Failed to load history:", error);
    }
  };

  // Sorted history based on current sort order
  const sortedHistory = useMemo(() => {
    if (!history.length) return [];
    const sorted = [...history];
    sorted.sort((a, b) => {
      const dateA = new Date(a.created_at).getTime();
      const dateB = new Date(b.created_at).getTime();
      return dateSortOrder === "desc" ? dateB - dateA : dateA - dateB;
    });
    return sorted;
  }, [history, dateSortOrder]);

  const toggleDateSort = () => {
    setDateSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  };

  const loadClientTotal = async (clientId: number) => {
    try {
      const total = await window.api.getClientDebtTotal(clientId);
      setTotalDebt(total || 0);
    } catch (error) {
      console.error("Failed to load client total:", error);
    }
  };

  const handleProcessRepayment = async () => {
    if (!selectedClient) return;

    const usd = parseFloat(repayAmountUSD) || 0;
    const lbp = parseFloat(repayAmountLBP) || 0;

    if (usd === 0 && lbp === 0) {
      alert("Please enter an amount.");
      return;
    }

    try {
      const result = await window.api.addRepayment({
        clientId: selectedClient.id,
        amountUSD: usd,
        amountLBP: lbp,
        note: repayNote,
        ...(user?.id != null ? { userId: user.id } : {}),
      });

      if (result.success) {
        alert("Repayment processed!");
        setShowRepaymentModal(false);
        setRepayAmountUSD("");
        setRepayAmountLBP("");
        setRepayNote("");
        
        // Reload debtors list
        await loadDebtors();
        
        // Check if client still has debt after repayment
        const updatedTotal = await window.api.getClientDebtTotal(selectedClient.id);
        
        if (updatedTotal > 0.01) {
          // Client still has debt, reload their history
          loadHistory(selectedClient.id);
          loadClientTotal(selectedClient.id);
        } else {
          // Client's debt is fully closed, deselect them
          setSelectedClient(null);
          setHistory([]);
          setTotalDebt(0);
        }
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      console.error(error);
      alert("Failed to process repayment");
    }
  };

  const filteredDebtors = debtors.filter((d) => {
    const matchesSearch =
      d.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.phone_number?.includes(searchTerm);

    if (!matchesSearch) return false;

    if (debtFilter === "ongoing") {
      return d.total_debt > 0.01;
    } else if (debtFilter === "closed") {
      return d.total_debt <= 0.01;
    }
    return true; // 'all' filter
  });

  // Auto-select first client when filtered list changes
  useEffect(() => {
    if (filteredDebtors.length > 0 && !selectedClient) {
      setSelectedClient(filteredDebtors[0]);
    } else if (filteredDebtors.length === 0) {
      setSelectedClient(null);
    }
  }, [filteredDebtors, selectedClient]);

  return (
    <div className="flex h-full min-h-0 gap-6 overflow-hidden">
      {/* Left: Debtors List */}
      <div className="w-1/3 flex flex-col bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
        <div className="p-4 border-b border-slate-700 space-y-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <User className="text-red-400" />
            Client Debts
          </h2>
          <div className="relative">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              size={18}
            />
            <input
              type="text"
              placeholder="Search client..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-red-500"
            />
          </div>
          {/* New filter dropdown */}
          <div className="mt-4">
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Show Debts:
            </label>
            <select
              value={debtFilter}
              onChange={(e) => {
                setDebtFilter(e.target.value as DebtFilter);
                setSelectedClient(null); // Reset selected client
              }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-red-500"
            >
              <option value="ongoing">Ongoing</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filteredDebtors.map((client) => (
            <button
              key={client.id}
              onClick={() => setSelectedClient(client)}
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                selectedClient?.id === client.id
                  ? "bg-red-500/10 border-red-500/50 shadow-md"
                  : "bg-slate-700/30 border-transparent hover:bg-slate-700/50"
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-bold text-slate-200">
                    {client.full_name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {client.phone_number || "No Phone"}
                  </div>
                </div>
                <div className="text-red-400 font-bold">
                  ${client.total_debt.toFixed(2)}
                </div>
              </div>
            </button>
          ))}
          {filteredDebtors.length === 0 && (
            <div className="text-center text-slate-500 py-8">
              No debtors found.
            </div>
          )}
        </div>
      </div>

      {/* Right: Details & History */}
      <div className="flex-1 flex flex-col bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
        {selectedClient ? (
          <>
            <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
              <div>
                <h2 className="text-2xl font-bold text-white">
                  {selectedClient.full_name}
                </h2>
                <p className="text-slate-400">
                  Total Debt:{" "}
                  <span className="text-red-400 font-bold">
                    ${totalDebt.toFixed(2)}
                  </span>
                  {totalDebt > 0 && (() => {
                    const integerUSD = Math.floor(totalDebt);
                    const fractionUSD = totalDebt - integerUSD;
                    const rawLBP = fractionUSD * EXCHANGE_RATE;
                    const roundedLBP = roundLBPUp(rawLBP);
                    
                    return (
                      <span className="text-xs text-slate-500 ml-2">
                        (i.e., ${integerUSD.toLocaleString()} + {roundedLBP.toLocaleString()} LBP)
                      </span>
                    );
                  })()}
                </p>
              </div>
              <button
                onClick={() => {
                  // Calculate autofill amounts based on debt breakdown
                  const integerUSD = Math.floor(totalDebt);
                  const fractionUSD = totalDebt - integerUSD;
                  const rawLBP = fractionUSD * EXCHANGE_RATE;
                  const roundedLBP = roundLBPUp(rawLBP);
                  
                  // Autofill the modal inputs
                  setRepayAmountUSD(integerUSD.toString());
                  setRepayAmountLBP(roundedLBP.toString());
                  setShowRepaymentModal(true);
                }}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-emerald-900/20 active:scale-95 transition-all flex items-center gap-2"
              >
                <ArrowDownLeft size={20} />
                Settle Debt
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <table className="w-full">
                <thead className="text-left text-slate-400 border-b border-slate-700">
                  <tr>
                    <th className="pb-3 text-sm font-medium">
                      <button
                        onClick={toggleDateSort}
                        className="flex items-center gap-1 hover:text-slate-200 transition-colors group"
                      >
                        Date
                        {dateSortOrder === "desc" ? (
                          <ChevronDown size={16} className="text-slate-500 group-hover:text-slate-300" />
                        ) : (
                          <ChevronUp size={16} className="text-slate-500 group-hover:text-slate-300" />
                        )}
                      </button>
                    </th>
                    <th className="pb-3 text-sm font-medium">Type</th>
                    <th className="pb-3 text-sm font-medium">Note</th>
                    <th className="pb-3 text-sm font-medium text-center" colSpan={2}>
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {sortedHistory.map((item, index) => {
                    // Show "Paid Fully" breakpoint if this is the transition from unpaid to paid
                    const showPaidFullyBreakpoint =
                      index > 0 &&
                      sortedHistory[index - 1].is_paid === false &&
                      item.is_paid === true;

                    return (
                      <React.Fragment key={item.id}>
                        {/* Paid Fully Breakpoint */}
                        {showPaidFullyBreakpoint && (
                          <tr>
                            <td colSpan={4} className="py-3">
                              <div className="flex items-center gap-3 text-emerald-400">
                                <div className="flex-1 h-px bg-emerald-500/30"></div>
                                <span className="text-xs font-bold px-3 py-1 bg-emerald-500/10 rounded-full">
                                  PAID FULLY
                                </span>
                                <div className="flex-1 h-px bg-emerald-500/30"></div>
                              </div>
                            </td>
                          </tr>
                        )}
                        <tr className="group hover:bg-slate-700/20">
                          <td className="py-3 text-slate-300">
                            {new Date(item.created_at).toLocaleDateString()}
                            <div className="text-xs text-slate-500">
                              {new Date(item.created_at).toLocaleTimeString()}
                            </div>
                          </td>
                          <td className="py-3">
                            <span
                              className={`px-2 py-1 rounded text-xs font-bold ${
                                item.amount_usd > 0
                                  ? "bg-red-500/20 text-red-400"
                                  : "bg-emerald-500/20 text-emerald-400"
                              }`}
                            >
                              {item.amount_usd > 0 ? "Debt" : "Repayment"}
                            </span>
                          </td>
                          <td className="py-3 text-slate-400 text-sm">
                            {item.note || "-"}
                          </td>
                          {/* USD Column */}
                          <td
                            className={`py-3 text-center font-mono font-bold ${
                              item.amount_usd > 0
                                ? "text-red-400"
                                : "text-emerald-400"
                            }`}
                          >
                            {item.amount_usd !== 0 && (
                              <>
                                {item.amount_usd > 0 ? "+" : ""}${Math.abs(item.amount_usd).toFixed(2)}
                              </>
                            )}
                          </td>
                          {/* LBP Column */}
                          <td
                            className={`py-3 text-center font-mono font-bold ${
                              item.amount_lbp > 0
                                ? "text-red-400"
                                : item.amount_lbp < 0
                                ? "text-emerald-400"
                                : "text-slate-600"
                            }`}
                          >
                            {item.amount_lbp !== 0 && (
                              <>
                                {item.amount_lbp > 0 ? "+" : ""}{Math.abs(item.amount_lbp).toLocaleString()} LBP
                              </>
                            )}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
            <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center mb-4">
              <User size={32} className="opacity-50" />
            </div>
            <p>Select a client to view details</p>
          </div>
        )}
      </div>

      {/* Repayment Modal */}
      {showRepaymentModal && (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setShowRepaymentModal(false);
            }
          }}
        >
          <div
            className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-bold text-white mb-4">
              Process Repayment
            </h3>

            <div className="space-y-4">
              {/* Merged Amount Header with Two Columns */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2 text-center uppercase">
                  Amount
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {/* USD Column */}
                  <div className="relative">
                    <input
                      type="number"
                      value={repayAmountUSD}
                      onChange={(e) => setRepayAmountUSD(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white text-center font-mono text-lg focus:outline-none focus:border-emerald-500"
                      placeholder="0"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 font-bold">
                      $
                    </span>
                  </div>
                  
                  {/* LBP Column */}
                  <div className="relative">
                    <input
                      type="number"
                      value={repayAmountLBP}
                      onChange={(e) => setRepayAmountLBP(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white text-center font-mono text-lg focus:outline-none focus:border-emerald-500"
                      placeholder="0"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-violet-400 text-xs font-bold">
                      LBP
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1 uppercase">
                  Note
                </label>
                <input
                  type="text"
                  value={repayNote}
                  onChange={(e) => setRepayNote(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-emerald-500"
                  placeholder="Optional note..."
                />
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  onClick={() => setShowRepaymentModal(false)}
                  className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleProcessRepayment}
                  className="flex-1 py-3 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 active:scale-95 transition-all"
                >
                  Confirm Payment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
