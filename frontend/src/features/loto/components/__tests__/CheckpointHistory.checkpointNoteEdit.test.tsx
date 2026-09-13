/** @jest-environment jsdom */

/**
 * CheckpointHistory — saving a checkpoint's note must hit the CHECKPOINT
 * channel, not the ticket-metadata channel (cross-table id bug).
 *
 * `startEdit(checkpoint)` sets `editingId` to a `loto_checkpoints` row id.
 * `api.loto.updateMetadata` resolves that id against `loto_tickets`
 * (`LotoService.updateLotoMetadata` → `ticketRepo.getTicketById(id)`), and
 * both tables are `INTEGER PRIMARY KEY AUTOINCREMENT` starting at 1, so ids
 * collide: the old code either silently rewrote an unrelated TICKET's note
 * or failed with "Loto ticket not found" — the checkpoint's own note never
 * saved. The fix routes the save through `api.loto.checkpoint.update`
 * instead, which persists `loto_checkpoints.note` directly.
 *
 * The negative assertion (`updateMetadata` NOT called) is the whole point —
 * a test that only checks "some save call happened" would have passed on
 * the buggy code too, since the buggy code also calls a function and often
 * resolves `{ success: true }`.
 *
 * Rule-17 note (discharged 2026-09-13): reverted `handleSaveEdit` in
 * `frontend/src/features/loto/components/CheckpointHistory.tsx` to call
 * `api.loto.updateMetadata({ id: editingId, note: editNoteValue })` instead
 * of `api.loto.checkpoint.update(editingId, { note: editNoteValue })`. Ran
 * `npx jest --maxWorkers=2 --testPathPatterns "CheckpointHistory.checkpointNoteEdit"`
 * — the test failed:
 *   expect(jest.fn()).toHaveBeenCalled()
 *   Expected number of calls: >= 1
 *   Received number of calls:    0
 * (`mockCheckpointUpdate` was never called — the reverted code called
 * `mockUpdateMetadata` instead, which resolved `undefined` since this test
 * never stubs a return value for it, so `handleSaveEdit` then threw
 * `TypeError: Cannot read properties of undefined (reading 'success')`).
 * 1 failed, 1 total. Reverted from a pre-edit copy;
 * `git diff --stat -- frontend/src/features/loto/components/CheckpointHistory.tsx`
 * printed nothing afterward.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CheckpointHistory } from "../CheckpointHistory";

const mockCheckpointGetByDateRange = jest.fn();
const mockCheckpointUpdate = jest.fn();
const mockUpdateMetadata = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    loto: {
      checkpoint: {
        getByDateRange: mockCheckpointGetByDateRange,
        update: mockCheckpointUpdate,
      },
      updateMetadata: mockUpdateMetadata,
    },
  }),
}));

const checkpoint = {
  id: 7,
  checkpoint_date: "2026-08-01",
  period_start: "2026-07-25",
  period_end: "2026-08-01",
  total_sales: 1000000,
  total_commission: 50000,
  total_tickets: 10,
  total_prizes: 0,
  total_cash_prizes: 0,
  total_cash_prizes_count: 0,
  is_settled: 0,
  settled_at: null,
  settlement_id: null,
  note: "old note",
  created_at: "2026-08-01 10:00:00",
  updated_at: "2026-08-01 10:00:00",
};

describe("CheckpointHistory — checkpoint note edit targets the checkpoint channel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckpointGetByDateRange.mockResolvedValue({
      success: true,
      checkpoints: [checkpoint],
    });
    mockCheckpointUpdate.mockResolvedValue({
      success: true,
      checkpoint: { ...checkpoint, note: "new note" },
    });
  });

  it("calls api.loto.checkpoint.update with the checkpoint id and NOT api.loto.updateMetadata", async () => {
    render(<CheckpointHistory onClose={jest.fn()} />);

    await waitFor(() =>
      expect(mockCheckpointGetByDateRange).toHaveBeenCalled(),
    );

    const editButton = await screen.findByTitle("Edit note");
    fireEvent.click(editButton);

    const noteInput = await screen.findByPlaceholderText(
      "Add a note for this checkpoint...",
    );
    fireEvent.change(noteInput, { target: { value: "new note" } });

    const saveButton = await screen.findByTitle("Save");
    fireEvent.click(saveButton);

    await waitFor(() => expect(mockCheckpointUpdate).toHaveBeenCalled());

    expect(mockCheckpointUpdate).toHaveBeenCalledWith(checkpoint.id, {
      note: "new note",
    });
    expect(mockUpdateMetadata).not.toHaveBeenCalled();
  });
});
