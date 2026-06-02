/** @jest-environment jsdom */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EditHistoryPopover } from "../EditHistoryPopover";
import type { AuditLogEntry } from "@/types/electron";
// @testing-library/jest-dom matchers are global (jest.setup.ts) — no import needed.

// ── Audit API mock ───────────────────────────────────────────────────────────

type GetByEntityResult = {
  success: boolean;
  rows?: AuditLogEntry[];
  error?: string;
};

const getByEntity = jest.fn<Promise<GetByEntityResult>, [string, string]>();

beforeEach(() => {
  getByEntity.mockReset();
  (window as unknown as { api: Record<string, unknown> }).api = {
    audit: { getByEntity },
  };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: 1,
    user_id: 7,
    username: "amir",
    role: "admin",
    action: "update",
    entity_type: "expense",
    entity_id: "42",
    summary: "Updated expense",
    old_values: null,
    new_values: null,
    metadata: null,
    created_at: "2026-06-01T10:00:00.000Z",
    updated_at: "2026-06-01T10:00:00.000Z",
    ...overrides,
  };
}

function renderPopover(entityId: string | number = 42) {
  render(
    <EditHistoryPopover
      entityType="expense"
      entityId={entityId}
      trigger={<span>history</span>}
    />,
  );
}

describe("EditHistoryPopover", () => {
  it("does not render the popover until the trigger is clicked", () => {
    getByEntity.mockResolvedValue({ success: true, rows: [] });
    renderPopover();

    expect(screen.getByTestId("edit-history-trigger")).toBeInTheDocument();
    expect(
      screen.queryByTestId("edit-history-popover"),
    ).not.toBeInTheDocument();
  });

  it("opens the popover and fetches history when the trigger is clicked", async () => {
    getByEntity.mockResolvedValue({ success: true, rows: [makeEntry()] });
    renderPopover(42);

    fireEvent.click(screen.getByTestId("edit-history-trigger"));

    expect(
      await screen.findByTestId("edit-history-popover"),
    ).toBeInTheDocument();
    // Fetches by entity type + stringified id.
    expect(getByEntity).toHaveBeenCalledWith("expense", "42");
  });

  it("renders history entries returned by the audit API", async () => {
    getByEntity.mockResolvedValue({
      success: true,
      rows: [
        makeEntry({
          id: 1,
          username: "amir",
          summary: "Changed description",
          old_values: JSON.stringify({ description: "Old desc" }),
          new_values: JSON.stringify({ description: "New desc" }),
        }),
      ],
    });
    renderPopover();

    fireEvent.click(screen.getByTestId("edit-history-trigger"));

    await screen.findByTestId("edit-history-popover");
    expect(screen.getByText("amir")).toBeInTheDocument();
    expect(screen.getByText("Changed description")).toBeInTheDocument();
    // Old → new diff is rendered.
    expect(screen.getByText("Old desc")).toBeInTheDocument();
    expect(screen.getByText("New desc")).toBeInTheDocument();
  });

  it("renders a before → after field diff (the '→' separator)", async () => {
    getByEntity.mockResolvedValue({
      success: true,
      rows: [
        makeEntry({
          old_values: JSON.stringify({ description: "Before" }),
          new_values: JSON.stringify({ description: "After" }),
        }),
      ],
    });
    renderPopover();

    fireEvent.click(screen.getByTestId("edit-history-trigger"));

    const popover = await screen.findByTestId("edit-history-popover");
    expect(popover.textContent).toContain("→");
  });

  it("renders multiple edits as a full timeline", async () => {
    getByEntity.mockResolvedValue({
      success: true,
      rows: [
        makeEntry({ id: 2, username: "amir", summary: "Edit v3" }),
        makeEntry({ id: 1, username: "amir", summary: "Edit v2" }),
      ],
    });
    renderPopover();

    fireEvent.click(screen.getByTestId("edit-history-trigger"));

    const popover = await screen.findByTestId("edit-history-popover");
    const entries = popover.querySelectorAll("ol li");
    expect(entries.length).toBe(2);
  });

  it("shows the empty state when there is no history", async () => {
    getByEntity.mockResolvedValue({ success: true, rows: [] });
    renderPopover();

    fireEvent.click(screen.getByTestId("edit-history-trigger"));

    await screen.findByTestId("edit-history-popover");
    expect(await screen.findByText("No edit history")).toBeInTheDocument();
  });

  it("shows an error message when the audit API returns failure", async () => {
    getByEntity.mockResolvedValue({
      success: false,
      error: "Boom: could not load",
    });
    renderPopover();

    fireEvent.click(screen.getByTestId("edit-history-trigger"));

    await screen.findByTestId("edit-history-popover");
    expect(await screen.findByText("Boom: could not load")).toBeInTheDocument();
  });

  it("shows an error message when the audit API throws", async () => {
    getByEntity.mockRejectedValue(new Error("network down"));
    renderPopover();

    fireEvent.click(screen.getByTestId("edit-history-trigger"));

    await screen.findByTestId("edit-history-popover");
    expect(await screen.findByText("network down")).toBeInTheDocument();
  });

  it("closes the popover when the trigger is clicked again", async () => {
    getByEntity.mockResolvedValue({ success: true, rows: [] });
    renderPopover();

    const trigger = screen.getByTestId("edit-history-trigger");
    fireEvent.click(trigger);
    await screen.findByTestId("edit-history-popover");

    fireEvent.click(trigger);
    await waitFor(() =>
      expect(
        screen.queryByTestId("edit-history-popover"),
      ).not.toBeInTheDocument(),
    );
  });

  it("closes the popover when clicking outside of it", async () => {
    getByEntity.mockResolvedValue({ success: true, rows: [] });
    renderPopover();

    fireEvent.click(screen.getByTestId("edit-history-trigger"));
    await screen.findByTestId("edit-history-popover");

    // Outside click (mousedown on document body) closes the popover.
    fireEvent.mouseDown(document.body);
    await waitFor(() =>
      expect(
        screen.queryByTestId("edit-history-popover"),
      ).not.toBeInTheDocument(),
    );
  });
});
