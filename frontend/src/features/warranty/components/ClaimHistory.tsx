/**
 * LIRA-296 P2 (FR-012) — a sale line's (or repair's, or unit's) warranty
 * claim history, newest first: date, staff member, action, status, notes.
 * An admin can void a live claim — that reverses everything it did.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import type { WarrantyClaimView, WarrantyClaimsForInput } from "@liratek/core";

// Codes → catalog keys, translated at render. Unknown codes show as stored.
const ACTION_KEY = {
  REPAIR: "action.REPAIR",
  REPLACE: "action.REPLACE",
  REFUND: "action.REFUND",
} as const;
const STATUS_KEY = {
  OPEN: "claimStatus.OPEN",
  DONE: "claimStatus.DONE",
  VOIDED: "claimStatus.VOIDED",
} as const;

interface ClaimHistoryProps {
  saleItemId?: number;
  maintenanceId?: number;
  unitId?: number;
  isAdmin: boolean;
  /** Bumped by the parent after a new claim, to reload. */
  refreshKey?: number;
  onChanged?: () => void;
}

export function ClaimHistory({
  saleItemId,
  maintenanceId,
  unitId,
  isAdmin,
  refreshKey,
  onChanged,
}: ClaimHistoryProps) {
  const { t } = useTranslation("warranty");
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const api = useApi();
  // Rule 25: `api` read through a ref; refreshed in an effect (declared
  // before the load effect, so it runs first).
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const [claims, setClaims] = useState<WarrantyClaimView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const input: WarrantyClaimsForInput =
      saleItemId != null
        ? { sale_item_id: saleItemId }
        : maintenanceId != null
          ? { maintenance_id: maintenanceId }
          : { unit_id: unitId! };
    try {
      setClaims(await apiRef.current.getWarrantyClaims(input));
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : tRef.current("history.loadFailed"),
      );
    }
  }, [saleItemId, maintenanceId, unitId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const voidClaim = async (id: number) => {
    if (
      !window.confirm(t("history.voidConfirm"))
    )
      return;
    const res = await apiRef.current.voidWarrantyClaim({ claim_id: id });
    if (!res.success) setError(res.error);
    else {
      await load();
      onChanged?.();
    }
  };

  if (error)
    return (
      <p role="alert" className="text-xs text-red-300">
        {error}
      </p>
    );
  if (!claims)
    return <p className="text-xs text-slate-500">{t("history.loading")}</p>;
  if (claims.length === 0)
    return <p className="text-xs text-slate-500">{t("history.empty")}</p>;

  return (
    <ul
      className="divide-y divide-slate-700/60 text-xs"
      data-testid="claim-history"
    >
      {claims.map((c) => (
        <li key={c.id} className="py-1.5 flex items-start gap-2">
          <span className="text-slate-400 w-24 shrink-0">
            <Ltr>{c.created_at.slice(0, 10)}</Ltr>
          </span>
          <span className="text-slate-200 font-medium w-16 shrink-0">
            {c.action in ACTION_KEY
              ? t(ACTION_KEY[c.action as keyof typeof ACTION_KEY])
              : c.action}
          </span>
          <span
            className={`w-14 shrink-0 ${c.status === "VOIDED" ? "text-slate-500" : c.status === "OPEN" ? "text-amber-300" : "text-emerald-300"}`}
          >
            {c.status in STATUS_KEY
              ? t(STATUS_KEY[c.status as keyof typeof STATUS_KEY])
              : c.status}
          </span>
          <span className="text-slate-400 w-20 shrink-0">
            {c.username ?? `#${c.user_id}`}
          </span>
          <span className="text-slate-300 flex-1">{c.notes}</span>
          {isAdmin && c.status !== "VOIDED" && (
            <button
              onClick={() => void voidClaim(c.id)}
              className="text-red-300 hover:text-red-200 underline shrink-0"
            >
              {t("history.void")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
