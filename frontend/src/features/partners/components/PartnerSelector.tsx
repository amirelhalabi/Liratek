import { useState, useEffect } from "react";
import { Users } from "lucide-react";
import type { Partner } from "@/types/electron";
import logger from "@/utils/logger";
import { Select } from "@liratek/ui";

interface PartnerSelectorProps {
  selectedPartnerId: number | null;
  onSelect: (partnerId: number | null) => void;
  className?: string;
  required?: boolean;
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

  useEffect(() => {
    window.api.partners
      .getAll(false)
      .then(setAllPartners)
      .catch((err: unknown) => logger.error("Failed to load partners:", err));
  }, []);

  // Filter by system association if specified
  const partners = systemFilter
    ? allPartners.filter((p) => p.system_association === systemFilter)
    : allPartners;

  // Auto-select when there's exactly one partner and autoSelectSingle is enabled
  useEffect(() => {
    if (
      autoSelectSingle &&
      partners.length === 1 &&
      selectedPartnerId === null
    ) {
      onSelect(partners[0].id);
    }
  }, [autoSelectSingle, partners, selectedPartnerId, onSelect]);

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
          { value: "", label: required ? "Select partner" : "Direct (no partner)" },
          ...partners.map((p) => ({ value: String(p.id), label: p.name })),
        ]}
        buttonClassName={`bg-slate-700 border ${borderClass} text-white text-sm rounded px-2 py-1.5 focus:ring-violet-500 focus:border-violet-500`}
      />
    </div>
  );
}
