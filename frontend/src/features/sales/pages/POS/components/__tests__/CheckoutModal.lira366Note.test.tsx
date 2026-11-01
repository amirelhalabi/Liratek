/** @jest-environment jsdom */
/**
 * LIRA-366 — POS checkout has one optional Note box (`payment-note`). The
 * typed text is sent as `typedNote` in the one PaymentData the POS page
 * spreads into processSale (walk-in and session basket alike). Blank is
 * dropped by the schema. Maintenance renders this modal without the box
 * (its job form has its own note). Payload parsed through
 * `saleProcessSchema` (rule 24). Rule 17: seen failing before the box.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { saleProcessSchema } from "@liratek/core";
import CheckoutModal from "../CheckoutModal";

type OnComplete = ComponentProps<typeof CheckoutModal>["onComplete"];
type PaymentData = Parameters<OnComplete>[0];

const mockApi = {
  getClients: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
  getRates: jest.fn().mockResolvedValue([]),
  partners: { getAll: jest.fn().mockResolvedValue([]) },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockApi };
});

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [{ id: 1, code: "CASH", label: "Cash", is_active: 1 }],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => ({ name: "Shop", phone: "", location: "", logo: "" }),
}));

function renderModal(
  props: Partial<ComponentProps<typeof CheckoutModal>> = {},
) {
  const onComplete = jest.fn<ReturnType<OnComplete>, [PaymentData]>(() =>
    Promise.resolve(),
  );
  render(
    <CheckoutModal
      totalAmount={6}
      currency="USD"
      onComplete={onComplete}
      onSaveDraft={jest.fn().mockResolvedValue(undefined)}
      {...props}
    />,
  );
  return onComplete;
}

/** The payload as the server's shared schema reads it (items are added by
 *  the POS page, not the modal). */
function parse(p: PaymentData) {
  return saleProcessSchema.parse({
    ...p,
    items: [{ product_id: 1, quantity: 1, price: 6 }],
  });
}

async function complete(onComplete: ReturnType<typeof renderModal>) {
  fireEvent.click(screen.getByText("Complete Sale"));
  await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  return onComplete.mock.calls[0][0];
}

describe("CheckoutModal — payment note (LIRA-366)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("typed note → parsed payload carries typedNote (trimmed)", async () => {
    const onComplete = renderModal({ showNote: true });
    fireEvent.change(await screen.findByTestId("payment-note"), {
      target: { value: "  rest on Monday " },
    });
    const parsed = parse(await complete(onComplete));
    expect(parsed.typedNote).toBe("rest on Monday");
  });

  it("note left empty → no typedNote", async () => {
    const onComplete = renderModal({ showNote: true });
    await screen.findByTestId("payment-note");
    const parsed = parse(await complete(onComplete));
    expect(parsed.typedNote).toBeUndefined();
  });

  it("no box unless the host opts in (Maintenance)", async () => {
    renderModal();
    await screen.findByTestId("payment-summary");
    expect(screen.queryByTestId("payment-note")).toBeNull();
  });
});
