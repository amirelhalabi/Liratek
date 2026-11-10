import { MultiSelect } from "@liratek/ui";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
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
 * LIRA-378 (owner 2026-11-09) — `emptyMeans="none"` (the SMS settle sheet):
 * nothing ticked reads "No commission" and the picker emits `[]`, never
 * `undefined`; "All types" is one tick, the header checkbox of the single
 * group the list is wrapped in (`${testIdPrefix}-group-ALL`).
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
  heading,
  emptyMeans = "all",
}: {
  value: OmtCoveredType[] | undefined;
  onChange: (next: OmtCoveredType[] | undefined) => void;
  byType?: AccountExpectedStatement["commission_by_type"];
  testIdPrefix: string;
  heading?: string;
  /** What nothing ticked means: every type (default) or no commission. */
  emptyMeans?: "all" | "none";
}) {
  const { t } = useTranslation("suppliers");
  const noneMode = emptyMeans === "none";
  const handleChange = (next: string[]) => {
    const picked = normaliseCoveredTypes(next as OmtCoveredType[]);
    onChange(picked.length === 0 && !noneMode ? undefined : picked);
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
            className="ms-auto shrink-0 font-mono text-[11px] text-slate-500"
          >
            {stats.count} · ${stats.commission_usd.toFixed(2)}
            {stats.commission_lbp
              ? ` + ${formatNumber(Math.round(stats.commission_lbp))} LBP`
              : ""}
          </span>
        )}
      </span>
    );
  };

  const allTypesLabel = t("ledger.allTypes");
  const groups = useMemo(
    () =>
      noneMode
        ? [{ key: "ALL", label: allTypesLabel, options: TYPE_OPTIONS }]
        : undefined,
    [noneMode, allTypesLabel],
  );
  const empty = value === undefined || value.length === 0;
  const label = empty
    ? noneMode
      ? t("coveredTypes.none")
      : allTypesLabel
    : t("coveredTypes.types");

  return (
    <div data-testid={`${testIdPrefix}-picker`} className="space-y-1">
      <div className="text-[11px] font-semibold text-slate-300">
        {heading ?? t("coveredTypes.defaultHeading")}
      </div>
      <MultiSelect
        label={label}
        testId={testIdPrefix}
        values={value ?? []}
        onChange={handleChange}
        options={TYPE_OPTIONS}
        getOptionLabel={optionLabel}
        optionsClassName="min-w-[16rem]"
        {...(groups ? { groups, groupsOpen: true } : {})}
      />
    </div>
  );
}
