import { useState } from "react";
import { UserPlus } from "lucide-react";
import { StartSessionModal } from "./StartSessionModal";
import { useSession } from "../context/SessionContext";

export function NewCustomerButton() {
  const { allActiveSessions } = useSession();
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      {/* Floating button - bottom right corner */}
      <button
        onClick={() => setShowModal(true)}
        className="fixed bottom-6 right-6 w-16 h-16 bg-gradient-to-br from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white rounded-full shadow-2xl flex items-center justify-center z-40 transition-all hover:scale-110 active:scale-95 border-2 border-violet-500/50"
        title="New Customer Session"
      >
        <UserPlus size={28} />
        {allActiveSessions.length > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-slate-900 shadow-lg">
            {allActiveSessions.length}
          </span>
        )}
      </button>

      <StartSessionModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </>
  );
}
