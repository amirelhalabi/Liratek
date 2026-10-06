/**
 * LIRA-263 — the client on a maintenance job survives reopen + status
 * changes on the page side.
 *
 * Since LIRA-263 the jobs list carries the linked client's phone
 * (`MaintenanceRepository.getJobs`), read from `clients.phone_number` —
 * which other modules store as free text. Two page-side guarantees:
 *
 *  1. A status transition is not an edit of the client: it must never fail
 *     because of the stored phone's format. It therefore sends the client
 *     NAME unchanged (which is what lets the backend keep the job's client
 *     link — MaintenanceService.saveJob) and a blank phone. Before this, the
 *     transition re-sent `job.client_phone`, so a job whose client's stored
 *     number was e.g. "03/123456" could no longer move to In Progress
 *     ("Invalid phone number format").
 *  2. Reopening a job puts the stored phone back in the Phone field (it
 *     used to come back empty because the list never carried it).
 *
 * The payload is checked against `saveMaintenanceJobSchema` itself (rule
 * 24), the contract both transports validate against.
 *
 * Rule 17: case 1 was run against the unfixed page and failed — the
 * transition payload carried `client_phone: "03/123456"`, which the schema
 * rejects. Case 2 is a guard for the read-side fix (the page already read
 * `job.client_phone`; the list simply never supplied it) — not proven
 * failing-first at the page level; its failing-first proof is the core
 * workflow test (MaintenanceService.clientPhoneWorkflow.test.ts).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { saveMaintenanceJobSchema } from "@liratek/core";
import Maintenance from "../index";

const mockGetMaintenanceJobs = jest.fn();
const mockSaveMaintenanceJob = jest.fn();
const mockGetProducts = jest.fn();

// Rule 25: a STABLE useApi() reference, never a fresh literal per call.
const mockApi = {
  getMaintenanceJobs: mockGetMaintenanceJobs,
  saveMaintenanceJob: mockSaveMaintenanceJob,
  deleteMaintenanceJob: jest.fn(),
  getMaintenanceStatusHistory: jest.fn().mockResolvedValue([]),
  getProducts: mockGetProducts,
  getAllSettings: jest.fn().mockResolvedValue([]),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "staff", role: "staff" } }),
}));

const LINKED_JOB = {
  id: 7,
  status: "Received",
  device_name: "iPhone 13",
  issue_description: "Screen cracked",
  client_id: 42,
  client_name: "Rami Haddad",
  // Free-text format another module stored on the client record.
  client_phone: "03/123456",
  currency: "USD",
  price_usd: 50,
  cost_usd: 20,
  parts_price_usd: 0,
  parts: [],
  created_at: "2026-10-06T10:00:00.000Z",
};

describe("Maintenance — client survives reopen + status change (LIRA-263)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMaintenanceJobs.mockResolvedValue([LINKED_JOB]);
    mockGetProducts.mockResolvedValue([]);
    mockSaveMaintenanceJob.mockResolvedValue({ success: true, id: 7 });
    window.alert = jest.fn();
  });

  it("a status transition keeps the client name and never re-sends the stored phone", async () => {
    render(<Maintenance />);
    fireEvent.click(await screen.findByTitle("Mark In Progress"));

    await waitFor(() => expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1));
    const payload = mockSaveMaintenanceJob.mock.calls[0][0];

    const parsed = saveMaintenanceJobSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.id).toBe(7);
    expect(parsed.data.status).toBe("In_Progress");
    expect(parsed.data.client_name).toBe("Rami Haddad");
    expect(parsed.data.client_phone).toBe("");
    // The page never invents a client_id on a transition — the backend keeps
    // the stored link because the name is unchanged.
    expect(parsed.data.client_id).toBeUndefined();
    expect(window.alert).not.toHaveBeenCalled();
  });

  it("a draft resave of a reopened job with an untouched phone saves (blank phone, name kept) instead of failing on the stored format", async () => {
    render(<Maintenance />);
    fireEvent.click((await screen.findByText("iPhone 13")).closest("button")!);
    await waitFor(() =>
      expect(
        (document.getElementById("maintenance-client-phone") as HTMLInputElement)
          .value,
      ).toBe("03/123456"),
    );
    fireEvent.click(screen.getByText("Save as Draft"));

    await waitFor(() => expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1));
    const parsed = saveMaintenanceJobSchema.safeParse(
      mockSaveMaintenanceJob.mock.calls[0][0],
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.client_name).toBe("Rami Haddad");
    expect(parsed.data.client_phone).toBe("");
  });

  it("a phone the operator actually edits on a reopened job IS sent", async () => {
    render(<Maintenance />);
    fireEvent.click((await screen.findByText("iPhone 13")).closest("button")!);
    const phone = document.getElementById(
      "maintenance-client-phone",
    ) as HTMLInputElement;
    await waitFor(() => expect(phone.value).toBe("03/123456"));
    fireEvent.change(phone, { target: { value: "70 123 456" } });
    fireEvent.click(screen.getByText("Save as Draft"));

    await waitFor(() => expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1));
    const parsed = saveMaintenanceJobSchema.safeParse(
      mockSaveMaintenanceJob.mock.calls[0][0],
    );
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.client_phone).toBe("70123456");
  });

  it("reopening a job fills the Phone field from the listed row", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      { ...LINKED_JOB, client_phone: "03123456" },
    ]);
    render(<Maintenance />);
    fireEvent.click(await screen.findByText("iPhone 13"));

    await waitFor(() =>
      expect(
        (document.getElementById("maintenance-client-phone") as HTMLInputElement)
          .value,
      ).toBe("03123456"),
    );
  });
});
