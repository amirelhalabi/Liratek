/** @jest-environment jsdom */
/**
 * LIRA-331 (money guard, rule 28d): the wrong-number payloads are identical
 * whatever the UI language. Walks every write the two panels make:
 *   - record a wrong number, no credits yet
 *   - record a wrong number with credits that already came back
 *   - record from a sale (locked card, right number)
 *   - add credits to an existing record
 * Each is driven once in English and once in Arabic, by ids/test ids that do
 * not depend on the language, and the captured payloads must deep-equal.
 * Not failing-first by nature (guard against future drift). The useApi mock
 * returns ONE stable object (rule 25).
 */
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import { WrongNumberPanel } from "../WrongNumberPanel";
import { CreditsReceivedPanel } from "../CreditsReceivedPanel";

const mockApi = {
  recordWrongNumber: jest.fn(async () => ({ success: true, data: { id: 1 } })),
  recordWrongNumberCredits: jest.fn(async () => ({ success: true })),
  getWrongNumberSaleCard: jest.fn(),
  getActiveMobileServiceItems: jest.fn(),
  getAllActiveCarrierLines: jest.fn(),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
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
const ALFA_LINE = {
  id: 7,
  carrier: "alfa",
  phone_number: "03123456",
  is_active: 1,
  is_primary: 1,
};
const RECORD = {
  id: 11,
  provider: "iPick" as const,
  carrier: "alfa",
  card_label: "7.58",
  wrong_number: "70111222",
  right_number: "70333444",
  status: "WAITING" as const,
  card_cost_lbp: 770000,
  card_credit_usd: 7.58,
  total_recovered_usd: 0,
  remaining_loss_lbp: 770000,
  credits: [],
};

type Lang = "en" | "ar";

async function setLang(lang: Lang) {
  await i18n.changeLanguage(lang);
}

function lastPayload(fn: jest.Mock): unknown {
  return fn.mock.calls[fn.mock.calls.length - 1][0];
}

async function recordFlow(
  lang: Lang,
  opts: { credits: boolean; fromSale: boolean },
): Promise<unknown> {
  await setLang(lang);
  mockApi.getWrongNumberSaleCard.mockResolvedValue(
    opts.fromSale ? { ...ALFA_CARD } : null,
  );
  const { container, unmount } = render(
    <WrongNumberPanel
      provider="iPick"
      saleTransactionId={opts.fromSale ? 42 : undefined}
      saleText={opts.fromSale ? "Alfa 7.58" : null}
      onDone={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  await waitFor(() =>
    expect(screen.getByTestId("wrong-number-save")).not.toBeDisabled(),
  );
  fireEvent.change(container.querySelector("#wn-wrong")!, {
    target: { value: "70111222" },
  });
  fireEvent.change(container.querySelector("#wn-right")!, {
    target: { value: "70333444" },
  });
  if (opts.credits) {
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(container.querySelector("#wn-credits")!, {
      target: { value: "3.5" },
    });
  }
  // The language really switched (otherwise equality is trivial).
  expect(screen.getByTestId("wrong-number-save")).toHaveTextContent(
    lang === "ar" ? "سجّل الرقم الخاطئ" : "Record wrong number",
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId("wrong-number-save"));
  });
  expect(mockApi.recordWrongNumber).toHaveBeenCalled();
  const payload = lastPayload(mockApi.recordWrongNumber);
  unmount();
  return payload;
}

async function creditsFlow(lang: Lang): Promise<unknown> {
  await setLang(lang);
  const { container, unmount } = render(
    <CreditsReceivedPanel record={RECORD} onDone={jest.fn()} />,
  );
  await waitFor(() =>
    expect(
      (container.querySelector("#wn-cr-line-11") as HTMLSelectElement).value,
    ).toBe("7"),
  );
  fireEvent.change(container.querySelector("#wn-cr-amount-11")!, {
    target: { value: "2.25" },
  });
  expect(screen.getByTestId("wrong-number-credits-save")).toHaveTextContent(
    lang === "ar" ? "احفظ الرصيد المُسترجع" : "Save credits received",
  );
  await act(async () => {
    fireEvent.click(screen.getByTestId("wrong-number-credits-save"));
  });
  expect(mockApi.recordWrongNumberCredits).toHaveBeenCalled();
  const payload = lastPayload(mockApi.recordWrongNumberCredits);
  unmount();
  return payload;
}

beforeAll(async () => {
  await loadLanguage("ar");
});
beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getActiveMobileServiceItems.mockResolvedValue([ALFA_CARD]);
  mockApi.getAllActiveCarrierLines.mockResolvedValue([ALFA_LINE]);
});
afterEach(() => i18n.changeLanguage("en"));

describe("wrong-number payloads do not depend on the UI language", () => {
  it.each([
    ["no credits yet", { credits: false, fromSale: false }],
    ["credits already came back", { credits: true, fromSale: false }],
    ["from a sale (locked card)", { credits: true, fromSale: true }],
  ])("record a wrong number: %s", async (_name, opts) => {
    const en = await recordFlow("en", opts);
    const ar = await recordFlow("ar", opts);
    expect(ar).toEqual(en);
    expect(en).toMatchObject({
      provider: "iPick",
      mobile_service_item_id: 5,
      wrong_number: "70111222",
      right_number: "70333444",
      ...(opts.credits
        ? { credits_received: { amount_usd: 3.5, carrier_line_id: 7 } }
        : {}),
      ...(opts.fromSale ? { sale_transaction_id: 42 } : {}),
    });
  });

  it("add credits to a record", async () => {
    const en = await creditsFlow("en");
    const ar = await creditsFlow("ar");
    expect(ar).toEqual(en);
    expect(en).toMatchObject({
      wrong_number_card_id: 11,
      amount_usd: 2.25,
      carrier_line_id: 7,
    });
  });
});
