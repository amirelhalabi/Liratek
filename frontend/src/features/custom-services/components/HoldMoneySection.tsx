import { useState, useEffect, useCallback } from "react";
import {
  Wallet,
  User,
  Phone,
  Tag,
  RefreshCw,
  HandCoins,
  History,
  Undo2,
} from "lucide-react";
import {
  appEvents,
  DecimalInput,
  useApi,
  MultiPaymentInput,
  type PaymentLine,
} from "@liratek/ui";
import type { Client } from "@liratek/ui";
import { HOLD_MONEY_METHODS } from "@liratek/core";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { toHoldMoneyLegs } from "@/utils/paymentUtils";
import logger from "@/utils/logger";
import { HoldMoneyPickupSheet } from "./HoldMoneyPickupSheet";

interface HoldMoneyRecord {
  id: number;
  client_name: string;
  phone_number: string | null;
  client_id: number | null;
  usd_amount: number;
  lbp_amount: number;
  status: "held" | "collected";
  notes: string | null;
  created_by: number | null;
  collected_by: number | null;
  collected_at: string | null;
  created_at: string;
  updated_at: string;
  /** Derived server-side (migration v183) — usd/lbp_amount minus every
   *  non-voided pickup so far. Equal to usd/lbp_amount for any hold that
   *  has never been partially collected. */
  remaining_usd: number;
  remaining_lbp: number;
}

/** One pickup EVENT against a hold — migration v183's balance-model row.
 *  Mirrors `HoldMoneyPickupEntity` (packages/core). */
interface HoldMoneyPickupRecord {
  id: number;
  hold_money_id: number;
  transaction_id: number | null;
  usd_amount: number;
  lbp_amount: number;
  is_voided: number;
  voided_by: number | null;
  voided_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

type HoldStatusFilter = "held" | "collected" | "all";

const EPS_USD = 0.01;
const EPS_LBP = 1;

function formatUsd(n: number): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatLbp(n: number): string {
  return n.toLocaleString();
}

/**
 * Hold Money — rendered inside the Services form when the "Hold Money"
 * category is selected. Holds cash (USD and/or LBP) for a customer, tendered
 * through the SAME payment form every other Services tab uses (LIRA-214,
 * OWNER_NOTES_REMAINING_BUILD.md #24). Collecting opens the shared
 * `HoldMoneyPickupSheet` (also used by the Dashboard's held-money cards),
 * which supports returning the FULL remaining balance or a partial amount
 * (migration v183).
 *
 * Self-contained: loads its own active holds and writes via api.holdMoney.
 */
export function HoldMoneySection() {
  const api = useApi();
  const { methods } = usePaymentMethods();
  const { buyRate } = useSellRate();

  const [holds, setHolds] = useState<HoldMoneyRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const [clientName, setClientName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [usdAmount, setUsdAmount] = useState(0);
  const [lbpAmount, setLbpAmount] = useState(0);
  const [note, setNote] = useState("");
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);
  const [returnLegs, setReturnLegs] = useState<PaymentLine[]>([]);
  const [effectiveRate, setEffectiveRate] = useState<number | undefined>(
    undefined,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pickupTarget, setPickupTarget] = useState<HoldMoneyRecord | null>(
    null,
  );

  // Owner answer #24 (rule 20): a pickup needs a reachable reversal owner,
  // not just a backend capability — a wrong pickup (partial or full) must
  // be fixable from THIS page, including for a hold that has already
  // reached 'collected' (getActiveHolds/status='held' alone would hide it).
  const [statusFilter, setStatusFilter] = useState<HoldStatusFilter>("held");
  const [expandedHoldId, setExpandedHoldId] = useState<number | null>(null);
  const [pickupsByHold, setPickupsByHold] = useState<
    Record<number, HoldMoneyPickupRecord[]>
  >({});
  const [pickupsLoading, setPickupsLoading] = useState<number | null>(null);
  const [voidingPickupId, setVoidingPickupId] = useState<number | null>(null);

  // Owner answer #24: cash from any drawer + the shop's own wallets — no
  // customer account, no gift card (HOLD_MONEY_METHODS is the SAME
  // allow-list the server enforces — rule 14).
  const allowedMethods = methods.filter((m) =>
    (HOLD_MONEY_METHODS as readonly string[]).includes(m.code),
  );

  const loadHolds = useCallback(async (filter: HoldStatusFilter) => {
    setLoading(true);
    try {
      const res =
        filter === "all"
          ? await api.holdMoney.list()
          : await api.holdMoney.list({ status: filter });
      if (res.success && res.data) {
        setHolds(res.data);
      } else if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error ?? "Failed to load holds",
          "error",
        );
      }
    } catch (err) {
      logger.error("[HoldMoney] load failed", err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadHolds(statusFilter);
  }, [loadHolds, statusFilter]);

  // Reversal owner UI (rule 20, owner answer #24): expand a hold's pickup
  // history and void a wrongly-recorded pickup event. `HoldMoneyRepository
  // .voidPickup` re-credits every drawer that pickup's legs debited and
  // reopens the hold if it had reached 'collected' — this panel is the
  // ONLY place that reaches it, so it must stay usable for a hold in EITHER
  // status (the status filter above defaults to 'held' but "Collected"/"All"
  // reach the rest).
  const loadPickups = useCallback(async (holdId: number) => {
    setPickupsLoading(holdId);
    try {
      const res = await api.holdMoney.pickups(holdId);
      if (res.success && res.data) {
        setPickupsByHold((prev) => ({ ...prev, [holdId]: res.data! }));
      } else if (!res.success) {
        appEvents.emit(
          "notification:show",
          res.error ?? "Failed to load pickup history",
          "error",
        );
      }
    } catch (err) {
      logger.error("[HoldMoney] load pickups failed", err);
    } finally {
      setPickupsLoading(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleHistory = (holdId: number) => {
    if (expandedHoldId === holdId) {
      setExpandedHoldId(null);
      return;
    }
    setExpandedHoldId(holdId);
    loadPickups(holdId);
  };

  const handleVoidPickup = async (pickup: HoldMoneyPickupRecord) => {
    if (
      !window.confirm(
        `Void this pickup (${pickup.usd_amount > 0 ? `$${formatUsd(pickup.usd_amount)}` : ""}${
          pickup.usd_amount > 0 && pickup.lbp_amount > 0 ? " + " : ""
        }${pickup.lbp_amount > 0 ? `${formatLbp(pickup.lbp_amount)} LBP` : ""})? This re-credits the drawer(s) it was paid from and reopens the hold.`,
      )
    ) {
      return;
    }
    setVoidingPickupId(pickup.id);
    try {
      const res = await api.holdMoney.voidPickup(pickup.id);
      if (res.success) {
        appEvents.emit("notification:show", "Pickup voided.", "success");
        appEvents.emit("holdMoney:changed");
        await loadPickups(pickup.hold_money_id);
        await loadHolds(statusFilter);
      } else {
        appEvents.emit(
          "notification:show",
          res.error ?? "Failed to void pickup.",
          "error",
        );
      }
    } catch (err) {
      logger.error("[HoldMoney] void pickup failed", err);
      appEvents.emit("notification:show", "Failed to void pickup.", "error");
    } finally {
      setVoidingPickupId(null);
    }
  };

  const selectClient = (client: Client) => {
    setClientName(client.full_name);
    if (client.phone_number) setPhoneNumber(client.phone_number);
    setClientId(client.id);
  };

  const canSubmit =
    clientName.trim().length > 0 &&
    (usdAmount > 0 || lbpAmount > 0) &&
    !isSubmitting;

  const handleHold = useCallback(async () => {
    if (!clientName.trim()) {
      appEvents.emit(
        "notification:show",
        "Customer name is required.",
        "warning",
      );
      return;
    }
    if (usdAmount <= 0 && lbpAmount <= 0) {
      appEvents.emit(
        "notification:show",
        "Enter a USD and/or LBP amount to hold.",
        "warning",
      );
      return;
    }
    setIsSubmitting(true);
    try {
      const trimmedPhone = phoneNumber.trim();
      const trimmedNote = note.trim();
      const res = await api.holdMoney.create({
        client_name: clientName.trim(),
        usd_amount: usdAmount,
        lbp_amount: lbpAmount,
        ...(trimmedPhone ? { phone_number: trimmedPhone } : {}),
        ...(clientId ? { client_id: clientId } : {}),
        ...(trimmedNote ? { notes: trimmedNote } : {}),
        ...(paymentLines.length > 0 || returnLegs.length > 0
          ? { payments: toHoldMoneyLegs(paymentLines, returnLegs) }
          : {}),
        ...(effectiveRate ? { exchange_rate: effectiveRate } : {}),
      });
      if (res.success) {
        appEvents.emit(
          "notification:show",
          `Held money for ${clientName.trim()}.`,
          "success",
        );
        setClientName("");
        setPhoneNumber("");
        setClientId(null);
        setUsdAmount(0);
        setLbpAmount(0);
        setNote("");
        setPaymentLines([]);
        setReturnLegs([]);
        appEvents.emit("holdMoney:changed");
        await loadHolds(statusFilter);
      } else {
        appEvents.emit(
          "notification:show",
          res.error ?? "Failed to hold money.",
          "error",
        );
      }
    } catch (err) {
      logger.error("[HoldMoney] create failed", err);
      appEvents.emit("notification:show", "Failed to hold money.", "error");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    clientName,
    phoneNumber,
    clientId,
    usdAmount,
    lbpAmount,
    note,
    paymentLines,
    statusFilter,
    returnLegs,
    effectiveRate,
    loadHolds,
  ]);

  return (
    <div className="space-y-4">
      {/* Customer Name, Phone & Note — single inline row (mirrors the service form) */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label
            htmlFor="hold-client"
            className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
          >
            <User size={12} /> Customer Name
            <span className="text-red-400 ml-1">*</span>
          </label>
          <ClientAutocompleteInput
            id="hold-client"
            value={clientName}
            onChange={(v) => {
              setClientName(v);
              setClientId(null);
            }}
            onClientSelect={selectClient}
            placeholder="Search or type name..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-all"
          />
        </div>
        <div>
          <label
            htmlFor="hold-phone"
            className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
          >
            <Phone size={12} /> Phone
          </label>
          <input
            id="hold-phone"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-all"
            placeholder="e.g., 03 123 456"
          />
        </div>
        <div>
          <label
            htmlFor="hold-note"
            className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider flex items-center gap-1"
          >
            <Tag size={12} /> Note (optional)
          </label>
          <input
            id="hold-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-teal-500 transition-all"
            placeholder="Additional details..."
            maxLength={1000}
          />
        </div>
      </div>

      {/* Amount to Hold — USD + LBP (mirrors the Cost/Price panel) */}
      <div className="p-4 rounded-xl bg-teal-400/5 border border-teal-400/20 space-y-3">
        <span className="block text-xs font-medium text-teal-400 uppercase tracking-wider">
          Amount to Hold
        </span>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label
              htmlFor="hold-usd"
              className="block text-[10px] text-slate-500 mb-1 uppercase"
            >
              USD
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                $
              </span>
              <DecimalInput
                id="hold-usd"
                value={usdAmount}
                onChange={setUsdAmount}
                decimals={2}
                className="w-full bg-slate-900/80 border border-slate-700 rounded-lg pl-8 pr-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all"
                placeholder="0.00"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="hold-lbp"
              className="block text-[10px] text-slate-500 mb-1 uppercase"
            >
              LBP
            </label>
            <DecimalInput
              id="hold-lbp"
              value={lbpAmount}
              onChange={setLbpAmount}
              className="w-full bg-slate-900/80 border border-slate-700 rounded-lg pl-3 pr-3 py-2.5 text-white font-mono text-sm focus:ring-2 focus:ring-teal-500 outline-none transition-all"
              placeholder="0"
            />
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Held cash is posted per the payment method below; collecting pays
          it back out the same way.
        </p>
      </div>

      {/* Payment method — how the held cash is being handed over */}
      {(usdAmount > 0 || lbpAmount > 0) && (
        <div>
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
            Received Via
          </label>
          <MultiPaymentInput
            key={`${usdAmount}-${lbpAmount > 0 ? "lbp" : "no-lbp"}`}
            totals={[
              ...(usdAmount > 0 ? [{ amount: usdAmount, currency: "USD" }] : []),
              ...(lbpAmount > 0 ? [{ amount: lbpAmount, currency: "LBP" }] : []),
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
            label="Payment"
          />
        </div>
      )}

      {/* Submit (mirrors the service form submit) */}
      <button
        type="button"
        data-testid="hold-money-submit"
        onClick={handleHold}
        disabled={!canSubmit}
        className="w-full py-4 mt-6 rounded-xl font-bold text-lg bg-teal-600 hover:bg-teal-500 text-white shadow-lg shadow-teal-900/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? (
          <>
            <RefreshCw size={18} className="animate-spin" /> Processing...
          </>
        ) : (
          <>
            <Wallet size={18} /> Hold Money
          </>
        )}
      </button>

      {/* Holds — status-filterable so a wrongly-recorded pickup on an
          already-'collected' hold stays reachable (rule 20). */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <HandCoins size={13} className="text-teal-400" />
            {statusFilter === "held"
              ? "Active Holds"
              : statusFilter === "collected"
                ? "Collected Holds"
                : "All Holds"}
            <span className="text-slate-500">({holds.length})</span>
          </label>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg overflow-hidden border border-slate-700/60 text-xs">
              {(["held", "collected", "all"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  data-testid={`hold-filter-${f}`}
                  onClick={() => setStatusFilter(f)}
                  className={`px-2.5 py-1 transition-colors ${
                    statusFilter === f
                      ? "bg-teal-600 text-white"
                      : "bg-slate-800/60 text-slate-400 hover:bg-slate-700"
                  }`}
                >
                  {f === "held" ? "Held" : f === "collected" ? "Collected" : "All"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => loadHolds(statusFilter)}
              className="text-xs px-2 py-1 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
          </div>
        </div>

        {holds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500 bg-slate-900/40 rounded-xl border border-slate-700/50">
            <Wallet size={28} className="mb-2 opacity-40" />
            <p className="text-sm">
              {statusFilter === "held"
                ? "No active holds"
                : statusFilter === "collected"
                  ? "No collected holds"
                  : "No holds"}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-700/50 divide-y divide-slate-700/60 overflow-hidden">
            {holds.map((hold) => {
              const isPartial =
                hold.remaining_usd < hold.usd_amount - EPS_USD ||
                hold.remaining_lbp < hold.lbp_amount - EPS_LBP;
              return (
                <div
                  key={hold.id}
                  className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-900/40 hover:bg-slate-800/60 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {hold.client_name}
                      {hold.phone_number && (
                        <span className="text-slate-500 font-normal ml-2">
                          {hold.phone_number}
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs">
                      {hold.remaining_usd > EPS_USD && (
                        <span className="text-emerald-400 font-mono">
                          ${formatUsd(hold.remaining_usd)}
                        </span>
                      )}
                      {hold.remaining_lbp > EPS_LBP && (
                        <span className="text-emerald-400 font-mono">
                          {formatLbp(hold.remaining_lbp)} LBP
                        </span>
                      )}
                      {isPartial && (
                        <span
                          className="text-slate-500"
                          data-testid={`hold-partial-badge-${hold.id}`}
                        >
                          of ${formatUsd(hold.usd_amount)}
                          {hold.lbp_amount > 0
                            ? ` + ${formatLbp(hold.lbp_amount)} LBP`
                            : ""}
                        </span>
                      )}
                    </div>
                    {hold.notes && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        {hold.notes}
                      </p>
                    )}
                  </div>
                  <div className="flex-shrink-0 flex items-center gap-2">
                    <button
                      type="button"
                      data-testid={`hold-history-${hold.id}`}
                      onClick={() => toggleHistory(hold.id)}
                      title="Pickup history / void a pickup"
                      className={`px-2.5 py-2 rounded-lg text-xs font-medium border transition-all flex items-center gap-1 ${
                        expandedHoldId === hold.id
                          ? "bg-slate-700 text-white border-slate-600"
                          : "bg-slate-800/60 text-slate-400 border-slate-700/60 hover:bg-slate-700"
                      }`}
                    >
                      <History size={13} />
                    </button>
                    {hold.status === "held" && (
                      <button
                        type="button"
                        data-testid={`hold-collect-${hold.id}`}
                        onClick={() => setPickupTarget(hold)}
                        className="px-4 py-2 rounded-lg font-medium text-sm bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all flex items-center gap-1.5"
                      >
                        <HandCoins size={14} />
                        Collect
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {/* Pickup history / void panel — kept OUTSIDE the row map's flex
                container so a wide table of pickups doesn't fight the row's
                own layout; keyed off expandedHoldId, rendered once. */}
            {expandedHoldId != null &&
              holds.some((h) => h.id === expandedHoldId) && (
                <div
                  data-testid={`hold-pickup-history-${expandedHoldId}`}
                  className="px-4 py-3 bg-slate-950/60 border-t border-slate-700/60"
                >
                  <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">
                    Pickup history
                  </p>
                  {pickupsLoading === expandedHoldId ? (
                    <p className="text-xs text-slate-500 flex items-center gap-1.5">
                      <RefreshCw size={12} className="animate-spin" />
                      Loading…
                    </p>
                  ) : (pickupsByHold[expandedHoldId] ?? []).length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No pickups recorded yet.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {(pickupsByHold[expandedHoldId] ?? []).map((p) => (
                        <div
                          key={p.id}
                          data-testid={`hold-pickup-row-${p.id}`}
                          className="flex items-center justify-between gap-3 text-xs py-1"
                        >
                          <div
                            className={
                              p.is_voided
                                ? "text-slate-500 line-through"
                                : "text-slate-300"
                            }
                          >
                            {p.usd_amount > 0 && `$${formatUsd(p.usd_amount)}`}
                            {p.usd_amount > 0 && p.lbp_amount > 0 ? " + " : ""}
                            {p.lbp_amount > 0 &&
                              `${formatLbp(p.lbp_amount)} LBP`}
                            <span className="text-slate-600 ml-2">
                              {new Date(p.created_at).toLocaleString()}
                            </span>
                            {p.is_voided ? (
                              <span className="ml-2 text-red-400/80 no-underline">
                                voided
                              </span>
                            ) : null}
                          </div>
                          {!p.is_voided && (
                            <button
                              type="button"
                              data-testid={`hold-void-pickup-${p.id}`}
                              onClick={() => handleVoidPickup(p)}
                              disabled={voidingPickupId === p.id}
                              className="flex-shrink-0 px-2 py-1 rounded font-medium text-[11px] bg-red-500/10 text-red-300 border border-red-500/30 hover:bg-red-500/20 disabled:opacity-50 transition-all flex items-center gap-1"
                            >
                              <Undo2 size={11} />
                              Void
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
          </div>
        )}
      </div>

      {pickupTarget && (
        <HoldMoneyPickupSheet
          hold={pickupTarget}
          onClose={() => setPickupTarget(null)}
          onCollected={() => loadHolds(statusFilter)}
        />
      )}
    </div>
  );
}

export default HoldMoneySection;
