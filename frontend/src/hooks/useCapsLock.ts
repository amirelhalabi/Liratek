import { useState, useCallback } from "react";

/**
 * Detects Caps Lock state on keyboard events.
 * Returns `capsLock` boolean and a `capsLockProps` object
 * to spread onto the target `<input>`.
 */
export function useCapsLock() {
  const [capsLock, setCapsLock] = useState(false);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (typeof e.getModifierState === "function") {
      setCapsLock(e.getModifierState("CapsLock"));
    }
  }, []);

  const capsLockProps = {
    onKeyUp: handleKey,
    onKeyDown: handleKey,
  };

  return { capsLock, capsLockProps } as const;
}
