import {
  OMT_COVERED_TYPE_VALUES,
  normaliseCoveredTypes,
  type OmtCoveredType,
} from "@liratek/core";

/**
 * LIRA-256 — remembers, on THIS device only, which OMT commission types the
 * operator last said a statement covers, per account. Shared by the
 * statement check panel and both settle screens so they start from the
 * same choice. A convenience only (CLAUDE.md browser-storage rule): every
 * read/write is wrapped in try/catch, and anything unreadable means
 * "All types" (`undefined`) — the exact pre-feature behaviour.
 */
export function coveredTypesStorageKey(accountSupplierId: number): string {
  return `liratek:omt-covered-types:${accountSupplierId}`;
}

export function loadCoveredTypes(
  accountSupplierId: number,
): OmtCoveredType[] | undefined {
  try {
    const raw = window.localStorage.getItem(
      coveredTypesStorageKey(accountSupplierId),
    );
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
    const allowed = new Set<string>(OMT_COVERED_TYPE_VALUES);
    if (!parsed.every((v) => typeof v === "string" && allowed.has(v))) {
      return undefined;
    }
    return normaliseCoveredTypes(parsed as OmtCoveredType[]);
  } catch {
    return undefined;
  }
}

export function saveCoveredTypes(
  accountSupplierId: number,
  value: OmtCoveredType[] | undefined,
): void {
  try {
    const key = coveredTypesStorageKey(accountSupplierId);
    if (value === undefined || value.length === 0) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(
        key,
        JSON.stringify(normaliseCoveredTypes(value)),
      );
    }
  } catch {
    // Best-effort only — blocked storage must never break the screen.
  }
}
