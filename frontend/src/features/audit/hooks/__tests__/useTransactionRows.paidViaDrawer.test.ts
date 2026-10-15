/** @jest-environment jsdom */
/**
 * LIRA-323 — client twin of `TransactionRepository.getRecent`'s
 * `paid_via_drawer` rule (isRowVisibleForOption in useTransactionRows.ts).
 *
 * A wallet option (e.g. "OMT App Send") also shows rows of OTHER types whose
 * payment detail moved money through that wallet's drawer — the row's own
 * `payments` OR the session basket's pooled `session_payments` — but never a
 * row of one of that wallet's OWN filter options (OMT App Recv/Top-up/
 * Cash-Out), which show only through their own tuple. The server already
 * strips internal legs from `payments`, so the twin only checks the drawer.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { useTransactionRows } from "../useTransactionRows";
import { getRecentTransactions } from "@/api/backendApi";

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
}));

const mockFetch = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

const BASE = { limit: "50", search: "", from: "", to: "" };

const leg = (method: string, drawer_name: string, signed_amount = 30) => ({
  direction: signed_amount < 0 ? "out" : "in",
  amount: Math.abs(signed_amount),
  signed_amount,
  currency_code: "USD",
  method,
  drawer_name,
});

function row(
  id: number,
  type: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type,
    created_at: `2026-08-28 10:${String(60 - id).padStart(2, "0")}:00`,
    metadata_json: null,
    payments: [],
    ...extra,
  };
}

const ROWS = [
  // 1: OMT App Send itself
  row(1, "FINANCIAL_SERVICE", {
    metadata_json: JSON.stringify({
      provider: "OMT_APP",
      service_type: "SEND",
    }),
  }),
  // 2: Maintenance paid Cash + OMT Wallet
  row(2, "MAINTENANCE", {
    payments: [leg("CASH", "General", 10), leg("OMT", "OMT_App")],
  }),
  // 3: Maintenance paid cash only
  row(3, "MAINTENANCE", { payments: [leg("CASH", "General", 10)] }),
  // 4: OMT App Recv with an OMT_App leg — own option, must NOT be added
  row(4, "FINANCIAL_SERVICE", {
    metadata_json: JSON.stringify({
      provider: "OMT_APP",
      service_type: "RECEIVE",
    }),
    payments: [leg("OMT", "OMT_App", -30)],
  }),
  // 5: session member, basket paid by OMT Wallet (pooled leg only)
  row(5, "CUSTOM_SERVICE", {
    session_id: 9,
    session_payments: [leg("OMT", "OMT_App")],
  }),
  // 6: refund paid out by OMT Wallet
  row(6, "REFUND", { payments: [leg("OMT", "OMT_App", -10)] }),
  // 7: Whish-paid sale — not an OMT row
  row(7, "SALE", { payments: [leg("WHISH", "Whish_App")] }),
];

async function visibleIds(selectedFilters: string[]): Promise<number[]> {
  mockFetch.mockResolvedValue(ROWS as never);
  const { result } = renderHook(() =>
    useTransactionRows({ ...BASE, selectedFilters }),
  );
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result.current.rows.map((r) => r.id).sort((a, b) => a - b);
}

describe("useTransactionRows — LIRA-323 paid via wallet drawer", () => {
  beforeEach(() => mockFetch.mockReset());

  it("sends paid_via_drawer on the wallet option's typeFilters tuple", async () => {
    await visibleIds(["OMT App Send"]);
    const filters = mockFetch.mock.calls[0][1] as {
      typeFilters?: Array<Record<string, unknown>>;
    };
    expect(filters.typeFilters).toEqual([
      {
        type: "FINANCIAL_SERVICE",
        provider: "OMT_APP",
        service_type: "SEND",
        paid_via_drawer: "OMT_App",
      },
    ]);
  });

  it("OMT App Send shows its own rows plus other-type rows paid through OMT_App (own legs, pooled legs, refund OUT legs)", async () => {
    expect(await visibleIds(["OMT App Send"])).toEqual([1, 2, 5, 6]);
  });

  it("a non-wallet option is unchanged (MTC adds nothing paid by OMT Wallet)", async () => {
    expect(await visibleIds(["MTC"])).toEqual([]);
  });

  it("mixed with Cash only (till): union of the cash rows and the OMT-paid rows", async () => {
    expect(await visibleIds(["OMT App Send", "Cash only (till)"])).toEqual([
      1, 2, 3, 5, 6,
    ]);
  });

  it("Whish App Send adds the Whish-paid sale and none of the OMT rows", async () => {
    expect(await visibleIds(["Whish App Send"])).toEqual([7]);
  });
});
