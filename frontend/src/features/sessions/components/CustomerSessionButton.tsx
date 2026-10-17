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
  ChevronDown,
} from "lucide-react";
import { StartSessionModal } from "./StartSessionModal";
import { SessionPopupPanel } from "./SessionFloatingWindow";
import { SessionCheckoutModal } from "./SessionCheckoutModal";
import { useSession } from "../context/SessionContext";
import { useApi, appEvents } from "@liratek/ui";
import { arePhoneNumbersEqual } from "@/utils/phoneNumber";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import logger from "@/utils/logger";
import { useTranslation } from "react-i18next";
import { useFormat } from "@/i18n/useFormat";
import { Ltr } from "@liratek/ui/components/ui/Ltr";

type SessionFilter = "all" | "active" | "closed";

/**
 * Embedded Customer Session Button - Compact design for topbar
 * Shows "Customer Session - ClientName" when active.
 * Click (with an active session): toggles the cart/transaction panel.
 * The small switcher button next to it (or the main button when no session
 * is active) opens the session switcher dropdown.
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
  const { t } = useTranslation("sessions");
  const { t: tc } = useTranslation("common");
  const { formatTime } = useFormat();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showNewSessionModal, setShowNewSessionModal] = useState(false);
  // Owned here, not in SessionPopupPanel: checkout closes the session, which
  // unmounts the panel (and the hover popup) before the modal can show its
  // "Checkout Complete" / Print view. This button stays mounted.
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [existingClients, setExistingClients] = useState<any[]>([]);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [editingSessionId, setEditingSessionId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("active");
  const editNameRef = useRef<HTMLInputElement>(null);

  // Session panel (owner decision 2026-10-16): it hangs under this top-bar
  // button and covers the page below while open (shop-day: the Mobile
  // Recharge provider tabs), so it opens only on a CLICK — never on hover —
  // and closes on a click outside, on Escape, or on clicking the button
  // again.
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isPanelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsPanelOpen(false);
    };
    // The button and the panel both live inside the wrapper, so a press on
    // either is not "outside" (the button's own click does the toggling).
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) {
        return;
      }
      setIsPanelOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isPanelOpen]);

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
    // With an active session the button toggles its panel; without one
    // there is no panel, so it opens the switcher (New Session + Walk-In).
    if (hasActiveSession) {
      setShowDropdown(false);
      setIsPanelOpen((open) => !open);
      return;
    }
    setShowDropdown(!showDropdown);
  };

  const handleSwitcherClick = () => {
    setIsPanelOpen(false);
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
          t("button.loadClientsFailed"),
          "error",
        );
      } finally {
        setIsLoadingClients(false);
      }
    };
    loadExistingClients();
  }, [api, t]);

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
        t("button.confirmDelete", {
          name: sessionName || t("thisCustomer"),
        }),
      )
    ) {
      return;
    }
    try {
      await deleteSession(sessionId);
    } catch (err) {
      logger.error("Failed to delete session:", err);
      appEvents.emit("notification:show", t("button.deleteFailed"), "error");
    }
  };

  const handleSaveClient = async (e: React.MouseEvent, session: any) => {
    e.stopPropagation();

    if (!session.customer_phone) {
      appEvents.emit("notification:show", t("button.noPhone"), "warning");
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
          t("button.clientExists", { name: existingClient.full_name }),
          "warning",
        );
        return;
      }

      // Create client directly via API — dual-mode (IPC on desktop, REST in
      // the browser) so this works from a web session too (rule 19).
      const result = await api.createClient({
        full_name: session.customer_name || "Unknown", // i18n-exempt: stored text sent to server
        phone_number: session.customer_phone,
        notes: `Added from customer session`, // i18n-exempt: stored text sent to server
        whatsapp_opt_in: 1,
      });

      if (result.success) {
        // Reload clients to update the list
        const clients = await api.getClients();
        setExistingClients(clients);

        appEvents.emit("notification:show", t("button.clientSaved"), "success");
      } else {
        appEvents.emit(
          "notification:show",
          result.error || t("button.saveClientFailed"),
          "error",
        );
      }
    } catch (err) {
      logger.error("Failed to save client:", err);
      appEvents.emit("notification:show", t("button.saveClientRetry"), "error");
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
      const todayResult = await api.session.getTodaySessions();
      const todayNames: string[] =
        todayResult.success && todayResult.sessions
          ? todayResult.sessions
              .map((s: { customer_name?: string }) => s.customer_name ?? "")
              .filter(Boolean)
          : [];

      let counter = 1;
      // i18n-exempt: stored walk-in customer name (data value), matched against today's sessions
      while (todayNames.includes(`Client${counter}`)) {
        counter++;
      }

      await startSession({ customer_name: `Client${counter}` }); // i18n-exempt: stored walk-in customer name (data value)
    } catch (err: any) {
      logger.error("Failed to start walk-in session:", err);
      appEvents.emit(
        "notification:show",
        err?.message || t("button.walkInFailed"),
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
      appEvents.emit("notification:show", t("button.updateFailed"), "error");
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

      {/* Session Button with Dropdown + click-to-open panel */}
      <div ref={wrapperRef} className="relative flex items-center gap-1">
        <button
          onClick={handleMainButtonClick}
          {...(hasActiveSession
            ? {
                "aria-expanded": isPanelOpen,
                "aria-haspopup": "dialog" as const,
              }
            : {})}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all ${
            hasActiveSession
              ? "bg-gradient-to-r from-violet-600 to-violet-700 text-white shadow-lg"
              : "bg-slate-700 text-slate-300 hover:bg-slate-600"
          }`}
          title={
            activeCount === 0
              ? t("button.startTitle")
              : hasActiveSession
                ? t("button.showCartTitle")
                : t(
                    activeCount > 1
                      ? "button.activeSessionsMany"
                      : "button.activeSessionsOne",
                    { n: activeCount },
                  )
          }
        >
          {activeCount > 0 ? (
            <>
              <Users size={16} />
              <span className="text-sm font-medium">
                {isKnownClient
                  ? t("button.clientSession")
                  : t("button.customerSession")}
                {activeSession?.customer_name
                  ? ` - ${activeSession.customer_name}`
                  : ""}
              </span>
              {cartItemCount > 0 && (
                <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-full px-2 py-0.5">
                  {t("button.itemsBadge", { n: cartItemCount })}
                </span>
              )}
              {activeCount > 1 && (
                <span className="bg-white/20 text-white text-[10px] font-bold rounded-full px-2 py-0.5">
                  {t("button.sessionsBadge", { n: activeCount })}
                </span>
              )}
            </>
          ) : (
            <>
              <UserPlus size={16} />
              <span className="text-sm font-medium">
                {t("button.newCustomer")}
              </span>
            </>
          )}
        </button>

        {/* Session switcher — next to the session button while one is
            active (the button itself opens the panel). Carries the "N active
            sessions" title the e2e fixtures click to reach New Session. */}
        {hasActiveSession && (
          <button
            type="button"
            onClick={handleSwitcherClick}
            aria-label={t("button.switcherAria")}
            aria-expanded={showDropdown}
            title={t(
              activeCount > 1
                ? "button.activeSessionsMany"
                : "button.activeSessionsOne",
              { n: activeCount },
            )}
            className="flex items-center px-1.5 py-1.5 rounded-lg bg-violet-700 text-white hover:bg-violet-600 transition-all"
          >
            <ChevronDown size={16} />
          </button>
        )}

        {/* Session panel: cart/transaction content (opens on click) */}
        {isPanelOpen && hasActiveSession && !showDropdown && (
          <div
            ref={popupRef}
            data-testid="session-hover-panel"
            className="absolute top-full start-0 mt-2 z-50 animate-in fade-in zoom-in-95 duration-200"
          >
            <SessionPopupPanel onCheckout={() => setIsCheckoutOpen(true)} />
          </div>
        )}

        {/* Click Dropdown: Session switcher */}
        {showDropdown && (
          <div className="absolute top-full start-0 mt-2 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-700">
              <p className="text-sm font-semibold text-white">
                {t("page.title")}
              </p>
              <p className="text-xs text-slate-400">
                {activeCount > 0
                  ? t("button.activeCount", { n: activeCount })
                  : t("button.noActive")}
                {allTodaySessions.length > activeCount &&
                  ` · ${t("button.closedCount", {
                    n: allTodaySessions.length - activeCount,
                  })}`}
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
                    ? t("button.filterActive")
                    : f === "closed"
                      ? t("button.filterClosed")
                      : t("button.filterAll")}
                </button>
              ))}
            </div>

            {/* Session List */}
            <div className="max-h-64 overflow-y-auto p-2">
              {isLoadingClients ? (
                <div className="flex items-center justify-center py-4 text-slate-400">
                  <span className="text-sm">{t("button.loadingClients")}</span>
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
                        <div className="flex-1 text-start">
                          <p className="text-sm font-medium text-white group-hover:text-violet-300">
                            {t("button.newSession")}
                          </p>
                          <p className="text-xs text-slate-400">
                            {t("button.newSessionHint")}
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
                        <div className="flex-1 text-start">
                          <p className="text-sm font-medium text-white group-hover:text-amber-300">
                            {t("button.walkIn")}
                          </p>
                          <p className="text-xs text-slate-400">
                            {t("button.walkInHint")}
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
                        <div className="flex-1 text-start">
                          {editingSessionId === session.id ? (
                            <div className="flex flex-col gap-1">
                              <input
                                ref={editNameRef}
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-slate-900 border border-slate-600 rounded px-2 py-0.5 text-sm text-white w-full focus:outline-none focus:ring-1 focus:ring-violet-500"
                                placeholder={t("field.name")}
                              />
                              <input
                                value={editPhone}
                                onChange={(e) => setEditPhone(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                className="bg-slate-900 border border-slate-600 rounded px-2 py-0.5 text-xs text-white w-full focus:outline-none focus:ring-1 focus:ring-violet-500"
                                placeholder={t("field.phone")}
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
                                {session.customer_name || t("unknownCustomer")}
                              </p>
                              <p className="text-xs text-slate-400">
                                {isClosed ? (
                                  session.closed_at ? (
                                    t("button.closedAt", {
                                      time: formatTime(
                                        parseDbDate(session.closed_at),
                                        { hour: "2-digit", minute: "2-digit" },
                                      ),
                                    })
                                  ) : (
                                    t("button.closed")
                                  )
                                ) : (
                                  <Ltr>{session.customer_phone || ""}</Ltr>
                                )}
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
                                title={tc("actions.save")}
                              >
                                <Check size={16} />
                              </button>
                              <button
                                onClick={handleCancelEdit}
                                className="p-1 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded transition-all"
                                title={tc("actions.cancel")}
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
                                  title={t("button.editSession")}
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
                                    title={t("button.saveAsClient")}
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
                                  title={t("button.closeVisit")}
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
                                title={t("button.deletePermanent")}
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
                      {sessionFilter === "active"
                        ? t("button.emptyActive")
                        : sessionFilter === "closed"
                          ? t("button.emptyClosed")
                          : t("button.emptyAll")}
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

      {/* Session checkout — outside the hover popup so its success view
          survives the session closing (see isCheckoutOpen above). */}
      <SessionCheckoutModal
        isOpen={isCheckoutOpen}
        onClose={() => setIsCheckoutOpen(false)}
      />
    </>
  );
}
