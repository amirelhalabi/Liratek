import { useState } from "react";
import { X, MinusCircle, Plus, Trash2 } from "lucide-react";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { appEvents, DecimalInput, useApi } from "@liratek/ui";
import { useCurrencyContext } from "@/contexts/CurrencyContext";

interface DrawerCashoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ExtraCurrencyRow {
  currency_code: string;
  amount: string;
}

export function DrawerCashoutModal({
  isOpen,
  onClose,
  onSuccess,
}: DrawerCashoutModalProps) {
  const api = useApi();
  useModalFocusFix(isOpen);
  const { activeCurrencies, getDecimals } = useCurrencyContext();
  const [amountUsd, setAmountUsd] = useState("");
  const [amountLbp, setAmountLbp] = useState("");
  // GENERAL_DRAWER_UNRESTRICTED.md Phase 4 review finding: Drawer Cash-Out is
  // DRAWER_TOPUP's documented rule-20 manual-correction owner, but until this
  // field existed it could only express USD/LBP — a mistaken foreign-currency
  // top-up (EUR via Drawer Top-Up's own extra_currencies) had no way to be
  // corrected through the app. Mirrors DrawerTopUpModal's extra-currency rows
  // minus the acquisition-rate inputs — a cash-out has no cost basis to record.
  const [extraCurrencies, setExtraCurrencies] = useState<ExtraCurrencyRow[]>(
    [],
  );
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const addableCurrencies = activeCurrencies.filter(
    (c) =>
      c.code !== "USD" &&
      c.code !== "LBP" &&
      !extraCurrencies.some((e) => e.currency_code === c.code),
  );

  function resetForm() {
    setAmountUsd("");
    setAmountLbp("");
    setExtraCurrencies([]);
    setNotes("");
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleAddCurrency(code: string) {
    if (!code) return;
    setExtraCurrencies((prev) => [
      ...prev,
      { currency_code: code, amount: "" },
    ]);
  }

  function handleExtraAmountChange(index: number, value: string) {
    setExtraCurrencies((prev) =>
      prev.map((row, i) => (i === index ? { ...row, amount: value } : row)),
    );
  }

  function handleRemoveExtra(index: number) {
    setExtraCurrencies((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    const usd = parseFloat(amountUsd) || 0;
    const lbp = parseFloat(amountLbp) || 0;
    const extra_currencies = extraCurrencies
      .map((row) => ({
        currency_code: row.currency_code,
        amount: parseFloat(row.amount) || 0,
      }))
      .filter((row) => row.amount > 0);
    const trimmedNotes = notes.trim();

    if (usd <= 0 && lbp <= 0 && extra_currencies.length === 0) {
      alert("Please enter at least one amount greater than 0.");
      return;
    }

    if (!trimmedNotes) {
      alert("Please enter a reason for this cash-out.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await api.drawerCashout.create({
        amount_usd: usd,
        amount_lbp: lbp,
        ...(extra_currencies.length > 0 ? { extra_currencies } : {}),
        notes: trimmedNotes,
      });

      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Cash removed from drawer.",
          "success",
        );
        resetForm();
        onSuccess();
      } else {
        alert(result.error ?? "Failed to cash out drawer.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const trimmedNotesEmpty = !notes.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <MinusCircle className="w-5 h-5 text-rose-400" />
            <h2 className="text-lg font-bold text-white">
              Cash Out — General Drawer
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          {/* USD Amount */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              USD Amount
            </label>
            <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-rose-500 transition-colors">
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
            <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-rose-500 transition-colors">
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

          {/* Extra currencies — correcting a mistaken foreign-currency top-up */}
          {extraCurrencies.length > 0 && (
            <div className="space-y-2">
              {extraCurrencies.map((row, index) => (
                <div key={`${row.currency_code}-${index}`}>
                  <label className="text-xs text-slate-400 block mb-1">
                    {row.currency_code} Amount
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center flex-1 bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-rose-500 transition-colors">
                      <span className="px-3 text-sm text-slate-400 border-r border-slate-700">
                        {row.currency_code}
                      </span>
                      <DecimalInput
                        value={parseFloat(row.amount) || 0}
                        onChange={(n) =>
                          handleExtraAmountChange(index, n ? String(n) : "")
                        }
                        decimals={getDecimals(row.currency_code)}
                        placeholder="0"
                        className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveExtra(index)}
                      className="p-2 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
                      aria-label={`Remove ${row.currency_code}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {addableCurrencies.length > 0 && (
            <div className="relative">
              <Plus className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value=""
                data-testid="drawer-cashout-add-currency"
                onChange={(e) => handleAddCurrency(e.target.value)}
                className="w-full bg-slate-900/60 border border-dashed border-slate-600 rounded-lg pl-8 pr-3 py-2 text-xs text-slate-400 focus:outline-none focus:border-rose-500 cursor-pointer"
              >
                <option value="">Add another currency</option>
                {addableCurrencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                    {c.name ? ` — ${c.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Notes (required) */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Reason *
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why is this cash being taken out?"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-rose-500 placeholder:text-slate-600 resize-none transition-colors"
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
            disabled={isSubmitting || trimmedNotesEmpty}
            className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded-lg transition-colors"
          >
            {isSubmitting ? "Processing..." : "Cash Out"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DrawerCashoutModal;
