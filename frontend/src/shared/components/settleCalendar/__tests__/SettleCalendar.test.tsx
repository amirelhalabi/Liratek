/**
 * LIRA-343 T017 — the generic settle calendar (spec FR-001..FR-006, FR-014,
 * FR-016b; owner's mock "calendar v3 + compact rows + selection v2 + option D").
 *
 * Failing-first: written before SettleCalendar existed; the first run failed
 * with "Cannot find module '../SettleCalendar'".
 *
 * The component takes plain props (no useApi), so the rule-25 stable-mock
 * requirement has nothing to mock here. Hover "+" and equal row heights are
 * CSS-only and are not observable in jsdom.
 */
import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SettleCalendar } from "../SettleCalendar";
import type { SettleDay } from "../types";

function day(partial: Partial<SettleDay> & { day: string }): SettleDay {
  return {
    state: "NONE",
    left_usd: 0,
    left_lbp: 0,
    owed_usd: 0,
    owed_lbp: 0,
    paid_pct_usd: null,
    paid_pct_lbp: null,
    currency_state_usd: null,
    currency_state_lbp: null,
    selectable: false,
    waiting_count: 0,
    account_marks: [],
    ...partial,
  };
}

// October 2026 as in the owner's mock; today is Monday 26 October.
const DAYS: SettleDay[] = [
  day({
    day: "2026-10-05",
    state: "SETTLED",
    owed_usd: 120,
    paid_pct_usd: 1,
    currency_state_usd: "PAID",
  }),
  // one currency, part paid: $277 owed, $230 paid, $47 left (83%)
  day({
    day: "2026-10-21",
    state: "PARTIAL",
    left_usd: 47,
    owed_usd: 277,
    paid_pct_usd: 230 / 277,
    currency_state_usd: "PART",
    selectable: true,
  }),
  // two currencies: $ fully paid, 900,000 LBP untouched
  day({
    day: "2026-10-22",
    state: "PARTIAL",
    left_lbp: 900000,
    owed_usd: 310,
    owed_lbp: 900000,
    paid_pct_usd: 1,
    paid_pct_lbp: 0,
    currency_state_usd: "PAID",
    currency_state_lbp: "OWED",
    selectable: true,
  }),
  day({
    day: "2026-10-23",
    state: "UNPAID",
    left_usd: 120,
    owed_usd: 120,
    paid_pct_usd: 0,
    currency_state_usd: "OWED",
    selectable: true,
    account_marks: [{ origin: "UNDO", ref: "A", currency: "USD", amount: 8.7 }],
  }),
  day({
    day: "2026-10-24",
    state: "UNPAID",
    left_usd: 55,
    owed_usd: 95,
    paid_pct_usd: 0,
    currency_state_usd: "OWED",
    selectable: true,
    account_marks: [{ origin: "VOID", ref: "440", currency: "USD", amount: -35 }],
  }),
  day({
    day: "2026-10-26",
    state: "UNPAID",
    left_usd: 60,
    owed_usd: 60,
    paid_pct_usd: 0,
    currency_state_usd: "OWED",
    selectable: true,
  }),
  // has activity but is in the future: still faint and not pickable
  day({
    day: "2026-10-28",
    state: "UNPAID",
    left_usd: 10,
    owed_usd: 10,
    paid_pct_usd: 0,
    currency_state_usd: "OWED",
    selectable: false,
  }),
];

function renderCal(overrides: Partial<ComponentProps<typeof SettleCalendar>> = {}) {
  const onToggleDay = jest.fn();
  const onOpenDay = jest.fn();
  const utils = render(
    <SettleCalendar
      month="2026-10"
      days={DAYS}
      today="2026-10-26"
      picked={new Set(["2026-10-22", "2026-10-23"])}
      onToggleDay={onToggleDay}
      onOpenDay={onOpenDay}
      monthLeft={{ usd: 482, lbp: 1890000 }}
      {...overrides}
    />,
  );
  const cell = (d: string) => utils.container.querySelector(`[data-day="${d}"]`) as HTMLElement;
  const btn = (d: string) => within(cell(d)).getAllByRole("button")[0] as HTMLButtonElement;
  return { ...utils, onToggleDay, onOpenDay, cell, btn };
}

describe("SettleCalendar (LIRA-343)", () => {
  it("renders every day of the month as a circle, Monday first", () => {
    const { container } = renderCal();
    expect(container.querySelectorAll("[data-day]")).toHaveLength(31);
    // 1 Oct 2026 is a Thursday: three blank slots before it (Mon-Wed).
    const first = container.querySelector('[data-day="2026-10-01"]') as HTMLElement;
    const before: Element[] = [];
    let el = first.previousElementSibling;
    while (el && el.hasAttribute("data-blank")) {
      before.push(el);
      el = el.previousElementSibling;
    }
    expect(before).toHaveLength(3);
  });

  it("settled day: ✓ inside the circle and no amount under it", () => {
    const { cell } = renderCal();
    const c = cell("2026-10-05");
    expect(c.querySelector("[data-settled-check]")).not.toBeNull();
    expect(c.querySelector("[data-amounts]")).toBeNull();
  });

  it("one-currency part-paid day: a % ring and $47 under it", () => {
    const { cell } = renderCal();
    const c = cell("2026-10-21");
    expect(c.querySelector('[data-ring="pct"]')).not.toBeNull();
    expect(c.querySelector("[data-amounts]")).toHaveTextContent("$47");
    expect(c.querySelector("[data-amounts]")).not.toHaveTextContent("$47.00");
    expect(c).toHaveTextContent("83%");
  });

  it("two-currency day: state ring with $ PAID and L OWED badges, 900k LBP", () => {
    const { cell } = renderCal();
    const c = cell("2026-10-22");
    expect(c.querySelector('[data-ring="state"]')).not.toBeNull();
    const usd = c.querySelector('[data-badge="USD"]');
    const lbp = c.querySelector('[data-badge="LBP"]');
    expect(usd).toHaveTextContent("$");
    expect(usd).toHaveAttribute("data-state", "PAID");
    expect(lbp).toHaveTextContent("L");
    expect(lbp).toHaveAttribute("data-state", "OWED");
    const amounts = c.querySelector("[data-amounts]");
    expect(amounts).toHaveTextContent("900k LBP");
    // nothing left in $: no $ line
    expect(amounts).not.toHaveTextContent("$");
    // no % on a two-currency day
    expect(c).not.toHaveTextContent("%");
  });

  it("a day with no transactions is a faint number and not clickable", () => {
    const { btn, onToggleDay, onOpenDay } = renderCal();
    const b = btn("2026-10-14");
    expect(b).toBeDisabled();
    fireEvent.click(b);
    expect(onToggleDay).not.toHaveBeenCalled();
    expect(onOpenDay).not.toHaveBeenCalled();
  });

  it("a future day is not clickable even with activity", () => {
    const { btn, cell, onToggleDay, onOpenDay } = renderCal();
    const b = btn("2026-10-28");
    expect(b).toBeDisabled();
    expect(cell("2026-10-28").querySelector("[data-amounts]")).toBeNull();
    fireEvent.click(b);
    expect(onToggleDay).not.toHaveBeenCalled();
    expect(onOpenDay).not.toHaveBeenCalled();
  });

  it("clicking a selectable day toggles it (and opens it)", () => {
    const { btn, onToggleDay, onOpenDay } = renderCal();
    fireEvent.click(btn("2026-10-21"));
    expect(onToggleDay).toHaveBeenCalledWith("2026-10-21");
    expect(onOpenDay).toHaveBeenCalledWith("2026-10-21");
  });

  it("clicking a settled day only opens it", () => {
    const { btn, onToggleDay, onOpenDay } = renderCal();
    fireEvent.click(btn("2026-10-05"));
    expect(onOpenDay).toHaveBeenCalledWith("2026-10-05");
    expect(onToggleDay).not.toHaveBeenCalled();
  });

  it("picked days are aria-pressed with a ✓ badge; unpicked are not", () => {
    const { btn, cell } = renderCal();
    expect(btn("2026-10-22")).toHaveAttribute("aria-pressed", "true");
    expect(cell("2026-10-22").querySelector('[data-corner="picked"]')).not.toBeNull();
    expect(btn("2026-10-21")).toHaveAttribute("aria-pressed", "false");
    expect(cell("2026-10-21").querySelector('[data-corner="picked"]')).toBeNull();
    // the neutral band joins 22 and 23 (same week row)
    expect(cell("2026-10-22").querySelector('[data-band="start"]')).not.toBeNull();
    expect(cell("2026-10-23").querySelector('[data-band="end"]')).not.toBeNull();
  });

  it("a left-out day shows the amber ! badge", () => {
    const { cell } = renderCal({ leftOutDays: new Set(["2026-10-21"]) });
    const badge = cell("2026-10-21").querySelector('[data-corner="leftOut"]');
    expect(badge).toHaveTextContent("!");
  });

  it("today has the TODAY label and a dot", () => {
    const { cell } = renderCal();
    const c = cell("2026-10-26");
    expect(c.querySelector("[data-today-dot]")).not.toBeNull();
    expect(c).toHaveTextContent(/today/i);
  });

  it("account marks show ↺ with the origin wording in a tooltip", () => {
    const { cell, btn } = renderCal();
    const undo = cell("2026-10-23");
    expect(undo.querySelector("[data-account-mark]")).toHaveTextContent("↺");
    expect(within(undo).getByRole("tooltip")).toHaveTextContent(
      "Owed to OMT added: $8.70 (undo of #A)",
    );
    expect(btn("2026-10-23")).toHaveAccessibleDescription(/undo of #A/);
    const voided = cell("2026-10-24");
    expect(within(voided).getByRole("tooltip")).toHaveTextContent(
      "OMT credit added: $35.00 (void of #440)",
    );
    // no marks → no badge
    expect(cell("2026-10-21").querySelector("[data-account-mark]")).toBeNull();
  });

  it("legend and the month line sit under the grid", () => {
    renderCal();
    const legend = screen.getByTestId("settle-legend");
    expect(legend).toHaveTextContent("Settled");
    expect(legend).toHaveTextContent("Partly paid");
    expect(legend).toHaveTextContent("Unpaid");
    expect(screen.getByTestId("settle-month-left")).toHaveTextContent(
      "$482.00 + 1,890,000 LBP left this month",
    );
  });

  it("month line says nothing is left when both currencies are 0", () => {
    renderCal({ monthLeft: { usd: 0, lbp: 0 } });
    expect(screen.getByTestId("settle-month-left")).toHaveTextContent("Nothing left this month");
  });

  it("month arrows: disabled without a handler, call it when given", () => {
    const onPrevMonth = jest.fn();
    renderCal({ onPrevMonth });
    expect(screen.getByText("October 2026")).toBeInTheDocument();
    const prev = screen.getByRole("button", { name: "Previous month" });
    const next = screen.getByRole("button", { name: "Next month" });
    expect(next).toBeDisabled();
    fireEvent.click(prev);
    expect(onPrevMonth).toHaveBeenCalledTimes(1);
  });

  it("older unselected days: amber link that opens that month", () => {
    const onOpen = jest.fn();
    renderCal({ olderUnselected: { count: 1, monthLabel: "September", onOpen } });
    const link = screen.getByRole("button", { name: /1 unselected day in September/ });
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

/**
 * LIRA-343 follow-up — a picked day with some transfers unticked in its
 * details shows a half-filled badge instead of the white ✓, and says
 * "partly picked" to screen readers. Failing-first: written before the
 * `partlyPicked` prop existed.
 */
describe("SettleCalendar — partly picked (LIRA-343)", () => {
  it("a picked day in partlyPicked shows the half badge and says so", () => {
    const { cell, btn } = renderCal({ partlyPicked: new Set(["2026-10-22"]) });
    const c = cell("2026-10-22");
    expect(c.querySelector('[data-corner="partlyPicked"]')).not.toBeNull();
    expect(c.querySelector('[data-corner="picked"]')).toBeNull();
    expect(btn("2026-10-22")).toHaveAttribute("aria-pressed", "true");
    expect(btn("2026-10-22")).toHaveAccessibleName(/partly picked/);
    // a fully picked day keeps the white ✓
    expect(cell("2026-10-23").querySelector('[data-corner="picked"]')).not.toBeNull();
    expect(btn("2026-10-23")).not.toHaveAccessibleName(/partly picked/);
  });

  it("an unpicked day is never marked partly picked", () => {
    const { cell, btn } = renderCal({ partlyPicked: new Set(["2026-10-21"]) });
    expect(cell("2026-10-21").querySelector('[data-corner="partlyPicked"]')).toBeNull();
    expect(btn("2026-10-21")).not.toHaveAccessibleName(/partly picked/);
  });
});
