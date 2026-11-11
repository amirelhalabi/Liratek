/**
 * HistoryModal — 5 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 5).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { HistoryModal } from "../HistoryModal";
import {
  CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
  DRAWER_SHORTAGE_EXPENSE_CATEGORY,
} from "@liratek/core";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("HistoryModal.businessDayFilter (LIRA-185)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-185 expenses lead 3 — the History window's From/To filter must file
   * each expense under its BUSINESS (local) day, the day Profits and the
   * closing report count it on.
   *
   * A line-usage expense recorded at 01:30 LOCAL on 2026-09-05 can serialize to
   * a UTC instant that still reads as 2026-09-04 (e.g. 22:30Z in a UTC+3 zone).
   * The old filter cut the raw string (`slice(0, 10)`), which is always the
   * UTC day, so filtering From = 2026-09-05 could hide it.
   *
   * `process.env.TZ`, set after the jsdom environment and its Date/Intl
   * machinery are already initialized, is NOT honored by Node — so this file
   * must not hardcode Beirut clock strings and rely on a TZ assignment to make
   * them land correctly. Instead every fixture instant is built with the local
   * `Date(year, month, day, hour, minute)` constructor, which Node always
   * interprets in whatever timezone the test process actually started in
   * (CI's UTC, this machine's Beirut, or anything `TZ=<zone>` is run under).
   * `.toISOString()` then gives the correct corresponding UTC instant for
   * that zone, so the local-day boundary this test is about exists no matter
   * where it runs.
   */

  function row(id: number, description: string, expense_date: string) {
    return {
      id,
      description,
      category: "Line_Usage",
      amount_usd: 8,
      amount_lbp: 0,
      expense_date,
      is_refunded: 0,
    };
  }

  // Local-time instants (interpreted in the process's own timezone), each at
  // least an hour clear of local midnight so the assertions never depend on
  // which side of a DST/offset boundary the runner happens to sit.
  const LINE_USAGE_0130_LOCAL = new Date(2026, 8, 5, 1, 30, 0).toISOString();
  const MANUAL_ENTRY_NOON_LOCAL = new Date(2026, 8, 5, 12, 0, 0).toISOString();
  const PREVIOUS_EVENING_2300_LOCAL = new Date(
    2026,
    8,
    4,
    23,
    0,
    0,
  ).toISOString();

  function renderModal() {
    render(
      <HistoryModal
        expenses={[
          row(1, "line usage 01:30", LINE_USAGE_0130_LOCAL),
          row(2, "manual entry", MANUAL_ENTRY_NOON_LOCAL),
          row(3, "previous evening", PREVIOUS_EVENING_2300_LOCAL),
        ]}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
        onVoid={jest.fn()}
      />,
    );
  }

  describe("Expenses HistoryModal — date filter uses the business day", () => {
    it("From = To = 2026-09-05 keeps the 01:30 local line-usage row", () => {
      renderModal();
      fireEvent.change(screen.getByTestId("date-range-from"), {
        target: { value: "2026-09-05" },
      });
      fireEvent.change(screen.getByTestId("date-range-to"), {
        target: { value: "2026-09-05" },
      });
      expect(screen.getByText("line usage 01:30")).toBeInTheDocument();
      expect(screen.getByText("manual entry")).toBeInTheDocument();
      expect(screen.queryByText("previous evening")).not.toBeInTheDocument();
    });

    it("To = 2026-09-04 does not show the 01:30 row under the previous day", () => {
      renderModal();
      fireEvent.change(screen.getByTestId("date-range-to"), {
        target: { value: "2026-09-04" },
      });
      expect(screen.queryByText("line usage 01:30")).not.toBeInTheDocument();
      expect(screen.getByText("previous evening")).toBeInTheDocument();
    });
  });
});

describe("HistoryModal.drawerShortage (LIRA-335)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-335 US3 (FR-013) — a Drawer shortage expense in the History window.
   *
   * Closing a Short checkpoint difference books an automatic "Drawer shortage"
   * expense linked to the difference (`source_ref_table`
   * = CHECKPOINT_DIFFERENCE_SOURCE_TABLE). Only Reopen may remove it, so its
   * row offers neither Void nor Edit; every other row is unchanged. The
   * constants come from core (rule 14/24), never retyped.
   *
   * Rule 17: written before the HistoryModal change.
   */

  const SHORTAGE_DESC = "Drawer shortage (General, checkpoint Oct 10, 18:00)";
  const SUPPLY_DESC = "Cleaning";

  function renderModal() {
    render(
      <HistoryModal
        expenses={[
          {
            id: 1,
            description: SHORTAGE_DESC,
            category: DRAWER_SHORTAGE_EXPENSE_CATEGORY,
            amount_usd: 3,
            amount_lbp: 0,
            expense_date: "2026-10-10",
            source_ref_table: CHECKPOINT_DIFFERENCE_SOURCE_TABLE,
          },
          {
            id: 2,
            description: SUPPLY_DESC,
            category: "Shop_Supply",
            amount_usd: 10,
            amount_lbp: 0,
            expense_date: "2026-10-10",
          },
        ]}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
        onVoid={jest.fn()}
      />,
    );
  }

  describe("Expenses HistoryModal — Drawer shortage row (LIRA-335)", () => {
    it("labels the category Drawer shortage and offers no Void or Edit", () => {
      renderModal();
      const row = screen.getByText(SHORTAGE_DESC).closest("tr") as HTMLElement;

      expect(within(row).getByText("Drawer shortage")).toBeInTheDocument();
      expect(within(row).queryByTitle("Void expense")).toBeNull();
      expect(within(row).queryByTitle("Edit metadata")).toBeNull();
    });

    it("leaves every other row's Void and Edit in place", () => {
      renderModal();
      const row = screen.getByText(SUPPLY_DESC).closest("tr") as HTMLElement;

      expect(within(row).getByTitle("Void expense")).toBeInTheDocument();
      expect(within(row).getByTitle("Edit metadata")).toBeInTheDocument();
    });
  });
});

describe("HistoryModal.paymentMethod (LIRA-185)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Expenses History modal — the payment column shows each expense's own
   * payment method (LIRA-185 leftover, expenses lead 5).
   *
   * The cell was a hard-coded "Cash" for every row, so an expense paid from
   * Whish, OMT or Binance still read "Cash". It now shows the shop's label for
   * `paid_by_method` (passed in by the page from its payment methods), falling
   * back to a title-cased code, and "Cash" only when the row has no method.
   */

  function expense(id: number, description: string, paid_by_method?: string) {
    return {
      id,
      description,
      category: "Shop_Supply",
      amount_usd: 10,
      amount_lbp: 0,
      expense_date: "2026-10-10",
      ...(paid_by_method !== undefined ? { paid_by_method } : {}),
    };
  }

  function rowOf(description: string): HTMLElement {
    const row = screen.getByText(description).closest("tr");
    expect(row).not.toBeNull();
    return row as HTMLElement;
  }

  describe("Expenses HistoryModal — payment method column", () => {
    it("shows the shop's label for each row's own payment method", () => {
      render(
        <HistoryModal
          expenses={[
            expense(1, "Paid in cash", "CASH"),
            expense(2, "Paid from Whish", "WHISH"),
            expense(3, "Paid from Binance", "BINANCE"),
          ]}
          methodLabels={{
            CASH: "Cash",
            WHISH: "Whish Money",
            BINANCE: "Binance",
          }}
          loading={false}
          onClose={jest.fn()}
          onRefresh={jest.fn()}
          onVoid={jest.fn()}
        />,
      );

      expect(
        within(rowOf("Paid in cash")).getByText("Cash"),
      ).toBeInTheDocument();
      expect(
        within(rowOf("Paid from Whish")).getByText("Whish Money"),
      ).toBeInTheDocument();
      expect(
        within(rowOf("Paid from Whish")).queryByText("Cash"),
      ).not.toBeInTheDocument();
      expect(
        within(rowOf("Paid from Binance")).getByText("Binance"),
      ).toBeInTheDocument();
    });

    it("falls back to a readable code when no label is known, and to Cash when the row has no method", () => {
      render(
        <HistoryModal
          expenses={[
            expense(1, "Line usage", "LINE_CREDIT"),
            expense(2, "Old row without method"),
          ]}
          loading={false}
          onClose={jest.fn()}
          onRefresh={jest.fn()}
          onVoid={jest.fn()}
        />,
      );

      expect(
        within(rowOf("Line usage")).getByText("Line Credit"),
      ).toBeInTheDocument();
      expect(
        within(rowOf("Old row without method")).getByText("Cash"),
      ).toBeInTheDocument();
    });
  });
});

describe("HistoryModal.refundedBadge (LIRA-131)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Expenses History modal — refunded-row display (LIRA-131).
   *
   * `expenses` is in `TransactionRepository._markSourceRefunded`'s
   * supported-tables whitelist (migration v68) — a void/refund of an expense
   * correctly sets `is_refunded = 1` / `refunded_at`. The "Refunded" badge JSX
   * already existed here (`isRefunded = Boolean(expense.is_refunded)`,
   * LIRA-131 audit: "dead badge ready") — it was starved because
   * `ExpenseRepository.getColumns()` never projected either column (fixed in
   * this same change; see ExpenseRepository.refundedRead.test.ts for the
   * backend-side proof). `expenses` carries no profit concept (it's a pure
   * cost/outflow row), so unlike recharges/exchange/financial_services/
   * custom-services there is no profit column to neutralise here — the badge
   * is the whole fix.
   *
   * Rule 17 (failing-first): no NEW frontend code was written for this
   * module (the badge JSX pre-dates this ticket) — the bug was entirely the
   * missing backend projection. This test proves that directly: given props
   * shaped like the PRE-fix repository (is_refunded/refunded_at simply
   * absent, exactly what an un-projected SELECT produces), the badge does
   * NOT render; given props shaped like the FIXED repository, it does. Both
   * branches are asserted below, so the test would fail if the badge JSX
   * were ever removed OR if the projection regressed back to omitting the
   * columns.
   */

  const REFUNDED_DESC = "Refunded shop supply";
  const LIVE_DESC = "Live shop supply";

  function baseExpense(overrides: Record<string, unknown>) {
    return {
      id: 1,
      description: LIVE_DESC,
      category: "Shop_Supply",
      amount_usd: 25,
      amount_lbp: 0,
      expense_date: "2026-08-10",
      ...overrides,
    };
  }

  describe("Expenses HistoryModal — refunded row display (LIRA-131)", () => {
    it("shows a Refunded badge on a row shaped like the FIXED repository (is_refunded=1)", () => {
      render(
        <HistoryModal
          expenses={[
            baseExpense({
              id: 1,
              description: REFUNDED_DESC,
              is_refunded: 1,
              refunded_at: "2026-08-10 21:00:00",
            }),
            baseExpense({ id: 2, description: LIVE_DESC, is_refunded: 0 }),
          ]}
          loading={false}
          onClose={jest.fn()}
          onRefresh={jest.fn()}
          onVoid={jest.fn()}
        />,
      );

      const refundedRow = screen.getByText(REFUNDED_DESC).closest("tr");
      const liveRow = screen.getByText(LIVE_DESC).closest("tr");
      expect(refundedRow).not.toBeNull();
      expect(liveRow).not.toBeNull();

      expect(
        within(refundedRow as HTMLElement).getByText("Refunded"),
      ).toBeInTheDocument();
      expect(
        within(liveRow as HTMLElement).queryByText("Refunded"),
      ).not.toBeInTheDocument();
    });

    it("failing-first proof: a row shaped like the PRE-fix repository (is_refunded simply absent from the SELECT) shows NO badge at all", () => {
      render(
        <HistoryModal
          // No is_refunded/refunded_at keys — exactly what
          // ExpenseRepository.getColumns() produced before this ticket's fix.
          expenses={[baseExpense({ id: 1, description: REFUNDED_DESC })]}
          loading={false}
          onClose={jest.fn()}
          onRefresh={jest.fn()}
          onVoid={jest.fn()}
        />,
      );

      const row = screen.getByText(REFUNDED_DESC).closest("tr");
      expect(within(row as HTMLElement).queryByText("Refunded")).toBeNull();
    });
  });
});

describe("HistoryModal.totals (LIRA-311)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Expenses History modal — Total USD / Total LBP chips (LIRA-311).
   *
   * The window shows the totals of the rows it lists, USD and LBP kept
   * separate, and leaves a refunded row out (same rule as the page header,
   * shared through `expenseTotals`). Rows from past days count too — the
   * window is now fed every day, not only today.
   *
   * Not proven failing-first: written after the change (rule 17).
   */

  function expense(overrides: Record<string, unknown>) {
    return {
      id: 1,
      description: "Row",
      category: "Shop_Supply",
      amount_usd: 0,
      amount_lbp: 0,
      expense_date: "2026-10-12",
      ...overrides,
    };
  }

  function chipValue(label: string): string {
    const chip = screen.getByText(label).parentElement as HTMLElement;
    return chip.textContent ?? "";
  }

  describe("Expenses HistoryModal — totals (LIRA-311)", () => {
    it("totals USD and LBP separately across days, leaving refunded rows out", () => {
      render(
        <HistoryModal
          expenses={[
            expense({ id: 1, amount_usd: 20 }),
            expense({ id: 2, amount_usd: 15.5, expense_date: "2026-09-01" }),
            expense({ id: 3, amount_lbp: 700000 }),
            expense({ id: 4, amount_lbp: 500000, expense_date: "2026-08-15" }),
            expense({ id: 5, amount_usd: 10, is_refunded: 1 }),
            expense({ id: 6, amount_lbp: 90000, is_refunded: 1 }),
          ]}
          loading={false}
          onClose={jest.fn()}
          onRefresh={jest.fn()}
          onVoid={jest.fn()}
        />,
      );

      expect(chipValue("Total USD")).toContain("$35.50");
      expect(chipValue("Total LBP")).toContain((1200000).toLocaleString());
    });

    it("shows zero totals when nothing is listed", () => {
      render(
        <HistoryModal
          expenses={[]}
          loading={false}
          onClose={jest.fn()}
          onRefresh={jest.fn()}
          onVoid={jest.fn()}
        />,
      );

      expect(chipValue("Total USD")).toContain("$0.00");
      expect(chipValue("Total LBP")).toContain("0");
    });
  });
});
