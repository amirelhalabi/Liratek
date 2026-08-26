import { useState, type FormEvent } from "react";
import { X, PackagePlus, History, Loader2 } from "lucide-react";
import { appEvents } from "@liratek/ui";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import logger from "@/utils/logger";
import {
  useAdjustStockMutation,
  useStockAdjustmentsQuery,
} from "../hooks/useStockAdjustments";
import { useRegisterUnitsMutation } from "../hooks/useProductUnits";
import { ImeiAddRow, type ImeiAddRowResult } from "./ImeiAddRow";

/**
 * Deliberately minimal — structurally satisfied by both the full `Product`
 * (@liratek/ui, used from ProductList.tsx) and the negative-stock read shape
 * (`{id, name, barcode, stock_quantity}` from `getNegativeStock()`, used from
 * Settings → Diagnostics) without either caller needing to cast.
 *
 * `tracks_imei_units` is OPTIONAL (LIRA-143 Phase 6b, decision #6's intake
 * prompt): the Diagnostics negative-stock shape doesn't carry it, and a
 * missing/falsy value means "treat as flag-OFF" — the intake step never
 * appears for that caller, keeping its flow byte-identical to before.
 */
export interface AdjustableProduct {
  id: number;
  name: string;
  barcode: string | null;
  stock_quantity?: number;
  tracks_imei_units?: number;
}

interface AdjustStockModalProps {
  product: AdjustableProduct;
  onClose: () => void;
  /** Called after a successful adjustment — the caller re-fetches its own
   *  product list (ProductList.tsx doesn't use TanStack Query for reads yet;
   *  the mutation already invalidates the ["products"] key defensively for
   *  when it does). */
  onSuccess: () => void;
}

type AdjustMode = "set" | "delta";

/**
 * LIRA-077 — manual stock correction with a required reason, written to the
 * `stock_adjustments` audit trail in the SAME db transaction as the
 * quantity change (ProductRepository.adjustStock/adjustStockDelta). Shows
 * the per-product adjustment history below the form.
 */
/** Post-adjustment step shown only when the category tracks IMEI units AND
 *  the adjustment INCREASED stock (owner decision #6's intake prompt). Any
 *  other case ("form") behaves exactly as before this ticket. */
type Step = "form" | "intake";

export default function AdjustStockModal({
  product,
  onClose,
  onSuccess,
}: AdjustStockModalProps) {
  const [mode, setMode] = useState<AdjustMode>("set");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const [step, setStep] = useState<Step>("form");
  const [pendingIncrease, setPendingIncrease] = useState(0);
  const [scannedImeis, setScannedImeis] = useState<string[]>([]);

  const adjustStock = useAdjustStockMutation();
  const registerUnits = useRegisterUnitsMutation(product.id);
  const {
    data: adjustments = [],
    isLoading: historyLoading,
    isError: historyError,
  } = useStockAdjustmentsQuery(product.id);

  const currentStock = product.stock_quantity ?? 0;

  const parsedQuantity = quantity.trim() === "" ? NaN : Number(quantity);
  const previewNewQuantity =
    Number.isFinite(parsedQuantity) && Number.isInteger(parsedQuantity)
      ? mode === "set"
        ? parsedQuantity
        : currentStock + parsedQuantity
      : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setFormError("Reason is required");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || !Number.isInteger(parsedQuantity)) {
      setFormError("Enter a whole number");
      return;
    }
    if (mode === "set" && parsedQuantity < 0) {
      setFormError("Stock quantity cannot be negative");
      return;
    }
    if (mode === "delta" && parsedQuantity === 0) {
      setFormError("Delta must be non-zero");
      return;
    }

    try {
      const result = await adjustStock.mutateAsync({
        id: product.id,
        ...(mode === "set"
          ? { newQuantity: parsedQuantity }
          : { delta: parsedQuantity }),
        reason: trimmedReason,
      });

      if (!result.success) {
        setFormError(result.error ?? "Failed to adjust stock");
        return;
      }

      appEvents.emit(
        "notification:show",
        `Stock adjusted for "${product.name}"`,
        "success",
      );

      // LIRA-143 Phase 6b (decision #6): an INCREASE on a category that
      // tracks IMEI units offers an optional intake step instead of closing
      // immediately. A decrease, a "set" to a lower/equal value, or a
      // flag-OFF product all fall through to `onSuccess()` exactly as
      // before this ticket.
      const increase =
        mode === "set" ? parsedQuantity - currentStock : parsedQuantity;
      if ((product.tracks_imei_units ?? 0) === 1 && increase > 0) {
        setPendingIncrease(increase);
        setStep("intake");
        return;
      }

      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to adjust stock:", err);
      setFormError(message || "Failed to adjust stock");
    }
  }

  async function handleAddImei(imei: string): Promise<ImeiAddRowResult> {
    try {
      const result = await registerUnits.mutateAsync([imei]);
      if (!result.success) {
        return {
          success: false,
          error: result.error ?? "Failed to register unit",
        };
      }
      setScannedImeis((prev) => [...prev, imei]);
      const drift = result.data?.drift;
      if (drift && !drift.matches) {
        appEvents.emit(
          "notification:show",
          `Unit count drift on "${product.name}": ${drift.inStockUnits} in stock vs ${drift.stockQuantity} on the product record — check when convenient.`,
          "warning",
        );
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to register product unit:", err);
      return { success: false, error: message || "Failed to register unit" };
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <PackagePlus size={18} className="text-violet-400" />
              Adjust Stock
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {product.name}{" "}
              <span className="text-slate-500">
                ({product.barcode || "no barcode"})
              </span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
            <span className="text-xs text-slate-400">Current stock</span>
            <span className="text-sm font-semibold text-white">
              {currentStock} units
            </span>
          </div>

          {step === "form" && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Adjustment mode
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("set")}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    mode === "set"
                      ? "bg-violet-600 text-white"
                      : "bg-slate-900 text-slate-400 border border-slate-700 hover:bg-slate-700"
                  }`}
                >
                  Set exact quantity
                </button>
                <button
                  type="button"
                  onClick={() => setMode("delta")}
                  className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    mode === "delta"
                      ? "bg-violet-600 text-white"
                      : "bg-slate-900 text-slate-400 border border-slate-700 hover:bg-slate-700"
                  }`}
                >
                  Add / remove (+/-)
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {mode === "set" ? "New quantity *" : "Delta (e.g. -5 or 10) *"}
              </label>
              <input
                type="number"
                step={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={mode === "set" ? "0" : "+10 or -5"}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
              />
              {previewNewQuantity !== null && (
                <p className="text-xs text-slate-500 mt-1">
                  New stock: {currentStock} {mode === "set" ? "→" : "+"}{" "}
                  {mode === "delta" ? quantity : ""}{" "}
                  {mode === "delta" ? "=" : ""} {previewNewQuantity} units
                </p>
              )}
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Reason *
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Physical recount, damaged goods, supplier correction…"
                rows={2}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 resize-none"
              />
            </div>

            {formError && (
              <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {formError}
              </p>
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={adjustStock.isPending}
                className="flex-1 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors text-sm disabled:opacity-50"
              >
                {adjustStock.isPending ? "Saving…" : "Apply Adjustment"}
              </button>
            </div>
          </form>
          )}

          {step === "intake" && (
            <div className="space-y-4" data-testid="stock-intake-step">
              <p className="text-sm text-slate-300">
                Scan {pendingIncrease} IMEI{pendingIncrease === 1 ? "" : "s"}{" "}
                for the new stock — optional.
              </p>
              <ImeiAddRow
                onAdd={handleAddImei}
                placeholder="356938035643809"
                autoFocus
              />
              {scannedImeis.length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {scannedImeis.map((imei) => (
                    <div
                      key={imei}
                      className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-white truncate">
                        {imei}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-500/10 text-sky-400 border-sky-500/30 shrink-0">
                        Added
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={onSuccess}
                className="w-full px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors text-sm"
              >
                Done
              </button>
            </div>
          )}

          <div className="border-t border-slate-700 pt-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
              <History size={14} className="text-slate-400" />
              Adjustment History
            </h3>

            {historyLoading && (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4 justify-center">
                <Loader2 size={16} className="animate-spin" />
                Loading history…
              </div>
            )}

            {!historyLoading && historyError && (
              <p className="text-sm text-red-400 text-center py-4">
                Failed to load adjustment history.
              </p>
            )}

            {!historyLoading && !historyError && adjustments.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">
                No adjustments recorded yet.
              </p>
            )}

            {!historyLoading && !historyError && adjustments.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {adjustments.map((adj) => (
                  <div
                    key={adj.id}
                    className="bg-slate-900/50 rounded-lg px-3 py-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-semibold ${
                          adj.delta > 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {adj.delta > 0 ? "+" : ""}
                        {adj.delta} ({adj.old_quantity} → {adj.new_quantity})
                      </span>
                      <span className="text-slate-500">
                        {parseDbDate(adj.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-slate-300 mt-1">{adj.reason}</p>
                    <p className="text-slate-500 mt-0.5">
                      by {adj.username ?? "Unknown user"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
