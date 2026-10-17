import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { useFormat } from "@/i18n/useFormat";
import { X, PackagePlus, History, Loader2, Layers } from "lucide-react";
import { appEvents } from "@liratek/ui";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import logger from "@/utils/logger";
import {
  useAdjustStockMutation,
  useReceiveStockMutation,
  useStockAdjustmentsQuery,
  useOpenStockBatchesQuery,
} from "../hooks/useStockAdjustments";
import {
  useSuppliersQuery,
  useOpenRecordedDebtsQuery,
} from "@/features/suppliers/hooks/useSuppliers";
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
  /** Supplier stock-intake (SUPPLIER_STOCK_INTAKE_PLAN.md) — both OPTIONAL:
   *  the Diagnostics negative-stock read shape (`getNegativeStock()`)
   *  carries neither. Missing `cost_price` means the unit-cost field on an
   *  increase starts at 0 rather than failing; missing/blank `supplier`
   *  means an increase can only ever create a batch, never book supplier
   *  debt — same "no supplier, no debt" rule `receiveStock` itself applies. */
  cost_price?: number;
  supplier?: string | null;
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
  const { t, i18n } = useTranslation(["inventory", "common"]);
  const { formatNumber, formatDate, formatDateTime } = useFormat();
  // Arabic only: isolate a bare number expression ("10 → 25") so the bidi
  // algorithm cannot reverse it. English keeps plain text nodes.
  const rtl = i18n.dir() === "rtl";
  const [mode, setMode] = useState<AdjustMode>("set");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // Supplier stock-intake (owner: "similar design" to the Add Product form,
  // "keep the button I have, no need to change its name") — only relevant
  // when the resolved change is an INCREASE; see `isIncrease` below.
  // Prefilled with the product's current cost, defaulting to 0 for callers
  // (Diagnostics) that don't carry `cost_price`.
  const [unitCost, setUnitCost] = useState(String(product.cost_price ?? 0));
  const [isOldStock, setIsOldStock] = useState(false);
  // LIRA-087 (migration v189) — attach this intake to an already-recorded
  // open supplier debt instead of booking a new one. "" = none selected
  // (book a new debt, today's behavior unchanged). Resolved from the
  // product's free-text `supplier` NAME to the real supplier id (the
  // repository only knows debts by id) — same resolution `receiveStock`
  // itself does server-side (`resolveSupplierId`), done here client-side
  // only to populate the picker.
  const [attachToRecordedDebtId, setAttachToRecordedDebtId] = useState("");
  const { data: suppliersList = [] } = useSuppliersQuery();
  const resolvedSupplierId =
    suppliersList.find(
      (s) =>
        s.name.trim().toLowerCase() ===
        (product.supplier ?? "").trim().toLowerCase(),
    )?.id ?? null;
  const { data: openRecordedDebts = [] } = useOpenRecordedDebtsQuery(
    resolvedSupplierId,
  );

  const [step, setStep] = useState<Step>("form");
  const [pendingIncrease, setPendingIncrease] = useState(0);
  const [scannedImeis, setScannedImeis] = useState<string[]>([]);
  // The stock change is already committed to the DB by the time the intake
  // step appears — any exit after that point (X, Cancel, backdrop) must
  // refresh the caller's list too, not just close.
  const [committed, setCommitted] = useState(false);
  const handleDismiss = committed ? onSuccess : onClose;

  const adjustStock = useAdjustStockMutation();
  const receiveStock = useReceiveStockMutation();
  const registerUnits = useRegisterUnitsMutation(product.id);
  const {
    data: adjustments = [],
    isLoading: historyLoading,
    isError: historyError,
  } = useStockAdjustmentsQuery(product.id);
  const {
    data: batches = [],
    isLoading: batchesLoading,
    isError: batchesError,
  } = useOpenStockBatchesQuery(product.id);

  const currentStock = product.stock_quantity ?? 0;

  const parsedQuantity = quantity.trim() === "" ? NaN : Number(quantity);
  const previewNewQuantity =
    Number.isFinite(parsedQuantity) && Number.isInteger(parsedQuantity)
      ? mode === "set"
        ? parsedQuantity
        : currentStock + parsedQuantity
      : null;
  // The resolved delta this submission would apply — used both to gate the
  // Unit cost/"old stock" fields below and, on submit, to route an
  // INCREASE through `receiveStock` (real delivery: batch + supplier debit)
  // instead of the plain `adjustStock` audit-only path a decrease still uses.
  const resolvedIncrease =
    previewNewQuantity !== null ? previewNewQuantity - currentStock : 0;
  const isIncrease = resolvedIncrease > 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setFormError(t("adjust.error.reasonRequired"));
      return;
    }
    if (!Number.isFinite(parsedQuantity) || !Number.isInteger(parsedQuantity)) {
      setFormError(t("adjust.error.wholeNumber"));
      return;
    }
    if (mode === "set" && parsedQuantity < 0) {
      setFormError(t("adjust.error.negative"));
      return;
    }
    if (mode === "delta" && parsedQuantity === 0) {
      setFormError(t("adjust.error.deltaZero"));
      return;
    }

    const increase =
      mode === "set" ? parsedQuantity - currentStock : parsedQuantity;

    if (increase > 0) {
      const parsedUnitCost = unitCost.trim() === "" ? NaN : Number(unitCost);
      if (!Number.isFinite(parsedUnitCost) || parsedUnitCost < 0) {
        setFormError(t("adjust.error.unitCost"));
        return;
      }
    }

    try {
      // Supplier stock-intake: an INCREASE is a real delivery — route it
      // through `receiveStock` so it books a FIFO cost batch and (unless
      // "old stock" is checked or the product has no supplier) a
      // supplier_ledger debit. A decrease (or a "set" to an equal/lower
      // value) is unchanged: `adjustStock`'s plain audit-only path, which
      // never touches the supplier ledger by design.
      let result;
      if (increase > 0) {
        result = await receiveStock.mutateAsync({
          product_id: product.id,
          quantity: increase,
          unit_cost_usd: Number(unitCost),
          supplier: product.supplier ?? null,
          is_old_stock: isOldStock,
          reason: trimmedReason,
          attach_to_recorded_debt_id: attachToRecordedDebtId
            ? Number(attachToRecordedDebtId)
            : null,
        });
      } else {
        result = await adjustStock.mutateAsync({
          id: product.id,
          ...(mode === "set"
            ? { newQuantity: parsedQuantity }
            : { delta: parsedQuantity }),
          reason: trimmedReason,
        });
      }

      if (!result.success) {
        setFormError(result.error ?? t("adjust.error.failed"));
        return;
      }

      setCommitted(true);

      appEvents.emit(
        "notification:show",
        t("adjust.toast.adjusted", { name: product.name }),
        "success",
      );

      // LIRA-143 Phase 6b (decision #6): an INCREASE on a category that
      // tracks IMEI units offers an optional intake step instead of closing
      // immediately. A decrease, a "set" to a lower/equal value, or a
      // flag-OFF product all fall through to `onSuccess()` exactly as
      // before this ticket.
      if ((product.tracks_imei_units ?? 0) === 1 && increase > 0) {
        setPendingIncrease(increase);
        setStep("intake");
        return;
      }

      onSuccess();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to adjust stock:", err);
      setFormError(message || t("adjust.error.failed"));
    }
  }

  async function handleAddImei(imei: string): Promise<ImeiAddRowResult> {
    try {
      const result = await registerUnits.mutateAsync([imei]);
      if (!result.success) {
        return {
          success: false,
          error: result.error ?? t("unit.registerFailed"),
        };
      }
      setScannedImeis((prev) => [...prev, imei]);
      const drift = result.data?.drift;
      if (drift && !drift.matches) {
        appEvents.emit(
          "notification:show",
          t("adjust.toast.drift", {
            name: product.name,
            inStock: drift.inStockUnits,
            stockQty: drift.stockQuantity,
          }),
          "warning",
        );
      }
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to register product unit:", err);
      return { success: false, error: message || t("unit.registerFailed") };
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <PackagePlus size={18} className="text-violet-400" />
              {t("adjust.title")}
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {product.name}{" "}
              <span className="text-slate-500">
                ({product.barcode ? (
                  <Ltr>{product.barcode}</Ltr>
                ) : (
                  t("adjust.noBarcode")
                )})
              </span>
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="text-slate-400 hover:text-white"
            aria-label={t("common:actions.close")}
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
            <span className="text-xs text-slate-400">
              {t("adjust.currentStock")}
            </span>
            <span className="text-sm font-semibold text-white">
              {t("adjust.units", { count: currentStock })}
            </span>
          </div>

          {step === "form" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  {t("adjust.mode")}
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setMode("set")}
                    data-testid="adjust-mode-set"
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      mode === "set"
                        ? "bg-violet-600 text-white"
                        : "bg-slate-900 text-slate-400 border border-slate-700 hover:bg-slate-700"
                    }`}
                  >
                    {t("adjust.setExact")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("delta")}
                    data-testid="adjust-mode-delta"
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      mode === "delta"
                        ? "bg-violet-600 text-white"
                        : "bg-slate-900 text-slate-400 border border-slate-700 hover:bg-slate-700"
                    }`}
                  >
                    {t("adjust.addRemove")}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  {mode === "set"
                    ? t("adjust.newQuantity")
                    : t("adjust.deltaLabel")}
                </label>
                <input
                  type="number"
                  step={1}
                  data-testid="adjust-quantity"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder={
                    mode === "set" ? "0" : t("adjust.deltaPlaceholder")
                  }
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
                />
                {previewNewQuantity !== null && (
                  <p className="text-xs text-slate-500 mt-1">
                    {t("adjust.newStock")}{" "}
                    {rtl ? (
                      <Ltr>
                        {mode === "set"
                          ? `${currentStock} → ${previewNewQuantity}`
                          : `${currentStock} + ${quantity} = ${previewNewQuantity}`}
                      </Ltr>
                    ) : (
                      <>
                        {currentStock} {mode === "set" ? "→" : "+"}{" "}
                        {mode === "delta" ? quantity : ""}{" "}
                        {mode === "delta" ? "=" : ""} {previewNewQuantity}
                      </>
                    )}{" "}
                    {t("adjust.unitsWord", { count: previewNewQuantity })}
                  </p>
                )}
              </div>

              {isIncrease ? (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    {t("adjust.unitCost")}
                  </label>
                  <div className="flex items-start gap-3">
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      data-testid="adjust-unit-cost"
                      value={unitCost}
                      onChange={(e) => setUnitCost(e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
                    />
                    {/* Same checkbox as the Add Product form (owner: keep a
                        "similar design"), shown only when the product has a
                        supplier — with no supplier there is no debt to
                        skip in the first place. */}
                    {product.supplier?.trim() && !attachToRecordedDebtId && (
                      <label className="flex items-start gap-2 pt-2.5 shrink-0 max-w-[55%]">
                        <input
                          type="checkbox"
                          data-testid="adjust-old-stock"
                          checked={isOldStock}
                          onChange={(e) => setIsOldStock(e.target.checked)}
                          className="mt-0.5 accent-violet-600"
                        />
                        <span className="text-xs text-slate-400 leading-snug">
                          {t("adjust.oldStock")}
                        </span>
                      </label>
                    )}
                  </div>
                  {/* LIRA-087 (migration v189) — attach this delivery to a
                      debt already recorded for this supplier (Suppliers
                      page "Record Debt") instead of booking a new one.
                      Mutually exclusive with "old stock" — picking a debt
                      here hides/clears that checkbox. */}
                  {product.supplier?.trim() &&
                    !isOldStock &&
                    openRecordedDebts.length > 0 && (
                      <div className="mt-2">
                        <label className="text-xs text-slate-400 block mb-1">
                          {t("adjust.attachDebt")}
                        </label>
                        <select
                          data-testid="adjust-recorded-debt"
                          value={attachToRecordedDebtId}
                          onChange={(e) =>
                            setAttachToRecordedDebtId(e.target.value)
                          }
                          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
                        >
                          <option value="">{t("adjust.bookNewDebt")}</option>
                          {openRecordedDebts.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.amount_usd > 0
                                ? `$${d.amount_usd.toFixed(2)}`
                                : ""}
                              {d.amount_usd > 0 && d.amount_lbp > 0
                                ? " + "
                                : ""}
                              {d.amount_lbp > 0
                                ? `${formatNumber(Math.round(d.amount_lbp))} LBP`
                                : ""}
                              {d.note ? ` — ${d.note}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  <p className="text-xs text-slate-500 mt-1">
                    {attachToRecordedDebtId
                      ? t("adjust.deliveryAttach")
                      : product.supplier?.trim()
                        ? t("adjust.deliverySupplier")
                        : t("adjust.deliveryNoSupplier")}
                  </p>
                </div>
              ) : (
                mode === "delta" &&
                previewNewQuantity !== null && (
                  <p className="text-xs text-slate-500">
                    {t("adjust.decreaseNote")}
                  </p>
                )
              )}

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  {t("adjust.reason")}
                </label>
                <textarea
                  data-testid="adjust-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("adjust.reasonPlaceholder")}
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
                  onClick={handleDismiss}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 transition-colors text-sm"
                >
                  {t("common:actions.cancel")}
                </button>
                <button
                  type="submit"
                  data-testid="adjust-submit"
                  disabled={adjustStock.isPending || receiveStock.isPending}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors text-sm disabled:opacity-50"
                >
                  {adjustStock.isPending || receiveStock.isPending
                    ? t("adjust.saving")
                    : t("adjust.apply")}
                </button>
              </div>
            </form>
          )}

          {step === "intake" && (
            <div className="space-y-4" data-testid="stock-intake-step">
              <p className="text-sm text-slate-300">
                {t("adjust.scanPrompt", { count: pendingIncrease })}
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
                      <Ltr className="font-mono text-white truncate">
                        {imei}
                      </Ltr>
                      <span className="text-[10px] px-1.5 py-0.5 rounded border bg-sky-500/10 text-sky-400 border-sky-500/30 shrink-0">
                        {t("adjust.added")}
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
                {t("adjust.done")}
              </button>
            </div>
          )}

          {/* Only worth a section once there's a split to show — a single
              batch says nothing the "Current stock" row above doesn't. */}
          {!batchesLoading && !batchesError && batches.length >= 2 && (
            <div className="border-t border-slate-700 pt-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-2">
                <Layers size={14} className="text-slate-400" />
                {t("adjust.batches")}
              </h3>
              <p className="text-xs text-slate-500 mb-2">
                {t("adjust.batchesHint")}
              </p>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {batches.map((batch) => (
                  <div
                    key={batch.id}
                    className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2 text-xs"
                  >
                    <span className="text-white font-semibold">
                      {t("adjust.batchLine", {
                        count: batch.quantity_remaining,
                        cost: batch.unit_cost_usd.toFixed(2),
                      })}
                    </span>
                    <span className="text-slate-500">
                      {formatDate(parseDbDate(batch.created_at), {
                        year: "numeric",
                        month: "numeric",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-slate-700 pt-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
              <History size={14} className="text-slate-400" />
              {t("adjust.history")}
            </h3>

            {historyLoading && (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-4 justify-center">
                <Loader2 size={16} className="animate-spin" />
                {t("adjust.loadingHistory")}
              </div>
            )}

            {!historyLoading && historyError && (
              <p className="text-sm text-red-400 text-center py-4">
                {t("adjust.historyFailed")}
              </p>
            )}

            {!historyLoading && !historyError && adjustments.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">
                {t("adjust.noHistory")}
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
                        dir="ltr"
                        className={`font-semibold ${
                          adj.delta > 0 ? "text-green-400" : "text-red-400"
                        }`}
                      >
                        {adj.delta > 0 ? "+" : ""}
                        {adj.delta}
                        {/* unit_cost_usd is null on every pre-existing row and
                            on any non-delivery correction — omit, don't guess */}
                        {adj.unit_cost_usd != null &&
                          ` @ $${adj.unit_cost_usd.toFixed(2)}`}{" "}
                        ({adj.old_quantity} → {adj.new_quantity})
                      </span>
                      <span className="text-slate-500">
                        {formatDateTime(parseDbDate(adj.created_at), {
                          year: "numeric",
                          month: "numeric",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-slate-300 mt-1">{adj.reason}</p>
                    <p className="text-slate-500 mt-0.5">
                      {t("adjust.by", {
                        name: adj.username ?? t("adjust.unknownUser"),
                      })}
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
