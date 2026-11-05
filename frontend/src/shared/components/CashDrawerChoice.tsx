/**
 * LIRA-371 — "OMT Cash Drawer | General" (Whish on a Whish shop): where the
 * cash of this payment goes (IN) or comes from (OUT). Two pills styled
 * exactly like the payment box's Split pill (one class definition,
 * `splitPillClassName`). The value is component state of the screen that
 * renders it, reset to SYSTEM each time that screen opens.
 */
import { useTranslation } from "react-i18next";
import { splitPillClassName } from "@liratek/ui/components/ui/SplitToggle";

export type CashDrawerChoiceValue = "SYSTEM" | "GENERAL";

export interface CashDrawerChoiceProps {
  value: CashDrawerChoiceValue;
  onChange: (value: CashDrawerChoiceValue) => void;
  systemDrawer: "OMT_System" | "Whish_System";
  direction: "IN" | "OUT";
}

export function CashDrawerChoice({
  value,
  onChange,
  systemDrawer,
  direction,
}: CashDrawerChoiceProps) {
  const { t } = useTranslation("payment");
  const options: Array<{ v: CashDrawerChoiceValue; label: string }> = [
    {
      v: "SYSTEM",
      label:
        systemDrawer === "Whish_System"
          ? t("cashDrawerChoice.whish")
          : t("cashDrawerChoice.omt"),
    },
    { v: "GENERAL", label: t("cashDrawerChoice.general") },
  ];
  return (
    <div
      data-testid="cash-drawer-choice"
      className="flex flex-wrap items-center gap-2"
      role="group"
    >
      <span className="text-xs text-slate-400">
        {direction === "OUT"
          ? t("cashDrawerChoice.comesFrom")
          : t("cashDrawerChoice.goesTo")}
      </span>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          data-testid={
            o.v === "SYSTEM"
              ? "cash-drawer-choice-system"
              : "cash-drawer-choice-general"
          }
          aria-pressed={value === o.v}
          onClick={() => onChange(o.v)}
          className={splitPillClassName(value === o.v)}
        >
          {value === o.v && (
            // The picked drawer carries a tick, so the choice reads at a
            // glance in every theme (colour alone is too subtle here).
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              aria-hidden="true"
            >
              <path d="M5 12l5 5L20 7" />
            </svg>
          )}
          {o.label}
        </button>
      ))}
    </div>
  );
}
