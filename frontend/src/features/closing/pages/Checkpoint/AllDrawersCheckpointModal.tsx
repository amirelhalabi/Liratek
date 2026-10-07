/**
 * "Checkpoint — all drawers" window, opened once after a fresh sign-in
 * (owner decision 2026-10-07; see useAutoCheckpointAfterSignIn).
 *
 * Every visible drawer is its own card with its own count fields and its OWN
 * Save, which saves ONLY that drawer through the exact save the single-drawer
 * window uses (`useDrawerCheckpoint` — one `createCheckpoint` call site).
 * There is no "save all": each drawer is a separate checkpoint, as before.
 * A saved drawer stays in the list, marked counted; the window stays open
 * until the owner closes it. Drawers already counted today start collapsed
 * with a Re-count option.
 *
 * Kept out of `pages/Checkpoint/index.tsx` on purpose: that module's default
 * export is the single-drawer window, which the dashboard clipboard icon
 * still opens unchanged.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import {
  useDrawerCheckpoint,
  SAVE_STYLES,
} from "../../hooks/useDrawerCheckpoint";
import { CheckpointDrawerBody } from "../../components/CheckpointDrawerBody";
import { DRAWER_CONFIGS } from "../../config/drawers";
import type { DrawerType } from "../../types";

export interface AllDrawersCheckpointEntry {
  name: string;
  countedToday: boolean;
}

interface AllDrawersCheckpointModalProps {
  isOpen: boolean;
  /** Visible drawers in dashboard order, General first. */
  drawers: AllDrawersCheckpointEntry[];
  onClose: () => void;
}

interface SectionState {
  dirty: boolean;
  saving: boolean;
}

const drawerLabel = (name: string): string =>
  DRAWER_CONFIGS[name as DrawerType]?.label ?? name;

export default function AllDrawersCheckpointModal({
  isOpen,
  drawers,
  onClose,
}: AllDrawersCheckpointModalProps) {
  useModalFocusFix(isOpen);

  // Drawers counted today: the ones the window opened with, plus every one
  // saved since. A saved drawer stays listed — it just shows as counted.
  const [counted, setCounted] = useState<Set<string>>(
    () => new Set(drawers.filter((d) => d.countedToday).map((d) => d.name)),
  );
  // Counted drawers the owner chose to count again (form open).
  const [recounting, setRecounting] = useState<Set<string>>(() => new Set());
  // Per-drawer unsaved/saving state, for the close button.
  const sections = useRef<Record<string, SectionState>>({});
  const [anySaving, setAnySaving] = useState(false);

  const reportState = useCallback((name: string, state: SectionState) => {
    sections.current[name] = state;
    setAnySaving(Object.values(sections.current).some((s) => s.saving));
  }, []);

  const handleSaved = useCallback((name: string) => {
    delete sections.current[name];
    setAnySaving(Object.values(sections.current).some((s) => s.saving));
    setCounted((prev) => new Set(prev).add(name));
    setRecounting((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const handleRecount = (name: string) =>
    setRecounting((prev) => new Set(prev).add(name));

  const handleClose = () => {
    if (anySaving) return;
    const dirty = Object.values(sections.current).some((s) => s.dirty);
    if (
      !dirty ||
      confirm("You have unsaved changes. Are you sure you want to close?")
    ) {
      onClose();
    }
  };

  if (!isOpen) return null;

  const countedCount = drawers.filter((d) => counted.has(d.name)).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="all-drawers-checkpoint-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header — one heading, one button (the e2e fixtures close it). */}
        <div className="flex justify-between items-center p-6 border-b border-slate-700 bg-slate-800">
          <div>
            <h2
              id="all-drawers-checkpoint-title"
              className="text-xl font-bold text-white"
            >
              Checkpoint — all drawers
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Count each drawer and save it on its own. Adjust any amount that
              differs from the expected balance.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={handleClose}
            disabled={anySaving}
            className="text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={24} />
          </button>
        </div>

        {/* One card per drawer */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {drawers.map(({ name }) =>
            counted.has(name) && !recounting.has(name) ? (
              <CountedDrawerRow
                key={name}
                name={name}
                onRecount={() => handleRecount(name)}
              />
            ) : (
              <DrawerCheckpointPanel
                key={name}
                name={name}
                recount={counted.has(name)}
                onSaved={handleSaved}
                onStateChange={reportState}
              />
            ),
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-700 px-6 py-4 bg-slate-800 flex justify-between items-center gap-3">
          <p
            className="text-sm text-slate-400"
            data-testid="checkpoint-progress"
          >
            {countedCount} of {drawers.length} drawers counted today
          </p>
          <button
            type="button"
            onClick={handleClose}
            disabled={anySaving}
            className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors disabled:opacity-50"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** A drawer already counted today: one compact line, with Re-count. */
function CountedDrawerRow({
  name,
  onRecount,
}: {
  name: string;
  onRecount: () => void;
}) {
  return (
    <div
      data-testid={`checkpoint-drawer-${name}`}
      className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3"
    >
      <p className="font-semibold text-white">{drawerLabel(name)}</p>
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-400">
          <CheckCircle2 size={16} aria-hidden="true" />
          Counted today
        </span>
        <button
          type="button"
          onClick={onRecount}
          className="px-3 py-1.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-600 transition-colors"
        >
          Re-count
        </button>
      </div>
    </div>
  );
}

/** One drawer's count sheet with its own Save — the shared checkpoint path. */
function DrawerCheckpointPanel({
  name,
  recount,
  onSaved,
  onStateChange,
}: {
  name: string;
  /** Counted earlier today and opened again for a second count. */
  recount: boolean;
  onSaved: (name: string) => void;
  onStateChange: (name: string, state: SectionState) => void;
}) {
  const cp = useDrawerCheckpoint({
    isOpen: true,
    drawerName: name,
    onSaved: () => onSaved(name),
  });

  // Until the fields hold the expected balances they read as "different",
  // which is not unsaved work.
  const dirty = cp.amountsReady && cp.hasUnsavedChanges;
  const { saving } = cp;
  useEffect(() => {
    onStateChange(name, { dirty, saving });
  }, [name, dirty, saving, onStateChange]);

  return (
    <section
      data-testid={`checkpoint-drawer-${name}`}
      aria-label={drawerLabel(name)}
      className="rounded-xl border border-slate-700 bg-slate-800 p-4 space-y-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-white">{drawerLabel(name)}</p>
        <span className="text-xs font-medium text-amber-400">
          {recount ? "Counting again" : "Not counted yet"}
        </span>
      </div>
      <CheckpointDrawerBody cp={cp} notesId={`checkpoint-notes-${name}`} />
      <div className="flex justify-end">
        <button
          type="button"
          data-testid={`checkpoint-save-${name}`}
          onClick={cp.handleSave}
          disabled={cp.saveDisabled}
          className={`px-6 py-2 ${SAVE_STYLES[cp.overallStatus]} text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed max-w-full truncate`}
        >
          {cp.saveLabel}
        </button>
      </div>
    </section>
  );
}
