/**
 * Per-Drawer Checkpoint Modal (single page)
 *
 * Performs a checkpoint for a single drawer. Fields pre-fill with the
 * system-expected balance; the cashier edits only what differs. Each field
 * shows a live two-tier variance status (green match / amber attention) — there
 * is no tolerance, any difference is flagged. Notes live on the same page.
 *
 * The count sheet and the save live in `useDrawerCheckpoint` +
 * `CheckpointDrawerBody`, shared with the after-sign-in "all drawers"
 * window (AllDrawersCheckpointModal) — this file is only the window around
 * them.
 */

import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { X } from "lucide-react";
import {
  useDrawerCheckpoint,
  SAVE_STYLES,
} from "../../hooks/useDrawerCheckpoint";
import { CheckpointDrawerBody } from "../../components/CheckpointDrawerBody";

interface CheckpointModalProps {
  isOpen: boolean;
  drawerName: string;
  onClose: () => void;
}

export default function CheckpointModal({
  isOpen,
  drawerName,
  onClose,
}: CheckpointModalProps) {
  useModalFocusFix(isOpen);
  const cp = useDrawerCheckpoint({ isOpen, drawerName, onSaved: onClose });
  const { drawerConfig, saving, overallStatus, saveLabel, handleSave } = cp;

  const handleCancel = () => {
    if (cp.hasUnsavedChanges) {
      if (
        confirm("You have unsaved changes. Are you sure you want to close?")
      ) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl"
        role="presentation"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-700 bg-slate-800">
          <div>
            <h2 className="text-xl font-bold text-white">
              Checkpoint — {drawerConfig?.label ?? drawerName}
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Adjust any amount that differs from the expected balance, then
              save.
            </p>
          </div>
          <button
            onClick={handleCancel}
            disabled={saving}
            className="text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <CheckpointDrawerBody cp={cp} />
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 p-6 bg-slate-800">
          <div className="flex justify-between items-center gap-3">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={cp.saveDisabled}
              className={`px-6 py-2 ${SAVE_STYLES[overallStatus]} text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed max-w-[70%] truncate`}
            >
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
