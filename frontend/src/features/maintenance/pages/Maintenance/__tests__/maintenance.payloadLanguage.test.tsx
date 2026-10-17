/** @jest-environment jsdom */
/**
 * LIRA-331 (T049-maintenance) — the screen's language never reaches the
 * money payload. Every payload the Maintenance page sends is built twice
 * through the REAL page — once in English, once in Arabic — and the two
 * captured payloads must be deep-equal (rule 28d: every mode the screen
 * offers, not just the happy path):
 *
 *   - new job saved as a draft (USD, warranty months)
 *   - an existing USD job with a part, saved as a draft (parts key present)
 *   - an existing LBP job saved as a draft (discount carried)
 *   - checkout, USD walk-in: cash, kept change, extra charge
 *   - checkout, LBP job with a USD part: split USD + LBP legs, change given
 *   - checkout to the customer's account (CUSTOMER_ACCOUNT leg, client_id)
 *   - "Save as Draft" from inside the checkout (client override)
 *   - checkout in a customer session → basket item (label + formData)
 *   - status transitions: Start (Received → In_Progress), Ready
 *   - delete a job
 *
 * Status values are codes ("In_Progress", "Delivered_Paid"); only their
 * labels are translated. The session basket label is stored text, so it
 * stays English in both languages.
 *
 * Not failing-first (guard against future drift): written before the
 * conversion and passing on the unconverted page.
 *
 * Rule 25: ONE stable api object and ONE stable session object.
 */
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { i18n } from "@/i18n/setup";
import Maintenance from "../index";

const mockAddToCart = jest.fn();
const mockSession: {
  activeSession: {
    id: number;
    customer_name: string;
    customer_phone: string;
  } | null;
  addToCart: jest.Mock;
} = { activeSession: null, addToCart: mockAddToCart };

const mockApi = {
  getMaintenanceJobs: jest.fn(),
  saveMaintenanceJob: jest.fn(),
  deleteMaintenanceJob: jest.fn(),
  getMaintenanceStatusHistory: jest.fn(),
  getProducts: jest.fn(),
  getAllSettings: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => mockSession,
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useAutoPrintReceipt", () => ({
  useAutoPrintReceipt: () => jest.fn().mockResolvedValue(undefined),
}));

type CheckoutProps = {
  totalAmount: number;
  currency?: string;
};

/** What the mocked CheckoutModal hands back, per scenario. */
let mockCheckoutData: (p: CheckoutProps) => Record<string, unknown> = () => ({});
let mockDraftData: Record<string, unknown> = {};

jest.mock("@/features/sales/pages/POS/components/CheckoutModal", () => ({
  __esModule: true,
  default: (props: {
    totalAmount: number;
    currency?: string;
    onComplete: (data: Record<string, unknown>) => Promise<void>;
    onSaveDraft: (data: Record<string, unknown>) => Promise<void>;
  }) => (
    <div data-testid="mock-checkout-modal">
      <button onClick={() => props.onComplete(mockCheckoutData(props))}>
        Mock Complete
      </button>
      <button onClick={() => props.onSaveDraft(mockDraftData)}>
        Mock Draft
      </button>
    </div>
  ),
}));

/** The page's own text for `key`, in whatever language is active. */
const tx = (key: string, en: string): string =>
  (i18n.t as unknown as (k: string, o: { defaultValue: string }) => string)(
    `maintenance:${key}`,
    { defaultValue: en },
  );

const PART = {
  id: 7,
  maintenance_id: 2,
  product_id: 5,
  product_name: "Screen Assembly",
  quantity: 2,
  unit_cost_usd: 25,
  unit_price_usd: 40,
  stock_restored: 0,
  created_at: "2026-09-01 10:00:00",
  updated_at: "2026-09-01 10:00:00",
  catalog_price_usd: 40,
};

const JOBS = [
  {
    id: 1,
    device_name: "Received USD Job",
    issue_description: "Screen swap",
    status: "Received",
    currency: "USD",
    cost_usd: 20,
    price_usd: 50,
    paid_usd: 0,
    paid_lbp: 0,
    discount_usd: 5,
    final_amount_usd: 45,
    client_name: "Rami Haddad",
    client_phone: "70123456",
    warranty_months: 3,
    created_at: "2026-10-01 09:00:00",
  },
  {
    id: 2,
    device_name: "LBP Parts Job",
    issue_description: "Battery swap",
    status: "In_Progress",
    currency: "LBP",
    cost_lbp: 100000,
    price_lbp: 500000,
    final_amount_lbp: 450000,
    paid_usd: 0,
    paid_lbp: 0,
    parts: [PART],
    parts_cost_usd: 50,
    parts_price_usd: 80,
    created_at: "2026-10-02 09:00:00",
  },
];

const byId = (id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not rendered`);
  return el;
};

async function openJob(device: string) {
  await screen.findByText(device);
  fireEvent.click(screen.getByText(device).closest("button")!);
}

function openCheckout() {
  fireEvent.click(screen.getByText(tx("actions.checkout", "Proceed to Checkout")));
}

type Captured = {
  save: unknown[];
  cart: unknown[];
  del: unknown[];
};

type Scenario = {
  name: string;
  session?: boolean;
  run: () => Promise<void>;
  /** Asserts the English capture directly, so en == ar cannot pass on two
   *  payloads that are wrong in the same way. */
  check?: (c: Captured) => void;
};

const SCENARIOS: Scenario[] = [
  {
    name: "new job saved as a draft (USD, warranty)",
    run: async () => {
      await screen.findByText("Received USD Job");
      fireEvent.change(byId("maintenance-device-name"), {
        target: { value: "Galaxy A55" },
      });
      fireEvent.change(byId("maintenance-issue"), {
        target: { value: "No charge" },
      });
      fireEvent.change(byId("maintenance-warranty-months"), {
        target: { value: "6" },
      });
      fireEvent.change(byId("maintenance-cost"), { target: { value: "15" } });
      fireEvent.change(byId("maintenance-price"), { target: { value: "35" } });
      fireEvent.change(byId("maintenance-client-name"), {
        target: { value: "Nour" },
      });
      fireEvent.change(byId("maintenance-client-phone"), {
        target: { value: "71222333" },
      });
      fireEvent.click(screen.getByText(tx("actions.saveDraft", "Save as Draft")));
      await waitFor(() => expect(mockApi.saveMaintenanceJob).toHaveBeenCalled());
    },
    check: (c) =>
      expect(c.save[0]).toMatchObject({
        device_name: "Galaxy A55",
        warranty_months: 6,
        cost_usd: 15,
        price_usd: 35,
        status: "Received",
      }),
  },
  {
    name: "existing LBP job with a USD part saved as a draft",
    run: async () => {
      await openJob("LBP Parts Job");
      fireEvent.click(screen.getByText(tx("actions.saveDraft", "Save as Draft")));
      await waitFor(() => expect(mockApi.saveMaintenanceJob).toHaveBeenCalled());
    },
  },
  {
    name: "existing USD job (discounted) saved as a draft",
    run: async () => {
      await openJob("Received USD Job");
      fireEvent.click(screen.getByText(tx("actions.saveDraft", "Save as Draft")));
      await waitFor(() => expect(mockApi.saveMaintenanceJob).toHaveBeenCalled());
    },
  },
  {
    name: "checkout USD walk-in: cash, kept change, extra",
    run: async () => {
      mockCheckoutData = (p) => ({
        client_id: null,
        client_name: "Rami Haddad",
        client_phone: "70123456",
        total_amount: p.totalAmount,
        discount: 5,
        final_amount: p.totalAmount - 5,
        currency: "USD",
        payment_usd: 60,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 60 }],
        change_given_usd: 0,
        change_given_lbp: 0,
        kept_change_usd: 10,
        kept_change_lbp: 0,
        extra_usd: 3,
        exchange_rate: 89500,
      });
      await openJob("Received USD Job");
      openCheckout();
      fireEvent.click(await screen.findByText("Mock Complete"));
      await waitFor(() => expect(mockApi.saveMaintenanceJob).toHaveBeenCalled());
    },
  },
  {
    name: "checkout LBP job with a part: split USD + LBP legs, change given",
    run: async () => {
      mockCheckoutData = (p) => ({
        client_id: null,
        total_amount: p.totalAmount,
        discount: 0,
        final_amount: p.totalAmount,
        currency: "LBP",
        payment_usd: 80,
        payment_lbp: 600000,
        payments: [
          { method: "CASH", currency_code: "USD", amount: 80 },
          { method: "CASH", currency_code: "LBP", amount: 600000 },
          {
            method: "CASH",
            currency_code: "LBP",
            amount: 100000,
            direction: "OUT",
          },
        ],
        change_given_usd: 0,
        change_given_lbp: 100000,
        exchange_rate: 89500,
      });
      await openJob("LBP Parts Job");
      openCheckout();
      fireEvent.click(await screen.findByText("Mock Complete"));
      await waitFor(() => expect(mockApi.saveMaintenanceJob).toHaveBeenCalled());
    },
  },
  {
    name: "checkout to the customer's account",
    run: async () => {
      mockCheckoutData = (p) => ({
        client_id: 42,
        client_name: "Rami Haddad",
        client_phone: "70999888",
        total_amount: p.totalAmount,
        discount: 0,
        final_amount: p.totalAmount,
        currency: "USD",
        payment_usd: 0,
        payment_lbp: 0,
        payments: [
          {
            method: "CUSTOMER_ACCOUNT",
            currency_code: "USD",
            amount: p.totalAmount,
          },
        ],
        change_given_usd: 0,
        change_given_lbp: 0,
        exchange_rate: 89500,
      });
      await openJob("Received USD Job");
      openCheckout();
      fireEvent.click(await screen.findByText("Mock Complete"));
      await waitFor(() => expect(mockApi.saveMaintenanceJob).toHaveBeenCalled());
    },
  },
  {
    name: "Save as Draft from inside the checkout (client override)",
    run: async () => {
      mockDraftData = {
        client_id: 42,
        client_name: "Rami Haddad",
        client_phone: "70999888",
      };
      await openJob("LBP Parts Job");
      openCheckout();
      fireEvent.click(await screen.findByText("Mock Draft"));
      await waitFor(() => expect(mockApi.saveMaintenanceJob).toHaveBeenCalled());
    },
  },
  {
    name: "checkout in a customer session → basket item",
    session: true,
    run: async () => {
      mockCheckoutData = (p) => ({
        client_id: null,
        total_amount: p.totalAmount,
        discount: 0,
        final_amount: p.totalAmount,
        currency: p.currency,
        payment_usd: 0,
        payment_lbp: p.totalAmount,
        payments: [
          { method: "CASH", currency_code: "LBP", amount: p.totalAmount },
        ],
        change_given_usd: 0,
        change_given_lbp: 0,
        exchange_rate: 89500,
      });
      await openJob("LBP Parts Job");
      openCheckout();
      fireEvent.click(await screen.findByText("Mock Complete"));
      await waitFor(() => expect(mockAddToCart).toHaveBeenCalled());
    },
    check: (c) => {
      const item = c.cart[0] as {
        label: string;
        formData: { status: string; parts?: unknown[] };
      };
      expect(item.label.startsWith("Maintenance: LBP Parts Job - ")).toBe(true);
      expect(item.formData.status).toBe("Delivered_Paid");
      expect(item.formData.parts).toHaveLength(1);
      expect(c.save).toHaveLength(0);
    },
  },
  {
    name: "status transition: Start (Received → In_Progress)",
    run: async () => {
      await screen.findByText("Received USD Job");
      fireEvent.click(
        screen.getByTitle(tx("jobs.markInProgress", "Mark In Progress")),
      );
      await waitFor(() => expect(mockApi.saveMaintenanceJob).toHaveBeenCalled());
    },
    check: (c) =>
      expect(c.save[0]).toMatchObject({ id: 1, status: "In_Progress" }),
  },
  {
    name: "status transition: Ready (In_Progress → Ready)",
    run: async () => {
      await screen.findByText("LBP Parts Job");
      fireEvent.click(screen.getByTitle(tx("jobs.markReady", "Mark Ready")));
      await waitFor(() => expect(mockApi.saveMaintenanceJob).toHaveBeenCalled());
    },
    check: (c) => expect(c.save[0]).toMatchObject({ id: 2, status: "Ready" }),
  },
  {
    name: "delete a job",
    run: async () => {
      await screen.findByText("LBP Parts Job");
      const row = screen.getByText("LBP Parts Job").closest("button")!;
      const del = row.querySelector<HTMLElement>(
        `[title="${tx("jobs.delete", "Delete job")}"]`,
      );
      if (!del) throw new Error("no delete button");
      fireEvent.click(del);
      await waitFor(() =>
        expect(mockApi.deleteMaintenanceJob).toHaveBeenCalled(),
      );
    },
    check: (c) => expect(c.del).toEqual([2]),
  },
];

async function capture(s: Scenario): Promise<Captured> {
  jest.clearAllMocks();
  mockApi.getMaintenanceJobs.mockResolvedValue(JOBS);
  mockApi.saveMaintenanceJob.mockResolvedValue({ success: true, id: 9 });
  mockApi.deleteMaintenanceJob.mockResolvedValue({ success: true });
  mockApi.getMaintenanceStatusHistory.mockResolvedValue([]);
  mockApi.getProducts.mockResolvedValue([]);
  mockApi.getAllSettings.mockResolvedValue([]);
  mockSession.activeSession = s.session
    ? { id: 7, customer_name: "Rami Haddad", customer_phone: "70123456" }
    : null;
  render(<Maintenance />);
  await s.run();
  const out: Captured = {
    save: mockApi.saveMaintenanceJob.mock.calls.map((c) => c[0]),
    cart: mockAddToCart.mock.calls.map((c) => c[0]),
    del: mockApi.deleteMaintenanceJob.mock.calls.map((c) => c[0]),
  };
  cleanup();
  return out;
}

beforeAll(() => {
  window.confirm = jest.fn(() => true);
  window.alert = jest.fn();
});

afterEach(async () => {
  mockSession.activeSession = null;
  await i18n.changeLanguage("en");
});

describe("Maintenance payloads are identical in English and Arabic (LIRA-331)", () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))(
    "%s",
    async (_name, scenario) => {
      await i18n.changeLanguage("en");
      const en = await capture(scenario);
      expect(en.save.length + en.cart.length + en.del.length).toBeGreaterThan(0);
      scenario.check?.(en);

      const { loadLanguage } = await import("@/i18n/setup");
      await loadLanguage("ar");
      await i18n.changeLanguage("ar");
      expect(i18n.t("maintenance:page.title")).toBe("التصليحات");

      const ar = await capture(scenario);
      expect(ar).toEqual(en);
    },
  );
});
