import { useEffect, useMemo, useState } from "react";
import Select from "../../../../shared/components/ui/Select";
import * as api from "../../../../api/backendApi";

type Supplier = {
  id: number;
  name: string;
  contact_name: string | null;
  phone: string | null;
  note: string | null;
  is_active: number;
  created_at: string;
};

type SupplierBalance = { supplier_id: number; total_usd: number; total_lbp: number };

type LedgerEntry = {
  id: number;
  supplier_id: number;
  entry_type: "TOP_UP" | "PAYMENT" | "ADJUSTMENT";
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  created_by: number | null;
  created_at: string;
};

export default function SupplierLedger() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [balances, setBalances] = useState<SupplierBalance[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);

  const [newSupplierName, setNewSupplierName] = useState("");

  const [entryType, setEntryType] = useState<"TOP_UP" | "PAYMENT" | "ADJUSTMENT">(
    "TOP_UP",
  );
  const [amountUSD, setAmountUSD] = useState<number>(0);
  const [amountLBP, setAmountLBP] = useState<number>(0);
  const [note, setNote] = useState<string>("");

  const [withdrawFromDrawer, setWithdrawFromDrawer] = useState(false);
  const [selectedDrawer, setSelectedDrawer] = useState("General");

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === selectedSupplierId) || null,
    [suppliers, selectedSupplierId],
  );

  const balanceBySupplier = useMemo(() => {
    const map = new Map<number, SupplierBalance>();
    for (const b of balances) map.set(b.supplier_id, b);
    return map;
  }, [balances]);

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

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSupplierId) return;
    api.getSupplierLedger(selectedSupplierId, 200).then(setLedger);
  }, [selectedSupplierId]);

  const handleCreateSupplier = async () => {
    if (!newSupplierName.trim()) return;
    const res = await api.createSupplier({ name: newSupplierName.trim() });
    if (!res.success) {
      alert(res.error || "Failed to create supplier");
      return;
    }
    setNewSupplierName("");
    await refresh();
  };

  const handleAddEntry = async () => {
    if (!selectedSupplierId) {
      alert("Select a supplier first");
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
    if (withdrawFromDrawer) payload.drawer_name = selectedDrawer;

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Supplier Ledger</h2>
          <p className="text-sm text-slate-400">
            Track amounts owed to suppliers separately in USD and LBP.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left: Supplier list */}
        <div className="col-span-5 bg-slate-900 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <input
              value={newSupplierName}
              onChange={(e) => setNewSupplierName(e.target.value)}
              placeholder="New supplier name (e.g., IPIC)"
              className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
            />
            <button
              onClick={handleCreateSupplier}
              className="px-3 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium"
            >
              Add
            </button>
          </div>

          <div className="divide-y divide-slate-800">
            {suppliers.map((s) => {
              const b = balanceBySupplier.get(s.id);
              const active = s.id === selectedSupplierId;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSupplierId(s.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${active ? "bg-slate-800" : "hover:bg-slate-800/50"
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-white">{s.name}</div>
                    <div className="text-xs text-slate-400">ID: {s.id}</div>
                  </div>
                  <div className="mt-1 text-xs text-slate-400 font-mono">
                    Owed: ${Number(b?.total_usd || 0).toFixed(2)} | {Number(
                      b?.total_lbp || 0,
                    ).toLocaleString()} LBP
                  </div>
                </button>
              );
            })}
            {suppliers.length === 0 && (
              <div className="text-slate-500 text-sm p-3">
                No suppliers yet. Add one above.
              </div>
            )}
          </div>
        </div>

        {/* Right: Ledger + add entry */}
        <div className="col-span-7 bg-slate-900 border border-slate-700 rounded-xl p-4">
          {!selectedSupplier ? (
            <div className="text-slate-400 text-sm">Select a supplier to view ledger.</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="text-white font-bold text-lg">{selectedSupplier.name}</div>
                  <div className="text-xs text-slate-400">
                    Add TOP_UP to increase debt, PAYMENT to decrease debt.
                  </div>
                </div>
                <button
                  onClick={refresh}
                  className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
                >
                  Refresh
                </button>
              </div>

              <div className="grid grid-cols-12 gap-3 mb-4">
                <div className="col-span-3">
                  <label className="block text-xs text-slate-400 mb-1">Entry Type</label>
                  <Select
                    value={entryType}
                    onChange={(value) => setEntryType(value as "TOP_UP" | "PAYMENT" | "ADJUSTMENT")}
                    options={[
                      { value: "TOP_UP", label: "TOP_UP" },
                      { value: "PAYMENT", label: "PAYMENT" },
                      { value: "ADJUSTMENT", label: "ADJUSTMENT" },
                    ]}
                    ringColor="ring-violet-500"
                    buttonClassName="bg-slate-950"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-slate-400 mb-1">Amount USD</label>
                  <input
                    type="number"
                    value={amountUSD || ""}
                    onChange={(e) => setAmountUSD(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                    placeholder="0"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-slate-400 mb-1">Amount LBP</label>
                  <input
                    type="number"
                    value={amountLBP || ""}
                    onChange={(e) => setAmountLBP(parseFloat(e.target.value) || 0)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono"
                    placeholder="0"
                  />
                </div>
                <div className="col-span-3">
                  <label className="block text-xs text-slate-400 mb-1">Note</label>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <div className="col-span-12 flex items-center gap-4 mb-2">
                  <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={withdrawFromDrawer}
                      onChange={(e) => setWithdrawFromDrawer(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-700 bg-slate-950 text-orange-600 focus:ring-orange-500"
                    />
                    <span className="text-sm">Withdraw from Drawer</span>
                  </label>

                  {withdrawFromDrawer && (
                    <Select
                      value={selectedDrawer}
                      onChange={(value) => setSelectedDrawer(value)}
                      options={[
                        { value: "General", label: "General" },
                        { value: "OMT", label: "OMT" },
                        { value: "Whish", label: "Whish" },
                        { value: "Binance", label: "Binance" },
                      ]}
                      ringColor="ring-violet-500"
                      buttonClassName="bg-slate-950 text-sm px-2 py-1"
                    />
                  )}
                </div>
                <div className="col-span-12 flex justify-end">
                  <button
                    onClick={handleAddEntry}
                    className="px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium"
                  >
                    Add Entry
                  </button>
                </div>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <div className="grid grid-cols-12 gap-2 bg-slate-800/60 text-slate-300 text-xs font-semibold px-3 py-2">
                  <div className="col-span-2">Type</div>
                  <div className="col-span-2 text-right">USD</div>
                  <div className="col-span-3 text-right">LBP</div>
                  <div className="col-span-3">Note</div>
                  <div className="col-span-2">Date</div>
                </div>
                <div className="max-h-[55vh] overflow-y-auto">
                  {ledger.map((row) => (
                    <div
                      key={row.id}
                      className="grid grid-cols-12 gap-2 px-3 py-2 text-sm border-t border-slate-800"
                    >
                      <div className="col-span-2 text-slate-200 font-mono">
                        {row.entry_type}
                      </div>
                      <div className="col-span-2 text-right text-slate-200 font-mono">
                        {row.amount_usd.toFixed(2)}
                      </div>
                      <div className="col-span-3 text-right text-slate-200 font-mono">
                        {row.amount_lbp.toLocaleString()}
                      </div>
                      <div className="col-span-3 text-slate-300 truncate">
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
    </div>
  );
}
