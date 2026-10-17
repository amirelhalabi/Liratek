import type { CartItem } from "@liratek/ui";
import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import type { CheckoutDraftData } from "./types";

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

interface CartItemsListProps {
  items: CartItem[];
  onEdit?: (checkoutData: CheckoutDraftData) => void;
  checkoutData?: CheckoutDraftData;
}

export function CartItemsList({
  items,
  onEdit,
  checkoutData,
}: CartItemsListProps) {
  const { t } = useTranslation("sales");
  if (!items || items.length === 0) return null;

  return (
    <div className="flex-1 min-h-0 my-4 bg-slate-900/50 rounded-xl border border-slate-700/50 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/50 bg-slate-800/30">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          {t("checkout.itemsCount", { count: items.length })}
        </span>
        {onEdit && checkoutData && (
          <button
            onClick={() => onEdit(checkoutData)}
            className="p-1.5 text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors"
            title={t("checkout.editOrder")}
          >
            {/* Pencil icon will be imported */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 h-full overflow-y-auto divide-y divide-slate-700/50">
        {items.map((item, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-800/40 transition-colors"
          >
            <div className="flex-1 min-w-0 me-3">
              <div className="flex items-center gap-1.5">
                <p className="text-sm text-slate-200 truncate">{item.name}</p>
                <WarrantyBadge months={item.warranty_months} />
              </div>
              <p className="text-xs text-slate-500">
                <Ltr>
                  {item.quantity} × ${item.retail_price.toFixed(2)}
                </Ltr>
              </p>
            </div>
            <Ltr className="text-sm font-mono text-slate-300 shrink-0">
              ${(item.quantity * item.retail_price).toFixed(2)}
            </Ltr>
          </div>
        ))}
      </div>
    </div>
  );
}
