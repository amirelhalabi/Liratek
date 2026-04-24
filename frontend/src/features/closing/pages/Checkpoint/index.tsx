/**
 * Unified Checkpoint Modal
 *
 * Smart modal that auto-detects whether to show Opening or Closing form
 * based on whether an opening balance has been set for today.
 */

import { useState, useEffect } from "react";
import logger from "@/utils/logger";
import OpeningModal from "../Opening";
import ClosingModal from "../Closing";
import { useApi } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";

interface CheckpointModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CheckpointModal({
  isOpen,
  onClose,
}: CheckpointModalProps) {
  useModalFocusFix(isOpen);
  const api = useApi();
  const [mode, setMode] = useState<"CHECKING" | "OPENING" | "CLOSING">(
    "CHECKING",
  );

  // Check if opening exists when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode("CHECKING");

      api
        .hasOpeningBalanceToday()
        .then((exists) => {
          setMode(exists ? "CLOSING" : "OPENING");
        })
        .catch((error) => {
          logger.error("[Checkpoint] Failed to check opening balance:", error);
          setMode("OPENING"); // Default to opening if check fails
        });
    }
  }, [isOpen, api]);

  const handleClose = () => {
    setMode("CHECKING");
    onClose();
  };

  // Show loading state while checking
  if (mode === "CHECKING") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        role="presentation"
      >
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-8 shadow-2xl">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-white font-medium">Loading checkpoint...</p>
          </div>
        </div>
      </div>
    );
  }

  // Render appropriate modal based on mode
  if (mode === "OPENING") {
    return <OpeningModal isOpen={isOpen} onClose={handleClose} />;
  }

  if (mode === "CLOSING") {
    return <ClosingModal isOpen={isOpen} onClose={handleClose} />;
  }

  return null;
}
