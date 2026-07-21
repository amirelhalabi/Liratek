import { useState, useEffect } from "react";
import { X, PlusCircle, ArrowRightLeft, Plus } from "lucide-react";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { appEvents, DecimalInput, Select, useApi } from "@liratek/ui";

interface SourceDrawer {
  drawer_name: string;
  balance_usd: number;
  balance_lbp: number;
}

interface AvailableCurrency {
  code: string;
  name: string;
  symbol?: string;
}

interface ExtraCurrencyRow {
  currency_code: string;
  amount: string;
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
  const api = useApi();
  useModalFocusFix(isOpen);
  const [mode, setMode] = useState<TopUpMode>("external");
  const [amountUsd, setAmountUsd] = useState("");
  const [amountLbp, setAmountLbp] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sourceDrawers, setSourceDrawers] = useState<SourceDrawer[]>([]);
  const [selectedDrawer, setSelectedDrawer] = useState("");
  const [extraCurrencies, setExtraCurrencies] = useState<ExtraCurrencyRow[]>(
    [],
  );
  const [availableExtraCurrencies, setAvailableExtraCurrencies] = useState<
    AvailableCurrency[]
  >([]);

  useEffect(() => {
    if (isOpen && mode === "from_drawer") {
      loadSourceDrawers();
    }
  }, [isOpen, mode]);

  useEffect(() => {
    if (isOpen) {
      loadExtraCurrencies();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function loadSourceDrawers() {
    const result = await api.drawerTopUp.getSourceDrawers();
    if (result.success && result.data) {
      setSourceDrawers(result.data);
      if (result.data.length > 0 && !selectedDrawer) {
        setSelectedDrawer(result.data[0].drawer_name);
      }
    }
  }

  async function loadExtraCurrencies() {
    try {
      const currencies = await api.getFullCurrenciesByDrawer("General");
      setAvailableExtraCurrencies(
        (currencies ?? [])
          .filter((c) => c.code !== "USD" && c.code !== "LBP")
          .map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })),
      );
    } catch {
      setAvailableExtraCurrencies([]);
    }
  }

  if (!isOpen) return null;

  function handleClose() {
    setAmountUsd("");
    setAmountLbp("");
    setNotes("");
    setMode("external");
    setSelectedDrawer("");
    setExtraCurrencies([]);
    onClose();
  }

  function addCurrencyRow() {
    const used = new Set(extraCurrencies.map((row) => row.currency_code));
    const next = availableExtraCurrencies.find((c) => !used.has(c.code));
    if (!next) return;
    setExtraCurrencies((prev) => [
      ...prev,
      { currency_code: next.code, amount: "" },
    ]);
  }

  function removeCurrencyRow(index: number) {
    setExtraCurrencies((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCurrencyRow(index: number, patch: Partial<ExtraCurrencyRow>) {
    setExtraCurrencies((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  async function handleSubmit() {
    const usd = parseFloat(amountUsd) || 0;
    const lbp = parseFloat(amountLbp) || 0;
    const extraLegs =
      mode === "external"
        ? extraCurrencies
            .filter(
              (row) => row.currency_code && (parseFloat(row.amount) || 0) > 0,
            )
            .map((row) => ({
              currency_code: row.currency_code,
              amount: parseFloat(row.amount) || 0,
            }))
        : [];

    if (usd <= 0 && lbp <= 0 && extraLegs.length === 0) {
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
        result = await api.drawerTopUp.createFromDrawer({
          amount_usd: usd,
          amount_lbp: lbp,
          source_drawer: selectedDrawer,
          ...(trimmedNotes ? { notes: trimmedNotes } : {}),
        });
      } else {
        result = await api.drawerTopUp.create({
          amount_usd: usd,
          amount_lbp: lbp,
          ...(trimmedNotes ? { notes: trimmedNotes } : {}),
          ...(extraLegs.length > 0 ? { extra_currencies: extraLegs } : {}),
        });
      }

      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Drawer topped up successfully.",
          "success",
        );
        setAmountUsd("");
        setAmountLbp("");
        setNotes("");
        setExtraCurrencies([]);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
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
              <Select
                value={selectedDrawer}
                onChange={(v) => setSelectedDrawer(v)}
                options={
                  sourceDrawers.length === 0
                    ? [{ value: "", label: "No drawers available" }]
                    : sourceDrawers.map((d) => ({
                        value: d.drawer_name,
                        label: d.drawer_name.replace("_", " "),
                      }))
                }
                buttonClassName="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-colors"
              />
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
              <DecimalInput
                value={parseFloat(amountUsd) || 0}
                onChange={(n) => setAmountUsd(n ? String(n) : "")}
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
              <DecimalInput
                value={parseFloat(amountLbp) || 0}
                onChange={(n) => setAmountLbp(n ? String(n) : "")}
                placeholder="0"
                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
              />
            </div>
          </div>

          {/* Extra currencies (External mode only) */}
          {mode === "external" && (
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Other Currencies{" "}
                <span className="text-slate-600">(optional)</span>
              </label>

              {availableExtraCurrencies.length === 0 ? (
                <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5">
                  No additional currencies enabled for the General drawer — add
                  and enable them in Settings → Currencies.
                </p>
              ) : (
                <div className="space-y-2">
                  {extraCurrencies.map((row, index) => {
                    const usedElsewhere = new Set(
                      extraCurrencies
                        .filter((_, i) => i !== index)
                        .map((r) => r.currency_code),
                    );
                    const rowOptions = availableExtraCurrencies
                      .filter((c) => !usedElsewhere.has(c.code))
                      .map((c) => ({
                        value: c.code,
                        label: c.symbol ? `${c.code} (${c.symbol})` : c.code,
                      }));

                    return (
                      <div key={index} className="flex items-center gap-2">
                        <Select
                          value={row.currency_code}
                          onChange={(v) =>
                            updateCurrencyRow(index, { currency_code: v })
                          }
                          options={rowOptions}
                          className="w-28 shrink-0"
                          buttonClassName="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        />
                        <div className="flex-1 flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-emerald-500 transition-colors">
                          <DecimalInput
                            value={parseFloat(row.amount) || 0}
                            onChange={(n) =>
                              updateCurrencyRow(index, {
                                amount: n ? String(n) : "",
                              })
                            }
                            placeholder="0.00"
                            className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCurrencyRow(index)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                          aria-label="Remove currency"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={addCurrencyRow}
                    disabled={
                      extraCurrencies.length >= availableExtraCurrencies.length
                    }
                    className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus size={14} />
                    Add currency
                  </button>
                </div>
              )}
            </div>
          )}

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
