import type { CartItem } from "@liratek/ui";
import type { CheckoutDraftData } from "./types";

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
  if (!items || items.length === 0) return null;

  return (
    <div className="flex-1 min-h-0 my-4 bg-slate-900/50 rounded-xl border border-slate-700/50 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-slate-700/50 bg-slate-800/30">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Items ({items.length})
        </span>
        {onEdit && checkoutData && (
          <button
            onClick={() => onEdit(checkoutData)}
            className="p-1.5 text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 rounded-lg transition-colors"
            title="Edit Order"
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
            <div className="flex-1 min-w-0 mr-3">
              <p className="text-sm text-slate-200 truncate">{item.name}</p>
              <p className="text-xs text-slate-500">
                {item.quantity} × ${item.retail_price.toFixed(2)}
              </p>
            </div>
            <span className="text-sm font-mono text-slate-300 shrink-0">
              ${(item.quantity * item.retail_price).toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
