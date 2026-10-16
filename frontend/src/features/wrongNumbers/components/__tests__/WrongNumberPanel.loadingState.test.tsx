/** @jest-environment jsdom */

/**
 * Shop-day finding D3 (2026-10-16): when `GET /api/mobile-service-items`
 * was slow, the wrong-number window showed "No MTC or Alfa card from iPick"
 * — as if the shop had no such card — with no sign it was still loading, and
 * a failed load left it like that for good. It must say it is loading, keep
 * Save off until the cards are in, and on failure show an error with Retry.
 *
 * Deferred promises hold the requests open by hand; the `useApi` mock is a
 * stable module-level object (rule 25).
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { WrongNumberPanel } from "../WrongNumberPanel";

const mockGetActiveMobileServiceItems = jest.fn();
const mockGetAllActiveCarrierLines = jest.fn();
const mockApi = {
  recordWrongNumber: jest.fn(),
  getWrongNumberSaleCard: jest.fn().mockResolvedValue(null),
  getActiveMobileServiceItems: mockGetActiveMobileServiceItems,
  getAllActiveCarrierLines: mockGetAllActiveCarrierLines,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const ALFA_CARD = {
  id: 5,
  provider: "iPick",
  category: "alfa",
  label: "7.58",
  cost_lbp: 770000,
  credits: 7.58,
  is_active: 1,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPanel() {
  return render(
    <WrongNumberPanel
      provider="iPick"
      onDone={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAllActiveCarrierLines.mockResolvedValue([]);
});

describe("WrongNumberPanel — loading and error states", () => {
  it("says it is loading (not 'No MTC or Alfa card') and keeps Save off", async () => {
    const items = deferred<unknown[]>();
    mockGetActiveMobileServiceItems.mockReturnValue(items.promise);

    renderPanel();

    expect(screen.queryByText(/No MTC or Alfa card/)).toBeNull();
    expect(screen.getByTestId("wrong-number-loading")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Record wrong number/ }),
    ).toBeDisabled();

    await act(async () => {
      items.resolve([ALFA_CARD]);
    });
    expect(screen.queryByTestId("wrong-number-loading")).toBeNull();
    expect(screen.getByText(/Alfa 7\.58/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Record wrong number/ }),
    ).not.toBeDisabled();
  });

  it("shows an error with Retry when the cards fail to load, and Retry reloads", async () => {
    mockGetActiveMobileServiceItems
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValueOnce([ALFA_CARD]);

    renderPanel();

    const err = await screen.findByTestId("wrong-number-load-error");
    expect(err).toHaveTextContent(/Network down/);
    expect(screen.queryByText(/No MTC or Alfa card/)).toBeNull();
    expect(
      screen.getByRole("button", { name: /Record wrong number/ }),
    ).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    });
    expect(mockGetActiveMobileServiceItems).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(/Alfa 7\.58/)).toBeInTheDocument();
    expect(screen.queryByTestId("wrong-number-load-error")).toBeNull();
  });
});
