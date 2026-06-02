/** @jest-environment jsdom */
/**
 * RTL unit tests for ClientAutocompleteInput.
 *
 * Migrated from the Electron e2e spec
 * (frontend/tests/e2e-electron/components/ClientAutocompleteInput.spec.ts).
 *
 * Captured behaviours:
 *   - typing a partial name filters clients into the dropdown            (e2e S9)
 *   - typing a partial phone filters clients into the dropdown           (e2e S10)
 *   - selecting a result fires onClientSelect + onChange (form autofill)  (e2e S11)
 *   - a query with no matches keeps the dropdown hidden (empty state)     (e2e S12)
 *   - clearing the field closes the dropdown / resets value              (e2e S13)
 *   - a client with an open debt shows the debt badge                    (e2e S15)
 *
 * ClientAutocompleteInput fetches ALL clients once on mount via
 * `window.api.clients.getAll("")` (returns Client[] directly, NOT a
 * {success,result} envelope) and then filters them client-side against the
 * controlled `value` prop. When showDebtBadge is set it also calls
 * `window.api.debt.getDebtors()` (returns an array of {id,total_debt_usd}).
 * Those are the only window.api methods the component touches.
 */

import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Client } from "@liratek/ui";
import {
  ClientAutocompleteInput,
  type ClientAutocompleteInputProps,
} from "../ClientAutocompleteInput";
// jest-dom matchers are global (jest.setup.ts).

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeClient(over: Partial<Client> & Pick<Client, "id">): Client {
  return {
    id: over.id,
    full_name: over.full_name ?? `Client ${over.id}`,
    phone_number: over.phone_number ?? "",
    notes: over.notes ?? null,
    whatsapp_opt_in: over.whatsapp_opt_in ?? 0,
    created_at: over.created_at ?? "2026-01-01T00:00:00.000Z",
  };
}

const CLIENTS: Client[] = [
  makeClient({ id: 1, full_name: "Jane Doe", phone_number: "03888777" }),
  makeClient({ id: 2, full_name: "John Smith", phone_number: "03111222" }),
  makeClient({ id: 3, full_name: "Janet Black", phone_number: "03999888" }),
];

// ── window.api mock ────────────────────────────────────────────────────────

interface ClientsApiMock {
  getAll: jest.Mock<Promise<Client[]>, [string]>;
}
interface DebtApiMock {
  getDebtors: jest.Mock<
    Promise<Array<{ id: number; total_debt_usd: number }>>,
    []
  >;
}

let getAllMock: ClientsApiMock["getAll"];
let getDebtorsMock: DebtApiMock["getDebtors"];

beforeEach(() => {
  getAllMock = jest.fn<Promise<Client[]>, [string]>().mockResolvedValue(CLIENTS);
  getDebtorsMock = jest
    .fn<Promise<Array<{ id: number; total_debt_usd: number }>>, []>()
    .mockResolvedValue([{ id: 1, total_debt_usd: 35 }]);

  (
    window as unknown as { api: { clients: ClientsApiMock; debt: DebtApiMock } }
  ).api = {
    clients: { getAll: getAllMock },
    debt: { getDebtors: getDebtorsMock },
  };
});

// ── Controlled harness ─────────────────────────────────────────────────────
// The component is fully controlled (value + onChange), so a tiny stateful
// wrapper reproduces real usage: typing updates `value`, selection writes the
// chosen client's name back into `value`.

type HarnessProps = Omit<ClientAutocompleteInputProps, "value" | "onChange"> & {
  initialValue?: string;
  onChangeSpy?: (value: string) => void;
};

function Harness({ initialValue = "", onChangeSpy, ...rest }: HarnessProps) {
  const [value, setValue] = useState(initialValue);
  return (
    <ClientAutocompleteInput
      {...rest}
      value={value}
      onChange={(v) => {
        setValue(v);
        onChangeSpy?.(v);
      }}
    />
  );
}

/** Render the harness and wait for the on-mount clients fetch to settle. */
async function renderAndLoad(props: HarnessProps = {}) {
  const utils = render(<Harness {...props} />);
  await waitFor(() => expect(getAllMock).toHaveBeenCalledWith(""));
  return utils;
}

function field(): HTMLInputElement {
  return screen.getByTestId("client-autocomplete-field") as HTMLInputElement;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ClientAutocompleteInput", () => {
  it("fetches all clients once on mount via window.api.clients.getAll('')", async () => {
    await renderAndLoad();
    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(getAllMock).toHaveBeenCalledWith("");
  });

  it("renders the input and starts with the dropdown hidden", async () => {
    await renderAndLoad();
    expect(screen.getByTestId("client-autocomplete-field")).toBeInTheDocument();
    expect(screen.queryByTestId("client-dropdown")).not.toBeInTheDocument();
  });

  it("S9: typing a partial name shows matching clients in the dropdown", async () => {
    await renderAndLoad();

    fireEvent.change(field(), { target: { value: "Jan" } });

    await waitFor(() =>
      expect(screen.getByTestId("client-dropdown")).toBeInTheDocument(),
    );

    // "Jane Doe" (id 1) and "Janet Black" (id 3) match "Jan"; "John Smith" must not.
    expect(screen.getByTestId("client-option-1")).toBeInTheDocument();
    expect(screen.getByTestId("client-option-3")).toBeInTheDocument();
    expect(screen.queryByTestId("client-option-2")).not.toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
  });

  it("S10: typing a partial phone number shows matching clients", async () => {
    await renderAndLoad();

    fireEvent.change(field(), { target: { value: "03888" } });

    await waitFor(() =>
      expect(screen.getByTestId("client-dropdown")).toBeInTheDocument(),
    );

    // Only Jane Doe's phone (03888777) contains "03888".
    expect(screen.getByTestId("client-option-1")).toBeInTheDocument();
    expect(screen.queryByTestId("client-option-2")).not.toBeInTheDocument();
    expect(screen.queryByTestId("client-option-3")).not.toBeInTheDocument();
  });

  it("S11: selecting a result fires onClientSelect and writes the name via onChange", async () => {
    const onClientSelect = jest.fn();
    const onChangeSpy = jest.fn();
    await renderAndLoad({ onClientSelect, onChangeSpy });

    fireEvent.change(field(), { target: { value: "Jan" } });
    await waitFor(() =>
      expect(screen.getByTestId("client-dropdown")).toBeInTheDocument(),
    );

    // Options use onMouseDown (preventDefault to avoid input blur).
    fireEvent.mouseDown(screen.getByTestId("client-option-1"));

    expect(onClientSelect).toHaveBeenCalledTimes(1);
    expect(onClientSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, full_name: "Jane Doe" }),
    );
    // onChange receives the selected client's full name → parent form autofills.
    expect(onChangeSpy).toHaveBeenLastCalledWith("Jane Doe");
    // Selection closes the dropdown and the input now shows the name.
    await waitFor(() =>
      expect(screen.queryByTestId("client-dropdown")).not.toBeInTheDocument(),
    );
    expect(field().value).toBe("Jane Doe");
  });

  it("selecting the generic first option fires the select callback", async () => {
    const onClientSelect = jest.fn();
    await renderAndLoad({ onClientSelect });

    fireEvent.change(field(), { target: { value: "Jan" } });
    await waitFor(() =>
      expect(screen.getByTestId("client-dropdown")).toBeInTheDocument(),
    );

    const options = screen.getAllByTestId(/^client-option-/);
    expect(options.length).toBeGreaterThan(0);
    fireEvent.mouseDown(options[0]);

    expect(onClientSelect).toHaveBeenCalled();
  });

  it("searchByPhone: matches on phone only and writes the phone back on select", async () => {
    const onClientSelect = jest.fn();
    const onChangeSpy = jest.fn();
    await renderAndLoad({ searchByPhone: true, onClientSelect, onChangeSpy });

    // The name "Jane" must NOT match when searching by phone.
    fireEvent.change(field(), { target: { value: "Jane" } });
    await waitFor(() => expect(field().value).toBe("Jane"));
    expect(screen.queryByTestId("client-dropdown")).not.toBeInTheDocument();

    // A phone fragment matches.
    fireEvent.change(field(), { target: { value: "03888" } });
    await waitFor(() =>
      expect(screen.getByTestId("client-dropdown")).toBeInTheDocument(),
    );

    fireEvent.mouseDown(screen.getByTestId("client-option-1"));
    // searchByPhone writes the phone number (not the name) back.
    expect(onChangeSpy).toHaveBeenLastCalledWith("03888777");
    expect(onClientSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
    );
  });

  it("S12: a query with no matches keeps the dropdown hidden (empty state)", async () => {
    await renderAndLoad();

    fireEvent.change(field(), { target: { value: "XXXXNOTEXIST99999" } });

    // Give React a tick; the dropdown must never appear.
    await waitFor(() => expect(field().value).toBe("XXXXNOTEXIST99999"));
    expect(screen.queryByTestId("client-dropdown")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId(/^client-option-/)).toHaveLength(0);
  });

  it("empty query renders no dropdown", async () => {
    await renderAndLoad();
    // Nothing typed yet.
    expect(screen.queryByTestId("client-dropdown")).not.toBeInTheDocument();

    // Whitespace-only is treated as empty too.
    fireEvent.change(field(), { target: { value: "   " } });
    await waitFor(() => expect(field().value).toBe("   "));
    expect(screen.queryByTestId("client-dropdown")).not.toBeInTheDocument();
  });

  it("S13: clearing the field hides the dropdown and empties the value", async () => {
    const onChangeSpy = jest.fn();
    await renderAndLoad({ onChangeSpy });

    fireEvent.change(field(), { target: { value: "Jan" } });
    await waitFor(() =>
      expect(screen.getByTestId("client-dropdown")).toBeInTheDocument(),
    );

    fireEvent.change(field(), { target: { value: "" } });

    await waitFor(() =>
      expect(screen.queryByTestId("client-dropdown")).not.toBeInTheDocument(),
    );
    expect(field().value).toBe("");
    expect(onChangeSpy).toHaveBeenLastCalledWith("");
  });

  it("S15: shows the debt badge for a client with an open balance", async () => {
    await renderAndLoad({ showDebtBadge: true });

    // Debt fetch runs because showDebtBadge is enabled.
    await waitFor(() => expect(getDebtorsMock).toHaveBeenCalledTimes(1));

    fireEvent.change(field(), { target: { value: "Jan" } });
    await waitFor(() =>
      expect(screen.getByTestId("client-dropdown")).toBeInTheDocument(),
    );

    // Client 1 has a debt of 35 → badge shown with the formatted amount.
    const badge = await screen.findByTestId("client-debt-badge-1");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("$35.00");
    // Client 3 has no debt → no badge.
    expect(screen.queryByTestId("client-debt-badge-3")).not.toBeInTheDocument();
  });

  it("does not fetch debtors when showDebtBadge is off", async () => {
    await renderAndLoad();
    expect(getDebtorsMock).not.toHaveBeenCalled();
  });

  it("disabled: renders a plain input with no autocomplete dropdown", async () => {
    const onChangeSpy = jest.fn();
    render(
      <Harness disabled placeholder="Plain" onChangeSpy={onChangeSpy} />,
    );
    const input = screen.getByPlaceholderText("Plain");
    // No autocomplete wrapper/testids in disabled mode.
    expect(
      screen.queryByTestId("client-autocomplete-field"),
    ).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "anything" } });
    expect(onChangeSpy).toHaveBeenLastCalledWith("anything");
    expect(screen.queryByTestId("client-dropdown")).not.toBeInTheDocument();
  });
});
