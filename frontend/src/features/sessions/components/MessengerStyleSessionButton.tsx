import { useState } from "react";
import { UserPlus } from "lucide-react";
import { StartSessionModal } from "./StartSessionModal";
import { useSession } from "../context/SessionContext";

export function MessengerStyleSessionButton() {
  const { allActiveSessions, activeSession, switchToSession } = useSession();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);

  const getInitials = (name?: string) => {
    if (!name) return "?";
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getAvatarColor = (sessionId: number) => {
    const colors = [
      "from-violet-600 to-violet-700",
      "from-blue-600 to-blue-700",
      "from-green-600 to-green-700",
      "from-orange-600 to-orange-700",
      "from-pink-600 to-pink-700",
      "from-cyan-600 to-cyan-700",
    ];
    return colors[sessionId % colors.length];
  };

  const handleMainButtonClick = () => {
    if (allActiveSessions.length === 0) {
      // No sessions - open create modal directly
      setShowNewSessionModal(true);
    } else {
      // Toggle expansion
      setIsExpanded(!isExpanded);
    }
  };

  const handleSessionClick = (sessionId: number) => {
    switchToSession(sessionId);
    setIsExpanded(false);
  };

  const handleNewSessionClick = () => {
    setIsExpanded(false);
    setShowNewSessionModal(true);
  };

  return (
    <>
      {/* Background Overlay when expanded */}
      {isExpanded && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40 transition-opacity duration-200"
          role="presentation"
          onClick={() => setIsExpanded(false)}
        />
      )}

      {/* Speed Dial Container */}
      <div className="fixed top-6 right-6 z-50 flex flex-col items-center gap-3">
        {/* Expanded Session Avatars - Vertical Stack */}
        {isExpanded && allActiveSessions.length > 0 && (
          <div className="flex flex-col items-center gap-3 mb-2">
            {/* New Session Button (Always at top when expanded) */}
            <button
              onClick={handleNewSessionClick}
              className="w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white shadow-xl flex items-center justify-center transition-all hover:scale-110 border-2 border-violet-500/50 animate-in slide-in-from-bottom-2 duration-200"
              style={{ animationDelay: "0ms" }}
              title="New Customer Session"
            >
              <UserPlus size={20} />
            </button>

            {/* Active Session Avatars */}
            {allActiveSessions.map((session, index) => (
              <button
                key={session.id}
                onClick={() => handleSessionClick(session.id)}
                className={`w-14 h-14 rounded-full bg-gradient-to-br ${getAvatarColor(session.id)} hover:scale-110 text-white shadow-xl flex items-center justify-center font-bold transition-all border-2 ${
                  activeSession?.id === session.id
                    ? "border-white ring-4 ring-violet-400/50"
                    : "border-slate-700"
                } animate-in slide-in-from-bottom-2 duration-200`}
                style={{ animationDelay: `${(index + 1) * 50}ms` }}
                title={session.customer_name || "Unknown Customer"}
              >
                <span className="text-sm">
                  {getInitials(session.customer_name)}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Main Trigger Button (FAB) */}
        <button
          onClick={handleMainButtonClick}
          className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white shadow-2xl flex items-center justify-center transition-all hover:scale-110 border-2 border-violet-500/50"
          title={
            allActiveSessions.length === 0
              ? "New Customer Session"
              : "Manage Sessions"
          }
        >
          {isExpanded ? (
            <div className="text-4xl font-light leading-none">−</div>
          ) : (
            <>
              <UserPlus size={32} />
              {allActiveSessions.length > 0 && (
                <span className="absolute -bottom-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-6 h-6 flex items-center justify-center border-2 border-slate-900 shadow-lg">
                  {allActiveSessions.length}
                </span>
              )}
            </>
          )}
        </button>
      </div>

      {/* New Session Modal */}
      <StartSessionModal
        isOpen={showNewSessionModal}
        onClose={() => setShowNewSessionModal(false)}
      />
    </>
  );
}
