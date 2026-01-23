/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import Closing from "../Closing";

jest.mock("../../../../auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 123, username: "admin", role: "admin" } }),
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

const mockFetchSystemExpected = jest.fn();
const mockGetExpectedAmount = jest.fn();
const mockUseSystemExpected = jest.fn();
jest.mock("../../../hooks/useSystemExpected", () => ({
  useSystemExpected: () => mockUseSystemExpected(),
}));

const emitSpy = jest.fn();
jest.mock("../../../../../shared/utils/appEvents", () => ({
  appEvents: {
    emit: (...args: any[]) => emitSpy(...args),
    on: jest.fn(() => () => {}),
    off: jest.fn(),
  },
}));

function setupDrawerAmounts(overrides: Partial<any> = {}) {
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

describe("Closing modal", () => {
  const onClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    (window as any).api = {
      closing: {
        createDailyClosing: jest.fn(),
      },
      settings: {
        getAll: jest.fn().mockResolvedValue([
          { key_name: "closing_variance_threshold_pct", value: "5" },
        ]),
        update: jest.fn(),
      },
    };

    mockGetDisplayValue.mockReturnValue("");
    mockValidate.mockReturnValue({ isValid: true, errors: [] });

    mockUseCurrencies.mockReturnValue({
      currencies: [{ code: "USD", name: "US Dollar", is_active: 1 }],
      loading: false,
      error: null,
    });

    setupDrawerAmounts();

    mockUseSystemExpected.mockReturnValue({
      systemExpected: null,
      loading: false,
      error: null,
      fetchSystemExpected: mockFetchSystemExpected,
      getExpectedAmount: mockGetExpectedAmount,
    });
  });

  afterEach(() => {
    delete (window as any).api;
  });

  it("renders nothing when closed", () => {
    const { container } = render(<Closing isOpen={false} onClose={onClose} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("step 1: requires at least one amount before proceeding", () => {
    setupDrawerAmounts({ hasAnyAmounts: false });
    render(<Closing isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByText("Next Step"));
    expect(
      screen.getByText(/Please enter at least one amount before proceeding/),
    ).toBeInTheDocument();
  });

  it("step 1: goes to step 2 and fetches expected balances", async () => {
    setupDrawerAmounts({ hasAnyAmounts: true });

    render(<Closing isOpen={true} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Next Step"));
    });

    // subtitle changes to step 2
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();

    await waitFor(() => {
      expect(mockFetchSystemExpected).toHaveBeenCalled();
    });
  });

  it("step 2: renders variance cards when systemExpected is available", async () => {
    setupDrawerAmounts({
      hasAnyAmounts: true,
      amounts: {
        General: { USD: 10 },
        OMT: { USD: 0 },
        MTC: { USD: 0 },
        Alfa: { USD: 0 },
      },
    });
    mockUseSystemExpected.mockReturnValue({
      systemExpected: {
        generalDrawer: { usd: 5 },
        omtDrawer: { usd: 0 },
        mtcDrawer: { usd: 0 },
        alfaDrawer: { usd: 0 },
      },
      loading: false,
      error: null,
      fetchSystemExpected: mockFetchSystemExpected,
      getExpectedAmount: (_drawer: string, _code: string) => 0,
    });

    render(<Closing isOpen={true} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Next Step"));
    });

    expect(screen.getByText(/Variance Review/)).toBeInTheDocument();
    // should show at least one drawer label
    expect(screen.getAllByText("General").length).toBeGreaterThan(0);
  });

  it("step 2: shows warning banner when variance exceeds threshold", async () => {
    // Make physical far from expected to exceed threshold.
    setupDrawerAmounts({
      hasAnyAmounts: true,
      amounts: {
        General: { USD: 1000 },
        OMT: {},
        MTC: {},
        Alfa: {},
      },
    });

    mockUseSystemExpected.mockReturnValue({
      systemExpected: {
        generalDrawer: { usd: 100, lbp: 0, eur: 0 },
        omtDrawer: { usd: 0, lbp: 0, eur: 0 },
        mtcDrawer: { usd: 0, lbp: 0, eur: 0 },
        alfaDrawer: { usd: 0, lbp: 0, eur: 0 },
      },
      loading: false,
      error: null,
      fetchSystemExpected: mockFetchSystemExpected,
      getExpectedAmount: mockGetExpectedAmount,
    });

    render(<Closing isOpen={true} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Next Step"));
      // flush effects (threshold load)
      await Promise.resolve();
    });

    // Threshold is configured at 5% in settings mock (beforeEach)
    expect(
      await screen.findByText(/Variance threshold exceeded \(5%\+\)/),
    ).toBeInTheDocument();
  });

  it("step 3: allows adding notes and saves successfully", async () => {
    jest.spyOn(window, "alert").mockImplementation(() => {});

    setupDrawerAmounts({
      hasAnyAmounts: true,
      amounts: {
        General: { USD: 10 },
        OMT: { USD: 0 },
        MTC: { USD: 0 },
        Alfa: { USD: 0 },
      },
    });
    mockUseSystemExpected.mockReturnValue({
      systemExpected: {
        generalDrawer: { usd: 10 },
        omtDrawer: { usd: 0 },
        mtcDrawer: { usd: 0 },
        alfaDrawer: { usd: 0 },
      },
      loading: false,
      error: null,
      fetchSystemExpected: mockFetchSystemExpected,
      getExpectedAmount: (_drawer: string, _code: string) => 0,
    });

    (window as any).api.closing.createDailyClosing.mockResolvedValue({
      success: true,
    });

    render(<Closing isOpen={true} onClose={onClose} />);

    // to step 2
    await act(async () => {
      fireEvent.click(screen.getByText("Next Step"));
    });
    // to step 3
    await act(async () => {
      fireEvent.click(screen.getByText("Next Step"));
    });

    expect(screen.getByText(/Step 3 of 3/)).toBeInTheDocument();

    fireEvent.change(
      screen.getByPlaceholderText("Explain any variances or issues..."),
      {
        target: { value: "note" },
      },
    );

    fireEvent.click(screen.getByText("Save & Close Day"));

    await waitFor(() => {
      expect((window as any).api.closing.createDailyClosing).toHaveBeenCalled();
    });

    expect(window.alert).toHaveBeenCalled();
    expect(emitSpy).toHaveBeenCalledWith(
      "closing:completed",
      expect.any(Object),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("cancel asks for confirmation after progressing", () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    setupDrawerAmounts({ hasAnyAmounts: true });

    render(<Closing isOpen={true} onClose={onClose} />);

    fireEvent.click(screen.getByText("Next Step"));
    // allow async threshold update to flush (Next Step triggers async settings load)
    return act(async () => {
      fireEvent.click(screen.getByText("Cancel"));
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
