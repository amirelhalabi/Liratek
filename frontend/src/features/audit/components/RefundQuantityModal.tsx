/**
 * Small "how many of this line" prompt used by any refund flow that lets the
 * cashier partially refund a sale line's quantity — the POS sale screen
 * (LIRA-231) and, since LIRA-232, the Transactions page's per-item session
 * refund line picker. Extracted out of `SaleDetailModal.tsx` (where it used
 * to be a local, unexported function) so both callers share ONE component
 * instead of two copies of the same quantity-clamp logic (rule 14).
 */
import { useState, useEffect } from "react";

export interface RefundQuantityModalProps {
  itemName: string;
  availableQuantity: number;
  onConfirm: (quantity: number) => void;
  onCancel: () => void;
}

export function RefundQuantityModal({
  itemName,
  availableQuantity,
  onConfirm,
  onCancel,
}: RefundQuantityModalProps) {
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    setQuantity(1);
  }, [availableQuantity]);

  return (
    <div
      className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="p-6 border-b border-slate-700">
        <h3 className="text-lg font-bold text-white">Refund Item Quantity</h3>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-slate-300">
          Refunding:{" "}
          <span className="font-semibold text-white">{itemName}</span>
        </p>

        <div className="space-y-2">
          <label className="text-sm text-slate-400">
            Available to refund: {availableQuantity}
          </label>
          <input
            type="number"
            min={1}
            max={availableQuantity}
            value={quantity}
            onChange={(e) =>
              setQuantity(
                Math.max(
                  1,
                  Math.min(availableQuantity, parseInt(e.target.value) || 1),
                ),
              )
            }
            className="w-full px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
      </div>

      <div className="p-4 border-t border-slate-700 flex gap-3">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2.5 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg font-medium transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(quantity)}
          className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors"
        >
          Refund {quantity}x
        </button>
      </div>
    </div>
  );
}

export default RefundQuantityModal;
