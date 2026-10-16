/** @jest-environment jsdom */

/**
 * Shop-day finding B6/B7 (2026-10-16): on the Hold Money form and its
 * pickup ("Return hold") sheet the payment-method dropdown was EMPTY
 * (value "") for ~1.5 s to several seconds — until `usePaymentMethods`'
 * fetch returned. Each mount refetches, so the sheet was empty every time it
 * opened. The forms must show Cash at once, and keep Cash once the real list
 * arrives.
 *
 * The real `usePaymentMethods` hook and the real `MultiPaymentInput` run
 * here; only the methods request is held open by hand (deferred promise),
 * which makes the "still loading" window deterministic.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
} from "@testing-library/react";
import { HoldMoneySection } from "../HoldMoneySection";
import { HoldMoneyPickupSheet } from "../HoldMoneyPickupSheet";
import {
  holdMoneyLegsHaveMethods,
  holdMoneyMethodOptions,
} from "../holdMoneyMethods";

type Method = {
  id: number;
  code: string;
  label: string;
  drawer_name: string;
  affects_drawer: number;
  sort_order: number;
  is_active: number;
  is_system: number;
  created_at: string;
};

let resolveMethods: (m: Method[]) => void = () => {};
const mockGetActivePaymentMethods = jest.fn(
  () =>
    new Promise<Method[]>((r) => {
      resolveMethods = r;
    }),
);

const METHODS: Method[] = [
  ["CASH", "Cash", "General"],
  ["OMT", "OMT", "OMT_System"],
  ["WHISH", "Whish", "Whish_App"],
  ["CUSTOMER_ACCOUNT", "Customer Account", ""],
].map(([code, label, drawer], i) => ({
  id: i + 1,
  code,
  label,
  drawer_name: drawer,
  affects_drawer: code === "CUSTOMER_ACCOUNT" ? 0 : 1,
  sort_order: i,
  is_active: 1,
  is_system: 1,
  created_at: "2026-10-16 00:00:00",
}));

// Rule 25 — a STABLE useApi() reference.
const mockApi = {
  getActivePaymentMethods: mockGetActivePaymentMethods,
  holdMoney: {
    list: jest.fn().mockResolvedValue({ success: true, data: [] }),
    create: jest.fn().mockResolvedValue({ success: true, id: 1 }),
    pickups: jest.fn().mockResolvedValue({ success: true, data: [] }),
    voidPickup: jest.fn(),
    collect: jest.fn().mockResolvedValue({ success: true, id: 2 }),
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    DecimalInput: ({
      value,
      onChange,
      id,
      "data-testid": testId,
    }: {
      value: number;
      onChange: (n: number) => void;
      id?: string;
      "data-testid"?: string;
    }) => (
      <input
        data-testid={testId ?? id}
        value={value === 0 ? "" : String(value)}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    ),
  };
});

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 89500 }),
}));

jest.mock("@/api/backendApi", () => ({
  getClients: jest.fn().mockResolvedValue([]),
  getDebtors: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

function methodSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector(
    'select[data-testid^="payment-method-"]',
  );
  if (!select) throw new Error("payment method select not rendered");
  return select as HTMLSelectElement;
}

function optionLabels(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => o.textContent ?? "");
}

beforeEach(() => {
  mockGetActivePaymentMethods.mockClear();
});

describe("Hold Money — payment method is Cash while methods are still loading", () => {
  it("hold form: Cash at once, still Cash after the list arrives", async () => {
    const { container } = render(<HoldMoneySection />);
    fireEvent.change(screen.getByTestId("hold-usd"), {
      target: { value: "200" },
    });

    // Methods request still pending.
    expect(mockGetActivePaymentMethods).toHaveBeenCalled();
    const select = methodSelect(container);
    expect(select.value).toBe("CASH");
    expect(optionLabels(select)).toContain("Cash");

    await act(async () => {
      resolveMethods(METHODS);
    });
    await waitFor(() =>
      expect(optionLabels(methodSelect(container))).toEqual([
        "Cash",
        "OMT",
        "Whish",
      ]),
    );
    expect(methodSelect(container).value).toBe("CASH");
  });

  it("pickup sheet: Cash at once, still Cash after the list arrives", async () => {
    const { container } = render(
      <HoldMoneyPickupSheet
        hold={{
          id: 3,
          client_name: "Georges Khoury",
          remaining_usd: 200,
          remaining_lbp: 0,
        }}
        onClose={jest.fn()}
        onCollected={jest.fn()}
      />,
    );

    const select = methodSelect(container);
    expect(select.value).toBe("CASH");
    expect(optionLabels(select)).toContain("Cash");

    await act(async () => {
      resolveMethods(METHODS);
    });
    await waitFor(() =>
      expect(optionLabels(methodSelect(container))).toContain("Whish"),
    );
    expect(methodSelect(container).value).toBe("CASH");
    expect(
      within(container).getByTestId("hold-money-pickup-submit"),
    ).not.toBeDisabled();
  });
});

describe("holdMoneyMethods helpers", () => {
  it("offers Cash alone until the list loads, then only the allowed methods", () => {
    expect(holdMoneyMethodOptions([])).toEqual([
      { code: "CASH", label: "Cash" },
    ]);
    expect(holdMoneyMethodOptions(METHODS).map((m) => m.code)).toEqual([
      "CASH",
      "OMT",
      "WHISH",
    ]);
  });

  it("refuses a leg with an empty or unoffered method", () => {
    const options = holdMoneyMethodOptions(METHODS);
    expect(holdMoneyLegsHaveMethods([{ method: "CASH" }], options)).toBe(true);
    expect(holdMoneyLegsHaveMethods([{ method: "" }], options)).toBe(false);
    expect(
      holdMoneyLegsHaveMethods([{ method: "CUSTOMER_ACCOUNT" }], options),
    ).toBe(false);
    expect(holdMoneyLegsHaveMethods([], options)).toBe(true);
  });
});
