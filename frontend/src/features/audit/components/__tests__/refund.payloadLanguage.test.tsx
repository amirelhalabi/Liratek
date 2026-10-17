/** @jest-environment jsdom */
/**
 * LIRA-331 (rule 28d) — the refund pop-ups hand the SAME values to their
 * caller in Arabic as in English. Each variant is driven once with the
 * language "en" and once with "ar"; the `onConfirm` arguments must be deeply
 * equal. A label that leaks into a refund leg (a translated method name, a
 * currency word) fails here.
 *
 * Variants walked: the default legs untouched (USD cash, LBP cash), a wallet
 * line with a changed amount, kept change (cash short by < $1), a returned
 * phone flagged defective, a units-only refund, and the quantity pop-up with
 * the amount typed in Western and in Arabic-Indic digits.
 *
 * Not failing-first: a guard against future drift, written after the audit
 * conversion.
 *
 * Renders the REAL RefundMethodModal (real CounterpartySettleModal and
 * MultiPaymentInput) and RefundQuantityModal. Controls are found by test id,
 * by role or by data (method codes), never by a label.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import { RefundMethodModal, type RefundableUnit } from "../RefundMethodModal";
import { RefundQuantityModal } from "../RefundQuantityModal";
import type { TransactionPaymentLeg } from "../../cashFlow";

type Lang = "en" | "ar";

const PAYMENT_METHODS = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT Wallet" },
  { code: "WHISH", label: "Whish Wallet" },
];

const leg = (
  amount: number,
  currency_code: "USD" | "LBP",
  method = "CASH",
): TransactionPaymentLeg => ({
  direction: "in",
  amount,
  signed_amount: amount,
  currency_code,
  method,
});

async function setLang(lang: Lang): Promise<void> {
  if (lang === "ar") await loadLanguage("ar");
  await i18n.changeLanguage(lang);
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

/** The modal's confirm button: the last button of the settle body. */
function confirmButton(): HTMLButtonElement {
  const bodies = screen.getAllByTestId("counterparty-settle-body");
  const buttons = within(bodies[bodies.length - 1]!).getAllByRole("button");
  return buttons[buttons.length - 1] as HTMLButtonElement;
}

interface Variant {
  name: string;
  legs: TransactionPaymentLeg[];
  units?: RefundableUnit[];
  allowKeptChange?: boolean;
  act?: () => void;
}

const UNIT: RefundableUnit = { id: 7, imei: "356938035643809" };

const VARIANTS: Variant[] = [
  { name: "USD cash, untouched", legs: [leg(100, "USD")] },
  { name: "LBP cash, untouched", legs: [leg(900_000, "LBP")] },
  {
    name: "wallet line with a changed amount",
    legs: [leg(50, "USD")],
    act: () => {
      fireEvent.change(screen.getByTestId(/payment-method-/), {
        target: { value: "WHISH" },
      });
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "50" },
      });
    },
  },
  {
    name: "kept change: $20.12 handed back as $20",
    legs: [leg(20.12, "USD")],
    allowKeptChange: true,
    act: () => {
      fireEvent.change(screen.getByTestId(/payment-amount-/), {
        target: { value: "20" },
      });
    },
  },
  {
    name: "returned phone flagged defective",
    legs: [leg(300, "USD")],
    units: [UNIT],
    act: () => {
      fireEvent.click(
        within(screen.getByTestId("refund-unit-7")).getByRole("checkbox"),
      );
    },
  },
  { name: "units-only refund", legs: [], units: [UNIT] },
];

async function runVariant(lang: Lang, v: Variant): Promise<unknown[][]> {
  await setLang(lang);
  const onConfirm = jest.fn();
  render(
    <RefundMethodModal
      legs={v.legs}
      {...(v.units ? { units: v.units } : {})}
      paymentMethods={PAYMENT_METHODS}
      exchangeRate={89_000}
      {...(v.allowKeptChange ? { allowKeptChange: true } : {})}
      onCancel={jest.fn()}
      onConfirm={onConfirm}
    />,
  );
  // The language really switched (otherwise equality is trivial).
  expect(confirmButton()).toHaveTextContent(
    lang === "ar" ? "تأكيد الاسترداد" : "Confirm Refund",
  );
  v.act?.();
  expect(confirmButton()).not.toBeDisabled();
  fireEvent.click(confirmButton());
  expect(onConfirm).toHaveBeenCalledTimes(1);
  const calls = JSON.parse(JSON.stringify(onConfirm.mock.calls)) as unknown[][];
  cleanup();
  return calls;
}

describe("refund pop-ups — same values in Arabic as in English", () => {
  it.each(VARIANTS.map((v) => [v.name, v] as const))(
    "RefundMethodModal: %s",
    async (_name, v) => {
      const en = await runVariant("en", v);
      const ar = await runVariant("ar", v);
      expect(ar).toEqual(en);
    },
  );

  it.each([
    ["Western digits", "3"],
    ["Arabic-Indic digits", "٣"],
  ])("RefundQuantityModal: quantity typed in %s", async (_name, typed) => {
    const quantities: Record<Lang, unknown[][]> = { en: [], ar: [] };
    for (const lang of ["en", "ar"] as const) {
      await setLang(lang);
      const onConfirm = jest.fn();
      render(
        <RefundQuantityModal
          itemName="Charger"
          availableQuantity={5}
          onConfirm={onConfirm}
          onCancel={jest.fn()}
        />,
      );
      fireEvent.change(screen.getByRole("textbox"), {
        target: { value: typed },
      });
      const buttons = screen.getAllByRole("button");
      const confirm = buttons[buttons.length - 1]!;
      expect(confirm).toHaveTextContent(
        lang === "ar" ? "استرداد 3x" : "Refund 3x",
      );
      fireEvent.click(confirm);
      quantities[lang] = onConfirm.mock.calls;
      cleanup();
    }
    expect(quantities.en).toEqual([[3]]);
    expect(quantities.ar).toEqual(quantities.en);
  });
});
