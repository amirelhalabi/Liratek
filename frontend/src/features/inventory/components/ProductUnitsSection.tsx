import { useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { appEvents } from "@liratek/ui";
import {
  useProductUnitsQuery,
  useRegisterUnitsMutation,
  useDeleteUnitMutation,
} from "../hooks/useProductUnits";
import { computeUnitDrift, parseImeiBatch } from "../productUnitsLogic";

export interface ProductUnitsSectionProps {
  productId: number;
  stockQuantity: number;
}

/**
 * LIRA-143 Phase 6b — the "Units / IMEIs" section embedded in ProductForm,
 * shown only for an existing product whose category tracks IMEI units (see
 * ProductForm for the flag-source decision). Lists every registered unit
 * (IN_STOCK/SOLD, defective flag), accepts a scan-friendly batch of new
 * IMEIs, and allows deleting an IN_STOCK intake mistake. The intake-vs-
 * stock_quantity drift (owner decision #6) is WARN-ONLY — it is rendered as
 * an amber banner and never blocks saving the product or adding more units.
 */
export function ProductUnitsSection({
  productId,
  stockQuantity,
}: ProductUnitsSectionProps) {
  const {
    data: units = [],
    isLoading,
    isError,
  } = useProductUnitsQuery(productId);
  const registerUnits = useRegisterUnitsMutation(productId);
  const deleteUnit = useDeleteUnitMutation(productId);

  const [imeiInput, setImeiInput] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);

  const inStockCount = units.filter((u) => u.status === "IN_STOCK").length;
  const drift = computeUnitDrift(inStockCount, stockQuantity);
  const pendingImeis = parseImeiBatch(imeiInput);

  const handleAddImeis = async () => {
    if (pendingImeis.length === 0) return;
    setRegisterError(null);
    try {
      const result = await registerUnits.mutateAsync(pendingImeis);
      if (!result.success) {
        setRegisterError(result.error ?? "Failed to register unit(s)");
        return;
      }
      setImeiInput("");
    } catch (err) {
      setRegisterError(
        err instanceof Error ? err.message : "Failed to register unit(s)",
      );
    }
  };

  const handleDelete = async (unitId: number) => {
    if (!confirm("Remove this unit? This cannot be undone.")) return;
    try {
      const result = await deleteUnit.mutateAsync(unitId);
      if (!result.success) {
        appEvents.emit(
          "notification:show",
          result.error ?? "Failed to delete unit",
          "error",
        );
      }
    } catch (err) {
      appEvents.emit(
        "notification:show",
        err instanceof Error ? err.message : "Failed to delete unit",
        "error",
      );
    }
  };

  return (
    <div
      className="border-t border-slate-700 pt-4 space-y-3"
      data-testid="product-units-section"
    >
      <h3 className="text-sm font-semibold text-white">Units / IMEIs</h3>

      {!drift.matches && (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300"
          data-testid="unit-drift-warning"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {inStockCount} unit{inStockCount === 1 ? "" : "s"} registered
            in-stock, but the product's stock quantity is {stockQuantity}.
            This is a warning only — it never blocks saving.
          </span>
        </div>
      )}

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        {isLoading && (
          <p className="text-sm text-slate-400 py-2">Loading units…</p>
        )}
        {!isLoading && isError && (
          <p className="text-sm text-red-400 py-2">Failed to load units.</p>
        )}
        {!isLoading && !isError && units.length === 0 && (
          <p className="text-sm text-slate-500 py-2">
            No units registered yet.
          </p>
        )}
        {!isLoading &&
          !isError &&
          units.map((u) => (
            <div
              key={u.id}
              data-testid={`product-unit-${u.id}`}
              className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2 text-sm"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-white truncate">
                  {u.imei}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${
                    u.status === "IN_STOCK"
                      ? "bg-sky-500/10 text-sky-400 border-sky-500/30"
                      : "bg-slate-700/40 text-slate-300 border-slate-600/40"
                  }`}
                >
                  {u.status}
                </span>
                {!!u.is_defective && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/30 shrink-0">
                    Defective
                  </span>
                )}
              </div>
              {u.status === "IN_STOCK" ? (
                <button
                  type="button"
                  onClick={() => handleDelete(u.id)}
                  disabled={deleteUnit.isPending}
                  className="text-slate-400 hover:text-red-400 p-1 disabled:opacity-50 shrink-0"
                  title="Remove unit"
                  aria-label={`Remove unit ${u.imei}`}
                >
                  <Trash2 size={14} />
                </button>
              ) : (
                <span className="text-slate-600 text-xs shrink-0">—</span>
              )}
            </div>
          ))}
      </div>

      <div>
        <label className="block text-xs text-slate-400 mb-1">
          Add IMEIs — scan or type, one per line
        </label>
        <textarea
          value={imeiInput}
          onChange={(e) => setImeiInput(e.target.value)}
          placeholder={"356938035643809\n356938035643810"}
          rows={3}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-600 resize-none"
        />
        {registerError && (
          <p className="text-sm text-red-400 mt-1">{registerError}</p>
        )}
        <button
          type="button"
          onClick={handleAddImeis}
          disabled={registerUnits.isPending || pendingImeis.length === 0}
          className="mt-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {registerUnits.isPending
            ? "Adding…"
            : pendingImeis.length > 0
              ? `Add ${pendingImeis.length} Unit${pendingImeis.length === 1 ? "" : "s"}`
              : "Add Unit(s)"}
        </button>
      </div>
    </div>
  );
}

export default ProductUnitsSection;
