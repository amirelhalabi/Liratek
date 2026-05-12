import { useState, useEffect, useRef } from "react";
import {
  UserPlus,
  Users,
  X,
  Save,
  Pencil,
  Check,
  Footprints,
  Trash2,
} from "lucide-react";
import { StartSessionModal } from "./StartSessionModal";
import { SessionPopupPanel } from "./SessionFloatingWindow";
import { useSession } from "../context/SessionContext";
import { useApi, appEvents } from "@liratek/ui";
import { arePhoneNumbersEqual } from "@/utils/phoneNumber";
import logger from "@/utils/logger";

type SessionFilter = "all" | "active" | "closed";

/**
 * Embedded Customer Session Button - Compact design for topbar
 * Shows "Customer Session - ClientName" when active.
 * Hover: shows cart/transaction popup panel.
 * Click: opens session switcher dropdown.
 */
interface CustomerSessionButtonProps {
  isKnownClient?: boolean;
}

export function CustomerSessionButton({
  isKnownClient = false,
}: CustomerSessionButtonProps) {
  const {
    allActiveSessions,
    allTodaySessions,
    activeSession,
    switchToSession,
    closeSession,
    deleteSession,
    updateSessionInfo,
    cartItemCount,
    startSession,
  } = useSession();
  const api = useApi();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  const [existingClients, setExistingClients] = useState<any[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("active");
  const editNameRef = useRef<HTMLInputElement>(null);

  // Hover popup state
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    // Small delay before hiding to allow moving mouse to popup
    hoverTimeoutRef.current = setTimeout(() => setIsHovered(false), 200);
  };

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
    // Always show dropdown (which has New Session + Walk-In options)
    setShowDropdown(!showDropdown);
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

  const handleDeleteSession = async (
    e: React.MouseEvent,
    sessionId: number,
    sessionName?: string,
  ) => {
    e.stopPropagation();
    if (
      !window.confirm(
        `Permanently delete session for "${sessionName || "this customer"}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await deleteSession(sessionId);
    } catch (err) {
      logger.error("Failed to delete session:", err);
      appEvents.emit("notification:show", "Failed to delete session", "error");
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

  const handleWalkInClick = async () => {
    setShowDropdown(false);
    try {
      // Generate "Client1", "Client2", ... based on today's existing walk-in sessions
      const todayResult = await window.api.session.getTodaySessions();
      const todayNames: string[] =
        todayResult.success && todayResult.sessions
          ? todayResult.sessions
              .map((s) => s.customer_name ?? "")
              .filter(Boolean)
          : [];

      let counter = 1;
      while (todayNames.includes(`Client${counter}`)) {
        counter++;
      }

      await startSession({ customer_name: `Client${counter}` });
    } catch (err: any) {
      logger.error("Failed to start walk-in session:", err);
      appEvents.emit(
        "notification:show",
        err?.message || "Failed to start walk-in session",
        "error",
      );
    }
  };

  const handleEditSession = (e: React.MouseEvent, session: any) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditName(session.customer_name || "");
    setEditPhone(session.customer_phone || "");
    setTimeout(() => editNameRef.current?.focus(), 50);
  };

  const handleSaveEdit = async (e: React.MouseEvent, sessionId: number) => {
    e.stopPropagation();
    try {
      // Switch to this session so updateSessionInfo works on it
      await switchToSession(sessionId);
      const updates: { customer_name?: string; customer_phone?: string } = {};
      if (editName.trim()) updates.customer_name = editName.trim();
      if (editPhone.trim()) updates.customer_phone = editPhone.trim();
      await updateSessionInfo(updates);
      setEditingSessionId(null);
    } catch (err) {
      logger.error("Failed to update session:", err);
      appEvents.emit("notification:show", "Failed to update session", "error");
    }
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingSessionId(null);
  };

  const activeCount = allActiveSessions.length;
  const hasActiveSession = !!activeSession;

  const filteredSessions =
    sessionFilter === "active"
      ? allActiveSessions
      : sessionFilter === "closed"
        ? allTodaySessions.filter((s) => !s.is_active)
        : allTodaySessions;

  return (
    <>
      {/* Dropdown backdrop */}
      {showDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowDropdown(false)}
        />
      )}

      {/* Session Button with Dropdown + Hover Popup */}
      <div
        className="relative"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
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
              <span className="text-sm font-medium">
                {isKnownClient ? "Client" : "Customer"} Session
                {activeSession?.customer_name
                  ? ` - ${activeSession.customer_name}`
                  : ""}
              </span>
              {cartItemCount > 0 && (
                <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-full px-2 py-0.5">
                  items: {cartItemCount}
                </span>
              )}
              {activeCount > 1 && (
                <span className="bg-white/20 text-white text-[10px] font-bold rounded-full px-2 py-0.5">
                  sessions: {activeCount}
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

        {/* Hover Popup: Session cart/transaction content */}
        {isHovered && hasActiveSession && !showDropdown && (
          <div
            ref={popupRef}
            className="absolute top-full left-0 mt-2 z-50 animate-in fade-in zoom-in-95 duration-200"
          >
            <SessionPopupPanel />
          </div>
        )}

        {/* Click Dropdown: Session switcher */}
        {showDropdown && (
          <div className="absolute top-full left-0 mt-2 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-700">
              <p className="text-sm font-semibold text-white">
                Customer Sessions
              </p>
              <p className="text-xs text-slate-400">
                {activeCount > 0
                  ? `${activeCount} active`
                  : "No active sessions"}
                {allTodaySessions.length > activeCount &&
                  ` · ${allTodaySessions.length - activeCount} closed`}
              </p>
            </div>

            {/* Filter Tabs */}
            <div className="flex border-b border-slate-700 px-2 pt-2">
              {(["active", "all", "closed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setSessionFilter(f)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-t-md transition-colors ${
                    sessionFilter === f
                      ? "bg-slate-700 text-white border-b-2 border-violet-500"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {f === "active"
                    ? "Active"
                    : f === "closed"
                      ? "Closed"
                      : "All"}
                </button>
              ))}
            </div>

            {/* Session List */}
            <div className="max-h-64 overflow-y-auto p-2">
              {isLoadingClients ? (
                <div className="flex items-center justify-center py-4 text-slate-400">
                  <span className="text-sm">Loading clients...</span>
                </div>
              ) : (
                <>
                  {/* New Session + Walk-In (only in active/all) */}
                  {sessionFilter !== "closed" && (
                    <>
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
                            Start with customer name
                          </p>
                        </div>
                      </button>

                      <button
                        onClick={handleWalkInClick}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-700 transition-all group"
                      >
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-600 to-amber-700 flex items-center justify-center flex-shrink-0">
                          <Footprints size={16} className="text-white" />
                        </div>
                        <div className="flex-1 text-left">
                          <p className="text-sm font-medium text-white group-hover:text-amber-300">
                            Walk-In
                          </p>
                          <p className="text-xs text-slate-400">
                            Quick start — auto-named
                          </p>
                        </div>
                      </button>
                    </>
                  )}

                  {/* Filtered Sessions */}
                  {filteredSessions.map((session) => {
                    const isClosed = !session.is_active;
                    const clientExists = existingClients.some((c: any) =>
                      arePhoneNumbersEqual(
                        c.phone_number,
                        session.customer_phone,
                      ),
                    );

                    return (
                      <div
                        key={session.id}
                        onClick={() =>
                          !isClosed && handleSessionClick(session.id)
                        }
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all group ${
                          isClosed
                            ? "opacity-50 cursor-default"
                            : activeSession?.id === session.id
                              ? "bg-violet-900/30 border border-violet-700 cursor-pointer"
                              : "hover:bg-slate-700 cursor-pointer"
                        }`}
                      >
                        <div
                          className={`w-8 h-8 rounded-full bg-gradient-to-br ${isClosed ? "from-slate-600 to-slate-700" : getAvatarColor(session.id)} flex items-center justify-center flex-shrink-0`}
                        >
                          <span className="text-xs font-bold text-white">
                            {getInitials(session.customer_name)}
                          </span>
                        </div>
                        <div className="flex-1 text-left">
                          {editingSessionId === session.id ? (
                            <div className="flex flex-col gap-1">
                              <input
                                ref={editNameRef}
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-slate-900 border border-slate-600 rounded px-2 py-0.5 text-sm text-white w-full focus:outline-none focus:ring-1 focus:ring-violet-500"
                                placeholder="Name"
                              />
                              <input
                                value={editPhone}
                                onChange={(e) => setEditPhone(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-slate-900 border border-slate-600 rounded px-2 py-0.5 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-violet-500"
                                placeholder="Phone"
                              />
                            </div>
                          ) : (
                            <>
                              <p
                                className={`text-sm font-medium ${
                                  isClosed
                                    ? "text-slate-400 line-through"
                                    : activeSession?.id === session.id
                                      ? "text-violet-300"
                                      : "text-white group-hover:text-violet-300"
                                }`}
                              >
                                {session.customer_name || "Unknown Customer"}
                              </p>
                              <p className="text-xs text-slate-400">
                                {isClosed
                                  ? `Closed${session.closed_at ? ` · ${new Date(session.closed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}`
                                  : session.customer_phone || ""}
                              </p>
                            </>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {editingSessionId === session.id ? (
                            <>
                              <button
                                onClick={(e) => handleSaveEdit(e, session.id)}
                                className="p-1 text-slate-400 hover:text-green-400 hover:bg-green-900/20 rounded transition-all"
                                title="Save"
                              >
                                <Check size={16} />
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded transition-all"
                                title="Cancel"
                              >
                                <X size={16} />
                              </button>
                            </>
                          ) : (
                            <>
                              {/* Edit button (active sessions only) */}
                              {!isClosed && (
                                <button
                                  onClick={(e) => handleEditSession(e, session)}
                                  className="p-1 text-slate-400 hover:text-violet-400 hover:bg-violet-900/20 rounded transition-all"
                                  title="Edit session"
                                >
                                  <Pencil size={14} />
                                </button>
                              )}
                              {/* Save as client (active sessions with phone) */}
                              {!isClosed &&
                                !clientExists &&
                                session.customer_phone && (
                                  <button
                                    onClick={(e) =>
                                      handleSaveClient(e, session)
                                    }
                                    className="p-1 text-slate-400 hover:text-emerald-400 hover:bg-emerald-900/20 rounded transition-all"
                                    title="Save as client"
                                  >
                                    <Save size={16} />
                                  </button>
                                )}
                              {/* Close button (active sessions only) */}
                              {!isClosed && (
                                <button
                                  onClick={(e) =>
                                    handleCloseSession(e, session.id)
                                  }
                                  className="p-1 text-slate-400 hover:text-orange-400 hover:bg-orange-900/20 rounded transition-all"
                                  title="Close session (end visit)"
                                >
                                  <X size={16} />
                                </button>
                              )}
                              {/* Delete button (all sessions) */}
                              <button
                                onClick={(e) =>
                                  handleDeleteSession(
                                    e,
                                    session.id,
                                    session.customer_name,
                                  )
                                }
                                className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded transition-all"
                                title="Delete permanently"
                              >
                                <Trash2 size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {filteredSessions.length === 0 && (
                    <div className="text-center text-slate-400 text-xs">
                      No{" "}
                      {sessionFilter === "active"
                        ? "active"
                        : sessionFilter === "closed"
                          ? "closed"
                          : ""}{" "}
                      sessions today
                    </div>
                  )}
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
