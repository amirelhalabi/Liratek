/**
 * LIRA-312 — record a MTC/Alfa card that was recharged onto the WRONG number.
 *
 * Owner rules (2026-10-12): this is NOT a refund. The sale stays as it is and
 * counts as the correct recharge of the customer's right number; the wasted
 * card is booked as a loss (its cost leaves the iPick/Katsh/Whish App
 * balance). Credits sent back can be entered now, if they already came, or
 * later from the record.
 *
 * Used from the Transactions page ("Wrong number…" on a card sale).
 *
 * LIRA-325: from a sale, the card is LOCKED to the one the sale sold (we know
 * what we sold) whenever the server can read it from the sale; otherwise
 * (an older sale, a card no longer in the catalog, a cart of several
 * different cards) the operator picks it, as before. The wrong number itself
 * is optional.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  useApi,
  type CarrierLineEntity,
  type MobileServiceItemEntity,
} from "@liratek/ui";
import type { RecordWrongNumberInput, WrongNumberCardItem } from "@liratek/core";
import { localDay } from "@/shared/utils/localDay";
import logger from "@/utils/logger";
import type { WrongNumberProviderCode } from "@/features/audit/actionGating";
import {
  PROVIDER_LABELS,
  carrierLabel,
  defaultCardFor,
  isWrongNumberCard,
  lbp,
} from "../wrongNumberFormat";

export function WrongNumberPanel({
  provider,
  saleTransactionId,
  saleText,
  onDone,
  onCancel,
}: {
  provider: WrongNumberProviderCode;
  /** Set when marked from a saved sale (the sale stays as it is). */
  saleTransactionId?: number;
  /** The sale's summary, used to pick the default card. */
  saleText?: string | null;
  onDone: (recordId: number) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;

  const [cards, setCards] = useState<MobileServiceItemEntity[]>([]);
  const [lines, setLines] = useState<CarrierLineEntity[]>([]);
  const [cardId, setCardId] = useState<number | null>(null);
  /** The card the sale sold, when the server could tell (LIRA-325). */
  const [soldCard, setSoldCard] = useState<WrongNumberCardItem | null>(null);
  const [wrongNumber, setWrongNumber] = useState("");
  const [rightNumber, setRightNumber] = useState("");
  const [creditsCame, setCreditsCame] = useState(false);
  const [credits, setCredits] = useState("");
  const [lineId, setLineId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [items, active, sold] = await Promise.all([
          apiRef.current.getActiveMobileServiceItems(),
          apiRef.current.getAllActiveCarrierLines(),
          saleTransactionId !== undefined
            ? apiRef.current
                .getWrongNumberSaleCard(saleTransactionId)
                .catch(() => null)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        const own = (Array.isArray(items) ? items : []).filter((i) =>
          isWrongNumberCard(i, provider),
        );
        setCards(own);
        setSoldCard(sold);
        setCardId(sold ? sold.id : (defaultCardFor(own, saleText)?.id ?? null));
        setLines(Array.isArray(active) ? active : []);
      } catch (err) {
        logger.error("Failed to load wrong-number cards", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, saleText, saleTransactionId]);

  const card: Pick<
    WrongNumberCardItem,
    "id" | "category" | "label" | "cost_lbp" | "credits"
  > | null = soldCard ?? cards.find((c) => c.id === cardId) ?? null;
  const carrier = card ? card.category.toLowerCase() : null;
  const carrierLines = useMemo(
    () => lines.filter((l) => l.carrier === carrier && l.is_active === 1),
    [lines, carrier],
  );

  // The shop line defaults to the card carrier's primary line.
  useEffect(() => {
    const primary =
      carrierLines.find((l) => l.is_primary === 1) ?? carrierLines[0];
    setLineId(primary ? primary.id : null);
  }, [carrierLines]);

  const handleSave = async () => {
    setError("");
    if (!card) {
      setError("Pick the MTC or Alfa card that was sent.");
      return;
    }
    if (saleTransactionId !== undefined && !rightNumber.trim()) {
      setError("Enter the customer's right number.");
      return;
    }
    const amount = Number(credits);
    if (creditsCame && (!(amount > 0) || !lineId)) {
      setError("Enter the credits that arrived and the shop line.");
      return;
    }
    // ONE payload, typed from the schema (rules 21, 22).
    const payload: RecordWrongNumberInput = {
      provider,
      mobile_service_item_id: card.id,
      // Optional (LIRA-325): sent only when typed.
      ...(wrongNumber.trim() ? { wrong_number: wrongNumber.trim() } : {}),
      expense_date: localDay(),
      ...(rightNumber.trim() ? { right_number: rightNumber.trim() } : {}),
      ...(saleTransactionId !== undefined
        ? { sale_transaction_id: saleTransactionId }
        : {}),
      ...(creditsCame && lineId
        ? { credits_received: { amount_usd: amount, carrier_line_id: lineId } }
        : {}),
    };
    setSaving(true);
    try {
      const res = await apiRef.current.recordWrongNumber(payload);
      if (!res.success) {
        setError(res.error || "Could not record the wrong number.");
        return;
      }
      onDone(res.data.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not record the wrong number.",
      );
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-white text-sm";

  return (
    <div className="space-y-3" data-testid="wrong-number-panel">
      <p className="text-xs text-slate-400">
        {saleTransactionId !== undefined
          ? "The sale stays as it is — it is the recharge of the right number. The wasted card is recorded as a loss from your "
          : "The wasted card is recorded as a loss from your "}
        {PROVIDER_LABELS[provider]} balance.
      </p>

      {soldCard ? (
        <div>
          <span className="text-xs text-slate-400 block mb-1">
            Card that was sent
          </span>
          <p
            data-testid="wrong-number-locked-card"
            className="text-sm text-white bg-slate-800/60 border border-slate-700 rounded px-3 py-1.5"
          >
            {carrierLabel(soldCard.category)} {soldCard.label} —{" "}
            {lbp(soldCard.cost_lbp)}
            <span className="text-slate-400"> · from this sale</span>
          </p>
        </div>
      ) : (
      <div>
        <label htmlFor="wn-card" className="text-xs text-slate-400 block mb-1">
          Card that was sent
        </label>
        <select
          id="wn-card"
          value={cardId ?? ""}
          onChange={(e) => setCardId(Number(e.target.value) || null)}
          className={inputClass}
        >
          {cards.length === 0 && (
            <option value="">No MTC or Alfa card from {PROVIDER_LABELS[provider]}</option>
          )}
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {carrierLabel(c.category)} {c.label} — {lbp(c.cost_lbp)}
            </option>
          ))}
        </select>
        {saleTransactionId !== undefined && (
          <p
            data-testid="wrong-number-pick-hint"
            className="text-xs text-slate-500 mt-1"
          >
            Pick the card that was sent.
          </p>
        )}
      </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="wn-wrong" className="text-xs text-slate-400 block mb-1">
            Wrong number (optional)
          </label>
          <input
            id="wn-wrong"
            inputMode="tel"
            value={wrongNumber}
            onChange={(e) => setWrongNumber(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="wn-right" className="text-xs text-slate-400 block mb-1">
            Customer's right number
          </label>
          <input
            id="wn-right"
            inputMode="tel"
            value={rightNumber}
            onChange={(e) => setRightNumber(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={creditsCame}
          onChange={(e) => setCreditsCame(e.target.checked)}
        />
        Credits already came back
      </label>

      {creditsCame && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="wn-credits" className="text-xs text-slate-400 block mb-1">
              Credits that arrived ($)
            </label>
            <input
              id="wn-credits"
              type="number"
              min="0"
              step="0.01"
              value={credits}
              onChange={(e) => setCredits(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="wn-line" className="text-xs text-slate-400 block mb-1">
              On shop line
            </label>
            <select
              id="wn-line"
              value={lineId ?? ""}
              onChange={(e) => setLineId(Number(e.target.value) || null)}
              className={inputClass}
            >
              {carrierLines.length === 0 && (
                <option value="">
                  No active {carrier ? carrierLabel(carrier) : ""} shop line
                </option>
              )}
              {carrierLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.phone_number}
                  {l.is_primary === 1 ? " (primary)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <p data-testid="wrong-number-preview" className="text-sm text-slate-300">
        {card
          ? `Loss ${lbp(card.cost_lbp)}${card.credits ? ` — the card carried $${card.credits}; credits sent back reduce it` : ""}.`
          : "Pick the card to see the loss."}
      </p>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 px-3 py-1.5 rounded">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded text-sm"
        >
          {saving ? "Saving..." : "Record wrong number"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
