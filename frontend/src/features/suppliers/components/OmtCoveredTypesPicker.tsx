import {
  OMT_COVERED_TYPE_VALUES,
  coveredTypeLabel,
  normaliseCoveredTypes,
  type OmtCoveredType,
} from "@liratek/core";
import type { AccountExpectedStatement } from "../hooks/useSuppliers";

/**
 * LIRA-256 — "which OMT commission types does this statement include?"
 *
 * Shared by the statement check panel and both settle screens. `value`
 * `undefined` means "All types" (the pre-feature behaviour, decision S3).
 * Unticking the last type returns to "All types" — the picker never emits
 * an empty list (the schema refuses `[]`).
 */
export default function OmtCoveredTypesPicker({
  value,
  onChange,
  byType,
  testIdPrefix,
  heading = "Which shares does this SMS include?",
}: {
  value: OmtCoveredType[] | undefined;
  onChange: (next: OmtCoveredType[] | undefined) => void;
  byType?: AccountExpectedStatement["commission_by_type"];
  testIdPrefix: string;
  heading?: string;
}) {
  const selected = new Set<string>(value ?? []);
  const toggle = (type: OmtCoveredType) => {
    const next = new Set(selected);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange(
      next.size === 0
        ? undefined
        : normaliseCoveredTypes([...next] as OmtCoveredType[]),
    );
  };

  return (
    <div
      data-testid={`${testIdPrefix}-picker`}
      className="rounded-md border border-slate-700/60 bg-slate-900/30 p-2 space-y-1.5"
    >
      <div className="text-[11px] font-semibold text-slate-300">{heading}</div>
      <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
        <input
          type="checkbox"
          data-testid={`${testIdPrefix}-all`}
          checked={value === undefined}
          onChange={() => onChange(undefined)}
        />
        All types
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        {OMT_COVERED_TYPE_VALUES.map((type) => {
          const stats = byType?.find((t) => t.omt_service_type === type);
          return (
            <label
              key={type}
              className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer min-w-0"
            >
              <input
                type="checkbox"
                data-testid={`${testIdPrefix}-${type}`}
                checked={selected.has(type)}
                onChange={() => toggle(type)}
              />
              <span className="truncate">{coveredTypeLabel(type)}</span>
              {stats && (
                <span
                  data-testid={`${testIdPrefix}-${type}-amount`}
                  className="ml-auto shrink-0 font-mono text-[11px] text-slate-500"
                >
                  {stats.count} · ${stats.commission_usd.toFixed(2)}
                  {stats.commission_lbp
                    ? ` + ${Math.round(stats.commission_lbp).toLocaleString()} LBP`
                    : ""}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
