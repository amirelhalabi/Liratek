/** @jest-environment jsdom */
/**
 * FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 4a — the Partners
 * "System Association" dropdown offers the REAL, tenant-scoped provider
 * list from `service_providers` instead of the hardcoded
 * `{None, <shop's non-owned system>}` pair (previously derived from
 * `useShopBase()`'s two-value `BaseSystem` union).
 *
 * Interaction-level, not props-level (per LIRA-097/LIRA-120, see
 * ../Partners.addCreditLbp.test.tsx's doc comment for the cautionary tale):
 * this opens the REAL `<Select>` (headlessui, not mocked), clicks the real
 * rendered option list, and asserts on the ACTUAL submitted payload. A
 * provider with neither an "OMT" nor a "WHISH" code (here: "SYRIA", the
 * plan's own '7welet souria' example) proves the list is API-driven — that
 * option could never have existed under the old hardcoded pair.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Partners from "../index";

const mockGetAllBalances = jest.fn();
const mockPartnersCreate = jest.fn();
const mockGetActiveServiceProviders = jest.fn();

const MOCK_PROVIDERS = [
  {
    id: 1,
    code: "OMT",
    label: "OMT",
    drawer_name: "OMT_System",
    is_system_provider: 1,
    sort_order: 0,
    is_active: 1,
    is_system: 1,
    created_at: "2026-08-01T00:00:00Z",
  },
  {
    id: 2,
    code: "WHISH",
    label: "Whish",
    drawer_name: "Whish_System",
    is_system_provider: 1,
    sort_order: 1,
    is_active: 1,
    is_system: 1,
    created_at: "2026-08-01T00:00:00Z",
  },
  {
    id: 3,
    code: "SYRIA",
    label: "Syria Remittance",
    drawer_name: "General",
    is_system_provider: 0,
    sort_order: 9,
    is_active: 1,
    is_system: 0,
    created_at: "2026-08-01T00:00:00Z",
  },
];

// Keep the REAL Select/Modal/PageHeader/etc. — only `useApi` needs a stub
// (no ApiProvider is mounted in this test), mirroring
// Partners.addCreditLbp.test.tsx.
jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      partners: {
        getAllBalances: mockGetAllBalances,
        getLedger: jest.fn(),
        create: mockPartnersCreate,
        update: jest.fn(),
        settle: jest.fn(),
        writeOff: jest.fn(),
        deactivate: jest.fn(),
        activate: jest.fn(),
        getBalance: jest.fn(),
        recordTransaction: jest.fn(),
      },
      getActiveServiceProviders: mockGetActiveServiceProviders,
    }),
  };
});

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

describe("Partners page — System Association dropdown offers the real provider list (§5b phase 4a)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllBalances.mockResolvedValue([]);
    mockGetActiveServiceProviders.mockResolvedValue(MOCK_PROVIDERS);
    mockPartnersCreate.mockResolvedValue({ success: true, data: { id: 99 } });
  });

  it("lists providers returned by the API (not the hardcoded OMT/WHISH pair) and submits the selected provider's code", async () => {
    render(<Partners />);

    fireEvent.click(await screen.findByRole("button", { name: "Add Partner" }));

    await screen.findByText("System Association");

    // The dropdown's default selection is `partnerSystem` ("WHISH") for a
    // brand-new partner. It only renders as "Whish" once the REAL provider
    // list has resolved and matched that code against a real `label` —
    // proof the control is now data-driven, not a static two-value union.
    const trigger = await screen.findByRole("button", { name: "Whish" });
    fireEvent.click(trigger);

    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();

    expect(screen.getByRole("option", { name: "None" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "OMT" })).toBeInTheDocument();
    // "Syria Remittance" carries neither the OMT nor the WHISH code — under
    // the old hardcoded {None, <non-owned system>} pair this option could
    // never have existed at all.
    const syriaOption = screen.getByRole("option", {
      name: "Syria Remittance",
    });

    fireEvent.click(syriaOption);
    await screen.findByRole("button", { name: "Syria Remittance" });

    fireEvent.change(screen.getByPlaceholderText("Partner name"), {
      target: { value: "7welet souria" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockPartnersCreate).toHaveBeenCalled());
    const payload = mockPartnersCreate.mock.calls[0][0];
    expect(payload.system_association).toBe("SYRIA");
    expect(payload.name).toBe("7welet souria");
  });
});
