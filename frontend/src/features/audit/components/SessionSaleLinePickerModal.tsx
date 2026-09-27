/**
 * LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4) — a SALE session-basket member
 * can bundle more than one sale line, so its "Refund item" action needs the
 * cashier to pick ONE remaining line (opens the quantity step next,
 * `RefundQuantityModal`) or refund every remaining line in one operation
 * (owner answer Q2, "Refund All Remaining" — no `saleItemId`). Fully-
 * refunded lines are hidden; there is nothing left to refund on them.
 */
export interface SessionSaleLineItem {
  id: number;
  name: string;
  quantity: number;
  refunded_quantity?: number;
  sold_price_usd: number;
}

export interface SessionSaleLinePickerModalProps {
  items: SessionSaleLineItem[];
  onPickLine: (item: SessionSaleLineItem) => void;
  onRefundAllRemaining: () => void;
  onCancel: () => void;
}

export function SessionSaleLinePickerModal({
  items,
  onPickLine,
  onRefundAllRemaining,
  onCancel,
}: SessionSaleLinePickerModalProps) {
  const refundable = items.filter(
    (item) => item.quantity - (item.refunded_quantity ?? 0) > 0,
  );

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-700">
          <h3 className="text-lg font-bold text-white">
            Refund Which Item?
          </h3>
        </div>

        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {refundable.map((item) => {
            const remaining = item.quantity - (item.refunded_quantity ?? 0);
            return (
              <div
                key={item.id}
                data-testid={`session-sale-line-${item.id}`}
                className="flex items-center justify-between gap-3 bg-slate-800/50 rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm text-white truncate">{item.name}</p>
                  <p className="text-xs text-slate-500">
                    Qty: {remaining} remaining × $
                    {item.sold_price_usd.toFixed(2)}
                  </p>
                </div>
                <button
                  onClick={() => onPickLine(item)}
                  className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-500 text-white font-medium shrink-0"
                >
                  Refund
                </button>
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-slate-700 flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg font-medium transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onRefundAllRemaining()}
            className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors"
          >
            Refund All Remaining
          </button>
        </div>
      </div>
    </div>
  );
}

export default SessionSaleLinePickerModal;
