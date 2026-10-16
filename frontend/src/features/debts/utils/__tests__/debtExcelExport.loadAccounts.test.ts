import type { DebtLedgerEntity, DebtorSummary } from "@liratek/ui";
import { loadAccountsForExport } from "../debtExcelExport";

/**
 * Guard — LIRA-330 follow-up (2026-10-17): the export used to ask for each
 * client's history separately. A shop with ~400 accounts made ~400 web
 * requests in a few seconds, past the API's per-user limit (200/minute), so
 * the export failed part-way and the cashier's other screens were refused
 * for a minute. It must read the whole shop's history in ONE request.
 */

const CLIENTS = 25;

const debtors: DebtorSummary[] = Array.from({ length: CLIENTS }, (_, i) => ({
  id: 100 + i,
  full_name: `Client ${String(CLIENTS - i).padStart(2, "0")}`,
  phone_number: `7012${String(i).padStart(4, "0")}`,
  total_debt: 0,
  total_debt_usd: 0,
  total_debt_lbp: 0,
}));

const row = (client_id: number, n: number): DebtLedgerEntity => ({
  id: client_id * 10 + n,
  client_id,
  transaction_id: null,
  transaction_type: "Manual Debt",
  amount_usd: n,
  amount_lbp: 0,
  note: `row ${n}`,
  created_at: "2026-10-01 10:00:00",
  created_by: null,
  session_id: null,
});

const allRows = debtors.flatMap((d) => [row(d.id, 1), row(d.id, 2)]);

const getDebtors = jest.fn(async () => debtors);
const getClientDebtHistory = jest.fn(async (clientId: number) =>
  allRows.filter((r) => r.client_id === clientId),
);
const getAllDebtHistory = jest.fn(async () => allRows);

const api = {
  getDebtors,
  getClientDebtHistory,
  getAllDebtHistory,
} as unknown as Parameters<typeof loadAccountsForExport>[0];

describe("loadAccountsForExport", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reads every client's history in one request, not one per client", async () => {
    await loadAccountsForExport(api);
    const historyRequests =
      getClientDebtHistory.mock.calls.length +
      getAllDebtHistory.mock.calls.length;
    expect(historyRequests).toBe(1);
  });

  it("gives each client exactly their own rows, sorted by name", async () => {
    const clients = await loadAccountsForExport(api);
    expect(clients).toHaveLength(CLIENTS);
    expect(clients.map((c) => c.name)).toEqual(
      [...debtors.map((d) => d.full_name)].sort((a, b) => a.localeCompare(b)),
    );
    for (const c of clients) {
      const d = debtors.find((x) => x.full_name === c.name)!;
      expect(c.phone).toBe(d.phone_number);
      expect(c.history.map((r) => r.id)).toEqual(
        allRows.filter((r) => r.client_id === d.id).map((r) => r.id),
      );
    }
  });
});
