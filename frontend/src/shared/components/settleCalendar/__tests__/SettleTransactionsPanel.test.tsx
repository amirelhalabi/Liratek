/**
 * "See transactions" (owner mock 2026-10-26, section 7): the generic table of
 * the picked days' transactions, the calendar's "See transactions (N)" pill
 * and the widening sheet layout.
 *
 * Failing-first: written before SettleTransactionsPanel / SettleSheetLayout
 * existed; the first run must fail with "Cannot find module
 * '../SettleTransactionsPanel'".
 *
 * Plain props, no useApi, so there is nothing to mock for rule 25.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { SettleTransactionsPanel } from "../SettleTransactionsPanel";
import {
  countOpenSettleTransactions,
  type SettleTransactionRow,
} from "../settleTransactions";
import { SettleSheetLayout } from "../SettleSheetLayout";
import { SettleCalendar } from "../SettleCalendar";

function row(
  partial: Partial<SettleTransactionRow> & { key: string; id: number; day: string },
): SettleTransactionRow {
  return {
    label: "SEND",
    memberTag: "OMT",
    nameRef: null,
    amount_usd: 0,
    amount_lbp: 0,
    left_usd: 0,
    left_lbp: 0,
    status: "open",
    checked: true,
    ...partial,
  };
}

const ROWS: SettleTransactionRow[] = [
  // 21 Oct: one paid, one part paid.
  row({ key: "FINANCIAL_SERVICE:402", id: 402, day: "2026-10-21", nameRef: "Nour A. · ref OMT-77610", amount_usd: 180, status: "paid", checked: false }),
  row({ key: "FINANCIAL_SERVICE:404", id: 404, day: "2026-10-21", label: "CASH_OUT", memberTag: "OMT App", nameRef: "70 123 456", amount_usd: 97, left_usd: 47 }),
  // 22 Oct: an LBP bill and a USD send.
  row({ key: "FINANCIAL_SERVICE:418", id: 418, day: "2026-10-22", label: "BILL", nameRef: "ref OMT-77730", amount_lbp: 900000, left_lbp: 900000 }),
  row({ key: "FINANCIAL_SERVICE:421", id: 421, day: "2026-10-22", nameRef: "Rami K.", amount_usd: 120, left_usd: 120 }),
  // 24 Oct: not picked in most tests.
  row({ key: "FINANCIAL_SERVICE:427", id: 427, day: "2026-10-24", memberTag: "iPick", amount_usd: 95, left_usd: 95 }),
];

const dayLabel = (d: string) => `${Number(d.slice(8))} Oct`;

function renderPanel(over: Partial<Parameters<typeof SettleTransactionsPanel>[0]> = {}) {
  const onToggleRow = jest.fn();
  const onClose = jest.fn();
  const utils = render(
    <SettleTransactionsPanel
      rows={ROWS}
      pickedDays={new Set(["2026-10-21", "2026-10-22"])}
      dayLabel={dayLabel}
      onToggleRow={onToggleRow}
      onClose={onClose}
      {...over}
    />,
  );
  return { ...utils, onToggleRow, onClose };
}

describe("SettleTransactionsPanel", () => {
  it("lists only the picked days, grouped under a day row with its subtotal per currency", () => {
    renderPanel();
    const table = screen.getByRole("table");
    const day21 = within(table).getByTestId("settle-tx-day-2026-10-21");
    expect(day21).toHaveTextContent("21 Oct");
    // Only the ticked open row counts: $47 left (the paid #402 adds nothing).
    expect(day21).toHaveTextContent("$47.00");
    const day22 = within(table).getByTestId("settle-tx-day-2026-10-22");
    expect(day22).toHaveTextContent("$120.00");
    expect(day22).toHaveTextContent("900,000 LBP");
    // 24 Oct is not picked.
    expect(within(table).queryByText("#427")).not.toBeInTheDocument();
    expect(within(table).queryByTestId("settle-tx-day-2026-10-24")).not.toBeInTheDocument();
  });

  it("shows the columns of the mock: tick, #, transaction, part, name / ref, amount, left", () => {
    renderPanel();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["", "#", "Transaction", "Part", "Name / ref", "Amount", "Left"]);
    const r404 = screen.getByTestId("settle-tx-row-FINANCIAL_SERVICE:404");
    expect(r404).toHaveTextContent("#404");
    expect(r404).toHaveTextContent("CASH_OUT");
    expect(within(r404).getByText("OMT App")).toBeInTheDocument();
    expect(r404).toHaveTextContent("70 123 456");
    expect(r404).toHaveTextContent("$97.00");
    expect(r404).toHaveTextContent("$47.00");
  });

  it("greys a paid row: disabled tick and 'paid' in the left column", () => {
    renderPanel();
    const r402 = screen.getByTestId("settle-tx-row-FINANCIAL_SERVICE:402");
    const box = within(r402).getByRole("checkbox");
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(r402).toHaveTextContent("paid");
  });

  it("unticking an open row reports its key; an unticked row reads 'unticked' and leaves the subtotal", () => {
    const { onToggleRow, rerender } = renderPanel();
    fireEvent.click(within(screen.getByTestId("settle-tx-row-FINANCIAL_SERVICE:421")).getByRole("checkbox"));
    expect(onToggleRow).toHaveBeenCalledWith("FINANCIAL_SERVICE:421");

    // The caller (the sheet) owns the state: it re-renders with checked=false.
    const next = ROWS.map((r) => (r.id === 421 ? { ...r, checked: false } : r));
    rerender(
      <SettleTransactionsPanel
        rows={next}
        pickedDays={new Set(["2026-10-21", "2026-10-22"])}
        dayLabel={dayLabel}
        onToggleRow={onToggleRow}
        onClose={jest.fn()}
      />,
    );
    const r421 = screen.getByTestId("settle-tx-row-FINANCIAL_SERVICE:421");
    expect(within(r421).getByRole("checkbox")).not.toBeChecked();
    expect(r421).toHaveTextContent("unticked");
    const day22 = screen.getByTestId("settle-tx-day-2026-10-22");
    expect(day22).not.toHaveTextContent("$120.00");
    expect(day22).toHaveTextContent("900,000 LBP");
  });

  it("a waiting row has no tick and says why", () => {
    renderPanel({
      rows: ROWS.map((r) =>
        r.id === 421 ? { ...r, status: "waiting" as const, checked: false } : r,
      ),
    });
    const r421 = screen.getByTestId("settle-tx-row-FINANCIAL_SERVICE:421");
    expect(within(r421).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(r421).toHaveTextContent("Waiting for its statement type");
  });

  it("search filters by reference, name or #id", () => {
    renderPanel();
    const search = screen.getByRole("searchbox", { name: "Search reference or name" });
    fireEvent.change(search, { target: { value: "77730" } });
    expect(screen.getByTestId("settle-tx-row-FINANCIAL_SERVICE:418")).toBeInTheDocument();
    expect(screen.queryByTestId("settle-tx-row-FINANCIAL_SERVICE:421")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "#404" } });
    expect(screen.getByTestId("settle-tx-row-FINANCIAL_SERVICE:404")).toBeInTheDocument();
    expect(screen.queryByTestId("settle-tx-row-FINANCIAL_SERVICE:418")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No transactions match.")).toBeInTheDocument();
  });

  it("× closes", () => {
    const { onClose } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close transactions" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says when no day is picked", () => {
    renderPanel({ pickedDays: new Set() });
    expect(screen.getByText("Pick days on the calendar to see their transactions.")).toBeInTheDocument();
  });

  it("scrolls ONLY its own table box to a picked day (never scrollIntoView, which would move the sheet)", () => {
    const intoView = jest.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { value: intoView, configurable: true });
    const { rerender } = renderPanel();
    const box = screen.getByTestId("settle-tx-scroll");
    const setTop = jest.fn();
    Object.defineProperty(box, "scrollTop", { get: () => 0, set: setTop, configurable: true });
    rerender(
      <SettleTransactionsPanel
        rows={ROWS}
        pickedDays={new Set(["2026-10-21", "2026-10-22"])}
        dayLabel={dayLabel}
        onClose={jest.fn()}
        scrollToDay={{ day: "2026-10-22", seq: 1 }}
      />,
    );
    expect(setTop).toHaveBeenCalledTimes(1);
    expect(intoView).not.toHaveBeenCalled();
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });
});

describe("countOpenSettleTransactions", () => {
  it("counts open rows (unticked included, paid left out) on the picked days only", () => {
    const rows = ROWS.map((r) => (r.id === 421 ? { ...r, checked: false } : r));
    expect(countOpenSettleTransactions(rows, new Set(["2026-10-21", "2026-10-22"]))).toBe(3);
    expect(countOpenSettleTransactions(rows, new Set(["2026-10-24"]))).toBe(1);
  });
});

describe("SettleCalendar 'See transactions' pill", () => {
  const base = {
    month: "2026-10",
    days: [],
    today: "2026-10-26",
    picked: new Set<string>(),
    onToggleDay: jest.fn(),
    onOpenDay: jest.fn(),
    monthLeft: { usd: 482, lbp: 1_890_000 },
  };

  it("is not shown unless the caller asks for it", () => {
    render(<SettleCalendar {...base} />);
    expect(screen.queryByRole("button", { name: /See transactions/ })).not.toBeInTheDocument();
  });

  it("sits under the month line with the count, aria-expanded / aria-controls, and toggles its label", () => {
    const onToggle = jest.fn();
    const { rerender } = render(
      <SettleCalendar
        {...base}
        seeTransactions={{ count: 5, expanded: false, controlsId: "tx-panel", onToggle }}
      />,
    );
    const btn = screen.getByRole("button", { name: /See transactions/ });
    expect(btn).toHaveTextContent("5");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveAttribute("aria-controls", "tx-panel");
    // Directly under "… left this month".
    expect(screen.getByTestId("settle-month-left").nextElementSibling).toContainElement(btn);
    fireEvent.click(btn);
    expect(onToggle).toHaveBeenCalled();

    rerender(
      <SettleCalendar
        {...base}
        seeTransactions={{ count: 5, expanded: true, controlsId: "tx-panel", onToggle }}
      />,
    );
    const open = screen.getByRole("button", { name: /Hide transactions/ });
    expect(open).toHaveAttribute("aria-expanded", "true");
  });
});

describe("SettleSheetLayout", () => {
  it("keeps the sheet mounted, and shows the panel region only when open (inert when closed)", () => {
    const { rerender } = render(
      <SettleSheetLayout open={false} panelId="tx-panel" panel={<p>table</p>}>
        <p>sheet</p>
      </SettleSheetLayout>,
    );
    expect(screen.getByText("sheet")).toBeInTheDocument();
    expect(screen.queryByText("table")).not.toBeInTheDocument();
    const region = document.getElementById("tx-panel");
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute("inert");

    rerender(
      <SettleSheetLayout open panelId="tx-panel" panel={<p>table</p>}>
        <p>sheet</p>
      </SettleSheetLayout>,
    );
    expect(screen.getByText("sheet")).toBeInTheDocument();
    expect(screen.getByText("table")).toBeInTheDocument();
    expect(document.getElementById("tx-panel")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("settle-sheet-layout")).toHaveAttribute("data-open", "true");
  });
});
