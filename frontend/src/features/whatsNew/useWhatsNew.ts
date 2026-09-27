import { useCallback, useEffect, useState } from "react";
import releaseNotesData from "./releaseNotes.generated.json";
import type { ReleaseNoteEntry } from "./types";

/** localStorage key — per owner spec, deliberately namespaced. */
const STORAGE_KEY = "liratek.whatsNew.lastSeenVersion";

const entries = releaseNotesData as ReleaseNoteEntry[];

/** Ascending numeric compare: >0 means `a` is newer than `b`. */
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Private mode / blocked storage must never crash the app — see CLAUDE.md rule 19 spirit. */
function readLastSeen(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLastSeen(version: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, version);
  } catch {
    // Ignored — a blocked/quota-exceeded write just means the modal shows
    // again next load, which is the documented "once per session" fallback.
  }
}

export interface UseWhatsNewResult {
  /** All known releases, newest first (the raw generated JSON). */
  entries: ReleaseNoteEntry[];
  /** The newest release, or null if none exist yet. */
  latest: ReleaseNoteEntry | null;
  isOpen: boolean;
  /** "Got it" — closes the modal and records `latest.version` as seen. */
  dismiss: () => void;
  /** Reopens the modal manually (e.g. clicking the sidebar version label). */
  open: () => void;
}

/**
 * Drives the in-app "What's new" modal: shows itself once, automatically,
 * the first time a user (on this device/browser) is on an app version newer
 * than the one they last acknowledged, then never again for that version.
 */
export function useWhatsNew(): UseWhatsNewResult {
  const latest = entries[0] ?? null;

  const [isOpen, setIsOpen] = useState(false);
  // Guards against re-showing within the same mount after "Got it" — the
  // component that hosts this hook is mounted once for the whole
  // authenticated session, so this is effectively "once per session" even
  // when localStorage itself is unavailable (private mode etc.).
  const [hasAutoShown, setHasAutoShown] = useState(false);

  useEffect(() => {
    if (!latest || hasAutoShown) return;

    const lastSeen = readLastSeen();
    const shouldShow =
      lastSeen == null || compareSemver(latest.version, lastSeen) > 0;

    if (shouldShow) {
      setIsOpen(true);
    }
    setHasAutoShown(true);
    // Only ever runs once per mount: `latest` is derived from a static
    // bundled JSON (never changes at runtime) and `hasAutoShown` flips to
    // true on the very first run, so re-adding it here would be inert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = useCallback(() => {
    setIsOpen(false);
    if (latest) writeLastSeen(latest.version);
  }, [latest]);

  const open = useCallback(() => {
    setIsOpen(true);
  }, []);

  return { entries, latest, isOpen, dismiss, open };
}
