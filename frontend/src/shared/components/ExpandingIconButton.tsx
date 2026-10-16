import type { ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * A header action shown as just its icon; on hover or keyboard focus it widens
 * to the usual pill and reveals its label ("History", "Top-Up", …).
 *
 * The label is always in the DOM — only its width is collapsed — so the
 * accessible name, `getByText("History")` in tests and screen readers keep
 * working. `title` gives the mouse user a tooltip as well.
 */
export function ExpandingIconButton({
  icon: Icon,
  label,
  className = "",
  ...rest
}: {
  icon: LucideIcon;
  label: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`group h-12 min-w-12 px-3 inline-flex items-center justify-center rounded-lg font-medium text-sm bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white focus-visible:text-white transition-all duration-200 ${className}`}
      {...rest}
    >
      <Icon size={20} className="shrink-0" aria-hidden="true" />
      <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-200 group-hover:max-w-40 group-hover:ml-2 group-hover:opacity-100 group-focus-visible:max-w-40 group-focus-visible:ml-2 group-focus-visible:opacity-100">
        {label}
      </span>
    </button>
  );
}
