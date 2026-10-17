/**
 * The "Split" / "Split Active" pill used in a payment box header. Shared by
 * the main ("Shop pays" / "Payment") header and the "Customer pays" section
 * (LIRA-321), so both sections look and behave the same: grey "↗ Split" when
 * off, violet "Split Active" when on.
 */
import { useTranslation } from "react-i18next";

export interface SplitToggleProps {
  active: boolean;
  onClick: () => void;
  testId: string;
  disabled?: boolean;
}

export function SplitToggle({
  active,
  onClick,
  testId,
  disabled = false,
}: SplitToggleProps) {
  const { t } = useTranslation("ui");
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-all ${
        active
          ? "bg-violet-500/20 text-violet-300 border border-violet-500/40"
          : "bg-slate-800 text-slate-400 border border-slate-600 hover:text-slate-200 hover:border-slate-500"
      }`}
    >
      {active ? (
        <>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
          </svg>
          {t("splitToggle.active")}
        </>
      ) : (
        <>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M16 3h5v5M4 20L21 3" />
          </svg>
          {t("splitToggle.off")}
        </>
      )}
    </button>
  );
}
