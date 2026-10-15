import { MultiSelect } from "@liratek/ui";
import {
  OMT_COVERED_TYPE_VALUES,
  coveredTypeLabel,
  normaliseCoveredTypes,
  type OmtCoveredType,
} from "@liratek/core";
import type { AccountExpectedStatement } from "../hooks/useSuppliers";

/** Stable module-level reference for MultiSelect's `options`. */
const TYPE_OPTIONS: string[] = [...OMT_COVERED_TYPE_VALUES];

/**
 * LIRA-256 — "which OMT commission types does this statement include?"
 *
 * Shared by the statement check panel and both settle screens. `value`
 * `undefined` means "All types" (the pre-feature behaviour, decision S3).
 *
 * LIRA-322 (owner, 2026-10-15) — a dropdown with checkboxes instead of a
 * checkbox grid: the shared `MultiSelect` (same control as the Audit page's
 * type filter), reused as-is. Nothing ticked reads "All types", exactly like
 * the Audit filter; unticking the last type returns to "All types" — the
 * picker never emits an empty list (the schema refuses `[]`).
 *
 * Test ids: the button is `${testIdPrefix}`, each option
 * `${testIdPrefix}-option-${TYPE}` (MultiSelect's convention), the per-type
 * figures `${testIdPrefix}-${TYPE}-amount` inside the open list.
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
  const handleChange = (next: string[]) => {
    onChange(
      next.length === 0
        ? undefined
        : normaliseCoveredTypes(next as OmtCoveredType[]),
    );
  };

  const optionLabel = (option: string) => {
    const type = option as OmtCoveredType;
    const stats = byType?.find((t) => t.omt_service_type === type);
    return (
      <span className="flex items-center gap-2 min-w-0">
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
      </span>
    );
  };

  return (
    <div data-testid={`${testIdPrefix}-picker`} className="space-y-1">
      <div className="text-[11px] font-semibold text-slate-300">{heading}</div>
      <MultiSelect
        label={value === undefined ? "All types" : "Types"}
        testId={testIdPrefix}
        values={value ?? []}
        onChange={handleChange}
        options={TYPE_OPTIONS}
        getOptionLabel={optionLabel}
        optionsClassName="min-w-[16rem]"
      />
    </div>
  );
}
