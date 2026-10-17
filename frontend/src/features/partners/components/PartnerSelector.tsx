import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import type { Partner } from "@/types/electron";
import logger from "@/utils/logger";
import { Select, useApi } from "@liratek/ui";

interface PartnerSelectorProps {
  selectedPartnerId: number | null;
  onSelect: (partnerId: number | null) => void;
  className?: string;
  required?: boolean;
  /**
   * @deprecated LIRA-118: no longer changes behavior. The single-partner
   * branch below always renders a non-interactive "Partner: {name}" line
   * (no dropdown — there is nothing else for the user to click), so it must
   * ALSO commit that selection; a displayed selection that isn't a real
   * selection is the bug this ticket fixed (it left every "For Partner"
   * flow permanently unsubmittable for a shop with exactly one partner).
   * The prop is kept, and still accepted from existing call sites, purely
   * so none of them need edits — it is otherwise a no-op.
   */
  autoSelectSingle?: boolean;
  /** Only show partners with this system_association */
  systemFilter?: string;
}

export function PartnerSelector({
  selectedPartnerId,
  onSelect,
  className = "",
  required,
  autoSelectSingle,
  systemFilter,
}: PartnerSelectorProps): React.ReactElement | null {
  const { t } = useTranslation("partners");
  const [allPartners, setAllPartners] = useState<Partner[]>([]);
  // Shop-day 2026-10-16: an empty list used to mean three different things —
  // still loading, the request failed, or the shop really has no partners —
  // and all three rendered "No partners available. Add a partner first."
  // (seen on Mobile Recharge while GET /api/partners had 4 active partners).
  // Only a SUCCESSFUL load may claim there are none.
  const [loadState, setLoadState] = useState<"loading" | "error" | "loaded">(
    "loading",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const api = useApi();
  // Rule 25: read `api` through a ref so an unstable adapter identity can
  // never re-fire the fetch (see FeatureFlagContext.tsx).
  // Synced in an effect (not during render) — declared before the fetch
  // effect, so it has already run when that effect reads it.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });

  useEffect(() => {
    let cancelled = false;
    apiRef.current.partners
      .getAll(false)
      .then((list: Partner[]) => {
        if (cancelled) return;
        setAllPartners(Array.isArray(list) ? list : []);
        setLoadState("loaded");
      })
      .catch((err: unknown) => {
        logger.error("Failed to load partners:", err);
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Filter by system association if specified
  const partners = systemFilter
    ? allPartners.filter((p) => p.system_association === systemFilter)
    : allPartners;

  // `autoSelectSingle` is a deprecated no-op (see prop doc above) — kept
  // referenced only so existing call sites that still pass it don't trip
  // strict unused-parameter checks.
  void autoSelectSingle;

  // LIRA-118: whenever there's exactly one partner, the render below shows
  // a non-interactive "Partner: {name}" line unconditionally (no dropdown
  // for any other choice). That display must always be backed by a real
  // selection, so this fires regardless of `autoSelectSingle` — every
  // caller that reaches the single-partner branch already opted into a
  // partner-taking flow (the "For Partner" checkbox, or an explicit
  // THROUGH-partner selector), so committing the only available partner
  // here never contradicts an intended "require explicit choice" UX: there
  // is no dropdown for the user to choose differently from in this branch.
  useEffect(() => {
    if (partners.length === 1 && selectedPartnerId === null) {
      onSelect(partners[0].id);
    }
  }, [partners, selectedPartnerId, onSelect]);

  if (!required && partners.length === 0) return null;

  if (required && loadState === "loading") {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Users size={16} className="text-slate-400" />
        <span className="text-xs text-slate-400">{t("selector.loading")}</span>
      </div>
    );
  }

  if (required && loadState === "error") {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Users size={16} className="text-red-400" />
        <span className="text-xs text-red-400 font-medium">
          {t("selector.loadFailed", {
            detail: loadError ? `: ${loadError}` : "",
          })}
        </span>
        <button
          type="button"
          onClick={() => {
            setLoadState("loading");
            setLoadError(null);
            setReloadKey((k) => k + 1);
          }}
          className="text-xs font-semibold text-orange-400 hover:text-orange-300 underline"
        >
          {t("common:actions.retry")}
        </button>
      </div>
    );
  }

  if (required && partners.length === 0) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Users size={16} className="text-amber-400" />
        <span className="text-xs text-amber-400 font-medium">
          {systemFilter
            ? t("selector.noneWithSystem", { system: systemFilter })
            : t("selector.none")}
        </span>
      </div>
    );
  }

  // If only one partner, just show the name inline (no dropdown needed)
  if (partners.length === 1) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Users size={16} className="text-violet-400" />
        <span className="text-sm text-violet-300 font-medium">
          {t("selector.single", { name: partners[0].name })}
        </span>
      </div>
    );
  }

  const borderClass =
    required && selectedPartnerId === null
      ? "border-red-500"
      : "border-slate-600";

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Users size={16} className="text-slate-400" />
      <p className="text-sm text-slate-300">{t("selector.label")}</p>
      <Select
        value={selectedPartnerId !== null ? String(selectedPartnerId) : ""}
        onChange={(v) => onSelect(v ? Number(v) : null)}
        options={[
          {
            value: "",
            label: required
              ? t("selector.selectPartner")
              : t("selector.direct"),
          },
          ...partners.map((p) => ({ value: String(p.id), label: p.name })),
        ]}
        buttonClassName={`bg-slate-700 border ${borderClass} text-white text-sm rounded px-2 py-1.5 focus:ring-violet-500 focus:border-violet-500`}
      />
    </div>
  );
}
