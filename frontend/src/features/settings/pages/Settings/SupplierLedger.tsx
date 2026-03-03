import { useEffect, useMemo, useState } from "react";
import { Select, useApi } from "@liratek/ui";

type Supplier = {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  note: string | null;
  is_active: number;
  module_key: string | null;
  provider: string | null;
  is_system: number;
  created_at: string;
};

type SupplierBalance = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

type LedgerEntry = {
  id: number;
  supplier_id: number;
  entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT" | "SETTLEMENT";
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_by: number | null;
  transaction_id: number | null;
  transaction_type: string | null;
  created_at: string;
};

type UnsettledTransaction = {
  id: number;
  service_type: "SEND" | "RECEIVE";
  amount: number;
  currency: string;
  commission: number;
  omt_fee: number | null;
  omt_service_type: string | null;
  client_name: string | null;
  created_at: string;
};

/** Map supplier provider to its corresponding drawer name */
const PROVIDER_DRAWER: Record<string, string> = {
  OMT: "OMT_System",
  WHISH: "Whish_System",
  IPEC: "IPEC",
  KATCH: "Katch",
  OMT_APP: "OMT_App",
  WHISH_APP: "Whish_App",
};

function EntryTypeBadge({ type }: { type: string }) {
  const color =
    type === "TOP_UP"
      ? "bg-red-900/50 text-red-300"
      : type === "PAYMENT"
        ? "bg-green-900/50 text-green-300"
        : type === "SETTLEMENT"
          ? "bg-blue-900/50 text-blue-300"
          : "bg-amber-900/50 text-amber-300";
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${color}`}>
      {type}
    </span>
  );
}

function AutoBadge() {
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-900/50 text-sky-300">
      Auto
    </span>
  );
}

export default function SupplierLedger() {
  const api = useApi();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [balances, setBalances] = useState<SupplierBalance[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(
    null,
  );
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);

  // Manual ledger entry form
  const [entryType, setEntryType] = useState<
    "TOP_UP" | "PAYMENT" | "ADJUSTMENT"
  >("PAYMENT");
  const [amountUSD, setAmountUSD] = useState<number>(0);
  const [amountLBP, setAmountLBP] = useState<number>(0);
  const [note, setNote] = useState<string>("");
  const [withdrawFromDrawer, setWithdrawFromDrawer] = useState(true);

  // Settlement state
  const [unsettledTxns, setUnsettledTxns] = useState<UnsettledTransaction[]>(
    [],
  );
  const [selectedTxnIds, setSelectedTxnIds] = useState<Set<number>>(new Set());
  const [settleNote, setSettleNote] = useState("");
  const [settleDrawer, setSettleDrawer] = useState("General");
  const [showSettleConfirm, setShowSettleConfirm] = useState(false);
  const [settling, setSettling] = useState(false);
  const [activeTab, setActiveTab] = useState<"settle" | "manual">("settle");

  // System suppliers first, then user-created
  const sortedSuppliers = useMemo(
    () =>
      [...suppliers].sort(
        (a, b) => b.is_system - a.is_system || a.name.localeCompare(b.name),
      ),
    [suppliers],
  );

  const selectedSupplier = useMemo(
    () => sortedSuppliers.find((s) => s.id === selectedSupplierId) || null,
    [sortedSuppliers, selectedSupplierId],
  );

  const balanceBySupplier = useMemo(() => {
    const map = new Map<number, SupplierBalance>();
    for (const b of balances) map.set(b.supplier_id, b);
    return map;
  }, [balances]);

  // Totals across system suppliers only
  const totalOwed = useMemo(() => {
    let usd = 0;
    let lbp = 0;
    for (const s of sortedSuppliers) {
      const b = balanceBySupplier.get(s.id);
      if (b) {
        usd += Number(b.total_usd || 0);
        lbp += Number(b.total_lbp || 0);
      }
    }
    return { usd, lbp };
  }, [sortedSuppliers, balanceBySupplier]);

  /** The drawer tied to the currently selected supplier */
  const supplierDrawer = useMemo(() => {
    if (!selectedSupplier?.provider) return "General";
    return PROVIDER_DRAWER[selectedSupplier.provider] || "General";
  }, [selectedSupplier]);

  // Settlement computed values
  const selectedUnsettled = useMemo(
    () => unsettledTxns.filter((t) => selectedTxnIds.has(t.id)),
    [unsettledTxns, selectedTxnIds],
  );
  // OMT owes shop: amount + commission per RECEIVE transaction
  const settleTotalOwedUsd = useMemo(
    () =>
      selectedUnsettled
        .filter((t) => t.currency !== "LBP")
        .reduce((s, t) => s + Math.abs(t.amount) + t.commission, 0),
    [selectedUnsettled],
  );
  const settleCommissionUsd = useMemo(
    () =>
      selectedUnsettled
        .filter((t) => t.currency !== "LBP")
        .reduce((s, t) => s + t.commission, 0),
    [selectedUnsettled],
  );
  const settleNetPayUsd = Math.max(0, settleTotalOwedUsd - settleCommissionUsd);

  const pendingCommissionTotal = useMemo(
    () =>
      unsettledTxns
        .filter((t) => t.currency !== "LBP")
        .reduce((s, t) => s + t.commission, 0),
    [unsettledTxns],
  );

  const refresh = async () => {
    const [sups, bals] = await Promise.all([
      api.getSuppliers(),
      api.getSupplierBalances(),
    ]);
    setSuppliers(sups);
    setBalances(bals);

    if (selectedSupplierId) {
      const rows = await api.getSupplierLedger(selectedSupplierId, 200);
      setLedger(rows);
    }
  };

  const refreshUnsettled = async () => {
    if (!selectedSupplier?.provider) return;
    const txns = await (api as any).getUnsettledTransactions(
      selectedSupplier.provider,
    );
    setUnsettledTxns(txns || []);
    setSelectedTxnIds(new Set());
  };

  const handleSettle = async () => {
    if (!selectedSupplier || !selectedSupplierId) return;
    if (selectedTxnIds.size === 0) return;
    setSettling(true);
    try {
      const res = await (api as any).settleTransactions({
        supplier_id: selectedSupplierId,
        financial_service_ids: [...selectedTxnIds],
        amount_usd: settleNetPayUsd,
        amount_lbp: 0,
        commission_usd: settleCommissionUsd,
        commission_lbp: 0,
        drawer_name: settleDrawer,
        note: settleNote || `Settlement: ${selectedTxnIds.size} txns`,
      });
      if (!res?.success) {
        alert(res?.error || "Settlement failed");
        return;
      }
      setShowSettleConfirm(false);
      setSettleNote("");
      setSelectedTxnIds(new Set());
      await Promise.all([refresh(), refreshUnsettled()]);
    } catch (_e) {
      alert("Settlement failed");
    } finally {
      setSettling(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSupplierId || !selectedSupplier) return;
    api.getSupplierLedger(selectedSupplierId, 200).then(setLedger);
    if (selectedSupplier.provider) {
      (api as any)
        .getUnsettledTransactions(selectedSupplier.provider)
        .then((txns: UnsettledTransaction[]) => {
          setUnsettledTxns(txns || []);
          setSelectedTxnIds(new Set());
        });
    }
  }, [selectedSupplierId]);

  const handleAddEntry = async () => {
    if (!selectedSupplierId) {
      alert("Select a supplier first");
      return;
    }
    if (amountUSD === 0 && amountLBP === 0) {
      alert("Enter an amount");
      return;
    }
    const payload: {
      supplier_id: number;
      entry_type: string;
      amount_usd: number;
      amount_lbp: number;
      note?: string;
      drawer_name?: string;
    } = {
      supplier_id: selectedSupplierId,
      entry_type: entryType,
      amount_usd: amountUSD || 0,
      amount_lbp: amountLBP || 0,
    };
    if (note.trim()) payload.note = note.trim();
    if (withdrawFromDrawer && entryType === "PAYMENT") {
      payload.drawer_name = supplierDrawer;
    }

    const res = await api.addSupplierLedgerEntry(selectedSupplierId, payload);
    if (!res.success) {
      alert(res.error || "Failed to add entry");
      return;
    }
    setAmountUSD(0);
    setAmountLBP(0);
    setNote("");
    await refresh();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">Supplier Ledger</h2>
        <p className="text-sm text-slate-400">
          Track amounts owed to suppliers. System debts are auto-recorded from
          transactions.
        </p>
      </div>

      {/* Balance overview */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Total Owed (USD)</div>
          <div className="text-2xl font-bold text-red-400 font-mono">
            ${totalOwed.usd.toFixed(2)}
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-4">
          <div className="text-xs text-slate-400 mb-1">Total Owed (LBP)</div>
          <div className="text-2xl font-bold text-red-400 font-mono">
            {totalOwed.lbp.toLocaleString()} LBP
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left: Supplier list */}
        <div className="col-span-4 bg-slate-900 border border-slate-700 rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Suppliers
          </div>
          <div className="space-y-1">
            {sortedSuppliers.map((s) => {
              const b = balanceBySupplier.get(s.id);
              const active = s.id === selectedSupplierId;
              const drawer = s.provider
                ? PROVIDER_DRAWER[s.provider]
                : undefined;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSupplierId(s.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    active ? "bg-slate-800" : "hover:bg-slate-800/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">{s.name}</span>
                    <div className="flex items-center gap-2">
                      {drawer && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          {drawer}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-slate-400 font-mono">
                    ${Number(b?.total_usd || 0).toFixed(2)} |{" "}
                    {Number(b?.total_lbp || 0).toLocaleString()} LBP
                  </div>
                </button>
              );
            })}
            {sortedSuppliers.length === 0 && (
              <div className="text-slate-500 text-sm p-3">
                No suppliers found.
              </div>
            )}
          </div>
        </div>

        {/* Right: Tabbed panel */}
        <div className="col-span-8 bg-slate-900 border border-slate-700 rounded-xl p-4">
          {!selectedSupplier ? (
            <div className="text-slate-400 text-sm">
              Select a supplier to view ledger.
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-white font-bold text-lg">
                    {selectedSupplier.name}
                  </div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">
                    Balance:{" "}
                    <span
                      className={`font-semibold ${(balanceBySupplier.get(selectedSupplierId!)?.total_usd ?? 0) < 0 ? "text-green-400" : "text-red-400"}`}
                    >
                      $
                      {(
                        balanceBySupplier.get(selectedSupplierId!)?.total_usd ??
                        0
                      ).toFixed(2)}
                    </span>
                    {pendingCommissionTotal > 0 && (
                      <span className="ml-3 text-amber-400">
                        ⚠ ${pendingCommissionTotal.toFixed(4)} pending
                        commission
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    refresh();
                    refreshUnsettled();
                  }}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm"
                >
                  Refresh
                </button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 mb-4 border-b border-slate-700">
                {[
                  {
                    id: "settle" as const,
                    label: `Settle Transactions${unsettledTxns.length > 0 ? ` (${unsettledTxns.length})` : ""}`,
                  },
                  { id: "manual" as const, label: "Manual Entry" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                      activeTab === tab.id
                        ? "bg-slate-800 text-white border-b-2 border-blue-500"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── Tab: Settle Transactions ── */}
              {activeTab === "settle" && (
                <div className="space-y-3">
                  {unsettledTxns.length === 0 ? (
                    <div className="text-slate-500 text-sm py-6 text-center">
                      ✓ No pending transactions to settle for{" "}
                      {selectedSupplier.name}
                    </div>
                  ) : (
                    <>
                      {/* Select all / Settle button */}
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-slate-300 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={
                              selectedTxnIds.size === unsettledTxns.length &&
                              unsettledTxns.length > 0
                            }
                            onChange={(e) =>
                              setSelectedTxnIds(
                                e.target.checked
                                  ? new Set(unsettledTxns.map((t) => t.id))
                                  : new Set(),
                              )
                            }
                            className="w-4 h-4 rounded border-slate-600 bg-slate-900"
                          />
                          Select All ({unsettledTxns.length})
                        </label>
                        <button
                          onClick={() => setShowSettleConfirm(true)}
                          disabled={selectedTxnIds.size === 0}
                          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium"
                        >
                          Settle{" "}
                          {selectedTxnIds.size > 0
                            ? `(${selectedTxnIds.size})`
                            : ""}
                        </button>
                      </div>

                      {/* Unsettled transactions list */}
                      <div className="border border-slate-800 rounded-xl overflow-hidden max-h-[40vh] overflow-y-auto">
                        <div className="grid grid-cols-12 gap-2 bg-slate-800/60 text-slate-300 text-xs font-semibold px-3 py-2">
                          <div className="col-span-1" />
                          <div className="col-span-2">Type</div>
                          <div className="col-span-2 text-right">Amount</div>
                          <div className="col-span-2 text-right">OMT Fee</div>
                          <div className="col-span-2 text-right">
                            Commission
                          </div>
                          <div className="col-span-3">Date</div>
                        </div>
                        {unsettledTxns.map((t) => (
                          <div
                            key={t.id}
                            className="grid grid-cols-12 gap-2 px-3 py-2.5 text-sm border-t border-slate-800 items-center hover:bg-slate-800/30"
                          >
                            <div className="col-span-1">
                              <input
                                type="checkbox"
                                checked={selectedTxnIds.has(t.id)}
                                onChange={(e) => {
                                  const next = new Set(selectedTxnIds);
                                  if (e.target.checked) {
                                    next.add(t.id);
                                  } else {
                                    next.delete(t.id);
                                  }
                                  setSelectedTxnIds(next);
                                }}
                                className="w-4 h-4 rounded border-slate-600 bg-slate-900"
                              />
                            </div>
                            <div className="col-span-2 text-xs text-slate-300">
                              {t.omt_service_type || t.service_type}
                            </div>
                            <div className="col-span-2 text-right font-mono text-white">
                              ${Math.abs(t.amount).toFixed(2)}
                            </div>
                            <div className="col-span-2 text-right font-mono text-amber-400">
                              {t.omt_fee ? `$${t.omt_fee.toFixed(2)}` : "—"}
                            </div>
                            <div className="col-span-2 text-right font-mono text-emerald-400">
                              ${t.commission.toFixed(4)}
                            </div>
                            <div className="col-span-3 text-xs text-slate-400">
                              {new Date(t.created_at).toLocaleString()}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Settlement summary */}
                      {selectedTxnIds.size > 0 && (
                        <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-sm space-y-1">
                          <div className="flex justify-between text-slate-300">
                            <span>Total owed to {selectedSupplier.name}:</span>
                            <span className="font-mono font-bold text-white">
                              ${settleTotalOwedUsd.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Your commission:</span>
                            <span className="font-mono text-emerald-400">
                              −${settleCommissionUsd.toFixed(4)}
                            </span>
                          </div>
                          <div className="h-px bg-slate-600 my-1" />
                          <div className="flex justify-between font-bold">
                            <span className="text-white">
                              Net you pay {selectedSupplier.name}:
                            </span>
                            <span className="font-mono text-blue-400 text-base">
                              ${settleNetPayUsd.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Tab: Manual Entry ── */}
              {activeTab === "manual" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-12 gap-3">
                    <div className="col-span-3">
                      <label className="block text-xs text-slate-400 mb-1">
                        Entry Type
                      </label>
                      <Select
                        value={entryType}
                        onChange={(value) =>
                          setEntryType(
                            value as "TOP_UP" | "PAYMENT" | "ADJUSTMENT",
                          )
                        }
                        options={[
                          { value: "PAYMENT", label: "PAYMENT" },
                          { value: "TOP_UP", label: "TOP_UP" },
                          { value: "ADJUSTMENT", label: "ADJUSTMENT" },
                        ]}
                        ringColor="ring-violet-500"
                        buttonClassName="bg-slate-950"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs text-slate-400 mb-1">
                        Amount USD
                      </label>
                      <input
                        type="number"
                        value={amountUSD || ""}
                        onChange={(e) =>
                          setAmountUSD(parseFloat(e.target.value) || 0)
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                        placeholder="0"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs text-slate-400 mb-1">
                        Amount LBP
                      </label>
                      <input
                        type="number"
                        value={amountLBP || ""}
                        onChange={(e) =>
                          setAmountLBP(parseFloat(e.target.value) || 0)
                        }
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                        placeholder="0"
                      />
                    </div>
                    <div className="col-span-3">
                      <label className="block text-xs text-slate-400 mb-1">
                        Note
                      </label>
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                      />
                    </div>
                    {entryType === "PAYMENT" && (
                      <div className="col-span-12">
                        <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={withdrawFromDrawer}
                            onChange={(e) =>
                              setWithdrawFromDrawer(e.target.checked)
                            }
                            className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-orange-600"
                          />
                          <span className="text-sm">
                            Withdraw from{" "}
                            <span className="font-mono text-white">
                              {supplierDrawer}
                            </span>{" "}
                            drawer
                          </span>
                        </label>
                      </div>
                    )}
                    <div className="col-span-12 flex justify-end">
                      <button
                        onClick={handleAddEntry}
                        className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium"
                      >
                        Add Entry
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Ledger history (always visible) */}
              <div className="mt-4 border border-slate-800 rounded-xl overflow-hidden">
                <div className="bg-slate-800/60 text-slate-300 text-xs font-semibold px-3 py-2">
                  Ledger History
                </div>
                <div className="max-h-[30vh] overflow-y-auto">
                  {ledger.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-12 gap-2 px-3 py-2 text-sm border-t border-slate-800 items-center"
                    >
                      <div className="col-span-2 flex items-center gap-1">
                        <EntryTypeBadge type={row.entry_type} />
                        {row.transaction_type && <AutoBadge />}
                      </div>
                      <div
                        className={`col-span-2 text-right font-mono ${row.amount_usd < 0 ? "text-green-400" : row.amount_usd > 0 ? "text-red-400" : "text-slate-500"}`}
                      >
                        {row.amount_usd !== 0
                          ? `${row.amount_usd > 0 ? "+" : ""}${row.amount_usd.toFixed(2)}`
                          : "—"}
                      </div>
                      <div
                        className={`col-span-2 text-right font-mono ${row.amount_lbp < 0 ? "text-green-400" : row.amount_lbp > 0 ? "text-red-400" : "text-slate-500"}`}
                      >
                        {row.amount_lbp !== 0
                          ? `${row.amount_lbp > 0 ? "+" : ""}${row.amount_lbp.toLocaleString()}`
                          : "—"}
                      </div>
                      <div className="col-span-4 text-slate-300 truncate text-xs">
                        {row.note || ""}
                      </div>
                      <div className="col-span-2 text-slate-400 text-xs">
                        {new Date(row.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                  {ledger.length === 0 && (
                    <div className="text-slate-500 text-sm p-3">
                      No ledger entries yet.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Settlement Confirmation Modal ── */}
      {showSettleConfirm && selectedSupplier && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-bold text-white">
              Settle {selectedTxnIds.size} transaction
              {selectedTxnIds.size !== 1 ? "s" : ""} with{" "}
              {selectedSupplier.name}
            </h3>

            <div className="bg-slate-800 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between text-slate-300">
                <span>Total owed to {selectedSupplier.name}:</span>
                <span className="font-mono font-bold text-white">
                  ${settleTotalOwedUsd.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Your commission:</span>
                <span className="font-mono text-emerald-400">
                  −${settleCommissionUsd.toFixed(4)}
                </span>
              </div>
              <div className="h-px bg-slate-600" />
              <div className="flex justify-between font-bold">
                <span className="text-white">
                  Net payment to {selectedSupplier.name}:
                </span>
                <span className="font-mono text-blue-400 text-base">
                  ${settleNetPayUsd.toFixed(2)}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Pay from drawer
              </label>
              <input
                value={settleDrawer}
                onChange={(e) => setSettleDrawer(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Note (optional)
              </label>
              <input
                value={settleNote}
                onChange={(e) => setSettleNote(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
                placeholder={`Settlement with ${selectedSupplier.name}`}
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowSettleConfirm(false)}
                disabled={settling}
                className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={handleSettle}
                disabled={settling}
                className="flex-1 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold"
              >
                {settling ? "Settling..." : "Confirm Settlement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
