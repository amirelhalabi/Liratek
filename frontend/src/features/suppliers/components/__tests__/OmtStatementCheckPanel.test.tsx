/** @jest-environment jsdom */

/**
 * LIRA-255 — `OmtStatementCheckPanel`: shows the app's gross owed figure,
 * the unsettled commission figure, the resulting "expected on OMT's
 * statement" figure (OMT's own sign — minus = OMT owes the shop, plus =
 * the shop owes OMT), and the diff against an operator-typed SMS figure.
 *
 * `useSupplierAccountExpectedStatementQuery` goes through the REAL hook
 * (`useSuppliers.ts`) down to a mocked `useApi()` — same precedent
 * `AccountSettleSheet.test.tsx` uses for this page's other account reads.
 * `useApi` is mocked as a MODULE-LEVEL stable object (rule 25) rather than
 * a fresh object literal returned per call — a fresh literal is exactly
 * the unstable-identity hazard rule 25 exists to catch, so the test must
 * not reintroduce it even though this component doesn't itself put `api`
 * in a dependency array.
 */

import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OmtStatementCheckPanel } from "../OmtStatementCheckPanel";
import type { AccountBalance, AccountExpectedStatement } from "../../hooks/useSuppliers";

const mockGetStatement = jest.fn();
// Module-level stable object — rule 25: returning the SAME reference every
// call, never a fresh `{ ... }` literal per render.
const mockApi = {
  getSupplierAccountExpectedStatement: mockGetStatement,
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
  };
});

const ACCOUNT: AccountBalance = {
  account_supplier_id: 1,
  account_name: "OMT",
  total_usd: 207.75,
  total_lbp: 1_045_000,
  children: [
    {
      supplier_id: 1,
      name: "OMT",
      provider: "OMT",
      drawer_name: "OMT_System",
      total_usd: 207.75,
      total_lbp: 1_045_000,
      is_parent: true,
    },
  ],
};

function renderPanel(statement: AccountExpectedStatement) {
  mockGetStatement.mockResolvedValue(statement);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <OmtStatementCheckPanel account={ACCOUNT} />
    </QueryClientProvider>,
  );
}

describe("OmtStatementCheckPanel (LIRA-255)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });

  it("shows gross owed, unsettled commission, and the expected-on-statement figure (shop owes OMT direction)", async () => {
    renderPanel({
      account_supplier_id: 1,
      gross_owed_usd: 208,
      gross_owed_lbp: 1_050_000,
      unsettled_commission_usd: 0.25,
      unsettled_commission_lbp: 5_000,
      expected_usd: 207.75,
      expected_lbp: 1_045_000,
    });

    await waitFor(() =>
      expect(mockGetStatement).toHaveBeenCalledWith(1),
    );

    expect(await screen.findByTestId("omt-statement-gross-usd")).toHaveTextContent(
      "$208.00",
    );
    expect(screen.getByTestId("omt-statement-gross-lbp")).toHaveTextContent(
      "1,050,000",
    );
    expect(screen.getByTestId("omt-statement-commission-usd")).toHaveTextContent(
      "$0.25",
    );
    expect(screen.getByTestId("omt-statement-commission-lbp")).toHaveTextContent(
      "5,000",
    );
    expect(screen.getByTestId("omt-statement-expected-usd")).toHaveTextContent(
      "$207.75",
    );
    expect(screen.getByTestId("omt-statement-expected-lbp")).toHaveTextContent(
      "1,045,000",
    );
  });

  it("typing the SMS figure within a cent/LBP shows green 'Matches' (shop-owes-OMT direction)", async () => {
    renderPanel({
      account_supplier_id: 1,
      gross_owed_usd: 208,
      gross_owed_lbp: 1_050_000,
      unsettled_commission_usd: 0.25,
      unsettled_commission_lbp: 5_000,
      expected_usd: 207.75,
      expected_lbp: 1_045_000,
    });

    await screen.findByTestId("omt-statement-expected-usd");

    const usdInput = screen.getByTestId(
      "omt-statement-sms-usd-input",
    ) as HTMLInputElement;
    fireEvent.change(usdInput, { target: { value: "207.75" } });

    const badges = screen.getAllByTestId("omt-statement-diff-badge");
    expect(badges[0]).toHaveTextContent("Matches");
  });

  it("typing a differing SMS figure shows amber with the signed difference, in the OMT-owes-the-shop direction (negative expected figure)", async () => {
    renderPanel({
      account_supplier_id: 1,
      gross_owed_usd: -500,
      gross_owed_lbp: 0,
      unsettled_commission_usd: 0.5,
      unsettled_commission_lbp: 0,
      expected_usd: -500.5,
      expected_lbp: 0,
    });

    // Waits for the RESOLVED statement, not just the fallback render — the
    // panel shows the account prop's own gross figures while loading, so a
    // bare `findByTestId` (presence only) can pass before the real async
    // value lands.
    await waitFor(() =>
      expect(screen.getByTestId("omt-statement-expected-usd")).toHaveTextContent(
        "-$500.50",
      ),
    );

    const usdInput = screen.getByTestId(
      "omt-statement-sms-usd-input",
    ) as HTMLInputElement;
    // Operator types what OMT's SMS actually said: -1,160.99-style minus
    // allowed, here a smaller mismatch to prove the diff math (and sign) —
    // SMS says -495 but expected is -500.50, diff = -495 - (-500.50) = 5.50.
    fireEvent.change(usdInput, { target: { value: "-495" } });

    const badges = screen.getAllByTestId("omt-statement-diff-badge");
    expect(badges[0]).toHaveTextContent("Off by $5.50");
  });

  it("persists the typed SMS figures to localStorage per account, and reloads them on remount", async () => {
    renderPanel({
      account_supplier_id: 1,
      gross_owed_usd: 208,
      gross_owed_lbp: 1_050_000,
      unsettled_commission_usd: 0.25,
      unsettled_commission_lbp: 5_000,
      expected_usd: 207.75,
      expected_lbp: 1_045_000,
    });
    await waitFor(() =>
      expect(screen.getByTestId("omt-statement-expected-usd")).toHaveTextContent(
        "$207.75",
      ),
    );

    fireEvent.change(screen.getByTestId("omt-statement-sms-usd-input"), {
      target: { value: "207.75" },
    });
    fireEvent.change(screen.getByTestId("omt-statement-sms-lbp-input"), {
      target: { value: "1045000" },
    });

    // Unmount before remounting — otherwise both instances stay in the DOM
    // and every testid query below matches twice.
    cleanup();

    // Remount with a fresh render — simulates reopening the account tab.
    renderPanel({
      account_supplier_id: 1,
      gross_owed_usd: 208,
      gross_owed_lbp: 1_050_000,
      unsettled_commission_usd: 0.25,
      unsettled_commission_lbp: 5_000,
      expected_usd: 207.75,
      expected_lbp: 1_045_000,
    });
    await screen.findByTestId("omt-statement-expected-usd");

    const usdInputs = screen.getAllByTestId(
      "omt-statement-sms-usd-input",
    ) as HTMLInputElement[];
    const lbpInputs = screen.getAllByTestId(
      "omt-statement-sms-lbp-input",
    ) as HTMLInputElement[];
    // The most recently rendered instance picked up the saved values.
    expect(usdInputs[usdInputs.length - 1].value).toBe("207.75");
    expect(lbpInputs[lbpInputs.length - 1].value).toBe("1045000");
  });
});
