/**
 * LIRA-343: one day of the settle calendar (owner's mock "calendar v3 +
 * compact rows + selection v2 + option D badges").
 *
 * - SETTLED: soft filled green circle, day number and a small ✓, no amount.
 * - One-currency open day: a ring, green for the paid share, red for the rest,
 *   with a small % inside when part paid.
 * - Two-currency open day: a ring showing the day's state only (red unpaid,
 *   amber partly paid) plus "$" (bottom start) and "L" (bottom end) badges,
 *   each coloured by its own currency (OWED red, PART amber, PAID green).
 * - Under an open circle: one line per open currency ("$200", "990k LBP").
 * - NONE and future days: a faint number, disabled.
 * - Top-end badge: picked ✓ > left-out "!" > "+" on hover/focus. A picked
 *   day with some transfers left out of it (`partlyPicked`) shows a
 *   half-filled badge instead of the ✓ and says "partly picked".
 * - Top-start badge: ↺ when an undo / void moved an amount to the account
 *   that day, with a hover / focus tooltip naming each amount and its origin.
 *
 * Clicking an enabled day always calls `onOpen`; a selectable day also calls
 * `onToggle` (as the mock: focus the day, and pick / unpick it when open).
 */
import { useId, type CSSProperties, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { SettleAccountMark, SettleCurrencyState, SettleDay, SettleFormatters } from "./types";

const EMERALD = "#10b981";
const ROSE = "rgba(251,113,133,.92)";
const AMBER = "#fbbf24";
const RING_MASK = "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3.5px))";

function ringStyle(background: string): CSSProperties {
  return { background, WebkitMask: RING_MASK, mask: RING_MASK };
}

function toPct(fraction: number): number {
  return Math.round(Math.min(1, Math.max(0, fraction)) * 100);
}

const BADGE_CLASS: Record<SettleCurrencyState, string> = {
  OWED: "bg-rose-400",
  PART: "bg-amber-400",
  PAID: "bg-emerald-500",
};

const CORNER =
  "absolute grid place-items-center size-[15px] rounded-full text-[9px] leading-none font-extrabold shadow-[0_0_0_2px_#0f172a] z-[3]";

export interface DayCircleProps {
  /** The day's data; a day with no rows is passed as state NONE. */
  day: SettleDay;
  dayNumber: number;
  /** Full date for screen readers, e.g. "21 October". */
  dateLabel: string;
  isToday: boolean;
  isFuture: boolean;
  picked: boolean;
  /** Picked, but some of the day's transfers are left out. Ignored when not
   *  picked. */
  partlyPicked?: boolean | undefined;
  leftOut: boolean;
  focused?: boolean | undefined;
  formatters: SettleFormatters;
  formatMark?: ((mark: SettleAccountMark) => string) | undefined;
  onOpen: (day: string) => void;
  onToggle: (day: string) => void;
}

export function DayCircle({
  day,
  dayNumber,
  dateLabel,
  isToday,
  isFuture,
  picked,
  partlyPicked = false,
  leftOut,
  focused = false,
  formatters,
  formatMark,
  onOpen,
  onToggle,
}: DayCircleProps) {
  const { t } = useTranslation("suppliers");
  const tooltipId = useId();

  const state = day.state;
  const isOpen = !isFuture && (state === "UNPAID" || state === "PARTIAL");
  const isSettled = !isFuture && state === "SETTLED";
  const enabled = !isFuture && state !== "NONE";
  const pickable = enabled && day.selectable;

  const pu = day.paid_pct_usd;
  const pl = day.paid_pct_lbp;
  const twoCurrency = pu !== null && pl !== null;

  // ---- amounts under the circle -----------------------------------------
  const showUsd = isOpen && Math.abs(day.left_usd) >= 0.005;
  const showLbp = isOpen && Math.abs(day.left_lbp) >= 0.5;

  // ---- ring ---------------------------------------------------------------
  let ring: ReactElement | null = null;
  let pctText: string | null = null;
  const pctTitles: string[] = [];
  if (isOpen) {
    if (twoCurrency) {
      ring = (
        <span
          data-ring="state"
          aria-hidden="true"
          className="absolute inset-0 rounded-full"
          style={ringStyle(state === "PARTIAL" ? AMBER : ROSE)}
        />
      );
      pctTitles.push(t("accountSettle.calendar.pctPaid", { currency: "$", pct: toPct(pu) }));
      pctTitles.push(
        t("accountSettle.calendar.pctPaid", { currency: t("accountSettle.calendar.lbp"), pct: toPct(pl) }),
      );
    } else if (pu !== null || pl !== null) {
      const pct = toPct((pu ?? pl) as number);
      ring = (
        <span
          data-ring="pct"
          aria-hidden="true"
          className="absolute inset-0 rounded-full"
          style={ringStyle(`conic-gradient(from 0deg, ${EMERALD} 0 ${pct}%, ${ROSE} ${pct}% 100%)`)}
        />
      );
      if (state === "PARTIAL" && pct > 0 && pct < 100) pctText = `${pct}%`;
      pctTitles.push(
        t("accountSettle.calendar.pctPaid", {
          currency: pu !== null ? "$" : t("accountSettle.calendar.lbp"),
          pct,
        }),
      );
    } else {
      // open but no debt in either currency (a credit-only day): state ring only
      ring = (
        <span
          data-ring="state"
          aria-hidden="true"
          className="absolute inset-0 rounded-full"
          style={ringStyle(state === "PARTIAL" ? AMBER : ROSE)}
        />
      );
    }
  }

  // ---- accessible label ---------------------------------------------------
  const stateWord = isFuture
    ? t("accountSettle.calendar.stateFuture")
    : state === "SETTLED"
      ? t("accountSettle.calendar.stateSettled")
      : state === "PARTIAL"
        ? t("accountSettle.calendar.statePartial")
        : state === "UNPAID"
          ? t("accountSettle.calendar.stateUnpaid")
          : t("accountSettle.calendar.stateNone");
  const leftParts: string[] = [];
  if (showUsd) leftParts.push(formatters.formatUsd(day.left_usd));
  if (showLbp) leftParts.push(formatters.formatLbp(day.left_lbp));
  const baseAriaLabel = leftParts.length
    ? t("accountSettle.calendar.dayAriaLeft", {
        date: dateLabel,
        state: stateWord,
        amounts: leftParts.join(" + "),
      })
    : t("accountSettle.calendar.dayAria", { date: dateLabel, state: stateWord });
  const isPartlyPicked = picked && partlyPicked;
  const ariaLabel = isPartlyPicked
    ? t("accountSettle.calendar.dayAriaPartlyPicked", { label: baseAriaLabel })
    : baseAriaLabel;

  // ---- account marks (↺) --------------------------------------------------
  const marks = day.account_marks;
  const markText = (m: SettleAccountMark): string => {
    if (formatMark) return formatMark(m);
    const amount =
      m.currency === "USD" ? formatters.formatUsd(Math.abs(m.amount)) : formatters.formatLbp(Math.abs(m.amount));
    const ref = m.ref.startsWith("#") ? m.ref : `#${m.ref}`;
    return m.origin === "UNDO"
      ? t("accountSettle.calendar.markOwed", { amount, ref })
      : t("accountSettle.calendar.markCredit", { amount, ref });
  };

  // ---- top-end corner -----------------------------------------------------
  let corner: ReactElement | null = null;
  if (isPartlyPicked) {
    // Half white (the picked ✓ colour), half dark: picked, but not all of it.
    corner = (
      <span
        data-corner="partlyPicked"
        aria-hidden="true"
        className={`${CORNER} -top-[3px] -end-[3px] border-[1.5px] border-slate-100 bg-slate-900`}
      >
        <span className="absolute inset-y-0 start-0 w-1/2 rounded-s-full bg-slate-100" />
      </span>
    );
  } else if (picked) {
    corner = (
      <span
        data-corner="picked"
        aria-hidden="true"
        className={`${CORNER} -top-[3px] -end-[3px] bg-slate-100 text-slate-900`}
      >
        ✓
      </span>
    );
  } else if (leftOut && isOpen) {
    corner = (
      <span
        data-corner="leftOut"
        aria-hidden="true"
        className={`${CORNER} -top-[3px] -end-[3px] bg-amber-400 text-slate-950`}
      >
        !
      </span>
    );
  } else if (pickable) {
    corner = (
      <span
        data-corner="add"
        aria-hidden="true"
        className={`${CORNER} -top-[3px] -end-[3px] hidden group-hover:grid group-focus-visible:grid bg-slate-700 text-white text-[12px]`}
      >
        +
      </span>
    );
  }

  // ---- disc colours -------------------------------------------------------
  let discClass = "";
  let numberClass = "";
  if (isFuture) {
    numberClass = "text-slate-700 font-medium";
  } else if (state === "NONE") {
    numberClass = "text-slate-600 font-medium";
  } else if (isSettled) {
    discClass = "bg-emerald-500/[.13] group-hover:bg-emerald-500/25";
    numberClass = "text-emerald-300 font-semibold";
  } else {
    discClass = "bg-slate-950";
    numberClass = "text-white font-bold";
  }

  const handleClick = () => {
    if (!enabled) return;
    onOpen(day.day);
    if (pickable) onToggle(day.day);
  };

  return (
    <button
      type="button"
      disabled={!enabled}
      aria-pressed={pickable ? picked : undefined}
      aria-label={ariaLabel}
      aria-describedby={marks.length ? tooltipId : undefined}
      title={pctTitles.length ? pctTitles.join(" · ") : undefined}
      onClick={handleClick}
      className="group relative z-[1] flex w-full flex-col items-center gap-0.5 rounded-lg border-0 bg-transparent pt-[3px] pb-px disabled:cursor-default enabled:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
    >
      <span
        className={`relative grid size-[42px] place-items-center rounded-full motion-safe:transition-[transform,background-color] motion-safe:duration-150 ${enabled ? "motion-safe:group-hover:scale-[1.06]" : ""} ${discClass}`}
        style={focused ? { boxShadow: "0 0 0 2px #0f172a, 0 0 0 3.5px #94a3b8" } : undefined}
      >
        {isToday && (
          <span
            data-today-dot
            aria-hidden="true"
            className="absolute inset-x-0 -top-[5px] mx-auto size-[5px] rounded-full bg-emerald-500 shadow-[0_0_0_2px_#0f172a]"
          />
        )}
        {ring}
        <span className="relative flex flex-col items-center gap-0.5 leading-none" aria-hidden="true">
          <span className={`text-[13px] tabular-nums ${numberClass}`}>{dayNumber}</span>
          {isSettled && (
            <svg
              data-settled-check
              viewBox="0 0 12 12"
              className="size-2.5 fill-none stroke-emerald-500 [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:3]"
            >
              <path d="M2.5 6.3l2.3 2.3 4.7-5" />
            </svg>
          )}
          {pctText && <span className="font-mono text-[8.5px] font-semibold text-amber-400">{pctText}</span>}
        </span>
        {isOpen && twoCurrency && day.currency_state_usd && (
          <span
            data-badge="USD"
            data-state={day.currency_state_usd}
            aria-hidden="true"
            className={`absolute -bottom-[3px] -start-[4px] z-[2] grid size-[14px] place-items-center rounded-full text-[8px] font-extrabold leading-none text-slate-950 shadow-[0_0_0_2px_#0f172a] ${BADGE_CLASS[day.currency_state_usd]}`}
          >
            {t("accountSettle.calendar.badgeUsd")}
          </span>
        )}
        {isOpen && twoCurrency && day.currency_state_lbp && (
          <span
            data-badge="LBP"
            data-state={day.currency_state_lbp}
            aria-hidden="true"
            className={`absolute -bottom-[3px] -end-[4px] z-[2] grid size-[14px] place-items-center rounded-full text-[8px] font-extrabold leading-none text-slate-950 shadow-[0_0_0_2px_#0f172a] ${BADGE_CLASS[day.currency_state_lbp]}`}
          >
            {t("accountSettle.calendar.badgeLbp")}
          </span>
        )}
        {corner}
        {marks.length > 0 && (
          <>
            <span
              data-account-mark
              aria-hidden="true"
              className={`${CORNER} -top-[3px] -start-[3px] bg-indigo-400 text-slate-950 text-[10px]`}
            >
              ↺
            </span>
            <span
              id={tooltipId}
              role="tooltip"
              className="pointer-events-none absolute bottom-full start-0 z-20 mb-2 hidden w-max max-w-[220px] flex-col gap-0.5 rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-start text-[11px] font-medium leading-snug whitespace-normal text-slate-200 shadow-lg group-hover:flex group-focus-visible:flex"
            >
              {marks.map((m, i) => (
                <span key={`${m.origin}-${m.ref}-${m.currency}-${i}`} className="block">
                  {markText(m)}
                </span>
              ))}
            </span>
          </>
        )}
      </span>

      {(isToday || showUsd || showLbp) && (
        <span className="flex flex-col items-center gap-px text-[10px] leading-[1.1] font-semibold tabular-nums whitespace-nowrap">
          {isToday && (
            <span className="text-[9px] font-bold tracking-wider text-emerald-500 uppercase">
              {t("accountSettle.calendar.today")}
            </span>
          )}
          {(showUsd || showLbp) && (
            <span data-amounts className={`flex flex-col items-center gap-px ${picked ? "text-white" : "text-slate-400"}`}>
              {showUsd && <span>{formatters.formatUsdShort(day.left_usd)}</span>}
              {showLbp && (
                <span>
                  {formatters.formatLbpShort(day.left_lbp)}{" "}
                  <i className="ms-px text-[8px] font-bold tracking-wide text-slate-400 not-italic">
                    {t("accountSettle.calendar.lbp")}
                  </i>
                </span>
              )}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
