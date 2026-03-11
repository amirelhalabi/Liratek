import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MODULE_TIPS, DEFAULT_TIPS } from "@/constants/voiceBot";

interface VoiceBotTipsProps {
  isOpen: boolean;
  onClose: () => void;
  onExampleClick: (example: string) => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  activeModule: string | null;
}

export function VoiceBotTips({
  isOpen,
  onClose,
  onExampleClick,
  anchorRef,
  activeModule,
}: VoiceBotTipsProps) {
  const [currentPage, setCurrentPage] = useState(0);
  const tipsRef = useRef<HTMLDivElement>(null);

  const tipsData =
    activeModule && MODULE_TIPS[activeModule]
      ? MODULE_TIPS[activeModule]
      : DEFAULT_TIPS;

  useEffect(() => {
    if (isOpen) {
      setCurrentPage(0);
    }
  }, [isOpen, activeModule]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        isOpen &&
        tipsRef.current &&
        !tipsRef.current.contains(e.target as Node) &&
        !anchorRef.current?.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose, anchorRef]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") setCurrentPage((p) => Math.max(0, p - 1));
      if (e.key === "ArrowRight")
        setCurrentPage((p) => Math.min(tipsData.length - 1, p + 1));
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, tipsData.length]);

  if (!isOpen) return null;

  const page = tipsData[currentPage];
  const totalPages = tipsData.length;

  const handleExampleClick = (example: string) => {
    onExampleClick(example);
    onClose();
  };

  return (
    <div
      ref={tipsRef}
      className="absolute top-full right-0 mt-2 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-[60] animate-scale-in"
    >
      <div className="p-3">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
          {page.title}
        </h4>

        <div className="space-y-1">
          {page.examples.map((example, index) => (
            <button
              key={index}
              onClick={() => handleExampleClick(example)}
              className="w-full text-left px-2 text-sm text-slate-700 dark:text-slate-300 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-slate-50 dark:hover:bg-slate-800 rounded transition-colors"
            >
              {example}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-center gap-2 mt-3 pt-2 border-t border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            className="p-1 rounded-lg bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30 text-violet-600 dark:text-violet-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={16} />
          </button>

          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
            {currentPage + 1} / {totalPages}
          </span>

          <button
            onClick={() =>
              setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
            }
            disabled={currentPage === totalPages - 1}
            className="p-1 rounded-lg bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30 text-violet-600 dark:text-violet-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
