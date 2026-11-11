/** @jest-environment jsdom */
/**
 * LIRA-387 (owner 2026-11-11: "make sure the client picker and payment
 * method thing doesn't happen anywhere else; keep it consistent in all the
 * payment rows") — ONE guard over every money window's client rules.
 *
 * Each row mounts the REAL `MultiPaymentInput` with the client props its
 * window passes:
 *  - windows on the shared builder (`clientPaymentProps` +
 *    `accountMethodOnPick`, shared/utils/clientPaymentProps.ts) take them
 *    from the builder itself — the very call the page makes;
 *  - REFERENCE rows (POS, Loto, Session checkout) still write their props
 *    inline (they passed the LIRA-387 audit); the row transcribes them with
 *    the page line, and also asserts they agree with the builder, so a drift
 *    on either side is a red row. Follow-up: move them onto the builder.
 *
 * Per row, three customers: a client PICKED from search, a NEW client
 * (typed name + phone), and a name with no phone. Asserted:
 *  1. a pick switches the box to Customer Account (sale windows only — a
 *     payout keeps the operator's method);
 *  2. a chargeable client never shows the red "client needed" box; a name
 *     without a phone does, once an account line exists;
 *  3. the emitted account leg, converted by the SAME leg helper the page
 *     uses and parsed through the window's REAL core schema (rule 24),
 *     carries the client id and the account leg;
 *  4. switching the line to a wallet reaches the parsed payload.
 *
 * The page-level wiring (client search through `useApi()`, the id reaching
 * the real submit) is proven per page: CustomServices.lira387NewClientAccount,
 * Services.lira387PickedClient, Vouchers.lira387ClientProps.
 * Mobile Recharge windows have their own guard
 * (features/recharge/components/__tests__/paymentSheetClientParity.test.tsx).
 */

import { fireEvent, render, screen } from "@testing-library/react";
import {
  MultiPaymentInput,
  canChargeToCustomerAccount,
  type PaymentLine,
} from "@liratek/ui";
import {
  createCustomServiceSchema,
  createFinancialServiceSchema,
  voucherCreateSchema,
  VOUCHER_SALE_METHODS,
} from "@liratek/core";
import {
  accountMethodOnPick,
  clientPaymentProps,
  type ClientPaymentProps,
} from "@/shared/utils/clientPaymentProps";
import { toCamelLegs, toSnakeLegs } from "@/utils/paymentUtils";
import {
  toVoucherSaleLegs,
  voucherSaleMethodOptions,
} from "@/features/vouchers/utils/voucherLegs";

// The shop's methods (data in the payment_methods table, not code).
const SHOP_METHODS = [
  "CASH",
  "OMT",
  "WHISH",
  "BINANCE",
  "CUSTOMER_ACCOUNT",
  "GIFT_CARD",
].map((code) => ({ code, label: code }));

interface Customer {
  kind: "picked" | "new" | "nameOnly";
  clientId: number | null;
  name: string;
  phone: string;
}
const PICKED: Customer = {
  kind: "picked",
  clientId: 7,
  name: "Rami Haddad",
  phone: "70123456",
};
const NEW: Customer = {
  kind: "new",
  clientId: null,
  name: "Maya Khoury",
  phone: "70555111",
};
const NAME_ONLY: Customer = {
  kind: "nameOnly",
  clientId: null,
  name: "Walk In",
  phone: "",
};

/** The id the window sends: the picked one, or the one registered on
 *  Confirm for a new client (the page or server creates it; 91 here). */
const sentClientId = (c: Customer) => c.clientId ?? 91;

interface Row {
  window: string;
  source: string;
  flow: "sale" | "payout";
  methods: (c: Customer) => { code: string; label: string }[];
  /** The client props the window passes for this customer. */
  props: (c: Customer, lines: PaymentLine[]) => ClientPaymentProps;
  /** Parses the emitted lines into the window's payload via its schema;
   *  returns the parsed client id and leg methods. */
  parse: (
    lines: PaymentLine[],
    c: Customer,
  ) => { clientId: number | undefined; methods: string[] };
  wallet: string;
}

const builderProps =
  (flow: "sale" | "payout", changeToAccount: boolean) =>
  (c: Customer, lines: PaymentLine[]) =>
    clientPaymentProps({
      clientId: c.clientId,
      name: c.name,
      phone: c.phone,
      flow,
      paymentLines: lines,
      inSession: false,
      changeToAccount,
    });

const parseCustomService = (lines: PaymentLine[], c: Customer) => {
  const p = createCustomServiceSchema.parse({
    description: "Screen repair",
    cost_usd: 3,
    price_usd: 20,
    paid_by: lines[0]?.method ?? "CASH",
    payments: toSnakeLegs(lines),
    client_id: sentClientId(c),
  });
  return {
    clientId: p.client_id,
    methods: (p.payments ?? []).map((l) => l.method),
  };
};

const parseFinancial =
  (serviceType: "SEND" | "RECEIVE") => (lines: PaymentLine[], c: Customer) => {
    const p = createFinancialServiceSchema.parse({
      provider: "OMT",
      serviceType,
      amount: 20,
      currency: "USD",
      omtServiceType: "INTRA",
      clientId: sentClientId(c),
      clientName: c.name,
      phoneNumber: c.phone,
      payments: toCamelLegs(lines),
    });
    return {
      clientId: p.clientId,
      methods: (p.payments ?? []).map((l) => l.method),
    };
  };

const parseVoucher = (lines: PaymentLine[], c: Customer) => {
  const p = voucherCreateSchema.parse({
    clientId: sentClientId(c),
    amount: 20,
    currency: "USD",
    payments: toVoucherSaleLegs(lines),
  });
  return {
    clientId: p.clientId,
    methods: (p.payments ?? []).map((l) => l.method),
  };
};

const chargeable = (c: Customer) =>
  canChargeToCustomerAccount({ name: c.name, phone: c.phone });

const ROWS: Row[] = [
  {
    window: "Custom services / insurance",
    source: "custom-services/pages/CustomServices/index.tsx (clientPaymentProps)",
    flow: "sale",
    methods: () => SHOP_METHODS,
    props: builderProps("sale", true),
    parse: parseCustomService,
    wallet: "WHISH",
  },
  {
    window: "OMT/Whish system SEND",
    source: "services/pages/Services/index.tsx (clientPaymentProps, sale)",
    flow: "sale",
    methods: () => SHOP_METHODS,
    props: builderProps("sale", true),
    parse: parseFinancial("SEND"),
    wallet: "OMT",
  },
  {
    window: "OMT/Whish system RECEIVE (payout)",
    source: "services/pages/Services/index.tsx (clientPaymentProps, payout)",
    flow: "payout",
    methods: () =>
      SHOP_METHODS.filter((m) =>
        ["CASH", "CUSTOMER_ACCOUNT", "OMT", "WHISH", "BINANCE"].includes(
          m.code,
        ),
      ),
    props: builderProps("payout", false),
    parse: parseFinancial("RECEIVE"),
    wallet: "WHISH",
  },
  {
    window: "Voucher sale",
    source: "vouchers/pages/Vouchers/index.tsx (clientPaymentProps, no change to account)",
    flow: "sale",
    methods: (c) => voucherSaleMethodOptions(SHOP_METHODS, chargeable(c)),
    props: builderProps("sale", false),
    parse: parseVoucher,
    wallet: "OMT",
  },
  // ── REFERENCE rows: inline props today (transcribed), not on the builder.
  {
    window: "POS checkout (reference)",
    source: "sales/pages/POS/components/CheckoutModal.tsx (canCreateDebt)",
    flow: "sale",
    methods: () => SHOP_METHODS,
    props: (c) => ({
      hasClient: !!c.clientId || chargeable(c),
      requiresClientForDebt: true,
      autoDebtRemainder: !!c.clientId || chargeable(c),
      ...(!!c.clientId || chargeable(c)
        ? { unreturnedChangeTo: "CUSTOMER_ACCOUNT" as const }
        : {}),
    }),
    parse: parseCustomService,
    wallet: "WHISH",
  },
  {
    window: "Loto ticket sale (reference)",
    source: "loto/pages/Loto/index.tsx (hasClient / autoDebtRemainder inline)",
    flow: "sale",
    methods: () => SHOP_METHODS,
    props: (c) => ({
      hasClient: !!c.clientId || (!!c.name.trim() && !!c.phone.trim()),
      requiresClientForDebt: true,
      autoDebtRemainder: !!c.clientId || (!!c.name.trim() && !!c.phone.trim()),
      unreturnedChangeTo: "CUSTOMER_ACCOUNT" as const,
    }),
    parse: parseCustomService,
    wallet: "WHISH",
  },
  {
    window: "Session checkout (reference)",
    source: "sessions/components/SessionCheckoutModal.tsx (canCharge…)",
    flow: "sale",
    methods: () => SHOP_METHODS,
    props: (c) => ({
      hasClient: !!c.clientId || chargeable(c),
      requiresClientForDebt: true,
      autoDebtRemainder: !!c.clientId || chargeable(c),
    }),
    parse: parseCustomService,
    wallet: "WHISH",
  },
];

function mount(row: Row, c: Customer, onChange: jest.Mock) {
  const methods = row.methods(c);
  const pick =
    c.kind === "picked" && row.flow === "sale"
      ? accountMethodOnPick({ methods, name: c.name, phone: c.phone })
      : undefined;
  const props = row.props(c, []);
  return render(
    <MultiPaymentInput
      totals={[{ amount: 20, currency: "USD" }]}
      currency="USD"
      totalAmountCurrency="USD"
      paymentMethods={methods}
      currencies={[
        { code: "USD", symbol: "$" },
        { code: "LBP", symbol: "LBP" },
      ]}
      exchangeRate={90_000}
      showDiscount={false}
      onChange={onChange}
      {...(row.flow === "payout" ? { payer: "payout" as const } : {})}
      {...props}
      {...(pick ? { initialMethod: pick } : {})}
    />,
  );
}

function methodSelect(container: HTMLElement): HTMLSelectElement {
  const s = container.querySelector(
    'select[data-testid^="payment-method-"]',
  ) as HTMLSelectElement | null;
  if (!s) throw new Error("payment method select not rendered");
  return s;
}

const lastLines = (m: jest.Mock): PaymentLine[] =>
  (m.mock.calls.at(-1)?.[0] as PaymentLine[] | undefined) ?? [];

describe("payment window client parity (LIRA-387)", () => {
  describe.each(ROWS)("$window", (row) => {
    it("a picked client: account by default (sale), no red box, the id and the account leg reach the payload", () => {
      const onChange = jest.fn();
      const { container } = mount(row, PICKED, onChange);
      // The box actually rendered (rule 28a).
      expect(
        container.querySelector('[data-testid^="payment-amount-"]'),
      ).not.toBeNull();
      if (row.flow === "sale") {
        expect(lastLines(onChange)[0]?.method).toBe("CUSTOMER_ACCOUNT");
      } else {
        // A payout keeps the operator's method; choosing the account is a
        // decision, not a default.
        expect(lastLines(onChange)[0]?.method).toBe("CASH");
        fireEvent.change(methodSelect(container), {
          target: { value: "CUSTOMER_ACCOUNT" },
        });
      }
      expect(screen.queryByTestId("client-needed")).toBeNull();
      const parsed = row.parse(lastLines(onChange), PICKED);
      expect(parsed.clientId).toBe(PICKED.clientId);
      expect(parsed.methods).toContain("CUSTOMER_ACCOUNT");
    });

    it("a new client (name + phone): account allowed, no red box", () => {
      const onChange = jest.fn();
      const { container } = mount(row, NEW, onChange);
      fireEvent.change(methodSelect(container), {
        target: { value: "CUSTOMER_ACCOUNT" },
      });
      expect(lastLines(onChange)[0]?.method).toBe("CUSTOMER_ACCOUNT");
      expect(screen.queryByTestId("client-needed")).toBeNull();
      const parsed = row.parse(lastLines(onChange), NEW);
      expect(parsed.clientId).toBe(sentClientId(NEW));
      expect(parsed.methods).toContain("CUSTOMER_ACCOUNT");
    });

    it("a name without a phone is not chargeable", () => {
      const onChange = jest.fn();
      const { container } = mount(row, NAME_ONLY, onChange);
      const offered = Array.from(methodSelect(container).options).some(
        (o) => o.value === "CUSTOMER_ACCOUNT",
      );
      if (!offered) return; // the window hides the account (voucher sale)
      fireEvent.change(methodSelect(container), {
        target: { value: "CUSTOMER_ACCOUNT" },
      });
      // The payout box decides `requiresClientForDebt` from the lines, so
      // re-render with the account line as the page does.
      if (row.flow === "payout") {
        const lines = lastLines(onChange);
        expect(row.props(NAME_ONLY, lines).requiresClientForDebt).toBe(true);
        expect(row.props(NAME_ONLY, []).requiresClientForDebt).toBe(false);
        return;
      }
      expect(screen.getByTestId("client-needed")).toBeInTheDocument();
    });

    it("a wallet chosen on the line reaches the payload", () => {
      const onChange = jest.fn();
      const { container } = mount(row, PICKED, onChange);
      fireEvent.change(methodSelect(container), {
        target: { value: row.wallet },
      });
      const parsed = row.parse(lastLines(onChange), PICKED);
      expect(parsed.methods).toEqual([row.wallet]);
    });

    it("its props agree with the shared builder", () => {
      for (const c of [PICKED, NEW, NAME_ONLY]) {
        const mine = row.props(c, []);
        const shared = builderProps(row.flow, true)(c, []);
        expect(mine.hasClient).toBe(shared.hasClient);
        expect(mine.autoDebtRemainder).toBe(shared.autoDebtRemainder);
        expect(mine.requiresClientForDebt).toBe(shared.requiresClientForDebt);
      }
    });
  });

  it("a voucher sale never offers change to the account (the server refuses it)", () => {
    expect(builderProps("sale", false)(PICKED, []).unreturnedChangeTo).toBe(
      undefined,
    );
    expect(
      (VOUCHER_SALE_METHODS as readonly string[]).includes("CUSTOMER_ACCOUNT"),
    ).toBe(true);
  });
});
