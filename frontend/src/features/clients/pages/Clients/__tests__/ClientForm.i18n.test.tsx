/**
 * LIRA-331: the client form in Arabic, and the saved payload is the same in
 * both languages (research R9 — no translated text reaches saved data).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { i18n, loadLanguage } from "@/i18n/setup";
import ClientForm from "../ClientForm";

const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
jest.mock("@/api/backendApi", () => ({
  createClient: (...a: unknown[]) => mockCreateClient(...a),
  updateClient: (...a: unknown[]) => mockUpdateClient(...a),
}));

const mockApi = { sendWhatsAppMessage: jest.fn() };
jest.mock("@liratek/ui", () => ({
  useApi: () => mockApi,
  useModalFocusFix: () => undefined,
}));

afterEach(async () => {
  await i18n.changeLanguage("en");
  jest.clearAllMocks();
});

async function fillAndSave(): Promise<unknown> {
  mockCreateClient.mockResolvedValue({ success: true });
  const { container, unmount } = render(
    <ClientForm onClose={jest.fn()} onSave={jest.fn()} />,
  );
  fireEvent.change(container.querySelector("#client-full-name")!, {
    target: { value: "Ali Hassan" },
  });
  fireEvent.change(container.querySelector("#client-phone")!, {
    target: { value: "03 123 456" },
  });
  fireEvent.change(container.querySelector("#client-notes")!, {
    target: { value: "VIP" },
  });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(mockCreateClient).toHaveBeenCalledTimes(1));
  const payload = mockCreateClient.mock.calls[0][0];
  unmount();
  mockCreateClient.mockClear();
  return payload;
}

it("keeps the English text", () => {
  render(<ClientForm onClose={jest.fn()} onSave={jest.fn()} />);
  expect(screen.getByText("New Client")).toBeInTheDocument();
  expect(screen.getByText("Save Client")).toBeInTheDocument();
});

it("shows Arabic when the language is ar", async () => {
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
  render(<ClientForm onClose={jest.fn()} onSave={jest.fn()} />);
  expect(screen.getByText("زبون جديد")).toBeInTheDocument();
  expect(screen.getByText("حفظ الزبون")).toBeInTheDocument();
});

it("saves the same payload in English and Arabic", async () => {
  await i18n.changeLanguage("en");
  const en = await fillAndSave();
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
  const ar = await fillAndSave();
  expect(ar).toEqual(en);
  expect(en).toEqual({
    full_name: "Ali Hassan",
    phone_number: "03 123 456",
    notes: "VIP",
    whatsapp_opt_in: 1,
  });
});
