import { useState, useEffect } from "react";
import { useSession } from "../context/SessionContext";

export function SessionFloatingWindow() {
  const {
    activeSession,
    sessionTransactions,
    isFloatingWindowOpen,
    isFloatingWindowMinimized,
    closeFloatingWindow: _closeFloatingWindow,
    minimizeFloatingWindow,
    expandFloatingWindow,
    closeCurrentSession,
  } = useSession();

  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Separate state for minimized badge position
  const [badgePosition, setBadgePosition] = useState({ x: 0, y: 0 });
  const [isBadgeDragging, setIsBadgeDragging] = useState(false);
  const [badgeDragStart, setBadgeDragStart] = useState({ x: 0, y: 0 });

  // Calculate default position based on screen and active sessions
  const calculateDefaultPosition = () => {
    const windowWidth = 400;
    const windowHeight = 500;
    const marginRight = 100; // Right margin from edge
    const marginBottom = 140; // Bottom margin (above FAB + sessions)

    return {
      x: window.innerWidth - windowWidth - marginRight,
      y: window.innerHeight - windowHeight - marginBottom,
    };
  };

  // Calculate default badge position (left of FAB)
  const calculateDefaultBadgePosition = () => {
    const fabBottom = 24; // bottom-6 = 24px
    const fabRight = 24; // right-6 = 24px
    const fabSize = 64; // Main FAB is 64x64
    const badgeSize = 64; // Badge is also 64x64

    return {
      x: window.innerWidth - fabRight - fabSize - badgeSize - 16, // 16px gap from FAB
      y: window.innerHeight - fabBottom - badgeSize,
    };
  };

  // Load saved position from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("sessionWindowPosition");
    if (saved) {
      try {
        const pos = JSON.parse(saved);
        setPosition(pos);
      } catch {
        setPosition(calculateDefaultPosition());
      }
    } else {
      setPosition(calculateDefaultPosition());
    }

    // Load badge position
    const savedBadge = localStorage.getItem("sessionBadgePosition");
    if (savedBadge) {
      try {
        const pos = JSON.parse(savedBadge);
        setBadgePosition(pos);
      } catch {
        setBadgePosition(calculateDefaultBadgePosition());
      }
    } else {
      setBadgePosition(calculateDefaultBadgePosition());
    }
  }, []);

  // Save position when changed
  useEffect(() => {
    if (position.x !== 0 || position.y !== 0) {
      localStorage.setItem("sessionWindowPosition", JSON.stringify(position));
    }
  }, [position]);

  // Save badge position when changed
  useEffect(() => {
    if (badgePosition.x !== 0 || badgePosition.y !== 0) {
      localStorage.setItem(
        "sessionBadgePosition",
        JSON.stringify(badgePosition),
      );
    }
  }, [badgePosition]);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;

    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;

    // Constrain to vertical column above FAB (same as minimized badge)
    const fabRight = 24; // FAB's right margin (right-6)
    const fabBottom = 24; // FAB's bottom margin (bottom-6)
    const fabSize = 64; // Main FAB button size

    // Calculate the FAB's X position
    const fabX = window.innerWidth - fabRight - fabSize;

    // Get current window dimensions
    const currentWidth = windowDimensions.width;
    const currentHeight = windowDimensions.height;

    // Constrain X to vertical column (window right edge aligns with FAB right edge)
    // Window should be positioned so its right edge aligns with FAB column
    const targetX = fabX + fabSize - currentWidth;

    // Allow small horizontal wiggle (±10px) for easier positioning
    const minX = targetX - 10;
    const maxX = targetX + 10;

    // Constrain Y to stay above FAB and within viewport
    const minY = 10; // Minimum distance from top
    const maxY = window.innerHeight - currentHeight - fabBottom - fabSize - 20; // Keep above FAB with 20px gap

    setPosition({
      x: Math.max(minX, Math.min(newX, maxX)),
      y: Math.max(minY, Math.min(newY, maxY)),
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging, dragStart]);

  // Track if badge was actually dragged (moved) vs just clicked
  const [badgeWasDragged, setBadgeWasDragged] = useState(false);
  const [dragStartPosition, setDragStartPosition] = useState({ x: 0, y: 0 });

  // Badge dragging handlers
  const handleBadgeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsBadgeDragging(true);
    setBadgeWasDragged(false); // Reset drag flag
    setDragStartPosition({ x: e.clientX, y: e.clientY }); // Remember start position
    setBadgeDragStart({
      x: e.clientX - badgePosition.x,
      y: e.clientY - badgePosition.y,
    });
  };

  const handleBadgeMouseMove = (e: MouseEvent) => {
    if (!isBadgeDragging) return;

    // Check if mouse has moved significantly (more than 5px) - indicates actual drag
    const dragDistance = Math.sqrt(
      Math.pow(e.clientX - dragStartPosition.x, 2) +
        Math.pow(e.clientY - dragStartPosition.y, 2),
    );

    if (dragDistance > 5) {
      setBadgeWasDragged(true); // Mark as dragged, not just clicked
    }

    const newX = e.clientX - badgeDragStart.x;
    const newY = e.clientY - badgeDragStart.y;

    // Constrain badge to vertical column above FAB button
    const badgeSize = 64;
    const fabSize = 64; // Main FAB button size
    const fabRight = 24; // FAB's right margin (right-6)
    const fabBottom = 24; // FAB's bottom margin (bottom-6)

    // Calculate the FAB's X position
    const fabX = window.innerWidth - fabRight - fabSize;

    // Constrain X to stay aligned with FAB (vertical column)
    // Allow small horizontal wiggle room (±10px) for easier alignment
    const minX = fabX - 10;
    const maxX = fabX + 10;

    // Constrain Y to stay above FAB and below top of screen
    const minY = 10; // Minimum distance from top
    const maxY = window.innerHeight - badgeSize - fabBottom - fabSize - 20; // Keep above FAB with 20px gap

    setBadgePosition({
      x: Math.max(minX, Math.min(newX, maxX)),
      y: Math.max(minY, Math.min(newY, maxY)),
    });
  };

  const handleBadgeMouseUp = () => {
    setIsBadgeDragging(false);
  };

  const handleBadgeClick = (_e: React.MouseEvent) => {
    // Only expand if badge wasn't dragged - this was a real click
    if (!badgeWasDragged) {
      expandFloatingWindow();
    }
  };

  useEffect(() => {
    if (isBadgeDragging) {
      window.addEventListener("mousemove", handleBadgeMouseMove);
      window.addEventListener("mouseup", handleBadgeMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleBadgeMouseMove);
        window.removeEventListener("mouseup", handleBadgeMouseUp);
      };
    }
  }, [isBadgeDragging, badgeDragStart, badgePosition, dragStartPosition]);

  if (!isFloatingWindowOpen || !activeSession) return null;

  // Minimized state - draggable badge
  if (isFloatingWindowMinimized) {
    const initials = getInitials(activeSession.customer_name || "Customer");

    return (
      <div
        onMouseDown={handleBadgeMouseDown}
        onClick={handleBadgeClick}
        className="fixed w-16 h-16 bg-gradient-to-br from-violet-600 to-violet-700 rounded-full flex items-center justify-center text-white font-bold cursor-move shadow-2xl hover:scale-110 z-50 border-2 border-slate-700"
        style={{
          left: `${badgePosition.x}px`,
          top: `${badgePosition.y}px`,
          transition: isBadgeDragging ? "none" : "transform 0.2s ease-out",
        }}
        title={`Session: ${activeSession.customer_name || "Customer"} (Drag to move)`}
      >
        <span className="text-lg">{initials}</span>
      </div>
    );
  }

  // Calculate adaptive dimensions based on transaction count
  const calculateWindowDimensions = () => {
    const transactionCount = sessionTransactions.length;
    const headerHeight = 50; // Title bar height
    const emptyStateHeight = 80; // Compact empty message
    const transactionItemHeight = 80; // Approximate height per transaction
    const maxHeight = 500; // Maximum window height

    // Width calculation
    const minWidth = 280; // Minimum width for header info in one line
    const fullWidth = 400; // Full width when showing transactions

    if (transactionCount === 0) {
      return {
        width: minWidth,
        height: headerHeight + emptyStateHeight, // ~130px
      };
    } else if (transactionCount <= 3) {
      // Grow height for 1-3 transactions (no scroll needed)
      return {
        width: fullWidth,
        height: Math.min(
          headerHeight + 50 + transactionCount * transactionItemHeight,
          maxHeight,
        ),
      };
    } else {
      // Max height reached, enable scrolling
      return {
        width: fullWidth,
        height: maxHeight,
      };
    }
  };

  const windowDimensions = calculateWindowDimensions();

  // Expanded window
  return (
    <div
      className="fixed bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col z-50"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${windowDimensions.width}px`,
        height: `${windowDimensions.height}px`,
        // Only transition width/height, not position during drag
        transition: isDragging ? "width 0.3s, height 0.3s" : "all 0.3s",
      }}
    >
      {/* Title Bar (Draggable) - Compact one-line layout */}
      <div
        className="bg-gradient-to-r from-violet-600 to-violet-700 text-white px-3 py-2 rounded-t-2xl flex items-center justify-between cursor-move select-none gap-2"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <svg
            className="w-4 h-4 flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <div className="truncate text-sm">
            <span className="font-semibold">
              {activeSession.customer_name || "Customer"}
            </span>
            {activeSession.customer_phone && (
              <span className="ml-2 opacity-90">
                {activeSession.customer_phone}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              minimizeFloatingWindow();
            }}
            className="hover:bg-violet-800 px-1.5 py-1 rounded transition-colors"
            title="Minimize"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 12H4"
              />
            </svg>
          </button>
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (
                window.confirm(
                  `Close session for ${activeSession.customer_name || "this customer"}?`,
                )
              ) {
                try {
                  await closeCurrentSession();
                } catch (err) {
                  console.error("Failed to close session:", err);
                  alert("Failed to close session");
                }
              }
            }}
            className="hover:bg-violet-800 px-1.5 py-1 rounded transition-colors"
            title="Close Session"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Transaction List */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {sessionTransactions.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400">
            <p className="text-xs">No transactions yet</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {sessionTransactions.map((tx) => (
              <li
                key={tx.id}
                className="border border-slate-700 rounded-lg p-3 bg-slate-800/30 hover:bg-slate-800 transition-colors"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="font-medium text-sm flex items-center gap-1 text-slate-200">
                    {getTransactionIcon(tx.transaction_type)}
                    {formatTransactionType(tx.transaction_type)}
                  </span>
                  <span className="text-xs text-slate-400">
                    {formatTime(tx.created_at)}
                  </span>
                </div>
                <div className="text-sm font-semibold">
                  {tx.amount_usd > 0 && (
                    <span className="text-green-400">
                      ${tx.amount_usd.toFixed(2)}
                    </span>
                  )}
                  {tx.amount_usd > 0 && tx.amount_lbp > 0 && (
                    <span className="mx-1 text-slate-500">+</span>
                  )}
                  {tx.amount_lbp > 0 && (
                    <span className="text-blue-400">
                      {tx.amount_lbp.toLocaleString()} LBP
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer - Total */}
      {sessionTransactions.length > 0 && (
        <div className="px-4 py-3 bg-slate-800/50 border-t border-slate-700 rounded-b-2xl">
          <div className="flex justify-between items-center text-sm">
            <span className="font-medium text-slate-300">
              Total ({sessionTransactions.length} transactions)
            </span>
            <div className="font-bold">
              {getTotals(sessionTransactions).usd > 0 && (
                <span className="text-green-400">
                  ${getTotals(sessionTransactions).usd.toFixed(2)}
                </span>
              )}
              {getTotals(sessionTransactions).usd > 0 &&
                getTotals(sessionTransactions).lbp > 0 && (
                  <span className="mx-1 text-slate-500">+</span>
                )}
              {getTotals(sessionTransactions).lbp > 0 && (
                <span className="text-blue-400">
                  {getTotals(sessionTransactions).lbp.toLocaleString()} LBP
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper functions
function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatTransactionType(type: string): string {
  const map: Record<string, string> = {
    sale: "Sale",
    recharge: "Recharge",
    exchange: "Exchange",
    omt: "OMT",
    whish: "Whish",
    maintenance: "Maintenance",
    expense: "Expense",
  };
  return map[type] || type.charAt(0).toUpperCase() + type.slice(1);
}

function getTransactionIcon(type: string) {
  const iconMap: Record<string, string> = {
    sale: "🛒",
    recharge: "📱",
    exchange: "💱",
    omt: "💸",
    whish: "💳",
    maintenance: "🔧",
    expense: "💰",
  };
  return <span>{iconMap[type] || "📄"}</span>;
}

function formatTime(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const mins = Math.floor(diff / 60000);

    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m ago`;

    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;

    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function getTotals(transactions: any[]): { usd: number; lbp: number } {
  return transactions.reduce(
    (acc, tx) => ({
      usd: acc.usd + (tx.amount_usd || 0),
      lbp: acc.lbp + (tx.amount_lbp || 0),
    }),
    { usd: 0, lbp: 0 },
  );
}
