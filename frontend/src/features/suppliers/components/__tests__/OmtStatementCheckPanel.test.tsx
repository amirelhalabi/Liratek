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
import { OMT_COVERED_TYPE_VALUES, coveredTypeLabel } from "@liratek/core";
import {
  coveredPickerShowsAllTypes,
  isCoveredTypeTicked,
  openCoveredPicker,
  toggleCoveredType,
} from "../../testing/coveredTypesPicker";

const mockGetStatement = jest.fn();
// Module-level stable object — rule 25: returning the SAME reference every
// call, never a fresh `{ ... }` literal per render.
const mockApi = {
  getSupplierAccountExpectedStatement: mockGetStatement,
};

// 2026-10-27 — the browser's own day is the 28th, so "yesterday" (the
// default statement day) is the 27th.
jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return { ...actual, localDay: () => "2026-10-28" };
});

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
      expect(mockGetStatement).toHaveBeenCalledWith(1, undefined, "2026-10-27"),
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

// ─────────────────────────────────────────────────────────────────────────
// LIRA-256 — "Which shares does this SMS include?" picker. RULE 17: run red
// before the picker existed (no "All types" control; the read was only ever
// called with one argument).
// ─────────────────────────────────────────────────────────────────────────
const P = "omt-statement-covered";

describe("OmtStatementCheckPanel — LIRA-256 covered types", () => {
  const BASE: AccountExpectedStatement = {
    account_supplier_id: 1,
    gross_owed_usd: 600,
    gross_owed_lbp: 1_050_000,
    unsettled_commission_usd: 1.5,
    unsettled_commission_lbp: 5_000,
    expected_usd: 598.5,
    expected_lbp: 1_045_000,
    covered_omt_service_types: null,
    commission_by_type: [
      { omt_service_type: "INTRA", commission_usd: 0.3, commission_lbp: 5_000, count: 2 },
      { omt_service_type: "WESTERN_UNION", commission_usd: 1.2, commission_lbp: 0, count: 1 },
    ],
  };
  const INTRA_ONLY: AccountExpectedStatement = {
    ...BASE,
    unsettled_commission_usd: 0.3,
    expected_usd: 599.7,
    covered_omt_service_types: ["INTRA"],
  };

  function renderWith(impl: (id: number, covered?: string[]) => AccountExpectedStatement) {
    mockGetStatement.mockImplementation((id: number, covered?: string[]) =>
      Promise.resolve(impl(id, covered)),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <OmtStatementCheckPanel account={ACCOUNT} />
      </QueryClientProvider>,
    );
  }
  const byChoice = (_id: number, covered?: string[]) => (covered ? INTRA_ONLY : BASE);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });

  it("shows 'All types', every OMT type label and 'Type not recorded'", async () => {
    renderWith(byChoice);
    await screen.findByTestId("omt-statement-covered");
    expect(coveredPickerShowsAllTypes(P)).toBe(true);
    await openCoveredPicker(P);
    for (const v of OMT_COVERED_TYPE_VALUES) {
      expect(
        screen.getByTestId(`${P}-option-${v}`).getAttribute("aria-selected"),
      ).toBe("false");
      expect(screen.getByText(coveredTypeLabel(v))).toBeInTheDocument();
    }
    expect(screen.getByText("Type not recorded")).toBeInTheDocument();
  });

  it("'All types' calls the read with no covered list (id, undefined, day)", async () => {
    renderWith(byChoice);
    await waitFor(() =>
      expect(mockGetStatement).toHaveBeenCalledWith(1, undefined, "2026-10-27"),
    );
    expect(mockGetStatement.mock.calls[0][1]).toBeUndefined();
  });

  it("ticking only Intra re-reads with (id, ['INTRA']) and renders that response", async () => {
    renderWith(byChoice);
    await toggleCoveredType(P, "INTRA");
    await waitFor(() => expect(mockGetStatement).toHaveBeenCalledWith(1, ["INTRA"], "2026-10-27"));
    await waitFor(() =>
      expect(screen.getByTestId("omt-statement-commission-usd")).toHaveTextContent("$0.30"),
    );
    expect(screen.getByTestId("omt-statement-expected-usd")).toHaveTextContent("$599.70");
    expect(coveredPickerShowsAllTypes(P)).toBe(false);
  });

  it("each type shows its count and unsettled commission from commission_by_type", async () => {
    renderWith(byChoice);
    await openCoveredPicker(P);
    await waitFor(() =>
      expect(screen.getByTestId("omt-statement-covered-INTRA-amount")).toHaveTextContent("2"),
    );
    expect(screen.getByTestId("omt-statement-covered-INTRA-amount")).toHaveTextContent("$0.30");
    expect(screen.getByTestId("omt-statement-covered-INTRA-amount")).toHaveTextContent("5,000");
    expect(screen.getByTestId("omt-statement-covered-WESTERN_UNION-amount")).toHaveTextContent("$1.20");
  });

  it("saves the choice per account on this device and restores it on remount", async () => {
    renderWith(byChoice);
    await toggleCoveredType(P, "INTRA");
    expect(window.localStorage.getItem("liratek:omt-covered-types:1")).toBe(JSON.stringify(["INTRA"]));
    cleanup();
    mockGetStatement.mockClear();
    renderWith(byChoice);
    expect(await isCoveredTypeTicked(P, "INTRA")).toBe(true);
    await waitFor(() => expect(mockGetStatement).toHaveBeenCalledWith(1, ["INTRA"], "2026-10-27"));
  });

  it("unticking the last type returns to 'All types' (never sends [])", async () => {
    renderWith(byChoice);
    await toggleCoveredType(P, "INTRA");
    await toggleCoveredType(P, "INTRA");
    expect(coveredPickerShowsAllTypes(P)).toBe(true);
    for (const call of mockGetStatement.mock.calls) {
      expect(call[1]).not.toEqual([]);
    }
  });

  it("a localStorage that throws does not break the panel (falls back to All types)", async () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderWith(byChoice);
    await screen.findByTestId("omt-statement-covered");
    expect(coveredPickerShowsAllTypes(P)).toBe(true);
    await toggleCoveredType(P, "INTRA");
    expect(await isCoveredTypeTicked(P, "INTRA")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2026-10-27 (owner option B) — OMT's SMS covers the account up to the END
// OF YESTERDAY. The panel reads up to a day (default: yesterday, from the
// browser's own day), lets the operator pick an earlier one, and shows what
// later days still have open, not counted.
// ─────────────────────────────────────────────────────────────────────────
describe("OmtStatementCheckPanel — up to a day", () => {
  const CUT: AccountExpectedStatement = {
    account_supplier_id: 1,
    gross_owed_usd: 150,
    gross_owed_lbp: 0,
    unsettled_commission_usd: 1.5,
    unsettled_commission_lbp: 0,
    expected_usd: 148.5,
    expected_lbp: 0,
    covered_omt_service_types: null,
    commission_by_type: [],
    after_day_usd: -150,
    after_day_lbp: 500_000,
  };

  function renderCut(statement: AccountExpectedStatement) {
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

  beforeEach(() => {
    jest.clearAllMocks();
    try {
      window.localStorage.clear();
    } catch {
      // ignore
    }
  });

  it("defaults to yesterday: the chip says so and the read is cut at it", async () => {
    renderCut(CUT);
    expect(screen.getByTestId("omt-statement-up-to-chip")).toHaveTextContent(
      "Up to: Tue, Oct 27",
    );
    await waitFor(() =>
      expect(mockGetStatement).toHaveBeenCalledWith(1, undefined, "2026-10-27"),
    );
  });

  it("picking another day re-reads with it; today and later cannot be picked", async () => {
    renderCut(CUT);
    await waitFor(() => expect(mockGetStatement).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("omt-statement-up-to-chip"));
    const input = screen.getByTestId(
      "omt-statement-up-to-input",
    ) as HTMLInputElement;
    expect(input.max).toBe("2026-10-27");
    expect(input.value).toBe("2026-10-27");

    fireEvent.change(input, { target: { value: "2026-10-25" } });
    await waitFor(() =>
      expect(mockGetStatement).toHaveBeenLastCalledWith(
        1,
        undefined,
        "2026-10-25",
      ),
    );
    expect(screen.getByTestId("omt-statement-up-to-chip")).toHaveTextContent(
      "Up to: Sun, Oct 25",
    );

    // Today (the 28th) is refused: the read stays on the 25th.
    mockGetStatement.mockClear();
    fireEvent.click(screen.getByTestId("omt-statement-up-to-chip"));
    fireEvent.change(screen.getByTestId("omt-statement-up-to-input"), {
      target: { value: "2026-10-28" },
    });
    expect(screen.getByTestId("omt-statement-up-to-chip")).toHaveTextContent(
      "Up to: Sun, Oct 25",
    );
    expect(mockGetStatement).not.toHaveBeenCalledWith(
      1,
      undefined,
      "2026-10-28",
    );
  });

  it("shows what later days still have open, not counted", async () => {
    renderCut(CUT);
    const line = await screen.findByTestId("omt-statement-after-day");
    expect(line).toHaveTextContent(
      "After Tue, Oct 27, not counted: -$150.00 · +500,000 LBP",
    );
  });

  it("no line when nothing is left out", async () => {
    renderCut({ ...CUT, after_day_usd: 0, after_day_lbp: 0 });
    await waitFor(() =>
      expect(screen.getByTestId("omt-statement-expected-usd")).toHaveTextContent(
        "$148.50",
      ),
    );
    expect(screen.queryByTestId("omt-statement-after-day")).toBeNull();
  });
});
