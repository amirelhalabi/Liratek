import { useMemo, useState } from "react";
import { X, HandCoins, RefreshCw } from "lucide-react";
import {
  appEvents,
  useApi,
  DecimalInput,
  MultiPaymentInput,
  type PaymentLine,
} from "@liratek/ui";
import { HOLD_MONEY_METHODS } from "@liratek/core";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { toHoldMoneyLegs } from "@/utils/paymentUtils";
import logger from "@/utils/logger";

/** Shape shared by every Hold Money list/active/collect read — the fields
 *  this sheet actually needs. A structural subset so both HoldMoneySection
 *  and the Dashboard card (which each keep their own slightly different
 *  local row type) can pass their row straight through with no mapping. */
export interface HoldMoneyPickupTarget {
  id: number;
  client_name: string;
  remaining_usd: number;
  remaining_lbp: number;
}

interface HoldMoneyPickupSheetProps {
  hold: HoldMoneyPickupTarget;
  onClose: () => void;
  /** Called after a successful pickup — the caller reloads its own list. */
  onCollected: () => void;
}

const EPS_USD = 0.01;
const EPS_LBP = 1;

/**
 * "Return hold" — the shared pickup sheet for Hold Money (LIRA-214,
 * OWNER_NOTES_REMAINING_BUILD.md #24, migration v183). Used by both
 * HoldMoneySection's Active Holds list and the Dashboard's held-money
 * cards, so there is exactly ONE place that builds a pickup payload
 * (rule 22 — never a payload built per call site). Supports a PARTIAL
 * pickup: the two amount fields default to the hold's full remaining
 * balance and are editable down to any smaller nonzero split.
 */
export function HoldMoneyPickupSheet({
  hold,
  onClose,
  onCollected,
}: HoldMoneyPickupSheetProps) {
  const api = useApi();
  const { methods } = usePaymentMethods();
  const { buyRate } = useSellRate();

  const [returnUsd, setReturnUsd] = useState(hold.remaining_usd);
  const [returnLbp, setReturnLbp] = useState(hold.remaining_lbp);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [returnLegs, setReturnLegs] = useState<PaymentLine[]>([]);
  const [effectiveRate, setEffectiveRate] = useState<number | undefined>(
    undefined,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Owner answer #24: cash from any drawer + the shop's own wallets — no
  // customer account, no gift card. HOLD_MONEY_METHODS is the SAME allow-
  // list the server enforces (packages/core/src/validators/holdMoney.ts),
  // imported rather than re-typed (rule 14).
  const allowedMethods = useMemo(
    () =>
      methods.filter((m) =>
        (HOLD_MONEY_METHODS as readonly string[]).includes(m.code),
      ),
    [methods],
  );

  const isPartial =
    returnUsd < hold.remaining_usd - EPS_USD ||
    returnLbp < hold.remaining_lbp - EPS_LBP;

  const canSubmit =
    !isSubmitting && (returnUsd > EPS_USD || returnLbp > EPS_LBP);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const res = await api.holdMoney.collect({
        id: hold.id,
        usd_amount: returnUsd,
        lbp_amount: returnLbp,
        payments: toHoldMoneyLegs(paymentLines, returnLegs),
        exchange_rate: effectiveRate ?? buyRate,
      });
      if (res.success) {
        appEvents.emit(
          "notification:show",
          isPartial
            ? `Returned part of the hold to ${hold.client_name}.`
            : `Returned hold to ${hold.client_name}.`,
          "success",
        );
        appEvents.emit("holdMoney:changed");
        onCollected();
        onClose();
      } else {
        appEvents.emit(
          "notification:show",
          res.error ?? "Failed to collect hold.",
          "error",
        );
      }
    } catch (err) {
      logger.error("[HoldMoney] pickup failed", err);
      appEvents.emit("notification:show", "Failed to collect hold.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="hold-money-pickup-sheet"
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-white">
              Return hold — {hold.client_name}
            </h3>
            <div className="text-xs text-slate-400 mt-1">
              Still held:{" "}
              {hold.remaining_usd > EPS_USD && (
                <span className="font-mono text-orange-300">
                  ${hold.remaining_usd.toFixed(2)}
                </span>
              )}
              {hold.remaining_usd > EPS_USD && hold.remaining_lbp > EPS_LBP
                ? " + "
                : ""}
              {hold.remaining_lbp > EPS_LBP && (
                <span className="font-mono text-orange-300">
                  {hold.remaining_lbp.toLocaleString()} LBP
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-orange-400/5 border border-orange-400/20 space-y-3">
            <span className="block text-xs font-medium text-orange-400 uppercase tracking-wider">
              Amount to Return
            </span>
            <p className="text-[11px] text-slate-500">
              Defaults to the full remaining balance — lower either field for
              a partial pickup.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="pickup-usd"
                  className="block text-[10px] text-slate-500 mb-1 uppercase"
                >
                  USD
                </label>
                <DecimalInput
                  id="pickup-usd"
                  value={returnUsd}
                  onChange={(v) =>
                    setReturnUsd(
                      Math.max(0, Math.min(v, hold.remaining_usd)),
                    )
                  }
                  decimals={2}
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                  placeholder="0.00"
                  data-testid="hold-pickup-usd"
                />
              </div>
              <div>
                <label
                  htmlFor="pickup-lbp"
                  className="block text-[10px] text-slate-500 mb-1 uppercase"
                >
                  LBP
                </label>
                <DecimalInput
                  id="pickup-lbp"
                  value={returnLbp}
                  onChange={(v) =>
                    setReturnLbp(
                      Math.max(0, Math.min(v, hold.remaining_lbp)),
                    )
                  }
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-orange-500 outline-none transition-all"
                  placeholder="0"
                  data-testid="hold-pickup-lbp"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
              Paid Out Via
            </label>
            <MultiPaymentInput
              key={`${returnUsd}-${returnLbp > 0 ? "lbp" : "no-lbp"}`}
              totals={[
                ...(returnUsd > EPS_USD
                  ? [{ amount: returnUsd, currency: "USD" }]
                  : []),
                ...(returnLbp > EPS_LBP
                  ? [{ amount: returnLbp, currency: "LBP" }]
                  : []),
              ]}
              side="buy"
              currency="USD"
              totalAmountCurrency="USD"
              onChange={setPaymentLines}
              onReturnChange={setReturnLegs}
              showDiscount={false}
              showPmFee={false}
              paymentMethods={allowedMethods}
              currencies={[
                { code: "USD", symbol: "$" },
                { code: "LBP", symbol: "LBP" },
              ]}
              exchangeRate={buyRate}
              onExchangeRateChange={setEffectiveRate}
              label="Payout"
            />
          </div>

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="hold-money-pickup-submit"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 py-3 rounded-xl font-bold text-white shadow-lg shadow-orange-900/20 active:scale-95 transition-all bg-orange-600 hover:bg-orange-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:shadow-none flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" /> Processing…
                </>
              ) : (
                <>
                  <HandCoins size={16} />
                  {isPartial ? "Return Part" : "Return Hold"}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default HoldMoneyPickupSheet;
