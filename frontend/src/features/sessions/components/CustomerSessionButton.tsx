import { useState, useEffect } from "react";
import { UserPlus, Users, X, Save } from "lucide-react";
import { StartSessionModal } from "./StartSessionModal";
import { useSession } from "../context/SessionContext";
import { useApi, appEvents } from "@liratek/ui";
import { arePhoneNumbersEqual } from "@/utils/phoneNumber";
import logger from "@/utils/logger";

/**
 * Embedded Customer Session Button - Compact design for topbar
 * Replaces the floating circles with an embedded button
 */
export function CustomerSessionButton() {
  const { allActiveSessions, activeSession, switchToSession, closeSession } =
    useSession();
  const api = useApi();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [existingClients, setExistingClients] = useState<any[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);

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
      setShowNewSessionModal(true);
    } else {
      setShowDropdown(!showDropdown);
    }
  };

  const handleSessionClick = (sessionId: number) => {
    switchToSession(sessionId);
    setShowDropdown(false);
  };

  // Load existing clients to check for duplicates
  useEffect(() => {
    const loadExistingClients = async () => {
      try {
        setIsLoadingClients(true);
        const clients = await api.getClients();
        setExistingClients(clients);
      } catch (err) {
        logger.error("Failed to load clients:", err);
        appEvents.emit(
          "notification:show",
          "Failed to load client list",
          "error",
        );
      } finally {
        setIsLoadingClients(false);
      }
    };
    loadExistingClients();
  }, [api]);

  const handleCloseSession = async (e: React.MouseEvent, sessionId: number) => {
    e.stopPropagation();
    try {
      await closeSession(sessionId);
    } catch (err) {
      console.error("Failed to close session:", err);
    }
  };

  const handleSaveClient = async (e: React.MouseEvent, session: any) => {
    e.stopPropagation();

    if (!session.customer_phone) {
      appEvents.emit(
        "notification:show",
        "Cannot save client without phone number",
        "warning",
      );
      return;
    }

    try {
      // Check if client already exists with this phone using utility function
      const existingClient = existingClients.find((c: any) =>
        arePhoneNumbersEqual(c.phone_number, session.customer_phone),
      );

      if (existingClient) {
        appEvents.emit(
          "notification:show",
          `Client already exists: ${existingClient.full_name}`,
          "warning",
        );
        return;
      }

      // Create client directly via API
      const result = await window.api.clients.create({
        full_name: session.customer_name || "Unknown",
        phone_number: session.customer_phone,
        notes: `Added from customer session`,
        whatsapp_opt_in: 1,
      });

      if (result.success) {
        // Reload clients to update the list
        const clients = await api.getClients();
        setExistingClients(clients);

        appEvents.emit(
          "notification:show",
          "Client saved successfully",
          "success",
        );
      } else {
        appEvents.emit(
          "notification:show",
          result.error || "Failed to save client",
          "error",
        );
      }
    } catch (err) {
      logger.error("Failed to save client:", err);
      appEvents.emit(
        "notification:show",
        "Failed to save client. Please try again.",
        "error",
      );
    }
  };

  const handleNewSessionClick = () => {
    setShowDropdown(false);
    setShowNewSessionModal(true);
  };

  const activeCount = allActiveSessions.length;
  const hasActiveSession = !!activeSession;

  return (
    <>
      {/* Dropdown Modal */}
      {showDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowDropdown(false)}
        />
      )}

      {/* Session Button with Dropdown */}
      <div className="relative">
        <button
          onClick={handleMainButtonClick}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
            hasActiveSession
              ? "bg-gradient-to-r from-violet-600 to-violet-700 text-white shadow-lg"
              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
          title={
            activeCount === 0
              ? "Start Customer Session"
              : `${activeCount} active session${activeCount > 1 ? "s" : ""}`
          }
        >
          {activeCount > 0 ? (
            <>
              <Users size={16} />
              <span className="text-sm font-medium">{activeCount}</span>
              {activeSession?.customer_name && (
                <span className="text-xs text-white/80 hidden lg:inline">
                  {activeSession.customer_name.split(" ")[0]}
                </span>
              )}
            </>
          ) : (
            <>
              <UserPlus size={16} />
              <span className="text-sm font-medium">New Customer</span>
            </>
          )}
        </button>

        {/* Dropdown Menu */}
        {showDropdown && activeCount > 0 && (
          <div className="absolute top-full left-0 mt-2 w-64 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-700">
              <p className="text-sm font-semibold text-white">
                Active Sessions
              </p>
              <p className="text-xs text-slate-400">
                {activeCount} session{activeCount > 1 ? "s" : ""}
              </p>
            </div>

            {/* Session List */}
            <div className="max-h-64 overflow-y-auto p-2">
              {isLoadingClients ? (
                <div className="flex items-center justify-center py-4 text-slate-400">
                  <span className="text-sm">Loading clients...</span>
                </div>
              ) : (
                <>
                  {/* New Session Button */}
                  <button
                    onClick={handleNewSessionClick}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700 transition-all group"
                  >
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-600 to-violet-700 flex items-center justify-center flex-shrink-0">
                      <UserPlus size={16} className="text-white" />
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-sm font-medium text-white group-hover:text-violet-300">
                        New Session
                      </p>
                      <p className="text-xs text-slate-400">
                        Start a new customer session
                      </p>
                    </div>
                  </button>

                  {/* Active Sessions */}
                  {allActiveSessions.map((session) => {
                    // Check if client already exists with this phone
                    const clientExists = existingClients.some((c: any) =>
                      arePhoneNumbersEqual(
                        c.phone_number,
                        session.customer_phone,
                      ),
                    );

                    return (
                      <div
                        key={session.id}
                        onClick={() => handleSessionClick(session.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all group cursor-pointer ${
                          activeSession?.id === session.id
                            ? "bg-violet-900/30 border border-violet-700"
                            : "hover:bg-slate-700"
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-full bg-gradient-to-br ${getAvatarColor(session.id)} flex items-center justify-center flex-shrink-0`}
                        >
                          <span className="text-xs font-bold text-white">
                            {getInitials(session.customer_name)}
                          </span>
                        </div>
                        <div className="flex-1 text-left">
                          <p
                            className={`text-sm font-medium ${
                              activeSession?.id === session.id
                                ? "text-violet-300"
                                : "text-white group-hover:text-violet-300"
                            }`}
                          >
                            {session.customer_name || "Unknown Customer"}
                          </p>
                          <p className="text-xs text-slate-400">
                            {session.customer_phone}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {/* Save button - only show if client doesn't exist and has phone */}
                          {!clientExists && session.customer_phone && (
                            <button
                              onClick={(e) => handleSaveClient(e, session)}
                              className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-emerald-900/20 rounded transition-all"
                              title="Save as client"
                            >
                              <Save size={16} />
                            </button>
                          )}
                          {/* Close button */}
                          <button
                            onClick={(e) => handleCloseSession(e, session.id)}
                            className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded transition-all"
                            title="Close session"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* New Session Modal */}
      <StartSessionModal
        isOpen={showNewSessionModal}
        onClose={() => setShowNewSessionModal(false)}
      />
    </>
  );
}
