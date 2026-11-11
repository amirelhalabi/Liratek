/**
 * CheckoutModal — 5 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 5).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { type ComponentProps } from "react";
import { saleProcessSchema } from "@liratek/core";
import CheckoutModal, { type CheckoutDraftData } from "../CheckoutModal";

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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockApi.getClients as unknown as jest.Mock).mockReset();
  (mockApi.getClients as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.getAllSettings as unknown as jest.Mock).mockReset();
  (mockApi.getAllSettings as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.getRates as unknown as jest.Mock).mockReset();
  (mockApi.getRates as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.partners.getAll as unknown as jest.Mock).mockReset();
  (mockApi.partners.getAll as unknown as jest.Mock).mockResolvedValue([]);
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("CheckoutModal.autoExtra (LIRA-334)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * CheckoutModal — round-up autofill of "+ Extra" (LIRA-334, owner
   * 2026-10-18). A $102.90 sale paid with $103.00: the line switches to
   * "+ Extra" with 0.10 filled in (the shop keeps it as an extra charge). The
   * cashier clears it to give the change back; it does not refill until the
   * payment changes. Never with a discount typed, above $5, or for a
   * session-basket job. Payload names from the schema (rule 24).
   *
   * Rule 17: run against CheckoutModal before the autofill — the autofill
   * cases failed (no extra side, extra_usd undefined); the guard cases passed.
   */

  type OnComplete = ComponentProps<typeof CheckoutModal>["onComplete"];
  type PaymentData = Parameters<OnComplete>[0];

  function renderModal(
    props: Partial<ComponentProps<typeof CheckoutModal>> = {},
  ) {
    const onComplete = jest.fn<ReturnType<OnComplete>, [PaymentData]>(() =>
      Promise.resolve(),
    );
    render(
      <CheckoutModal
        totalAmount={102.9}
        currency="USD"
        allowExtraCharge={true}
        onComplete={onComplete}
        onSaveDraft={jest.fn().mockResolvedValue(undefined)}
        {...props}
      />,
    );
    return onComplete;
  }

  const lineInput = () =>
    screen.getByTestId("checkout-discount-input") as HTMLInputElement;

  const paymentAmount = () =>
    document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );

  /** The payload as the server's shared schema reads it (items are added by
   *  the POS page, not the modal). */
  function parse(p: PaymentData) {
    return saleProcessSchema.parse({
      ...p,
      items: [{ product_id: 1, quantity: 1, price: 102.9 }],
    });
  }

  async function complete(onComplete: ReturnType<typeof renderModal>) {
    fireEvent.click(screen.getByText("Complete Sale"));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    return onComplete.mock.calls[0][0];
  }

  async function pay(amount: string) {
    const amt = paymentAmount();
    if (!amt) throw new Error("no payment-amount input rendered");
    fireEvent.change(amt, { target: { value: amount } });
  }

  describe("CheckoutModal — round-up fills + Extra (LIRA-334)", () => {
    beforeEach(() => jest.clearAllMocks());

    it("$103 on $102.90 → + Extra 0.10, no change box, payload extra_usd 0.1", async () => {
      const onComplete = renderModal();
      const box = await screen.findByTestId("payment-summary");
      await pay("103");
      await waitFor(() =>
        expect(within(box).getByTestId("discount-mode-extra")).toHaveAttribute(
          "aria-pressed",
          "true",
        ),
      );
      expect(lineInput().value).toBe("0.1");
      expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
      const parsed = parse(await complete(onComplete));
      expect(parsed.extra_usd).toBeCloseTo(0.1, 2);
      expect(parsed.final_amount).toBe(102.9);
      expect(parsed.payment_usd).toBe(103);
    });

    it("clearing the extra gives the change box back and does not refill", async () => {
      const onComplete = renderModal();
      await screen.findByTestId("payment-summary");
      await pay("103");
      await waitFor(() => expect(lineInput().value).toBe("0.1"));
      fireEvent.change(lineInput(), { target: { value: "" } });
      expect(await screen.findByTestId("return-change")).toBeInTheDocument();
      expect(lineInput().value).toBe("");
      const p = await complete(onComplete);
      expect(parse(p).extra_usd ?? 0).toBe(0);
    });

    it("a discount already typed → nothing is filled in", async () => {
      renderModal();
      await screen.findByTestId("payment-summary");
      fireEvent.change(lineInput(), { target: { value: "0.9" } });
      await pay("103");
      expect(screen.getByTestId("discount-mode-discount")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(await screen.findByTestId("return-change")).toBeInTheDocument();
    });

    it("above the $5 cap → nothing is filled in, change box as today", async () => {
      renderModal();
      await screen.findByTestId("payment-summary");
      await pay("110");
      expect(await screen.findByTestId("return-change")).toBeInTheDocument();
      expect(screen.getByTestId("discount-mode-discount")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("session-basket job → no autofill", async () => {
      const onComplete = renderModal({ addsToSessionBasket: true });
      await screen.findByTestId("payment-summary");
      await pay("103");
      const p = await complete(onComplete);
      expect("extra_usd" in p).toBe(false);
    });
  });
});

describe("CheckoutModal.discountInPaymentBox (LIRA-318)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * CheckoutModal — one Discount line in the payment box (LIRA-318).
   *
   * Owner 2026-10-13: the POS / Maintenance checkout discount moves out of the
   * "Order Summary" panel and into the payment box, under "Total Amount",
   * through MultiPaymentInput's `discountRow` slot. The modal still owns the
   * value, the `maxDiscount` cap and the payload (`discount`, `final_amount`);
   * typing above the cap now says so ("Capped to max (…)") instead of clamping
   * silently. A partner sale has no payment box, so its discount field stays
   * in the order summary.
   *
   * The REAL MultiPaymentInput renders (no `@liratek/ui` component mock).
   * Rule 25: the `useApi` mock returns ONE stable object.
   */

  type OnComplete = ComponentProps<typeof CheckoutModal>["onComplete"];
  type PaymentData = Parameters<OnComplete>[0];

  function draft(
    discount: number,
    extra: Partial<CheckoutDraftData> = {},
  ): CheckoutDraftData {
    return {
      selectedClient: null,
      clientSearchInput: "",
      clientSearchSecondary: "",
      discount,
      paidUSD: 0,
      paidLBP: 0,
      changeGivenUSD: 0,
      changeGivenLBP: 0,
      exchangeRate: 90_000,
      ...extra,
    };
  }

  function renderModal(
    props: Partial<ComponentProps<typeof CheckoutModal>> = {},
  ) {
    const onComplete = jest.fn<ReturnType<OnComplete>, [PaymentData]>(() =>
      Promise.resolve(),
    );
    render(
      <CheckoutModal
        totalAmount={100}
        currency="USD"
        onComplete={onComplete}
        onSaveDraft={jest.fn().mockResolvedValue(undefined)}
        {...props}
      />,
    );
    return onComplete;
  }

  const discountInput = () =>
    screen.getByTestId("checkout-discount-input") as HTMLInputElement;

  const paymentAmount = () =>
    document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );

  describe("CheckoutModal — Discount line in the payment box (LIRA-318)", () => {
    beforeEach(() => jest.clearAllMocks());

    it("the discount field sits inside the payment box, not in the order summary", async () => {
      renderModal();
      const box = await screen.findByTestId("payment-summary");
      expect(
        within(box).getByTestId("checkout-discount-input"),
      ).toBeInTheDocument();
      // Exactly one discount field on the page.
      expect(screen.getAllByTestId("checkout-discount-input")).toHaveLength(1);
    });

    it("typing above maxDiscount caps the value and says so", async () => {
      renderModal({ maxDiscount: 10 });
      await screen.findByTestId("checkout-discount-input");
      expect(screen.queryByText(/Capped to max/)).not.toBeInTheDocument();
      fireEvent.change(discountInput(), { target: { value: "15" } });
      expect(discountInput().value).toBe("10");
      expect(screen.getByText("Capped to max ($10.00)")).toBeInTheDocument();
      // Back under the cap: the note goes away.
      fireEvent.change(discountInput(), { target: { value: "5" } });
      expect(screen.queryByText(/Capped to max/)).not.toBeInTheDocument();
    });

    it("a draft with a $20 discount restores into the payment-box line; Total Amount is gross, the payment pre-fills the net $80", async () => {
      renderModal({ draftData: draft(20) });
      const box = await screen.findByTestId("payment-summary");
      expect(
        (within(box).getByTestId("checkout-discount-input") as HTMLInputElement)
          .value,
      ).toBe("20");
      expect(within(box).getByTestId("after-page-discount")).toHaveTextContent(
        "$80.00",
      );
      await waitFor(() => expect(paymentAmount()?.value).toBe("80"));
    });

    it("payload is unchanged: discount 20 → discount 20, final_amount 80", async () => {
      const onComplete = renderModal();
      await screen.findByTestId("checkout-discount-input");
      fireEvent.change(discountInput(), { target: { value: "20" } });
      await waitFor(() => expect(paymentAmount()?.value).toBe("80"));
      fireEvent.click(screen.getByText("Complete Sale"));
      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      const p = onComplete.mock.calls[0][0];
      expect(p.discount).toBe(20);
      expect(p.final_amount).toBe(80);
    });

    it("partner sale (no payment box): the discount field is still offered, once", async () => {
      renderModal({
        allowForPartner: true,
        draftData: draft(5, { forPartner: true }),
      });
      await screen.findByTestId("checkout-partner-no-payment-notice");
      expect(screen.queryByTestId("payment-summary")).not.toBeInTheDocument();
      expect(screen.getAllByTestId("checkout-discount-input")).toHaveLength(1);
      expect(discountInput().value).toBe("5");
    });
  });
});

describe("CheckoutModal.extra (LIRA-319)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * CheckoutModal — "+ Extra" on the payment box's Discount line (LIRA-319).
   *
   * Owner 2026-10-13: the POS cashier can charge a little more than the price
   * ($6 item, customer pays $7). The line's "− Discount | + Extra" switch picks
   * the side; the extra is sent as `extra_usd` (the sale's currency), the
   * payment line follows the new total, and a sale never carries a discount
   * and an extra together. Not offered on a partner sale or for a job that
   * goes into a session basket (the session checkout takes the extra there),
   * and only when the host opts in (`allowExtraCharge` — POS does).
   *
   * Payload names come from the schema (rule 24): every payload is parsed
   * through core's `saleProcessSchema` and the PARSED output is asserted, so a
   * key the schema does not know (Zod strips it) fails here.
   * Not proven failing-first: the props are new (rule 17).
   *
   * The REAL MultiPaymentInput renders. Rule 25: the `useApi` mock returns ONE
   * stable object.
   */

  type OnComplete = ComponentProps<typeof CheckoutModal>["onComplete"];
  type PaymentData = Parameters<OnComplete>[0];

  function draft(
    discount: number,
    extra: Partial<CheckoutDraftData> = {},
  ): CheckoutDraftData {
    return {
      selectedClient: null,
      clientSearchInput: "",
      clientSearchSecondary: "",
      discount,
      paidUSD: 0,
      paidLBP: 0,
      changeGivenUSD: 0,
      changeGivenLBP: 0,
      exchangeRate: 90_000,
      ...extra,
    };
  }

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
        allowExtraCharge={true}
        onComplete={onComplete}
        onSaveDraft={jest.fn().mockResolvedValue(undefined)}
        {...props}
      />,
    );
    return onComplete;
  }

  const lineInput = () =>
    screen.getByTestId("checkout-discount-input") as HTMLInputElement;

  const paymentAmount = () =>
    document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );

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

  describe("CheckoutModal — + Extra (LIRA-319)", () => {
    beforeEach(() => jest.clearAllMocks());

    it("Extra 1 on a $6 sale → payment fills $7, After Extra $7.00, parsed payload has extra_usd 1, discount 0", async () => {
      const onComplete = renderModal();
      const box = await screen.findByTestId("payment-summary");
      fireEvent.click(within(box).getByTestId("discount-mode-extra"));
      fireEvent.change(lineInput(), { target: { value: "1" } });
      await waitFor(() => expect(paymentAmount()?.value).toBe("7"));
      expect(within(box).getByTestId("after-page-extra")).toHaveTextContent(
        "$7.00",
      );
      const parsed = parse(await complete(onComplete));
      expect(parsed.extra_usd).toBe(1);
      expect(parsed.extra_lbp).toBeUndefined();
      expect(parsed.discount).toBe(0);
      expect(parsed.total_amount).toBe(6);
      expect(parsed.final_amount).toBe(6);
      expect(parsed.payment_usd).toBe(7);
    });

    it("discount and extra are never sent together: switching sides clears the other amount", async () => {
      const onComplete = renderModal();
      await screen.findByTestId("payment-summary");
      // Discount 2 first …
      fireEvent.change(lineInput(), { target: { value: "2" } });
      await waitFor(() => expect(paymentAmount()?.value).toBe("4"));
      // … then switch to Extra: the discount is gone.
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      expect(lineInput().value).toBe("");
      fireEvent.change(lineInput(), { target: { value: "1" } });
      await waitFor(() => expect(paymentAmount()?.value).toBe("7"));
      // … and back to Discount: the extra is gone.
      fireEvent.click(screen.getByTestId("discount-mode-discount"));
      await waitFor(() => expect(paymentAmount()?.value).toBe("6"));
      const parsed = parse(await complete(onComplete));
      expect(parsed.discount).toBe(0);
      expect(parsed.extra_usd).toBeUndefined();
    });

    it("an extra above the sale itself is capped and says so", async () => {
      renderModal();
      await screen.findByTestId("payment-summary");
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      fireEvent.change(lineInput(), { target: { value: "9" } });
      expect(lineInput().value).toBe("6");
      expect(screen.getByText("Capped to max ($6.00)")).toBeInTheDocument();
    });

    it("control: the same small underpay on the Discount side DOES offer Waive", async () => {
      renderModal();
      await screen.findByTestId("payment-summary");
      const amt = paymentAmount();
      if (!amt) throw new Error("no payment-amount input rendered");
      fireEvent.change(amt, { target: { value: "5.9" } });
      expect(await screen.findByTestId("waive-remaining")).toBeInTheDocument();
    });

    it("Waive (a discount) is not offered on the Extra side", async () => {
      renderModal();
      await screen.findByTestId("payment-summary");
      fireEvent.click(screen.getByTestId("discount-mode-extra"));
      fireEvent.change(lineInput(), { target: { value: "1" } });
      // Underpay by a small amount — Waive would normally appear.
      const amt = paymentAmount();
      if (!amt) throw new Error("no payment-amount input rendered");
      fireEvent.change(amt, { target: { value: "6.9" } });
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    });

    it("a draft with an extra restores on the Extra side", async () => {
      renderModal({ draftData: draft(0, { extra: 1 }) });
      const box = await screen.findByTestId("payment-summary");
      expect(within(box).getByTestId("discount-mode-extra")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(lineInput().value).toBe("1");
      await waitFor(() => expect(paymentAmount()?.value).toBe("7"));
    });

    it("session-basket checkout: no + Extra switch, and no extra_* in the payload", async () => {
      const onComplete = renderModal({ addsToSessionBasket: true });
      await screen.findByTestId("payment-summary");
      expect(
        screen.queryByTestId("discount-mode-extra"),
      ).not.toBeInTheDocument();
      const p = await complete(onComplete);
      expect("extra_usd" in p).toBe(false);
      expect("extra_lbp" in p).toBe(false);
    });

    it("a host that does not opt in (Maintenance) shows no switch", async () => {
      renderModal({ allowExtraCharge: false });
      await screen.findByTestId("payment-summary");
      expect(
        screen.queryByTestId("discount-mode-extra"),
      ).not.toBeInTheDocument();
    });

    it("partner sale: no switch and no extra_* sent", async () => {
      const onComplete = renderModal({
        allowForPartner: true,
        draftData: draft(0, {
          forPartner: true,
          selectedPartnerId: 3,
          extra: 1,
        }),
      });
      await screen.findByTestId("checkout-partner-no-payment-notice");
      expect(
        screen.queryByTestId("discount-mode-extra"),
      ).not.toBeInTheDocument();
      const p = await complete(onComplete);
      expect("extra_usd" in p).toBe(false);
    });
  });
});

describe("CheckoutModal.lira365NoCap (LIRA-365)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-365 US4 (T029) — POS keeps its uncapped discount (owner 2026-10-31:
   * the $5 / 450,000 LBP cap is for Exchange, OMT/Whish system send and
   * voucher sale only). POS renders CheckoutModal with no `maxDiscount`, so a
   * $30 discount on a $300 sale goes through whole.
   *
   * Not a failing-first guard: it pins existing behaviour so the LIRA-365 cap
   * never leaks into POS.
   *
   * The REAL MultiPaymentInput renders. Rule 25: one stable `useApi` object.
   */

  type OnComplete = ComponentProps<typeof CheckoutModal>["onComplete"];
  type PaymentData = Parameters<OnComplete>[0];

  function renderModal(
    props: Partial<ComponentProps<typeof CheckoutModal>> = {},
  ) {
    const onComplete = jest.fn<ReturnType<OnComplete>, [PaymentData]>(() =>
      Promise.resolve(),
    );
    render(
      <CheckoutModal
        totalAmount={300}
        currency="USD"
        onComplete={onComplete}
        onSaveDraft={jest.fn().mockResolvedValue(undefined)}
        {...props}
      />,
    );
    return onComplete;
  }

  const discountInput = () =>
    screen.getByTestId("checkout-discount-input") as HTMLInputElement;

  const paymentAmount = () =>
    document.querySelector<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    );

  describe("LIRA-365 US4 — POS discount stays uncapped", () => {
    beforeEach(() => jest.clearAllMocks());

    it("$30 discount on a $300 sale (as POS renders it, no maxDiscount) → discount 30, final 270", async () => {
      const onComplete = renderModal();
      await screen.findByTestId("checkout-discount-input");
      fireEvent.change(discountInput(), { target: { value: "30" } });
      expect(discountInput().value).toBe("30");
      expect(screen.queryByText(/Capped to max/)).not.toBeInTheDocument();
      await waitFor(() => expect(paymentAmount()?.value).toBe("270"));
      fireEvent.click(screen.getByText("Complete Sale"));
      await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
      const p = onComplete.mock.calls[0][0];
      expect(p.discount).toBe(30);
      expect(p.final_amount).toBe(270);
    });
  });
});

describe("CheckoutModal.lira366Note (LIRA-366)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-366 — POS checkout has one optional Note box (`payment-note`). The
   * typed text is sent as `typedNote` in the one PaymentData the POS page
   * spreads into processSale (walk-in and session basket alike). Blank is
   * dropped by the schema. Maintenance renders this modal without the box
   * (its job form has its own note). Payload parsed through
   * `saleProcessSchema` (rule 24). Rule 17: seen failing before the box.
   */

  type OnComplete = ComponentProps<typeof CheckoutModal>["onComplete"];
  type PaymentData = Parameters<OnComplete>[0];

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
});
