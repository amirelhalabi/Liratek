import { useState, useEffect } from "react";
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
  const [allPartners, setAllPartners] = useState<Partner[]>([]);
  const api = useApi();

  useEffect(() => {
    api.partners
      .getAll(false)
      .then(setAllPartners)
      .catch((err: unknown) => logger.error("Failed to load partners:", err));
  }, [api]);

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

  if (required && partners.length === 0) {
    const systemLabel = systemFilter ? ` with ${systemFilter} system` : "";
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Users size={16} className="text-amber-400" />
        <span className="text-xs text-amber-400 font-medium">
          No partners available{systemLabel}. Add a partner first.
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
          Partner: {partners[0].name}
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
      <p className="text-sm text-slate-300">Partner:</p>
      <Select
        value={selectedPartnerId !== null ? String(selectedPartnerId) : ""}
        onChange={(v) => onSelect(v ? Number(v) : null)}
        options={[
          {
            value: "",
            label: required ? "Select partner" : "Direct (no partner)",
          },
          ...partners.map((p) => ({ value: String(p.id), label: p.name })),
        ]}
        buttonClassName={`bg-slate-700 border ${borderClass} text-white text-sm rounded px-2 py-1.5 focus:ring-violet-500 focus:border-violet-500`}
      />
    </div>
  );
}
