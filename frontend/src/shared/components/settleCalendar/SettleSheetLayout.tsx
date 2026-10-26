/**
 * The settle sheet's box, able to widen to the right for the "See
 * transactions" table (owner mock 2026-10-26, omt-settle-by-day §7).
 *
 * - Closed: exactly the sheet as before (`max-w-2xl`, its own scroll).
 * - Open (≥ 900px): the box grows to the right (max-width and the second
 *   grid column animate; `motion-reduce` turns the motion off) and the panel
 *   shows beside the sheet. The sheet column keeps its width, so the
 *   calendar and the payment do not reflow.
 * - Open (< 900px): the panel replaces the sheet content as a full panel;
 *   the sheet stays MOUNTED (only hidden), so picks and typed payments are
 *   kept when the panel closes.
 * - The panel region (`panelId`, for the button's `aria-controls`) is always
 *   in the DOM; while closed it is empty and `inert`.
 *
 * Generic: the caller passes its own sheet as `children` and the panel
 * (usually `SettleTransactionsPanel`) as `panel`.
 */
import type { MouseEventHandler, ReactNode } from "react";

export interface SettleSheetLayoutProps {
  open: boolean;
  panelId: string;
  /** Rendered only while open. */
  panel: ReactNode;
  children: ReactNode;
  /** Passed to the box (the sheets stop the overlay's close there). */
  onMouseDown?: MouseEventHandler<HTMLDivElement> | undefined;
  role?: string | undefined;
  "aria-modal"?: boolean | undefined;
  "aria-label"?: string | undefined;
  /** Padding etc. of the sheet column; default `p-6`. */
  mainClassName?: string | undefined;
}

const EASE = "ease-[cubic-bezier(.2,.8,.2,1)]";

export function SettleSheetLayout({
  open,
  panelId,
  panel,
  children,
  onMouseDown,
  role = "presentation",
  "aria-modal": ariaModal,
  "aria-label": ariaLabel,
  mainClassName = "p-6",
}: SettleSheetLayoutProps) {
  return (
    <div
      data-testid="settle-sheet-layout"
      data-open={open ? "true" : "false"}
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl transition-[max-width] duration-[350ms] ${EASE} motion-reduce:transition-none ${
        open ? "max-w-2xl min-[900px]:max-w-[1240px]" : "max-w-2xl"
      }`}
    >
      <div
        className={`grid min-h-0 flex-1 grid-rows-1 transition-[grid-template-columns] duration-[350ms] ${EASE} motion-reduce:transition-none ${
          open
            ? "grid-cols-1 min-[900px]:grid-cols-[minmax(0,42rem)_minmax(0,1fr)]"
            : "grid-cols-[minmax(0,42rem)_0fr]"
        }`}
      >
        <div
          className={`min-h-0 min-w-0 overflow-y-auto ${mainClassName} ${open ? "max-[899px]:hidden" : ""}`}
        >
          {children}
        </div>
        <div
          id={panelId}
          inert={!open}
          className={`min-h-0 min-w-0 overflow-hidden transition-opacity duration-[250ms] delay-100 motion-reduce:transition-none ${
            open
              ? "border-slate-700 opacity-100 min-[900px]:border-s"
              : "pointer-events-none opacity-0 max-[899px]:hidden"
          }`}
        >
          {open ? panel : null}
        </div>
      </div>
    </div>
  );
}
