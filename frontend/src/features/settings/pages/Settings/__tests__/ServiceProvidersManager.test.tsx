/** @jest-environment jsdom */
/**
 * ServiceProvidersManager (FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b
 * phase 5) — interaction-level tests, not props-level. LIRA-097/LIRA-120
 * lesson: a test that only checks a component's props/state without driving
 * the actual DOM (click, type, submit) can pass while the control is
 * unusable — these tests render the real component and fire real DOM
 * events.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import ServiceProvidersManager from "../ServiceProvidersManager";
import type { ServiceProviderEntity } from "@liratek/ui";

const mockGetServiceProviders = jest.fn();
const mockCreateServiceProvider = jest.fn();
const mockUpdateServiceProvider = jest.fn();
const mockDeleteServiceProvider = jest.fn();
// A STABLE object reference — mirrors CarrierLinesManager.test.tsx's comment:
// ServiceProvidersManager's load() is a useCallback depending on [api]; a
// factory returning a fresh object literal per useApi() call would
// re-trigger the load effect every render.
const mockApi = {
  getServiceProviders: mockGetServiceProviders,
  createServiceProvider: mockCreateServiceProvider,
  updateServiceProvider: mockUpdateServiceProvider,
  deleteServiceProvider: mockDeleteServiceProvider,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const SYSTEM_PROVIDER: ServiceProviderEntity = {
  id: 1,
  code: "OMT",
  label: "OMT",
  drawer_name: "OMT_System",
  is_system_provider: 1,
  sort_order: 0,
  is_active: 1,
  is_system: 1,
  created_at: "2026-08-01T00:00:00Z",
};

const NON_SYSTEM_PROVIDER: ServiceProviderEntity = {
  id: 10,
  code: "SYRIA",
  label: "Syria",
  drawer_name: "General",
  is_system_provider: 0,
  sort_order: 9,
  is_active: 1,
  is_system: 0,
  created_at: "2026-08-10T00:00:00Z",
};

describe("ServiceProvidersManager", () => {
  beforeEach(() => {
    mockGetServiceProviders
      .mockReset()
      .mockResolvedValue([SYSTEM_PROVIDER, NON_SYSTEM_PROVIDER]);
    mockCreateServiceProvider.mockReset().mockResolvedValue({
      success: true,
      id: 99,
    });
    mockUpdateServiceProvider.mockReset().mockResolvedValue({ success: true });
    mockDeleteServiceProvider.mockReset().mockResolvedValue({ success: true });
  });

  it("lists existing service providers with their drawer", async () => {
    render(<ServiceProvidersManager />);

    // "OMT" is both the seeded row's code AND label (matches the real seed
    // data — create_db.sql's `(1, 'OMT', 'OMT', 'OMT_System', ...)`), so it
    // legitimately renders twice; assert on the unique drawer/label text
    // instead of triggering a "multiple elements" ambiguity.
    expect(await screen.findByText("OMT_System")).toBeInTheDocument();
    expect(screen.getAllByText("OMT").length).toBe(2); // code cell + label cell
    expect(screen.getByText("Syria")).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
  });

  it("creates a new service provider via the form and it appears in the list", async () => {
    render(<ServiceProvidersManager />);
    await screen.findByText("OMT_System");

    fireEvent.click(screen.getByText("+ Add Provider"));
    fireEvent.change(screen.getByPlaceholderText("e.g. SYRIA"), {
      target: { value: "germany" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Syria"), {
      target: { value: "Germany" },
    });

    // Refresh the mock to include the newly created row for the post-save reload.
    mockGetServiceProviders.mockResolvedValue([
      SYSTEM_PROVIDER,
      NON_SYSTEM_PROVIDER,
      {
        id: 11,
        code: "GERMANY",
        label: "Germany",
        drawer_name: "General",
        is_system_provider: 0,
        sort_order: 10,
        is_active: 1,
        is_system: 0,
        created_at: "2026-08-10T00:00:00Z",
      },
    ]);

    fireEvent.click(screen.getByText("Create"));

    await waitFor(() =>
      // The UI uppercases/trims the code before sending — the operator can
      // type any case, the server always sees a normalized value.
      expect(mockCreateServiceProvider).toHaveBeenCalledWith({
        code: "GERMANY",
        label: "Germany",
      }),
    );

    expect(await screen.findByText("GERMANY")).toBeInTheDocument();
  });

  it("does NOT offer a drawer picker anywhere in the create form (money-safety: new providers always settle to General server-side)", async () => {
    render(<ServiceProvidersManager />);
    await screen.findByText("OMT_System");

    fireEvent.click(screen.getByText("+ Add Provider"));

    // "Drawer" as a TABLE HEADER (informational, showing existing rows'
    // resolved drawer) is fine and expected — what must be absent is a
    // drawer FIELD the operator could set, which PaymentMethodsManager's
    // form has as a labelled `<Select>` (`getByLabelText`, not `getByText`,
    // scopes to a form control rather than any text node on the page).
    expect(screen.queryByLabelText("Drawer")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    // Only code + label inputs exist.
    expect(screen.getByPlaceholderText("e.g. SYRIA")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g. Syria")).toBeInTheDocument();
  });

  it("surfaces a failed create (e.g. duplicate code) instead of silently closing the form", async () => {
    mockCreateServiceProvider.mockResolvedValue({
      success: false,
      error: "Service provider code 'OMT' already exists",
    });
    render(<ServiceProvidersManager />);
    await screen.findByText("OMT_System");

    fireEvent.click(screen.getByText("+ Add Provider"));
    fireEvent.change(screen.getByPlaceholderText("e.g. SYRIA"), {
      target: { value: "OMT" },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Syria"), {
      target: { value: "OMT Dup" },
    });
    fireEvent.click(screen.getByText("Create"));

    expect(
      await screen.findByText("Service provider code 'OMT' already exists"),
    ).toBeInTheDocument();
    // The form is still open (didn't silently succeed/close).
    expect(screen.getByText("New Service Provider")).toBeInTheDocument();
  });

  describe("system provider protections", () => {
    it("does not offer a Delete button for a system provider, but does for a non-system one", async () => {
      render(<ServiceProvidersManager />);
      await screen.findByText("OMT_System");

      const rows = screen.getAllByRole("row");
      const omtRow = rows.find((r) => within(r).queryByText("OMT_System"));
      const syriaRow = rows.find((r) => within(r).queryByText("Syria"));

      expect(omtRow).toBeDefined();
      expect(syriaRow).toBeDefined();
      expect(within(omtRow!).queryByText("Delete")).not.toBeInTheDocument();
      expect(within(syriaRow!).getByText("Delete")).toBeInTheDocument();
    });

    it("clicking Delete on a non-system provider calls the API; a system provider offers no such control to click", async () => {
      window.confirm = jest.fn(() => true);
      render(<ServiceProvidersManager />);
      await screen.findByText("OMT_System");

      const rows = screen.getAllByRole("row");
      const syriaRow = rows.find((r) => within(r).queryByText("Syria"))!;
      fireEvent.click(within(syriaRow).getByText("Delete"));

      await waitFor(() =>
        expect(mockDeleteServiceProvider).toHaveBeenCalledWith(10),
      );
    });

    it("disables the code field when editing a system provider, and never sends `code` on save", async () => {
      render(<ServiceProvidersManager />);
      await screen.findByText("OMT_System");

      const rows = screen.getAllByRole("row");
      const omtRow = rows.find((r) => within(r).queryByText("OMT_System"))!;
      fireEvent.click(within(omtRow).getByText("Edit"));

      const codeInput = screen.getByLabelText(
        "Code (uppercase, unique)",
      ) as HTMLInputElement;
      expect(codeInput.value).toBe("OMT");
      // `disabled` is the real-browser guarantee a user cannot type into
      // this field — jsdom's `fireEvent.change` bypasses `disabled` (it
      // dispatches directly through React's synthetic event system, unlike
      // a real keyboard/mouse interaction a browser would block), so
      // asserting on a post-`fireEvent.change` value would not prove
      // anything about real usability. `toBeDisabled()` is the correct and
      // sufficient interaction-level proof.
      expect(codeInput).toBeDisabled();

      fireEvent.change(screen.getByLabelText("Display Label"), {
        target: { value: "OMT Renamed" },
      });
      fireEvent.click(screen.getByText("Save Changes"));

      await waitFor(() =>
        expect(mockUpdateServiceProvider).toHaveBeenCalledWith(1, {
          label: "OMT Renamed",
        }),
      );
      // The update call NEVER carries a `code` field — proves the UI can't
      // smuggle one in even by mutating the disabled input's DOM value.
      const [, payload] = mockUpdateServiceProvider.mock.calls[0];
      expect(payload).not.toHaveProperty("code");
    });

    it("disables the code field when editing a NON-system provider too (code is never editable for any row)", async () => {
      render(<ServiceProvidersManager />);
      await screen.findByText("Syria");

      const rows = screen.getAllByRole("row");
      const syriaRow = rows.find((r) => within(r).queryByText("Syria"))!;
      fireEvent.click(within(syriaRow).getByText("Edit"));

      const codeInput = screen.getByLabelText(
        "Code (uppercase, unique)",
      ) as HTMLInputElement;
      expect(codeInput.value).toBe("SYRIA");
      expect(codeInput).toBeDisabled();
    });
  });

  it("toggles active state via the status pill", async () => {
    render(<ServiceProvidersManager />);
    await screen.findByText("OMT_System");

    const rows = screen.getAllByRole("row");
    const syriaRow = rows.find((r) => within(r).queryByText("Syria"))!;
    fireEvent.click(within(syriaRow).getByText("Active"));

    await waitFor(() =>
      expect(mockUpdateServiceProvider).toHaveBeenCalledWith(10, {
        is_active: 0,
      }),
    );
  });
});
