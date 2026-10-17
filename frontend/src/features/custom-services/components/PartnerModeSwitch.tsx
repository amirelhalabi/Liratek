import { useTranslation } from "react-i18next";
import type { PartnerMode } from "@/features/custom-services/utils/partnerModeTransition";

const OPTIONS: ReadonlyArray<{
  mode: PartnerMode;
  labelKey: "partnerMode.customer" | "partnerMode.for" | "partnerMode.via";
  testId: string;
}> = [
  {
    mode: "none",
    labelKey: "partnerMode.customer",
    testId: "custom-service-partner-mode-none",
  },
  // The For/Via segments keep the testids of the two checkboxes they
  // replaced, so existing unit and e2e selectors keep matching.
  {
    mode: "FOR",
    labelKey: "partnerMode.for",
    testId: "custom-service-for-partner-toggle",
  },
  {
    mode: "VIA",
    labelKey: "partnerMode.via",
    testId: "custom-service-via-partner-toggle",
  },
];

/**
 * Custom Services: who the service is for — [ Customer | For Partner |
 * Via Partner ]. Styled like the slim mode tabs on the Recharge page
 * (Whish App Transfer | Bills). Controlled; side effects of a change live
 * in the page (see `partnerModeTransition`).
 */
export function PartnerModeSwitch({
  value,
  onChange,
  hideFor = false,
}: {
  value: PartnerMode;
  onChange: (next: PartnerMode) => void;
  /** Leave out the "For Partner" segment — during a customer session (owner
   *  rule 2026-10-16: a session never has partner sales). "Via Partner"
   *  stays: the customer still pays. */
  hideFor?: boolean;
}) {
  const { t } = useTranslation("customServices");
  const options = hideFor
    ? OPTIONS.filter((option) => option.mode !== "FOR")
    : OPTIONS;
  return (
    <div
      role="radiogroup"
      aria-label={t("partnerMode.ariaLabel")}
      className="flex gap-2 bg-slate-800 border border-slate-700/50 p-1 rounded-xl h-11"
    >
      {options.map((option) => {
        const active = option.mode === value;
        return (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={option.testId}
            onClick={() => {
              if (!active) onChange(option.mode);
            }}
            className={`flex-1 h-full py-1.5 px-3 rounded-lg font-semibold text-sm whitespace-nowrap transition-all ${
              active
                ? "bg-teal-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white hover:bg-slate-700/60"
            }`}
          >
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
