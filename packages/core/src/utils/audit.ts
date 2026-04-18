/**
 * Compute a diff between two objects for audit logging.
 * Returns null if no changes detected.
 */
export function diffObjects(
  oldObj: Record<string, unknown>,
  newObj: Record<string, unknown>,
  keys: string[],
): {
  oldValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
} | null {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  let hasChanges = false;

  for (const key of keys) {
    const oldVal = oldObj[key];
    const newVal = newObj[key];
    if (oldVal !== newVal) {
      oldValues[key] = oldVal;
      newValues[key] = newVal;
      hasChanges = true;
    }
  }

  return hasChanges ? { oldValues, newValues } : null;
}
