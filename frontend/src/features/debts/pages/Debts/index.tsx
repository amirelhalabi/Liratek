import React, { useState, useEffect, useMemo } from "react";
import {
  Search,
  User,
  ArrowDownLeft,
  ChevronDown,
  ChevronUp,
  Receipt,
  Eye,
  X as CloseIcon,
} from "lucide-react";
import PageHeader from "../../../../shared/components/layouts/PageHeader";
import { useAuth } from "@/features/auth/context/AuthContext";
import { EXCHANGE_RATE } from "@/config/constants";
import { roundLBPUp } from "@/config/denominations";
import Select from "../../../../shared/components/ui/Select";
import * as api from "../../../../api/backendApi";

type DebtFilter = "ongoing" | "closed" | "all";
type SortOrder = "desc" | "asc";

export default function Debts() {
  const { user } = useAuth();
  type Debtor = {
    id: number;
    full_name: string;
    phone_number?: string;
    total_debt: number;
  };
  type DebtHistoryItem = {
    id: number;
    created_at: string;
    amount_usd: number;
    amount_lbp: number;
    note?: string;
    sale_id?: number | null;
    is_paid: boolean;
  };

  type SaleDetail = {
    id: number;
    final_amount_usd: number;
    paid_usd: number;
    paid_lbp: number;
    status: string;
    created_at: string;
    items: Array<{
      product_name: string;
      quantity: number;
      price_per_unit: number;
      subtotal: number;
    }>;
  };
  const [debtors, setDebtors] = useState<Debtor[]>([]);
  const [selectedClient, setSelectedClient] = useState<Debtor | null>(null);
  const [history, setHistory] = useState<DebtHistoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showRepaymentModal, setShowRepaymentModal] = useState(false);
  const [totalDebt, setTotalDebt] = useState(0);
  const [debtFilter, setDebtFilter] = useState<DebtFilter>("ongoing");
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null);
  const [showSaleDetails, setShowSaleDetails] = useState(false); // New state for filter
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
      const data = window.api
        ? await window.api.getDebtors()
        : await (async () => {
          const { getDebtors } = await import("../../../../api/backendApi");
          return getDebtors();
        })();
      setDebtors(data);
    } catch (error) {
      console.error("Failed to load debtors:", error);
    }
  };

  const loadHistory = async (clientId: number) => {
    try {
      const data = window.api
        ? await window.api.getClientDebtHistory(clientId)
        : await (async () => {
          const { getClientDebtHistory } = await import("../../../../api/backendApi");
          return getClientDebtHistory(clientId);
        })();
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
      const total = window.api
        ? await window.api.getClientDebtTotal(clientId)
        : await (async () => {
          const { getClientDebtTotal } = await import("../../../../api/backendApi");
          return getClientDebtTotal(clientId);
        })();
      setTotalDebt(total || 0);
    } catch (error) {
      console.error("Failed to load client total:", error);
    }
  };

  const loadSaleDetails = async (saleId: number) => {
    try {
      const sale = await api.getSale(saleId);
      const items = await api.getSaleItems(saleId);

      setSelectedSale({
        ...sale,
        items: items.map((item: any) => ({
          product_name: item.name || 'Unknown Product',
          quantity: item.quantity || 0,
          price_per_unit: item.sold_price_usd || 0,
          subtotal: (item.sold_price_usd || 0) * (item.quantity || 0),
        })),
      });
      setShowSaleDetails(true);
    } catch (error) {
      console.error("Failed to load sale details:", error);
    }
  };

  const handleProcessRepayment = async () => {
    if (!selectedClient) return;

    const paidUSD = parseFloat(repayAmountUSD) || 0;
    const paidLBP = parseFloat(repayAmountLBP) || 0;

    if (paidUSD === 0 && paidLBP === 0) {
      alert("Please enter an amount.");
      return;
    }

    // Calculate the actual debt reduction amounts
    // For USD: reduce debt by the exact paid amount
    // For LBP: if paying the fractional portion, reduce by the actual fractional debt (not the rounded payment)
    // This allows customers to pay rounded amounts while maintaining accurate debt tracking
    const integerDebt = Math.floor(totalDebt);
    const fractionalDebt = totalDebt - integerDebt;
    const fractionalLBP = fractionalDebt * EXCHANGE_RATE;

    let debtReductionUSD = paidUSD;

    // If user is paying LBP and it's approximately the fractional portion
    if (paidLBP > 0) {
      const roundedFractionalLBP = Math.ceil(fractionalLBP / 5000) * 5000;
      // Check if paying the full fractional portion (with rounding tolerance)
      if (Math.abs(paidLBP - roundedFractionalLBP) < 1000) {
        // Reduce debt by the actual fractional amount, not the rounded payment
        debtReductionUSD += fractionalDebt;
      } else {
        // Otherwise, reduce by the exact LBP value
        debtReductionUSD += paidLBP / EXCHANGE_RATE;
      }
    }

    const debtReductionLBP = 0; // We track debt in USD
    const totalDebtReductionUSD = debtReductionUSD;

    try {
      const result = window.api
        ? await window.api.addRepayment({
          clientId: selectedClient.id,
          amountUSD: totalDebtReductionUSD,
          amountLBP: debtReductionLBP,
          paidAmountUSD: paidUSD,
          paidAmountLBP: paidLBP,
          drawerName: "General",
          note: repayNote,
          ...(user?.id != null ? { userId: user.id } : {}),
        } as any)
        : await (async () => {
          const { addRepayment } = await import("../../../../api/backendApi");
          return addRepayment({
            client_id: selectedClient.id,
            amount_usd: totalDebtReductionUSD,
            amount_lbp: debtReductionLBP,
            paid_amount_usd: paidUSD,
            paid_amount_lbp: paidLBP,
            drawer_name: "General",
            note: repayNote,
            ...(user?.id != null ? { user_id: user.id } : {}),
          });
        })();

      if (result.success) {
        alert("Repayment processed!");
        setShowRepaymentModal(false);
        setRepayAmountUSD("");
        setRepayAmountLBP("");
        setRepayNote("");

        // Reload debtors list
        await loadDebtors();

        // Check if client still has debt after repayment
        const updatedTotal = window.api
          ? await window.api.getClientDebtTotal(selectedClient.id)
          : await (async () => {
            const { getClientDebtTotal } = await import("../../../../api/backendApi");
            return getClientDebtTotal(selectedClient.id);
          })();

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
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader icon={Receipt} title="Debts" />

      <div className="flex h-full min-h-0 gap-6 overflow-hidden">
        {/* Left: Debtors List */}
        <div className="w-1/3 flex flex-col bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
          <div className="p-4 border-b border-slate-700 space-y-4">
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
              <Select
                value={debtFilter}
                onChange={(value) => {
                  setDebtFilter(value as DebtFilter);
                  setSelectedClient(null); // Reset selected client
                }}
                options={[
                  { value: "ongoing", label: "Ongoing" },
                  { value: "closed", label: "Closed" },
                  { value: "all", label: "All" },
                ]}
                ringColor="ring-red-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {filteredDebtors.map((client) => (
              <button
                key={client.id}
                onClick={() => setSelectedClient(client)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${selectedClient?.id === client.id
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
                    {totalDebt > 0 &&
                      (() => {
                        const integerUSD = Math.floor(totalDebt);
                        const fractionUSD = totalDebt - integerUSD;
                        const rawLBP = fractionUSD * EXCHANGE_RATE;
                        const roundedLBP = roundLBPUp(rawLBP);

                        return (
                          <span className="text-xs text-slate-500 ml-2">
                            (i.e., ${integerUSD.toLocaleString()} +{" "}
                            {roundedLBP.toLocaleString()} LBP)
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

                    // Autofill the modal inputs with rounded amounts
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
                            <ChevronDown
                              size={16}
                              className="text-slate-500 group-hover:text-slate-300"
                            />
                          ) : (
                            <ChevronUp
                              size={16}
                              className="text-slate-500 group-hover:text-slate-300"
                            />
                          )}
                        </button>
                      </th>
                      <th className="pb-3 text-sm font-medium">Type</th>
                      <th className="pb-3 text-sm font-medium">Note</th>
                      <th className="pb-3 text-sm font-medium text-center">Details</th>
                      <th
                        className="pb-3 text-sm font-medium text-center"
                        colSpan={2}
                      >
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
                                className={`px-2 py-1 rounded text-xs font-bold ${item.amount_usd > 0
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
                            {/* Details Button */}
                            <td className="py-3 text-center">
                              {item.sale_id ? (
                                <button
                                  onClick={() => loadSaleDetails(item.sale_id!)}
                                  className="p-1.5 rounded-lg bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 transition-all"
                                  title="View Sale Details"
                                >
                                  <Eye size={16} />
                                </button>
                              ) : (
                                <span className="text-slate-600">-</span>
                              )}
                            </td>
                            {/* USD Column */}
                            <td
                              className={`py-3 text-center font-mono font-bold ${item.amount_usd > 0
                                ? "text-red-400"
                                : item.amount_usd < 0
                                  ? "text-emerald-400"
                                  : "text-slate-600"
                                }`}
                            >
                              {item.amount_usd !== 0 && Math.abs(item.amount_usd) > 0 ? (
                                <>
                                  {item.amount_usd > 0 ? "+" : ""}$
                                  {Math.abs(item.amount_usd).toFixed(2)}
                                </>
                              ) : (
                                <span className="text-slate-600">-</span>
                              )}
                            </td>
                            {/* LBP Column */}
                            <td
                              className={`py-3 text-center font-mono font-bold ${item.amount_lbp > 0
                                ? "text-red-400"
                                : item.amount_lbp < 0
                                  ? "text-emerald-400"
                                  : "text-slate-600"
                                }`}
                            >
                              {item.amount_lbp !== 0 && Math.abs(item.amount_lbp) > 0 ? (
                                <>
                                  {item.amount_lbp > 0 ? "+" : ""}
                                  {Math.abs(item.amount_lbp).toLocaleString()} LBP
                                </>
                              ) : (
                                <span className="text-slate-600">-</span>
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

      {/* Sale Details Modal */}
      {showSaleDetails && selectedSale && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-700">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h2 className="text-xl font-bold text-white">
                Sale Details - #{selectedSale.id}
              </h2>
              <button
                onClick={() => {
                  setShowSaleDetails(false);
                  setSelectedSale(null);
                }}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <CloseIcon size={20} className="text-slate-400" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Sale Info */}
              <div className="flex gap-4 p-4 bg-slate-900 rounded-lg">
                <div className="flex-[2]">
                  <p className="text-slate-500 text-sm">Date</p>
                  <p className="text-white font-medium">
                    {new Date(selectedSale.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex-1">
                  <p className="text-slate-500 text-sm">Total Amount</p>
                  <p className="text-white font-medium">
                    ${selectedSale.final_amount_usd.toFixed(2)}
                  </p>
                </div>
                <div className="flex-1">
                  <p className="text-slate-500 text-sm">Amount Paid</p>
                  <p className="text-emerald-400 font-medium">
                    ${selectedSale.paid_usd.toFixed(2)}
                    {selectedSale.paid_lbp > 0 &&
                      ` + ${selectedSale.paid_lbp.toLocaleString()} LBP`}
                  </p>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">Items</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-slate-700">
                      <tr className="text-left text-slate-400">
                        <th className="pb-3 text-sm font-medium">Product</th>
                        <th className="pb-3 text-sm font-medium text-center">Qty</th>
                        <th className="pb-3 text-sm font-medium text-right">Price</th>
                        <th className="pb-3 text-sm font-medium text-right">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {selectedSale.items.map((item, index) => (
                        <tr key={index}>
                          <td className="py-3 text-white">{item.product_name}</td>
                          <td className="py-3 text-slate-300 text-center">
                            {item.quantity}
                          </td>
                          <td className="py-3 text-slate-300 text-right">
                            ${item.price_per_unit.toFixed(2)}
                          </td>
                          <td className="py-3 text-white font-medium text-right">
                            ${item.subtotal.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Summary */}
              <div className="border-t border-slate-700 pt-4 space-y-2">
                <div className="flex justify-between text-slate-400">
                  <span>Total Amount:</span>
                  <span className="text-white font-medium">
                    ${selectedSale.final_amount_usd.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Amount Paid:</span>
                  <span className="text-emerald-400 font-medium">
                    ${selectedSale.paid_usd.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t border-slate-700 pt-2">
                  <span className="text-white">Outstanding Debt:</span>
                  <span className="text-red-400">
                    ${(selectedSale.final_amount_usd - selectedSale.paid_usd).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
