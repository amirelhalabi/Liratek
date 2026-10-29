/**
 * LIRA-360 — the Dashboard "Insurance renewals" card.
 *
 * RULE 17 — written before `InsuranceRenewalsCard.tsx` existed.
 * RULE 25 — `useApi()` returns ONE stable object across renders.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { InsuranceRenewal } from "@liratek/core";
import { InsuranceRenewalsCard } from "../InsuranceRenewalsCard";

const mockApi = {
  getInsuranceRenewals: jest.fn(),
  dismissInsuranceRenewal: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

let mockCustomServicesOn = true;
jest.mock("@/contexts/ModuleContext", () => ({
  useModules: () => ({
    isModuleEnabled: (key: string) =>
      key === "custom_services" ? mockCustomServicesOn : true,
  }),
}));

function renewal(over: Partial<InsuranceRenewal>): InsuranceRenewal {
  return {
    id: 1,
    client_id: null,
    client_name: "Ali Hassan",
    phone_number: "70 123 456",
    description: "Car insurance",
    insurance_type: "COMPULSORY",
    sale_day: "2025-11-03",
    expiry_day: "2026-11-03",
    days_left: 5,
    ...over,
  };
}

describe("InsuranceRenewalsCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomServicesOn = true;
    jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("asks for the shop's own day and lists name, phone, type and days", async () => {
    mockApi.getInsuranceRenewals.mockResolvedValue([
      renewal({ id: 2, client_name: "Rana", days_left: -150, expiry_day: "2026-06-01" }),
      renewal({ id: 1, days_left: 5 }),
      renewal({ id: 3, client_name: null, description: "Maid policy", insurance_type: "DOMESTIC_WORKER", days_left: 0 }),
    ]);
    render(<InsuranceRenewalsCard />);

    expect(await screen.findByTestId("insurance-renewal-row-1")).toHaveTextContent(
      /Ali Hassan.*70 123 456.*Compulsory.*in 5 days/s,
    );
    expect(screen.getByTestId("insurance-renewal-row-2")).toHaveTextContent(
      /Rana.*expired 150 days ago/s,
    );
    expect(screen.getByTestId("insurance-renewal-row-3")).toHaveTextContent(
      /Maid policy.*Domestic worker.*today/s,
    );
    expect(mockApi.getInsuranceRenewals).toHaveBeenCalledWith({
      client_day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("shows no money", async () => {
    mockApi.getInsuranceRenewals.mockResolvedValue([renewal({})]);
    render(<InsuranceRenewalsCard />);
    const card = await screen.findByTestId("insurance-renewals-card");
    await screen.findByTestId("insurance-renewal-row-1");
    expect(card.textContent).not.toMatch(/\$|LBP/);
  });

  it("shows the empty message when nobody is due", async () => {
    mockApi.getInsuranceRenewals.mockResolvedValue([]);
    render(<InsuranceRenewalsCard />);
    expect(await screen.findByTestId("insurance-renewals-empty")).toHaveTextContent(
      "No insurance renewals due",
    );
  });

  it("renders nothing when Custom Services is off", () => {
    mockCustomServicesOn = false;
    mockApi.getInsuranceRenewals.mockResolvedValue([renewal({})]);
    const { container } = render(<InsuranceRenewalsCard />);
    expect(container).toBeEmptyDOMElement();
    expect(mockApi.getInsuranceRenewals).not.toHaveBeenCalled();
  });

  it("'Won't renew' asks first, then removes the row", async () => {
    mockApi.getInsuranceRenewals
      .mockResolvedValueOnce([renewal({})])
      .mockResolvedValueOnce([]);
    mockApi.dismissInsuranceRenewal.mockResolvedValue({ success: true });
    render(<InsuranceRenewalsCard />);

    fireEvent.click(await screen.findByTestId("insurance-renewal-dismiss-1"));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockApi.dismissInsuranceRenewal).toHaveBeenCalledWith({ id: 1 }),
    );
    expect(await screen.findByTestId("insurance-renewals-empty")).toBeInTheDocument();
  });

  it("cancelling the question changes nothing", async () => {
    (window.confirm as jest.Mock).mockReturnValue(false);
    mockApi.getInsuranceRenewals.mockResolvedValue([renewal({})]);
    render(<InsuranceRenewalsCard />);
    fireEvent.click(await screen.findByTestId("insurance-renewal-dismiss-1"));
    expect(mockApi.dismissInsuranceRenewal).not.toHaveBeenCalled();
    expect(screen.getByTestId("insurance-renewal-row-1")).toBeInTheDocument();
  });

  it("shows the server's refusal", async () => {
    mockApi.getInsuranceRenewals.mockResolvedValue([renewal({})]);
    mockApi.dismissInsuranceRenewal.mockResolvedValue({
      success: false,
      error: "This insurance is not on the renewal list",
    });
    render(<InsuranceRenewalsCard />);
    fireEvent.click(await screen.findByTestId("insurance-renewal-dismiss-1"));
    expect(
      await screen.findByText("This insurance is not on the renewal list"),
    ).toBeInTheDocument();
  });
});
