import { useState, useEffect, useCallback } from "react";
import { Wallet, User, Phone, Tag, RefreshCw, HandCoins } from "lucide-react";
import { appEvents, DecimalInput } from "@liratek/ui";
import type { Client } from "@liratek/ui";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import logger from "@/utils/logger";

interface HoldMoneyRecord {
  id: number;
  client_name: string;
  phone_number: string | null;
  usd_amount: number;
  lbp_amount: number;
  status: "held" | "collected";
  notes: string | null;
  created_by: number | null;
  collected_by: number | null;
  collected_at: string | null;
  created_at: string;
  updated_at: string;
}

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
 * Hold Money — rendered inside the Services form when the "Hold Money" category
 * is selected. Holds cash (USD and/or LBP) for a customer: holding credits the
 * General drawer, collecting returns it. Styling/layout/naming mirror the
 * standard custom-service form (Customer Name + Phone row, teal amount panel,
 * "Note (optional)", teal submit) so the two categories feel identical.
 *
 * Self-contained: loads its own active holds and writes via window.api.holdMoney.
 */
export function HoldMoneySection() {
  const [holds, setHolds] = useState<HoldMoneyRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const [clientName, setClientName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [usdAmount, setUsdAmount] = useState(0);
  const [lbpAmount, setLbpAmount] = useState(0);
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [collectingId, setCollectingId] = useState<number | null>(null);

  const loadHolds = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.api.holdMoney.active();
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
  }, []);

  useEffect(() => {
    loadHolds();
  }, [loadHolds]);

  const selectClient = (client: Client) => {
    setClientName(client.full_name);
    if (client.phone_number) setPhoneNumber(client.phone_number);
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
      const res = await window.api.holdMoney.create({
        client_name: clientName.trim(),
        usd_amount: usdAmount,
        lbp_amount: lbpAmount,
        ...(trimmedPhone ? { phone_number: trimmedPhone } : {}),
        ...(trimmedNote ? { notes: trimmedNote } : {}),
      });
      if (res.success) {
        appEvents.emit(
          "notification:show",
          `Held money for ${clientName.trim()}.`,
          "success",
        );
        setClientName("");
        setPhoneNumber("");
        setUsdAmount(0);
        setLbpAmount(0);
        setNote("");
        appEvents.emit("holdMoney:changed");
        await loadHolds();
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
  }, [clientName, phoneNumber, usdAmount, lbpAmount, note, loadHolds]);

  const handleCollect = useCallback(
    async (hold: HoldMoneyRecord) => {
      setCollectingId(hold.id);
      try {
        const res = await window.api.holdMoney.collect(hold.id);
        if (res.success) {
          appEvents.emit(
            "notification:show",
            `Returned hold to ${hold.client_name}.`,
            "success",
          );
          appEvents.emit("holdMoney:changed");
          await loadHolds();
        } else {
          appEvents.emit(
            "notification:show",
            res.error ?? "Failed to collect hold.",
            "error",
          );
        }
      } catch (err) {
        logger.error("[HoldMoney] collect failed", err);
        appEvents.emit("notification:show", "Failed to collect hold.", "error");
      } finally {
        setCollectingId(null);
      }
    },
    [loadHolds],
  );

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
            onChange={(v) => setClientName(v)}
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
          Held cash is added to the General drawer; collecting returns it.
        </p>
      </div>

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

      {/* Active Holds */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <HandCoins size={13} className="text-teal-400" />
            Active Holds
            <span className="text-slate-500">({holds.length})</span>
          </label>
          <button
            type="button"
            onClick={loadHolds}
            className="text-xs px-2 py-1 rounded bg-slate-700/60 hover:bg-slate-700 text-slate-300 transition-colors flex items-center gap-1"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {holds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-500 bg-slate-900/40 rounded-xl border border-slate-700/50">
            <Wallet size={28} className="mb-2 opacity-40" />
            <p className="text-sm">No active holds</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-700/50 divide-y divide-slate-700/60 overflow-hidden">
            {holds.map((hold) => (
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
                    {hold.usd_amount > 0 && (
                      <span className="text-emerald-400 font-mono">
                        ${formatUsd(hold.usd_amount)}
                      </span>
                    )}
                    {hold.lbp_amount > 0 && (
                      <span className="text-emerald-400 font-mono">
                        {formatLbp(hold.lbp_amount)} LBP
                      </span>
                    )}
                  </div>
                  {hold.notes && (
                    <p className="text-xs text-slate-500 mt-0.5 truncate">
                      {hold.notes}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleCollect(hold)}
                  disabled={collectingId === hold.id}
                  className="flex-shrink-0 px-4 py-2 rounded-lg font-medium text-sm bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 transition-all flex items-center gap-1.5"
                >
                  {collectingId === hold.id ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : (
                    <HandCoins size={14} />
                  )}
                  Collect
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default HoldMoneySection;
