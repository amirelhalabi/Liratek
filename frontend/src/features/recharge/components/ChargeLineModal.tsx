/**
 * LIRA-338 — "Charge to shop line" from the iPick / Katsh / Whish App grids:
 * the cashier picks WHICH line the card goes on (owner, 2026-10-19).
 *
 * - Shop lines: every active line of the card's carrier, the main line
 *   pre-picked. Uses the existing self-charge (TELECOM_SELF_CHARGE): the
 *   provider's LBP balance pays, the line gains the card's credit and days.
 * - Lines for sale: every unsold, not-lost line of that carrier. Uses the
 *   existing LIRA-309 CARD recharge (LINE_RECHARGE): the card's cost is added
 *   to the line's cost and selling price.
 *
 * No new money path: both writes already exist and are undone by Void. The
 * validity warnings come from core's `projectValidityExpiry`, the rule the
 * server applies (LIRA-157), never a copy of it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { useApi, type CarrierLineEntity } from "@liratek/ui";
import {
  classifyLineStatus,
  projectValidityExpiry,
  MAX_LINE_VALIDITY_DAYS,
  RESALE_LINE_EXPIRY_WARNING_DAYS,
  type RechargeResaleLineInput,
  type ResaleLineRow,
} from "@liratek/core";
import { useSellRate } from "@/hooks/useSellRate";
import { localDay } from "@/shared/utils/localDay";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";
import logger from "@/utils/logger";
import type { ServiceItem } from "../hooks/useMobileServiceItems";
import { formatCatalogItemName } from "../hooks/useMobileServiceItems";

type Target =
  | { kind: "shop"; line: CarrierLineEntity }
  | { kind: "sale"; line: ResaleLineRow };

const PROVIDER_NAMES: Record<string, string> = {
  iPick: "iPick",
  Katsh: "Katsh",
  WHISH_APP: "Whish App",
};

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysLeft(expiry: string | null | undefined, today: string): number | null {
  if (!expiry) return null;
  const ms = Date.parse(`${expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

export function ChargeLineModal({
  item,
  onClose,
  onCharged,
}: {
  item: ServiceItem;
  onClose: () => void;
  /** Called after a successful charge, so the caller can refresh balances. */
  onCharged: () => void;
}) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;
  const { sellRate } = useSellRate();
  const { t } = useTranslation("recharge");
  const { t: tc } = useTranslation("common");
  const today = localDay();

  const carrier = item.category.toLowerCase() as "alfa" | "mtc";
  const carrierLabel = carrier.toUpperCase();
  const providerName = PROVIDER_NAMES[item.provider] ?? item.provider;
  const costLbp = item.catalogCost ?? 0;

  const [shopLines, setShopLines] = useState<CarrierLineEntity[]>([]);
  const [saleLines, setSaleLines] = useState<ResaleLineRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [pick, setPick] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lines, forSale] = await Promise.all([
          apiRef.current.getAllActiveCarrierLines(),
          apiRef.current.getResaleLines({ carrier }),
        ]);
        if (cancelled) return;
        const own = (Array.isArray(lines) ? lines : []).filter(
          (l) => l.carrier === carrier && l.is_active === 1,
        );
        const sale = (Array.isArray(forSale) ? forSale : []).filter(
          (l) =>
            l.carrier === carrier &&
            l.is_unsold === 1 &&
            classifyLineStatus(l.validity_expires_at, today, RESALE_LINE_EXPIRY_WARNING_DAYS)
              .status !== "LOST",
        );
        setShopLines(own);
        setSaleLines(sale);
        const main = own.find((l) => l.is_primary === 1) ?? own[0];
        if (main) setPick(`shop:${main.id}`);
      } catch (err) {
        logger.error("Failed to load lines to charge", err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [carrier, today]);

  const target: Target | null = useMemo(() => {
    const [kind, id] = pick.split(":");
    if (kind === "shop") {
      const line = shopLines.find((l) => l.id === Number(id));
      return line ? { kind: "shop", line } : null;
    }
    if (kind === "sale") {
      const line = saleLines.find((l) => l.product_id === Number(id));
      return line ? { kind: "sale", line } : null;
    }
    return null;
  }, [pick, shopLines, saleLines]);

  // LIRA-157 — what the charge will really do to a SHOP line's validity.
  const projection = useMemo(() => {
    const requested = item.validityDays;
    if (target?.kind !== "shop" || requested == null || requested <= 0) return null;
    const p = projectValidityExpiry(
      target.line.validity_expires_at,
      requested,
      undefined,
      target.line.days_owed ?? 0,
    );
    return {
      ...p,
      requestedDays: requested,
      appliedDays: requested - p.daysLostToCap - p.owedApplied,
    };
  }, [target, item.validityDays]);
  const blocked = projection?.burned === true;

  const saleCostUsd = sellRate > 0 ? round2(costLbp / sellRate) : 0;

  const handleConfirm = async () => {
    if (!target || !item.id) return;
    setSubmitting(true);
    setError("");
    try {
      if (target.kind === "shop") {
        const res = await apiRef.current.selfChargeTelecomItem({
          mobileServiceItemId: item.id,
          carrierLineId: target.line.id,
          client_day: localDay(),
        });
        if (!res.success || !res.data) {
          setError(res.error || t("katsh.selfChargeFailed"));
          return;
        }
        setDone(t("chargeLine.doneShop", {
          line: target.line.label || target.line.phone_number,
          credits: res.data.creditsAdded,
          days: res.data.validityDaysAdded,
          cost: formatNumber(res.data.costLbp),
          provider: providerName,
        }));
      } else {
        // ONE payload, typed from the schema (rules 21, 22).
        const payload: RechargeResaleLineInput = {
          product_id: target.line.product_id,
          source: "CARD",
          mobile_service_item_id: item.id,
          exchange_rate: sellRate,
          client_day: localDay(),
        };
        const res = await apiRef.current.rechargeResaleLine(payload);
        if (!res.success) {
          setError(res.error || t("katsh.selfChargeFailed"));
          return;
        }
        setDone(t("chargeLine.doneSale", {
          line: target.line.phone_number ?? target.line.name,
          cost: money(res.data.line.cost_usd),
          price: money(res.data.line.price_usd),
        }));
      }
      onCharged();
    } catch (err) {
      setError(getApiErrorMessage(err, t("katsh.selfChargeFailed")));
    } finally {
      setSubmitting(false);
    }
  };

  const lineName =
    target?.kind === "shop"
      ? target.line.label || target.line.phone_number
      : target?.kind === "sale"
        ? (target.line.phone_number ?? target.line.name)
        : t("katsh.theCarrierLine", { carrier: carrierLabel });

  const option = (value: string, label: string, detail: string) => (
    <label
      key={value}
      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm ${
        pick === value ? "bg-emerald-900/30 text-white" : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      <input
        type="radio"
        name="charge-line"
        value={value}
        checked={pick === value}
        onChange={() => {
          setError("");
          setPick(value);
        }}
        className="accent-emerald-500"
      />
      <span className="font-mono">{label}</span>
      <span className="text-xs text-slate-400 ms-auto">{detail}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
      <div
        data-testid="charge-line-modal"
        className="relative w-full max-w-md bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl p-6"
      >
        <h3 className="text-lg font-bold text-white mb-1">{t("chargeLine.title")}</h3>
        <p className="text-slate-400 text-xs mb-4">
          {formatCatalogItemName(item)} · {formatNumber(costLbp)} LBP · {providerName}
        </p>

        {done ? (
          <div className="space-y-4">
            <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-3 text-sm text-emerald-300">
              <p>{t("katsh.chargedSuccessfully")}</p>
              <p className="text-emerald-200/80 text-xs mt-1">{done}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded text-sm"
            >
              {t("katsh.done")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="max-h-64 overflow-y-auto border border-slate-700 rounded-lg p-2 space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-slate-500 px-2">
                {t("chargeLine.shopLines")}
              </p>
              {shopLines.length === 0 && loaded && (
                <p className="text-amber-400 text-xs px-2">
                  {t("katsh.noActiveLine", { carrier: carrierLabel })}
                </p>
              )}
              {shopLines.map((l) => {
                const left = daysLeft(l.validity_expires_at, today);
                return option(
                  `shop:${l.id}`,
                  `${l.phone_number}${l.is_primary === 1 ? ` ${t("chargeLine.main")}` : ""}`,
                  `${money(l.credits ?? 0)} · ${
                    left === null ? t("chargeLine.noExpiry") : t("chargeLine.daysLeft", { n: left })
                  }`,
                );
              })}
              {saleLines.length > 0 && (
                <p className="text-[10px] uppercase tracking-wider text-slate-500 px-2 pt-2">
                  {t("chargeLine.linesForSale")}
                </p>
              )}
              {saleLines.map((l) =>
                option(
                  `sale:${l.product_id}`,
                  l.phone_number ?? l.name,
                  `${money(l.credits ?? 0)} · ${t("chargeLine.price", { price: money(l.selling_price_usd) })}`,
                ),
              )}
            </div>

            {error && (
              <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">{error}</div>
            )}

            {target && (
              <div className="bg-slate-900/60 border border-slate-700 rounded-lg p-3 text-sm text-slate-300 space-y-1">
                <p className="text-slate-400 text-xs uppercase mb-1">{t("katsh.thisWill")}</p>
                <p>
                  <Trans
                    t={t}
                    i18nKey="katsh.debitFromDrawer"
                    values={{ amount: `${formatNumber(costLbp)} LBP`, provider: providerName }}
                    components={{ amt: <span className="text-white font-mono" /> }}
                  />
                </p>
                <p>
                  <Trans
                    t={t}
                    i18nKey="katsh.addCreditTo"
                    values={{ amount: `+$${item.credits}`, line: lineName }}
                    components={{ amt: <span className="text-emerald-400 font-mono" /> }}
                  />
                </p>
                <p>
                  <Trans
                    t={t}
                    i18nKey="katsh.addValidityTo"
                    values={{ n: item.validityDays, line: lineName }}
                    components={{
                      amt: (
                        <span
                          className={
                            projection?.capped || blocked
                              ? "text-amber-400 font-mono line-through"
                              : "text-emerald-400 font-mono"
                          }
                        />
                      ),
                    }}
                  />
                </p>
                {target.kind === "sale" && (
                  <p data-testid="charge-line-for-sale-preview" className="text-slate-300">
                    {t("chargeLine.forSaleEffect", {
                      costFrom: money(target.line.cost_price_usd),
                      costTo: money(round2(target.line.cost_price_usd + saleCostUsd)),
                      priceFrom: money(target.line.selling_price_usd),
                      priceTo: money(round2(target.line.selling_price_usd + saleCostUsd)),
                    })}
                  </p>
                )}
                {blocked && (
                  <p className="text-red-400 text-xs pt-1" data-testid="self-charge-burned-warning">
                    {t("katsh.lineBurned", { n: projection?.lapseDays })}
                  </p>
                )}
                {!blocked && (projection?.owedApplied ?? 0) > 0 && (
                  <p className="text-amber-400 text-xs pt-1" data-testid="self-charge-owed-payoff-notice">
                    {(projection?.appliedDays ?? 0) > 0
                      ? t("katsh.owedPayoffSplit", {
                          owed: projection?.owedApplied,
                          requested: projection?.requestedDays,
                          applied: projection?.appliedDays,
                        })
                      : t("katsh.owedPayoff", {
                          owed: projection?.owedApplied,
                          requested: projection?.requestedDays,
                        })}
                  </p>
                )}
                {!blocked && projection?.capped && (
                  <p className="text-amber-400 text-xs pt-1" data-testid="self-charge-capped-warning">
                    {t("katsh.validityCapped", {
                      applied: projection.appliedDays,
                      requested: projection.requestedDays,
                      max: MAX_LINE_VALIDITY_DAYS,
                    })}
                  </p>
                )}
                {!blocked && projection?.state === "GRACE" && (
                  <p className="text-amber-400 text-xs pt-1" data-testid="self-charge-grace-warning">
                    {t("katsh.lineGrace", { n: projection.lapseDays })}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                data-testid="katsh-self-charge-confirm"
                onClick={handleConfirm}
                disabled={submitting || !target || blocked}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded text-sm"
              >
                {submitting ? t("katsh.charging") : t("katsh.confirmCharge")}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm disabled:opacity-50"
              >
                {tc("actions.cancel")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
