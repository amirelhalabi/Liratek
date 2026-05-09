import { useState, useEffect } from "react";
import { X, PlusCircle, ArrowRightLeft } from "lucide-react";

interface SourceDrawer {
  drawer_name: string;
  balance_usd: number;
  balance_lbp: number;
}

type TopUpMode = "external" | "from_drawer";

interface DrawerTopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function DrawerTopUpModal({
  isOpen,
  onClose,
  onSuccess,
}: DrawerTopUpModalProps) {
  const [mode, setMode] = useState<TopUpMode>("external");
  const [amountUsd, setAmountUsd] = useState("");
  const [amountLbp, setAmountLbp] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sourceDrawers, setSourceDrawers] = useState<SourceDrawer[]>([]);
  const [selectedDrawer, setSelectedDrawer] = useState("");

  useEffect(() => {
    if (isOpen && mode === "from_drawer") {
      loadSourceDrawers();
    }
  }, [isOpen, mode]);

  async function loadSourceDrawers() {
    const result = await window.api.drawerTopUp.getSourceDrawers();
    if (result.success && result.data) {
      setSourceDrawers(result.data);
      if (result.data.length > 0 && !selectedDrawer) {
        setSelectedDrawer(result.data[0].drawer_name);
      }
    }
  }

  if (!isOpen) return null;

  function handleClose() {
    setAmountUsd("");
    setAmountLbp("");
    setNotes("");
    setMode("external");
    setSelectedDrawer("");
    onClose();
  }

  async function handleSubmit() {
    const usd = parseFloat(amountUsd) || 0;
    const lbp = parseFloat(amountLbp) || 0;

    if (usd <= 0 && lbp <= 0) {
      alert("Please enter at least one amount greater than 0.");
      return;
    }

    if (mode === "from_drawer" && !selectedDrawer) {
      alert("Please select a source drawer.");
      return;
    }

    setIsSubmitting(true);
    try {
      const trimmedNotes = notes.trim();

      let result;
      if (mode === "from_drawer") {
        result = await window.api.drawerTopUp.createFromDrawer({
          amount_usd: usd,
          amount_lbp: lbp,
          source_drawer: selectedDrawer,
          ...(trimmedNotes ? { notes: trimmedNotes } : {}),
        });
      } else {
        result = await window.api.drawerTopUp.create({
          amount_usd: usd,
          amount_lbp: lbp,
          ...(trimmedNotes ? { notes: trimmedNotes } : {}),
        });
      }

      if (result.success) {
        alert("Drawer topped up successfully.");
        setAmountUsd("");
        setAmountLbp("");
        setNotes("");
        onSuccess();
      } else {
        alert(result.error ?? "Failed to top up drawer.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const currentDrawer = sourceDrawers.find(
    (d) => d.drawer_name === selectedDrawer,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-white">
              Top Up General Drawer
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setMode("external")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors ${
              mode === "external"
                ? "bg-emerald-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            External (Cash In)
          </button>
          <button
            onClick={() => setMode("from_drawer")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              mode === "from_drawer"
                ? "bg-violet-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            <ArrowRightLeft size={14} />
            From Drawer
          </button>
        </div>

        <div className="space-y-4">
          {/* Source Drawer Selector (only in from_drawer mode) */}
          {mode === "from_drawer" && (
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Source Drawer
              </label>
              <select
                value={selectedDrawer}
                onChange={(e) => setSelectedDrawer(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-colors"
              >
                {sourceDrawers.length === 0 && (
                  <option value="">No drawers available</option>
                )}
                {sourceDrawers.map((d) => (
                  <option key={d.drawer_name} value={d.drawer_name}>
                    {d.drawer_name.replace("_", " ")}
                  </option>
                ))}
              </select>
              {currentDrawer && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Balance: ${currentDrawer.balance_usd.toLocaleString()} USD
                  {currentDrawer.balance_lbp > 0 &&
                    ` / ${currentDrawer.balance_lbp.toLocaleString()} LBP`}
                </p>
              )}
            </div>
          )}

          {/* USD Amount */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              USD Amount
            </label>
            <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-violet-500 transition-colors">
              <span className="px-3 text-sm text-slate-400 border-r border-slate-700">
                $
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={amountUsd}
                onChange={(e) => setAmountUsd(e.target.value)}
                placeholder="0.00"
                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
              />
            </div>
          </div>

          {/* LBP Amount */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              LBP Amount
            </label>
            <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-violet-500 transition-colors">
              <span className="px-3 text-sm text-slate-400 border-r border-slate-700">
                LBP
              </span>
              <input
                type="number"
                min="0"
                step="1"
                value={amountLbp}
                onChange={(e) => setAmountLbp(e.target.value)}
                placeholder="0"
                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Notes <span className="text-slate-600">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 placeholder:text-slate-600 resize-none transition-colors"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`flex-1 py-2.5 ${
              mode === "from_drawer"
                ? "bg-violet-600 hover:bg-violet-500"
                : "bg-emerald-600 hover:bg-emerald-500"
            } disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded-lg transition-colors`}
          >
            {isSubmitting
              ? "Processing..."
              : mode === "from_drawer"
                ? "Transfer"
                : "Top Up"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DrawerTopUpModal;
