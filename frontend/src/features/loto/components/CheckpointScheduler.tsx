import { useState, useEffect } from "react";
import { useApi } from "@liratek/ui";
import { AlertTriangle, CheckCircle } from "lucide-react";

interface CheckpointSchedulerProps {
  onCheckpointCreated?: (checkpoint: any) => void;
}

export function CheckpointScheduler({
  onCheckpointCreated,
}: CheckpointSchedulerProps) {
  const api = useApi();
  const [showPopup, setShowPopup] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastCheckpoint, setLastCheckpoint] = useState<any>(null);

  // Check if it's Thursday or Monday at 7pm and show the popup if needed
  useEffect(() => {
    const checkSchedule = () => {
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, 4 = Thursday
      const hour = now.getHours();
      const minutes = now.getMinutes();

      // Check if it's Thursday (4) or Monday (1) at 7pm (19:00)
      const isCorrectDay = dayOfWeek === 4 || dayOfWeek === 1; // Thursday or Monday
      const isCorrectTime = hour === 19 && minutes === 0; // 7:00 PM exactly

      if (isCorrectDay && isCorrectTime) {
        // Check if we already have a checkpoint for today
        const today = now.toISOString().split("T")[0];
        checkForExistingCheckpoint(today);
      }
    };

    // Check immediately and then every minute
    checkSchedule();
    const interval = setInterval(checkSchedule, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  // Load the last checkpoint on mount
  useEffect(() => {
    loadLastCheckpoint();
  }, []);

  async function loadLastCheckpoint() {
    try {
      const result = await api.loto.checkpoint.getLast();
      if (result.success && result.checkpoint) {
        setLastCheckpoint(result.checkpoint);
      }
    } catch (error) {
      console.error("Error loading last checkpoint:", error);
    }
  }

  async function checkForExistingCheckpoint(date: string) {
    try {
      const result = await api.loto.checkpoint.getByDate(date);
      if (result.success && !result.checkpoint) {
        // No checkpoint exists for today, show the popup
        setShowPopup(true);
      }
    } catch (error) {
      console.error("Error checking for existing checkpoint:", error);
    }
  }

  async function handleCreateCheckpoint() {
    setIsProcessing(true);
    try {
      // Create checkpoint for the period since last checkpoint
      const checkpointData = {
        checkpoint_date: new Date().toISOString().split("T")[0],
        period_start: lastCheckpoint ? lastCheckpoint.period_end : "1970-01-01", // From beginning if no previous checkpoint
        period_end: new Date().toISOString().split("T")[0],
        note: `Scheduled checkpoint for ${new Date().toLocaleDateString()}`,
      };

      const result = await api.loto.checkpoint.create(checkpointData);
      if (result.success) {
        setShowPopup(false);
        setLastCheckpoint(result.checkpoint);
        onCheckpointCreated?.(result.checkpoint);
      } else {
        console.error("Failed to create checkpoint:", result.error);
        alert("Failed to create checkpoint: " + result.error);
      }
    } catch (error) {
      console.error("Error creating checkpoint:", error);
      alert("Error creating checkpoint: " + (error as Error).message);
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleDismiss() {
    setShowPopup(false);
  }

  if (!showPopup) {
    return null;
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md">
        <div className="p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-lg font-bold text-white mb-2">
                Scheduled Checkpoint
              </h3>
              <p className="text-slate-300 mb-4">
                It's time for the scheduled Loto checkpoint. Would you like to
                create one now?
              </p>

              <div className="flex gap-3">
                <button
                  onClick={handleDismiss}
                  className="flex-1 py-2.5 px-4 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
                >
                  Remind Me Later
                </button>
                <button
                  onClick={handleCreateCheckpoint}
                  disabled={isProcessing}
                  className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Creating...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="w-4 h-4" />
                      Create Now
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
