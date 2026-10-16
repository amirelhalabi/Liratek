import { useEffect, useRef } from "react";

/**
 * Owner rule 2026-10-16: a customer session NEVER has partner sales.
 *
 * Every screen that offers "For Partner" hides it while a session is open
 * (`!activeSession && <ForPartnerToggle … />`) and calls this hook so a For
 * Partner that is already ON — left on when the session started, restored
 * from a draft, or stale on mount — is turned OFF, partner included, instead
 * of only being hidden. Hidden-but-on would still send a partner order.
 *
 * `turnOff` must clear BOTH the flag and the picked partner. It is read
 * through a ref (rule 25), so callers can pass an inline arrow. The effect
 * only fires while For Partner is actually on, so a setter that allocates a
 * new value can never loop.
 *
 * The session is passed in rather than read here: this module stays free of
 * the SessionContext import (most tests mock that module with `useSession`
 * only).
 */
export function useForPartnerOffInSession(
  sessionActive: boolean,
  forPartnerOn: boolean,
  turnOff: () => void,
): void {
  const turnOffRef = useRef(turnOff);
  // Kept current in an effect (not during render); it runs before the one
  // below, so that one always calls this render's `turnOff`.
  useEffect(() => {
    turnOffRef.current = turnOff;
  });
  useEffect(() => {
    if (sessionActive && forPartnerOn) turnOffRef.current();
  }, [sessionActive, forPartnerOn]);
}
