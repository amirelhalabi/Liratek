/** @jest-environment jsdom */
/**
 * Shop-day bug (2026-10-16): on Mobile Recharge (Katsh / iPick / Whish App /
 * MTC tabs) the "For Partner" picker said "No partners available. Add a
 * partner first." while `GET /api/partners` returned 4 active partners.
 *
 * No recharge form filters partners by system (owner decision Q5: the For
 * Partner list shows ALL active partners) — the list is only ever empty in
 * the picker while the fetch is still pending or after it failed, and
 * PartnerSelector rendered BOTH of those as "No partners available". These
 * tests pin the three states apart, through the real ForPartnerToggle the
 * recharge forms render.
 *
 * `useApi()` returns ONE module-level object (rule 25) — a fresh literal
 * per call would hide an unstable-identity effect loop.
 */

import { render, screen, fireEvent, act } from "@testing-library/react";
import type { Partner } from "@/types/electron";
import { ForPartnerToggle } from "../ForPartnerToggle";

const mockPartnersGetAll = jest.fn();
const mockApi = { partners: { getAll: mockPartnersGetAll } };

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

function partner(id: number, name: string): Partner {
  return {
    id,
    name,
    phone: null,
    notes: null,
    is_active: 1,
    system_association: "WHISH",
    created_at: "2026-10-16 08:00:00",
    updated_at: "2026-10-16 08:00:00",
  };
}

const WHISH_PARTNERS: Partner[] = [
  partner(4, "Flow Partner 7619"),
  partner(6, "Smoke Partner 3225"),
  partner(7, "Smoke Partner 4807"),
  partner(21, "OVERPAY Test Partner"),
];

function renderRechargeToggle() {
  return render(
    <ForPartnerToggle
      testId="katsh-for-partner-toggle"
      checked
      onChange={jest.fn()}
      selectedPartnerId={null}
      onPartnerChange={jest.fn()}
      autoSelectSingle
      selectorClassName=""
    />,
  );
}

describe("For Partner picker on recharge forms", () => {
  beforeEach(() => {
    mockPartnersGetAll.mockReset();
  });

  // Guard for owner decision Q5. NOT proven failing-first: today's code
  // already lists every partner here (no recharge site passes a system
  // filter) — it pins that no WHISH/OMT filter creeps back in.
  it("lists all 4 active partners even though every one is set up for WHISH", async () => {
    mockPartnersGetAll.mockResolvedValue(WHISH_PARTNERS);
    renderRechargeToggle();

    await screen.findByText("Select partner");
    fireEvent.click(screen.getByText("Select partner"));
    for (const p of WHISH_PARTNERS) {
      expect(await screen.findByText(p.name)).toBeInTheDocument();
    }
    expect(screen.queryByText(/No partners available/)).toBeNull();
  });

  it("does not claim there are no partners while the list is still loading", async () => {
    mockPartnersGetAll.mockReturnValue(new Promise<Partner[]>(() => {}));
    renderRechargeToggle();
    await act(async () => {});

    expect(screen.queryByText(/No partners available/)).toBeNull();
    expect(screen.getByText(/Loading partners/)).toBeInTheDocument();
  });

  it("says the list could not be loaded (with the reason) and retries", async () => {
    mockPartnersGetAll
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce(WHISH_PARTNERS);
    renderRechargeToggle();

    expect(
      await screen.findByText(/Couldn't load partners.*Network request failed/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No partners available/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await screen.findByText("Select partner");
    expect(mockPartnersGetAll).toHaveBeenCalledTimes(2);
  });

  it("still says 'No partners available' when the shop really has none", async () => {
    mockPartnersGetAll.mockResolvedValue([]);
    renderRechargeToggle();

    expect(
      await screen.findByText(/No partners available\. Add a partner first\./),
    ).toBeInTheDocument();
  });
});
