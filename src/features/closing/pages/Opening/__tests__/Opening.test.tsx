/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Opening from "../index";

jest.mock("../../../../auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 123, username: "u", role: "admin" } }),
}));

const mockUseCurrencies = jest.fn();
jest.mock("../../../hooks/useCurrencies", () => ({
  useCurrencies: () => mockUseCurrencies(),
}));

const mockInitializeAmounts = jest.fn();
const mockReset = jest.fn();
const mockUpdateAmount = jest.fn();
const mockValidate = jest.fn();
const mockGetDisplayValue = jest.fn();

const mockUseDrawerAmounts = jest.fn();
jest.mock("../../../hooks/useDrawerAmounts", () => ({
  useDrawerAmounts: () => mockUseDrawerAmounts(),
}));

function setupDrawerAmounts(overrides: Partial<ReturnType<typeof mockUseDrawerAmounts>> = {}) {
  const base = {
    amounts: {
      General: { USD: 0 },
      OMT: { USD: 0 },
      MTC: { USD: 0 },
      Alfa: { USD: 0 },
    },
    hasAnyAmounts: false,
    initializeAmounts: mockInitializeAmounts,
    reset: mockReset,
    updateAmount: mockUpdateAmount,
    validate: mockValidate,
    getDisplayValue: mockGetDisplayValue,
  };
  mockUseDrawerAmounts.mockReturnValue({ ...base, ...overrides });
}

describe("Opening modal", () => {
  const onClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    // window.api mock
    (window as any).api = {
      closing: {
        setOpeningBalances: jest.fn(),
      },
    };

    mockGetDisplayValue.mockReturnValue("");
  });

  afterEach(() => {
    delete (window as any).api;
  });

  it("renders nothing when closed", () => {
    mockUseCurrencies.mockReturnValue({ currencies: [], loading: false, error: null });
    setupDrawerAmounts();

    const { container } = render(<Opening isOpen={false} onClose={onClose} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows loading and error banners", () => {
    mockUseCurrencies.mockReturnValue({ currencies: [], loading: true, error: null });
    setupDrawerAmounts();

    render(<Opening isOpen={true} onClose={onClose} />);
    expect(screen.getByText("Loading currencies...")).toBeInTheDocument();

    mockUseCurrencies.mockReturnValue({ currencies: [], loading: false, error: "Boom" });
    render(<Opening isOpen={true} onClose={onClose} />);
    expect(screen.getAllByText(/Error: Boom/)[0]).toBeInTheDocument();
  });

  it("initializes amounts when currencies load and modal is open", () => {
    mockUseCurrencies.mockReturnValue({
      currencies: [{ code: "USD", name: "US Dollar", is_active: 1 }],
      loading: false,
      error: null,
    });
    setupDrawerAmounts();

    render(<Opening isOpen={true} onClose={onClose} />);
    expect(mockInitializeAmounts).toHaveBeenCalledTimes(1);
  });

  it("updates amount on input change", () => {
    mockUseCurrencies.mockReturnValue({
      currencies: [{ code: "USD", name: "US Dollar", is_active: 1 }],
      loading: false,
      error: null,
    });
    setupDrawerAmounts();

    render(<Opening isOpen={true} onClose={onClose} />);

    const input = screen.getByLabelText("USD", { selector: "#General-USD" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12.5" } });

    expect(mockUpdateAmount).toHaveBeenCalledWith("General", "USD", 12.5);
  });

  it("prevents save when validation fails", () => {
    mockUseCurrencies.mockReturnValue({
      currencies: [{ code: "USD", name: "US Dollar", is_active: 1 }],
      loading: false,
      error: null,
    });
    mockValidate.mockReturnValue({ isValid: false, errors: ["Bad amount"] });
    setupDrawerAmounts({ hasAnyAmounts: true }); // Need amounts for button to be enabled

    render(<Opening isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByText("Save & Start Day"));
    expect(screen.getByText(/Bad amount/)).toBeInTheDocument();
    expect((window as any).api.closing.setOpeningBalances).not.toHaveBeenCalled();
  });

  it("saves successfully and closes", async () => {
    jest.spyOn(window, "alert").mockImplementation(() => {});

    mockUseCurrencies.mockReturnValue({
      currencies: [{ code: "USD", name: "US Dollar", is_active: 1 }],
      loading: false,
      error: null,
    });
    mockValidate.mockReturnValue({ isValid: true, errors: [] });
    setupDrawerAmounts({
      hasAnyAmounts: true,
      amounts: { General: { USD: 10 }, OMT: { USD: 0 }, MTC: { USD: 0 }, Alfa: { USD: 0 } },
    });

    (window as any).api.closing.setOpeningBalances.mockResolvedValue({ success: true });

    render(<Opening isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByText("Save & Start Day"));

    await waitFor(() => {
      expect((window as any).api.closing.setOpeningBalances).toHaveBeenCalled();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(window.alert).toHaveBeenCalled();
  });

  it("asks for confirmation when cancelling with unsaved changes", () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);

    mockUseCurrencies.mockReturnValue({
      currencies: [{ code: "USD", name: "US Dollar", is_active: 1 }],
      loading: false,
      error: null,
    });
    setupDrawerAmounts({ hasAnyAmounts: true });

    render(<Opening isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByText("Cancel"));
    expect(window.confirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
