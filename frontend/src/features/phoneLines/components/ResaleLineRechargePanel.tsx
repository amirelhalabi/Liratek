/**
 * LIRA-309 phase 5 — recharge a line the shop holds for sale.
 *
 * Owner rules (2026-10-11): three sources — MTC/Alfa days taken from a shop
 * line, credit moved from a shop line, or a card from the iPick/Katsh balance.
 * What the recharge costs the shop is added to the line's cost AND selling
 * price (no expense), so its profit when sold stays the same. The server
 * decides the exact cost; the preview here shows what it will be where the
 * panel can know it (days: the typed cost; card: cost ÷ rate).
 *
 * Used on the Phone Lines page (and, in phase 6, on Mobile Recharge when the
 * typed number is one of the shop's lines for sale).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi, type CarrierLineEntity, type MobileServiceItemEntity } from "@liratek/ui";
import {
  planSmsTransfer,
  type RechargeResaleLineInput,
  type ResaleLineRow,
} from "@liratek/core";
import { useSellRate } from "@/hooks/useSellRate";
import { localDay } from "@/shared/utils/localDay";
import logger from "@/utils/logger";

type Source = "DAYS" | "SHOP_LINE_CREDIT" | "CARD";

const SOURCES: Array<{ key: Source; label: string }> = [
  { key: "DAYS", label: "Days" },
  { key: "SHOP_LINE_CREDIT", label: "Shop-line credit" },
  { key: "CARD", label: "Card" },
];

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ResaleLineRechargePanel({
  line,
  onDone,
  onCancel,
}: {
  line: ResaleLineRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const { sellRate } = useSellRate();

  const carrier = line.carrier ?? "mtc";
  const carrierLabel = carrier === "mtc" ? "MTC" : "Alfa";

  const [source, setSource] = useState<Source>("DAYS");
  const [shopLines, setShopLines] = useState<CarrierLineEntity[]>([]);
  const [cards, setCards] = useState<MobileServiceItemEntity[]>([]);
  const [shopLineId, setShopLineId] = useState<number | null>(null);
  const [cardId, setCardId] = useState<number | null>(null);
  const [days, setDays] = useState("");
  const [daysCost, setDaysCost] = useState("");
  const [credits, setCredits] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lines, items] = await Promise.all([
          apiRef.current.getAllActiveCarrierLines(),
          apiRef.current.getActiveMobileServiceItems(),
        ]);
        if (cancelled) return;
        const own = (Array.isArray(lines) ? lines : []).filter(
          (l) => l.carrier === carrier && l.is_active === 1,
        );
        setShopLines(own);
        const primary = own.find((l) => l.is_primary === 1) ?? own[0];
        setShopLineId(primary ? primary.id : null);
        setCards(
          (Array.isArray(items) ? items : []).filter(
            (i) =>
              (i.provider === "iPick" || i.provider === "Katsh") &&
              i.category.toLowerCase() === carrier &&
              i.cost_lbp > 0,
          ),
        );
      } catch (err) {
        logger.error("Failed to load recharge sources", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [carrier]);

  const card = cards.find((c) => c.id === cardId) ?? null;
  const smsFee = useMemo(() => {
    const n = Number(credits);
    return n > 0 ? round2(planSmsTransfer(n).feeUsd) : 0;
  }, [credits]);

  // What the preview can know for sure; credit's cost uses the shop's credit
  // cost rate on the server, so it is shown as an amount, not a new price.
  const previewCost: number | null =
    source === "DAYS"
      ? Number(daysCost) > 0
        ? round2(Number(daysCost))
        : null
      : source === "CARD"
        ? card
          ? round2(card.cost_lbp / sellRate)
          : null
        : null;

  const handleSave = async () => {
    setError("");
    // ONE payload, typed from the schema (rules 21, 22).
    const base = {
      product_id: line.product_id,
      exchange_rate: sellRate,
      client_day: localDay(),
    };
    let payload: RechargeResaleLineInput;
    if (source === "DAYS") {
      if (!(Number(days) > 0) || !(Number(daysCost) > 0)) {
        setError("Enter the days and what they cost.");
        return;
      }
      payload = {
        ...base,
        source,
        days: Math.trunc(Number(days)),
        days_cost_usd: Number(daysCost),
        ...(shopLineId ? { source_carrier_line_id: shopLineId } : {}),
      };
    } else if (source === "SHOP_LINE_CREDIT") {
      if (!(Number(credits) > 0)) {
        setError("Enter the credit to move.");
        return;
      }
      payload = {
        ...base,
        source,
        credits: Number(credits),
        ...(shopLineId ? { source_carrier_line_id: shopLineId } : {}),
      };
    } else {
      if (!card) {
        setError("Pick the card.");
        return;
      }
      payload = { ...base, source, mobile_service_item_id: card.id };
    }

    setSaving(true);
    try {
      const res = await apiRef.current.rechargeResaleLine(payload);
      if (!res.success) {
        setError(res.error || "Could not recharge the line.");
        return;
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not recharge the line.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm";

  return (
    <div className="border border-violet-700/50 rounded-lg p-4 bg-slate-900/60 space-y-3">
      <div>
        <h2 className="text-white font-medium">
          Recharge {line.phone_number} ({carrierLabel})
        </h2>
        <p className="text-xs text-slate-400">
          What this costs you is added to the line's cost and selling price.
        </p>
      </div>

      <div role="tablist" className="flex gap-2">
        {SOURCES.map((s) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={source === s.key}
            onClick={() => {
              setError("");
              setSource(s.key);
            }}
            className={`px-3 py-1 rounded text-sm ${
              source === s.key
                ? "bg-violet-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {source !== "CARD" && (
          <div>
            <label htmlFor="rr-shop-line" className="text-xs text-slate-400 block mb-1">
              From shop line
            </label>
            <select
              id="rr-shop-line"
              value={shopLineId ?? ""}
              onChange={(e) => setShopLineId(Number(e.target.value) || null)}
              className={inputClass}
            >
              {shopLines.length === 0 && <option value="">No active {carrierLabel} shop line</option>}
              {shopLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.phone_number} — ${l.credits}
                  {l.is_primary === 1 ? " (primary)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {source === "DAYS" && (
          <>
            <div>
              <label htmlFor="rr-days" className="text-xs text-slate-400 block mb-1">
                Days
              </label>
              <input id="rr-days" type="number" min="1" step="1" value={days}
                onChange={(e) => setDays(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="rr-days-cost" className="text-xs text-slate-400 block mb-1">
                Days cost ($)
              </label>
              <input id="rr-days-cost" type="number" min="0" step="0.01" value={daysCost}
                onChange={(e) => setDaysCost(e.target.value)} className={inputClass} />
            </div>
          </>
        )}

        {source === "SHOP_LINE_CREDIT" && (
          <div>
            <label htmlFor="rr-credits" className="text-xs text-slate-400 block mb-1">
              Credit to move ($)
            </label>
            <input id="rr-credits" type="number" min="0" step="0.01" value={credits}
              onChange={(e) => setCredits(e.target.value)} className={inputClass} />
            {smsFee > 0 && (
              <p className="text-xs text-slate-400 mt-1">
                + SMS fee {money(smsFee)} from the shop line
              </p>
            )}
          </div>
        )}

        {source === "CARD" && (
          <div className="sm:col-span-2">
            <label htmlFor="rr-card" className="text-xs text-slate-400 block mb-1">
              Card
            </label>
            <select id="rr-card" value={cardId ?? ""}
              onChange={(e) => setCardId(Number(e.target.value) || null)} className={inputClass}>
              <option value="">Choose…</option>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.provider} {carrierLabel} {c.label} — {c.cost_lbp.toLocaleString()} LBP
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <p data-testid="recharge-preview" className="text-sm text-slate-300">
        {previewCost !== null ? (
          <>
            Cost {money(line.cost_price_usd)} → {money(round2(line.cost_price_usd + previewCost))} ·
            Price {money(line.selling_price_usd)} →{" "}
            {money(round2(line.selling_price_usd + previewCost))}
          </>
        ) : (
          "The cost and price go up by what this recharge costs you."
        )}
      </p>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">{error}</div>
      )}

      <div className="flex gap-2">
        <button onClick={handleSave} disabled={saving}
          className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded text-sm">
          {saving ? "Recharging..." : "Recharge line"}
        </button>
        <button onClick={onCancel}
          className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
