/** @jest-environment jsdom */
/**
 * LIRA-348 — "load more as you scroll" and the "today by default" day filter
 * are features of the shared DataTable (packages/ui), so any table can use
 * them:
 *   - `loadMore`: a sentinel under the last row; when it scrolls into view
 *     (IntersectionObserver) the table asks for the next page. A "Load more"
 *     button does the same where there is no IntersectionObserver.
 *   - `dayRange`: From / To with Today, Yesterday, This week, This month,
 *     All — the browser's own local days (rule 27).
 *   - `useDayRange()` starts on today.
 * Written before the component change (rule 17).
 */
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import {
  DataTable,
  useDayRange,
  type DataTableColumn,
  type ExportTemplate,
} from "@liratek/ui";

jest.mock("../../../../../packages/ui/src/utils/tableExport", () => ({
  exportToExcel: jest.fn(),
  exportToPdf: jest.fn(),
}));
const exportTemplateToExcel = jest.fn();
jest.mock("../../../../../packages/ui/src/utils/exportTemplate", () => ({
  ...jest.requireActual("../../../../../packages/ui/src/utils/exportTemplate"),
  exportTemplateToExcel: (...args: unknown[]) => exportTemplateToExcel(...args),
}));

type Row = { id: number; name: string };
const COLS: DataTableColumn[] = [{ header: "Name" }];
const rows: Row[] = [
  { id: 1, name: "one" },
  { id: 2, name: "two" },
];
const renderRow = (r: Row) => (
  <tr key={r.id}>
    <td>{r.name}</td>
  </tr>
);

/** Local day the same way the app computes it (never toISOString). */
function day(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe("DataTable — LIRA-348 load more", () => {
  const observers: Array<{
    cb: IntersectionObserverCallback;
    target: Element | null;
  }> = [];
  const original = (globalThis as { IntersectionObserver?: unknown })
    .IntersectionObserver;

  beforeEach(() => {
    observers.length = 0;
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
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      IO;
  });
  afterEach(() => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      original;
  });

  const fire = (isIntersecting: boolean) =>
    act(() => {
      for (const o of observers) {
        o.cb(
          [{ isIntersecting, target: o.target } as IntersectionObserverEntry],
          o as unknown as IntersectionObserver,
        );
      }
    });

  it("asks for the next page when the sentinel scrolls into view", () => {
    const onLoadMore = jest.fn();
    render(
      <DataTable<Row>
        columns={COLS}
        data={rows}
        renderRow={renderRow}
        loadMore={{ hasMore: true, isLoadingMore: false, onLoadMore }}
      />,
    );
    expect(
      screen.getByTestId("data-table-load-more-sentinel"),
    ).toBeInTheDocument();
    fire(false);
    expect(onLoadMore).not.toHaveBeenCalled();
    fire(true);
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not ask again while a page is loading, nor when there is nothing more", () => {
    const onLoadMore = jest.fn();
    const { rerender } = render(
      <DataTable<Row>
        columns={COLS}
        data={rows}
        renderRow={renderRow}
        loadMore={{ hasMore: true, isLoadingMore: true, onLoadMore }}
      />,
    );
    fire(true);
    expect(onLoadMore).not.toHaveBeenCalled();
    rerender(
      <DataTable<Row>
        columns={COLS}
        data={rows}
        renderRow={renderRow}
        loadMore={{ hasMore: false, isLoadingMore: false, onLoadMore }}
      />,
    );
    fire(true);
    expect(onLoadMore).not.toHaveBeenCalled();
    expect(screen.queryByTestId("data-table-load-more-sentinel")).toBeNull();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });

  it("offers a Load more button that does the same", () => {
    const onLoadMore = jest.fn();
    render(
      <DataTable<Row>
        columns={COLS}
        data={rows}
        renderRow={renderRow}
        loadMore={{ hasMore: true, isLoadingMore: false, onLoadMore }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("still renders, with the button, where there is no IntersectionObserver", () => {
    delete (globalThis as { IntersectionObserver?: unknown })
      .IntersectionObserver;
    const onLoadMore = jest.fn();
    render(
      <DataTable<Row>
        columns={COLS}
        data={rows}
        renderRow={renderRow}
        loadMore={{ hasMore: true, isLoadingMore: false, onLoadMore }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});

describe("DataTable — LIRA-348 day filter", () => {
  it("useDayRange starts on today (the browser's local day)", () => {
    const { result } = renderHook(() => useDayRange());
    expect(result.current.from).toBe(day());
    expect(result.current.to).toBe(day());
  });

  it("renders From / To and the presets, which set the range", () => {
    const onChange = jest.fn();
    render(
      <DataTable<Row>
        columns={COLS}
        data={rows}
        renderRow={renderRow}
        dayRange={{ from: day(), to: day(), onChange }}
      />,
    );
    expect(screen.getByTestId("data-table-day-range")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Yesterday" }));
    expect(onChange).toHaveBeenLastCalledWith(day(-1), day(-1));
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(onChange).toHaveBeenLastCalledWith(day(), day());
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(onChange).toHaveBeenLastCalledWith("", "");
    fireEvent.click(screen.getByRole("button", { name: "This month" }));
    expect(onChange).toHaveBeenLastCalledWith(`${day().slice(0, 7)}-01`, day());
    fireEvent.click(screen.getByRole("button", { name: "This week" }));
    const [weekFrom, weekTo] = onChange.mock.calls.at(-1) as [string, string];
    expect(weekTo).toBe(day());
    expect(weekFrom <= weekTo).toBe(true);
    expect(new Date(`${weekFrom}T12:00:00`).getDay()).toBe(1); // Monday
  });
});

describe("DataTable — LIRA-348 export covers every page, not just the loaded ones", () => {
  it("loads the remaining pages first, then exports all of them", async () => {
    const template = {} as ExportTemplate<Row>;
    const loadAll = jest.fn();
    function Paged() {
      const [data, setData] = useState<Row[]>(rows);
      const [hasMore, setHasMore] = useState(true);
      loadAll.mockImplementation(async () => {
        setData([...rows, { id: 3, name: "three" }, { id: 4, name: "four" }]);
        setHasMore(false);
      });
      return (
        <DataTable<Row>
          columns={COLS}
          data={data}
          renderRow={renderRow}
          exportExcel
          exportTemplate={template}
          loadMore={{
            hasMore,
            isLoadingMore: false,
            onLoadMore: jest.fn(),
            loadAll,
          }}
        />
      );
    }
    render(<Paged />);
    fireEvent.click(screen.getByTestId("export-excel-btn"));
    await waitFor(() => expect(exportTemplateToExcel).toHaveBeenCalledTimes(1));
    expect(loadAll).toHaveBeenCalledTimes(1);
    const ctx = exportTemplateToExcel.mock.calls[0][1] as { rows: Row[] };
    expect(ctx.rows.map((r) => r.id).sort()).toEqual([1, 2, 3, 4]);
  });
});
