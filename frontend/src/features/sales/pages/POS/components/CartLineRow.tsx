import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { normalizeDigits } from "@liratek/ui/i18n/digits";
import { Trash2, Plus, Minus } from "lucide-react";
import type { CartItem } from "@liratek/ui";
import { ConfirmModal } from "@liratek/ui";
import { useInStockUnitsQuery } from "@/features/sales/hooks/useProductUnits";
import {
  resolveCartLineMode,
  shouldAlwaysAddNewLine,
} from "@/features/sales/utils/cartGate";
import { getCartLineKey } from "@/features/sales/utils/cartLineKey";
import {
  useCategorySerialLabels,
  useCategoryWarrantyDefaults,
} from "@/features/sales/hooks/useCategoryWarrantyDefaults";
import { resolveWarrantyMonths, warrantyMonthsSchema } from "@liratek/core";

function WarrantyBadge({ months }: { months: number | null | undefined }) {
  const { t } = useTranslation("sales");
  if (!months || months <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-950/60 border border-red-500/60 text-xs font-semibold text-red-400 shrink-0">
      {months === 1
        ? t("line.warrantyOneMonth")
        : t("line.warrantyMonths", { count: months })}
    </span>
  );
}

const monthsLabel = (m: number, t: TFunction<"sales">) =>
  m === 1 ? t("line.oneMonth") : t("line.months", { count: m });

/**
 * LIRA-296 — "Warranty: N months (edit)" for one cart line. The default is
 * the product's own length, else its category's (core's
 * `resolveWarrantyMonths`, rule 14); the cashier may change it for this
 * line only (0–60 months, core's `warrantyMonthsSchema`).
 */
function WarrantyControl({
  item,
  onSet,
}: {
  item: CartItem;
  onSet: (months: number | null) => void;
}) {
  const { t } = useTranslation("sales");
  const categoryDefaults = useCategoryWarrantyDefaults();
  const defaultMonths = resolveWarrantyMonths(
    undefined,
    item.warranty_months,
    categoryDefaults.get((item.category ?? "").trim().toLowerCase()),
  );
  const edited = item.warranty_months_edit != null;
  const months = resolveWarrantyMonths(
    item.warranty_months_edit,
    defaultMonths,
    null,
  );
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [invalid, setInvalid] = useState(false);

  const label = months
    ? edited
      ? t("line.warrantyEdited", { months: monthsLabel(months, t) })
      : t("line.warranty", { months: monthsLabel(months, t) })
    : edited
      ? t("line.noWarrantyEdited")
      : t("line.noWarranty");

  if (editing) {
    return (
      <div className="mt-1 flex items-center gap-1.5 text-[11px]">
        <input
          type="text"
          inputMode="numeric"
          autoFocus
          value={value}
          aria-label={t("line.warrantyInputLabel", { name: item.name })}
          onChange={(e) => {
            setValue(normalizeDigits(e.target.value));
            setInvalid(false);
          }}
          className="w-14 bg-slate-900 border border-slate-600 rounded px-1.5 py-0.5 text-white text-[11px] focus:outline-none focus:border-violet-500"
        />
        <span className="text-slate-400">{t("line.monthsUnit")}</span>
        <button
          type="button"
          aria-label={t("line.saveWarranty")}
          onClick={() => {
            const n = Number(value);
            if (
              value.trim() === "" ||
              !warrantyMonthsSchema.safeParse(n).success
            ) {
              setInvalid(true);
              return;
            }
            onSet(n);
            setEditing(false);
          }}
          className="px-1.5 py-0.5 rounded bg-violet-600 hover:bg-violet-500 text-white"
        >
          {t("line.save")}
        </button>
        <button
          type="button"
          onClick={() => {
            onSet(null);
            setEditing(false);
          }}
          className="px-1.5 py-0.5 rounded text-slate-400 hover:text-white"
        >
          {t("line.useDefault")}
        </button>
        {invalid && (
          <span className="text-red-400">{t("line.warrantyRange")}</span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-1.5 text-[11px]">
      <span className={edited ? "text-amber-300" : "text-slate-400"}>
        {label}
      </span>
      <button
        type="button"
        aria-label={t("line.editWarranty")}
        onClick={() => {
          setValue(months == null ? "" : String(months));
          setInvalid(false);
          setEditing(true);
        }}
        className="text-violet-300 hover:text-violet-100 underline"
      >
        {t("line.edit")}
      </button>
    </div>
  );
}

interface CartLineRowProps {
  item: CartItem;
  /** The full cart, used only to filter units already claimed by OTHER
   *  lines of the same product out of this line's picker options. */
  allItems: CartItem[];
  onUpdateQuantity: (lineKey: string, delta: number) => void;
  onRemoveItem: (lineKey: string) => void;
  onSelectUnit: (
    lineKey: string,
    unit: { id: number; imei: string } | null,
  ) => void;
  /** LIRA-296: set (or with `null` clear) this line's warranty length edit.
   *  Omitted → the row shows the plain warranty badge, no edit control. */
  onSetWarranty?: (lineKey: string, months: number | null) => void;
}

/**
 * One cart row. LIRA-143 phase 6a extracted this out of Cart.tsx because it
 * now needs a per-product IN_STOCK-units query (resolveCartLineMode) to
 * decide between the unit picker and neither — hooks can't be called
 * conditionally inside Cart.tsx's `.map`, so each row is its own component
 * instead.
 */
export function CartLineRow({
  item,
  allItems,
  onUpdateQuantity,
  onRemoveItem,
  onSelectUnit,
  onSetWarranty,
}: CartLineRowProps) {
  const { t } = useTranslation("sales");
  const lineKey = getCartLineKey(item);
  // LIRA-296 P3: "IMEI" or "Serial", as the category calls it.
  const serialLabel = useCategorySerialLabels()(
    item.category,
    item.tracks_imei_units,
  );
  const { data: units = [] } = useInStockUnitsQuery(
    item.tracks_imei_units ? item.id : null,
  );
  // Owner decision 2026-09-26: a defective-but-in-stock unit (refunded via
  // the Transactions-page "Defective" checkbox) still shows in this picker
  // — it CAN be sold as-is — but picking one must ask first, so a defective
  // phone is never sold by accident. Held here, not committed to the cart,
  // until the operator confirms.
  const [pendingDefectiveUnit, setPendingDefectiveUnit] = useState<{
    id: number;
    imei: string;
  } | null>(null);
  // Display only: the label the category uses, in the screen language.
  const serialText = t(`serial.${serialLabel}`);
  const mode = resolveCartLineMode(item.tracks_imei_units, units.length);
  const isLockedQty = shouldAlwaysAddNewLine(mode);

  // Units already picked on OTHER lines of the SAME product must not be
  // offered here — but this line's OWN current selection stays an option
  // (it needs to keep showing as selected).
  const usedElsewhere = new Set(
    allItems
      .filter(
        (other) => other.id === item.id && getCartLineKey(other) !== lineKey,
      )
      .map((other) => other.product_unit_id)
      .filter((id): id is number => id != null),
  );
  const unitOptions = units.filter(
    (u) => u.id === item.product_unit_id || !usedElsewhere.has(u.id),
  );

  return (
    <div className="bg-slate-700/30 rounded-xl p-3 border border-slate-700/50 flex items-end gap-3 group hover:bg-slate-700/50 transition-all">
      <div className="flex-1">
        <div className="flex items-center gap-1.5">
          <h4 className="font-medium text-slate-200 text-sm line-clamp-1">
            {item.name}
          </h4>
          {!onSetWarranty && <WarrantyBadge months={item.warranty_months} />}
        </div>
        {onSetWarranty && (
          <WarrantyControl
            item={item}
            onSet={(months) => onSetWarranty(lineKey, months)}
          />
        )}

        {mode === "unit-picker" && (
          <div className="mt-2">
            <select
              value={item.product_unit_id ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (!raw) {
                  onSelectUnit(lineKey, null);
                  return;
                }
                const unitId = Number(raw);
                const unit = unitOptions.find((u) => u.id === unitId);
                if (!unit) return;
                if (unit.is_defective) {
                  // Don't commit yet — the confirm dialog below decides.
                  // Not calling onSelectUnit means the controlled <select>
                  // stays on its previous value once this state update
                  // re-renders (React re-syncs the DOM to the `value` prop
                  // on every render of a controlled element).
                  setPendingDefectiveUnit({ id: unit.id, imei: unit.imei });
                  return;
                }
                onSelectUnit(lineKey, { id: unit.id, imei: unit.imei });
              }}
              className="w-full h-[30px] bg-slate-900 border border-slate-700/50 rounded-lg px-2 text-[10px] text-white focus:border-violet-500/50 outline-none font-mono"
            >
              <option value="">
                {t("line.selectSerial", { label: serialText })}
              </option>
              {unitOptions.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.is_defective
                    ? t("line.defectiveOption", { imei: u.imei })
                    : u.imei}
                </option>
              ))}
            </select>
            <ConfirmModal
              isOpen={pendingDefectiveUnit !== null}
              title={t("line.defectiveTitle")}
              message={t("line.defectiveMessage")}
              confirmLabel={t("line.sellAnyway")}
              cancelLabel={t("actions.cancel")}
              variant="warning"
              onConfirm={() => {
                if (pendingDefectiveUnit) {
                  onSelectUnit(lineKey, pendingDefectiveUnit);
                }
                setPendingDefectiveUnit(null);
              }}
              onCancel={() => setPendingDefectiveUnit(null)}
            />
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        <Ltr className="font-bold text-violet-400">
          ${(item.retail_price * item.quantity).toFixed(2)}
        </Ltr>

        <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1 border border-slate-700">
          <button
            onClick={() => onUpdateQuantity(lineKey, -1)}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-30"
            disabled={item.quantity <= 1 || isLockedQty}
            aria-label={t("line.decrease")}
            title={
              isLockedQty
                ? t("line.lockedQty", { label: serialText })
                : undefined
            }
          >
            <Minus size={12} />
          </button>
          <span className="text-xs font-mono w-4 text-center text-white">
            {item.quantity}
          </span>
          <button
            onClick={() => onUpdateQuantity(lineKey, 1)}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white disabled:opacity-30"
            disabled={isLockedQty}
            aria-label={t("line.increase")}
            title={
              isLockedQty
                ? t("line.lockedQty", { label: serialText })
                : undefined
            }
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <button
        onClick={() => onRemoveItem(lineKey)}
        className="self-center p-2 text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all -me-2"
        aria-label={t("line.remove")}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}
