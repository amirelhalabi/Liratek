/**
 * LIRA-296 P2 (FR-012) — a sale line's (or repair's, or unit's) warranty
 * claim history, newest first: date, staff member, action, status, notes.
 * An admin can void a live claim — that reverses everything it did.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import type { WarrantyClaimView, WarrantyClaimsForInput } from "@liratek/core";

const ACTION_LABEL: Record<string, string> = {
  REPAIR: "Repair",
  REPLACE: "Replace",
  REFUND: "Refund",
};
const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  DONE: "Done",
  VOIDED: "Voided",
};

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
      setError(e instanceof Error ? e.message : "Could not load claims");
    }
  }, [saleItemId, maintenanceId, unitId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const voidClaim = async (id: number) => {
    if (
      !window.confirm(
        "Void this claim? Everything it did (stock, refund, repair job, cost) is reversed.",
      )
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
  if (!claims) return <p className="text-xs text-slate-500">Loading claims…</p>;
  if (claims.length === 0)
    return <p className="text-xs text-slate-500">No warranty claims yet.</p>;

  return (
    <ul
      className="divide-y divide-slate-700/60 text-xs"
      data-testid="claim-history"
    >
      {claims.map((c) => (
        <li key={c.id} className="py-1.5 flex items-start gap-2">
          <span className="text-slate-400 w-24 shrink-0">
            {c.created_at.slice(0, 10)}
          </span>
          <span className="text-slate-200 font-medium w-16 shrink-0">
            {ACTION_LABEL[c.action] ?? c.action}
          </span>
          <span
            className={`w-14 shrink-0 ${c.status === "VOIDED" ? "text-slate-500" : c.status === "OPEN" ? "text-amber-300" : "text-emerald-300"}`}
          >
            {STATUS_LABEL[c.status] ?? c.status}
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
              Void claim
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
