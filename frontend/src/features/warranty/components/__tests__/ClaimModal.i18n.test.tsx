/** @jest-environment jsdom */
/**
 * LIRA-331 — the warranty claim payload is identical in English and Arabic
 * for every action (Repair / Replace / Refund) and for an expired warranty
 * honoured with a reason (research R9, rule 28d). Controls are found by
 * value/id, never by label, so the same steps run in both languages.
 */
import { render, fireEvent, waitFor, screen } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import { ClaimModal, type ClaimTarget } from "../ClaimModal";

const api = {
  createWarrantyClaim: jest.fn(),
  productUnits: { getForProduct: jest.fn() },
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => api,
}));

const TRACKED: ClaimTarget = {
  saleItemId: 1000,
  productId: 10,
  productName: "Phone",
  state: "COVERED",
  units: [
    { id: 21, serial: "SN-21" },
    { id: 22, serial: "SN-22" },
  ],
};

beforeEach(() => {
  api.createWarrantyClaim.mockResolvedValue({ success: true });
  api.productUnits.getForProduct.mockResolvedValue([{ id: 31, imei: "SN-31" }]);
});

afterEach(async () => {
  await i18n.changeLanguage("en");
  jest.clearAllMocks();
});

async function claim(
  target: ClaimTarget,
  action: "REPAIR" | "REPLACE" | "REFUND",
): Promise<Record<string, unknown>> {
  const { container, unmount } = render(
    <ClaimModal target={target} isAdmin onClose={jest.fn()} onDone={jest.fn()} />,
  );
  fireEvent.click(container.querySelector(`input[value="${action}"]`)!);
  fireEvent.change(container.querySelector("#claim-unit")!, {
    target: { value: "22" },
  });
  if (action === "REPLACE") {
    await waitFor(() =>
      expect(container.querySelector('#claim-replacement option[value="31"]')).not.toBeNull(),
    );
    fireEvent.change(container.querySelector("#claim-replacement")!, {
      target: { value: "31" },
    });
  }
  if (target.state === "EXPIRED") {
    fireEvent.change(container.querySelector("#claim-reason")!, {
      target: { value: "loyal customer" },
    });
  }
  fireEvent.change(container.querySelector("#claim-notes")!, {
    target: { value: "screen flickers" },
  });
  const buttons = screen.getAllByRole("button");
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(api.createWarrantyClaim).toHaveBeenCalledTimes(1));
  const payload = api.createWarrantyClaim.mock.calls[0][0];
  unmount();
  api.createWarrantyClaim.mockClear();
  return payload;
}

const CASES: [string, ClaimTarget, "REPAIR" | "REPLACE" | "REFUND"][] = [
  ["repair", TRACKED, "REPAIR"],
  ["replace", TRACKED, "REPLACE"],
  ["refund", TRACKED, "REFUND"],
  ["expired, honoured", { ...TRACKED, state: "EXPIRED" }, "REFUND"],
];

it.each(CASES)("%s: same payload in English and Arabic", async (_n, target, action) => {
  await i18n.changeLanguage("en");
  const en = await claim(target, action);
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
  const ar = await claim(target, action);
  expect(ar).toEqual(en);
  expect(en.action).toBe(action);
  expect(en.unit_id).toBe(22);
  expect(en.notes).toBe("screen flickers");
});

it("shows Arabic when the language is ar", async () => {
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
  render(
    <ClaimModal target={TRACKED} isAdmin onClose={jest.fn()} onDone={jest.fn()} />,
  );
  expect(screen.getByText("بدء المطالبة")).toBeInTheDocument();
});
