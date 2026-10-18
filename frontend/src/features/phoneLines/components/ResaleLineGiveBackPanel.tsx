/**
 * LIRA-337 — give part of a line held for sale's credit back to one of the
 * shop's own lines, before the sale.
 *
 * Owner rules (2026-10-18): the buyer keeps exactly the credit they asked for
 * (the sender pays the SMS fee), the shop line receives the rest, the line's
 * price drops by the credit given back × the typed credit price, and its cost
 * by the credit received × the shop's credit cost rate.
 *
 * The preview comes from core's `planLineGiveBack` — the same function the
 * server saves with (rule 14), so what the cashier sees is what is booked.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DecimalInput, useApi, type CarrierLineEntity } from "@liratek/ui";
import { normalizeDigits } from "@liratek/ui/i18n/digits";
import {
  planLineGiveBack,
  type GiveBackResaleLineInput,
  type ResaleLineGiveBackData,
  type ResaleLineRow,
} from "@liratek/core";
import { useSellRate } from "@/hooks/useSellRate";
import { localDay } from "@/shared/utils/localDay";
import logger from "@/utils/logger";

/** Shop Config's fallbacks when a setting is unset (ShopConfig.tsx,
 *  RechargeRepository.getAlfaCreditCostRateLbp). */
const DEFAULT_CREDIT_SELL_PRICE_LBP = 100_000;
const DEFAULT_CREDIT_COST_RATE_LBP = 85_000;

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ResaleLineGiveBackPanel({
  line,
  onDone,
  onCancel,
}: {
  line: ResaleLineRow;
  onDone: (result: ResaleLineGiveBackData) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const { sellRate } = useSellRate();
  const { t } = useTranslation("phoneLines");

  const carrier = line.carrier ?? "mtc";
  const carrierLabel = carrier === "mtc" ? "MTC" : "Alfa";

  const [shopLines, setShopLines] = useState<CarrierLineEntity[]>([]);
  const [shopLineId, setShopLineId] = useState<number | null>(null);
  const [kept, setKept] = useState("");
  const [sellPriceLbp, setSellPriceLbp] = useState(DEFAULT_CREDIT_SELL_PRICE_LBP);
  const [costRateLbp, setCostRateLbp] = useState(DEFAULT_CREDIT_COST_RATE_LBP);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lines, settings] = await Promise.all([
          apiRef.current.getAllActiveCarrierLines(),
          apiRef.current.getAllSettings(),
        ]);
        if (cancelled) return;
        const own = (Array.isArray(lines) ? lines : []).filter(
          (l) => l.carrier === carrier && l.is_active === 1,
        );
        setShopLines(own);
        const primary = own.find((l) => l.is_primary === 1) ?? own[0];
        setShopLineId(primary ? primary.id : null);
        const map = new Map(
          (Array.isArray(settings) ? settings : []).map(
            (s: { key_name: string; value: string }) => [s.key_name, s.value],
          ),
        );
        setSellPriceLbp(
          Number(map.get("alfa_credit_sell_rate_lbp")) || DEFAULT_CREDIT_SELL_PRICE_LBP,
        );
        setCostRateLbp(
          Number(map.get("alfa_credit_cost_lbp")) || DEFAULT_CREDIT_COST_RATE_LBP,
        );
      } catch (err) {
        logger.error("Failed to load give-back sources", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [carrier]);

  const plan = useMemo(
    () =>
      kept.trim() === ""
        ? null
        : planLineGiveBack({
            creditsBefore: line.credits ?? 0,
            creditsKept: Number(kept),
            creditSellPriceLbp: sellPriceLbp,
            creditCostRateLbp: costRateLbp,
            exchangeRate: sellRate,
          }),
    [kept, line.credits, sellPriceLbp, costRateLbp, sellRate],
  );

  const handleSave = async () => {
    setError("");
    if (!plan) {
      setError(t("giveBack.enterKept"));
      return;
    }
    if (!plan.ok) {
      setError(plan.error);
      return;
    }
    // ONE payload, typed from the schema (rules 21, 22).
    const payload: GiveBackResaleLineInput = {
      product_id: line.product_id,
      credits_kept: Number(kept),
      credit_sell_price_lbp: sellPriceLbp,
      exchange_rate: sellRate,
      client_day: localDay(),
      ...(shopLineId ? { carrier_line_id: shopLineId } : {}),
    };
    setSaving(true);
    try {
      const res = await apiRef.current.giveBackResaleLineCredit(payload);
      if (!res.success) {
        setError(res.error || t("giveBack.failed"));
        return;
      }
      onDone(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("giveBack.failed"));
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm";

  const newPrice = plan?.ok ? round2(line.selling_price_usd - plan.priceDropUsd) : 0;
  const newCost = plan?.ok ? round2(line.cost_price_usd - plan.costDropUsd) : 0;

  return (
    <div
      data-testid="give-back-panel"
      className="border border-sky-700/50 rounded-lg p-4 bg-slate-900/60 space-y-3"
    >
      <div>
        <h2 className="text-white font-medium">
          {t("giveBack.title", { number: line.phone_number, carrier: carrierLabel })}
        </h2>
        <p className="text-xs text-slate-400">{t("giveBack.intro")}</p>
        <p className="text-xs text-slate-300 mt-1">
          {t("giveBack.lineHas", { credits: money(line.credits ?? 0) })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor="gb-kept" className="text-xs text-slate-400 block mb-1">
            {t("giveBack.kept")}
          </label>
          <input
            id="gb-kept"
            type="text"
            inputMode="decimal"
            value={kept}
            onChange={(e) => setKept(normalizeDigits(e.target.value))}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="gb-shop-line" className="text-xs text-slate-400 block mb-1">
            {t("giveBack.toShopLine")}
          </label>
          <select
            id="gb-shop-line"
            value={shopLineId ?? ""}
            onChange={(e) => setShopLineId(Number(e.target.value) || null)}
            className={inputClass}
          >
            {shopLines.length === 0 && (
              <option value="">{t("recharge.noShopLine", { carrier: carrierLabel })}</option>
            )}
            {shopLines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.phone_number} — ${l.credits}
                {l.is_primary === 1 ? t("recharge.primary") : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="gb-sell-price" className="text-xs text-slate-400 block mb-1">
            {t("giveBack.sellPrice")}
          </label>
          <DecimalInput
            id="gb-sell-price"
            value={sellPriceLbp}
            onChange={setSellPriceLbp}
            decimals={0}
            className={inputClass}
          />
        </div>
      </div>

      <div data-testid="give-back-preview" className="text-sm text-slate-300 space-y-0.5">
        {plan === null ? null : plan.ok ? (
          <>
            <p>
              {t("giveBack.previewSend", {
                sent: money(plan.creditsSent),
                fee: money(plan.smsFeeUsd),
                after: money(plan.creditsAfter),
              })}
            </p>
            <p>
              {t("giveBack.previewPrice", {
                from: money(line.selling_price_usd),
                to: money(newPrice),
                costFrom: money(line.cost_price_usd),
                costTo: money(newCost),
              })}
            </p>
            {newPrice < newCost && (
              <p className="text-red-400">
                {t("giveBack.previewLoss", { amount: money(round2(newCost - newPrice)) })}
              </p>
            )}
          </>
        ) : (
          <p className="text-amber-400">{plan.error}</p>
        )}
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">{error}</div>
      )}

      <div className="flex gap-2">
        <button
          data-testid="give-back-save"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded text-sm"
        >
          {saving ? t("giveBack.saving") : t("giveBack.submit")}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm"
        >
          {t("giveBack.cancel")}
        </button>
      </div>
    </div>
  );
}
