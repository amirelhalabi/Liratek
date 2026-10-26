/** @jest-environment jsdom */
/**
 * LIRA-348 — Audit & Transactions open on TODAY, 50 at a time:
 *   - both tabs start on today's day range (the browser's local day, sent
 *     as `YYYY-MM-DD` — rule 27), shown by the table's own day filter;
 *   - the Audit Log asks for 50 and, when the bottom of the table scrolls
 *     into view, the next 50 after the last row shown (keyset `beforeId`);
 *   - the old free "Rows" box is gone (it fought "50 at a time").
 * Field names come from the shared core schema (rule 24).
 * Written before the page change (rule 17).
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { auditPageFiltersSchema } from "@liratek/core";
import AuditPage from "../AuditPage";

const viewerProps: Array<Record<string, unknown>> = [];
jest.mock("../TransactionsViewer", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    viewerProps.push(props);
    return <div data-testid="transactions-viewer-stub" />;
  },
}));

jest.mock("../../../../../../packages/ui/src/utils/tableExport", () => ({
  exportToExcel: jest.fn(),
  exportToPdf: jest.fn(),
}));

const search = jest.fn();
// rule 25: ONE identity for the whole file.
const mockApi = { audit: { search } };
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function auditRows(topId: number, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: topId - i,
    user_id: 1,
    username: "alice",
    role: "admin",
    action: "CREATE",
    entity_type: "sale",
    entity_id: null,
    summary: `row ${topId - i}`,
    created_at: "2026-10-26 07:00:00",
  }));
}

const observers: Array<{
  cb: IntersectionObserverCallback;
  target: Element | null;
}> = [];
beforeEach(() => {
  viewerProps.length = 0;
  observers.length = 0;
  search.mockReset();
  class IO {
    cb: IntersectionObserverCallback;
    target: Element | null = null;
    constructor(cb: IntersectionObserverCallback) {
      this.cb = cb;
      observers.push(this);
    }
    observe(el: Element) {
      this.target = el;
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IO;
});

describe("AuditPage — LIRA-348 today, 50 at a time", () => {
  it("the Transactions tab starts on today, 50 per page, with the day filter wired", () => {
    render(<AuditPage />);
    const last = viewerProps.at(-1)!;
    expect(last.from).toBe(today());
    expect(last.to).toBe(today());
    expect(last.limit).toBe("50");
    expect(typeof last.onDayRangeChange).toBe("function");
    expect(screen.queryByText("Rows")).toBeNull();
  });

  it("the Audit Log starts on today, asks for 50, and loads the next 50 after the last row on scroll", async () => {
    search.mockResolvedValueOnce({
      success: true,
      rows: auditRows(500, 50),
      total: 120,
    });
    render(<AuditPage />);
    fireEvent.click(screen.getByRole("button", { name: "Audit Log" }));

    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    const expected = auditPageFiltersSchema.parse({
      dayFrom: today(),
      dayTo: today(),
    });
    expect(search.mock.calls[0][0]).toMatchObject({ ...expected, limit: 50 });
    expect(search.mock.calls[0][0].beforeId).toBeUndefined();
    expect(await screen.findByText("row 451")).toBeInTheDocument();
    expect(screen.getByTestId("data-table-day-range")).toBeInTheDocument();

    // A short page: the end of the log for these filters.
    search.mockResolvedValueOnce({
      success: true,
      rows: auditRows(450, 30),
      total: 80,
    });
    await act(async () => {
      for (const o of observers) {
        o.cb(
          [
            {
              isIntersecting: true,
              target: o.target,
            } as IntersectionObserverEntry,
          ],
          o as unknown as IntersectionObserver,
        );
      }
    });
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(search.mock.calls[1][0]).toMatchObject({
      ...expected,
      limit: 50,
      beforeId: 451,
    });
    expect(await screen.findByText("row 421")).toBeInTheDocument();
    expect(screen.getByText("row 500")).toBeInTheDocument();
  });
});
