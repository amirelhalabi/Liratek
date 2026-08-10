/**
 * Partner-ledger FOR_%/THROUGH_% type drift guard (CQ-1).
 *
 * `PartnerRepository.CreateLedgerEntryData["transaction_type"]` is the single
 * source of truth for the "FOR partner" vs "THROUGH partner" money-flow
 * classification (CLAUDE.md rule 14 — a business-rule predicate defined once,
 * reused everywhere). `PartnerRepository` itself consumes exactly that
 * `FOR_%`/`THROUGH_%` prefix convention in several places — the
 * `getBalanceBreakdown()` USD/LBP/USDT split, `applySettlementCoverage()`'s
 * FIFO coverage predicate (`transaction_type LIKE 'FOR\_%'`), and
 * `getLedgerEntries()`'s `mode` filter — so a caller that writes a NEW
 * `"FOR_..."`/`"THROUGH_..."` string literal without adding it to this union
 * would compile (TS only rejects literals that are actually assigned to the
 * typed `transaction_type` field) but any duplicate/typo'd/out-of-band
 * literal (e.g. written straight into a SQL string, a report, or a second
 * copy of the union) silently drifts from every one of those predicates.
 *
 * Mechanism: every `"FOR_..."`/`"THROUGH_..."` double-quoted string literal
 * anywhere in core source must be a member of the
 * `CreateLedgerEntryData.transaction_type` union (parsed directly from
 * `PartnerRepository.ts` source text — it is a TypeScript type, not a runtime
 * value, so it can't be imported). Conversely every `FOR_%`/`THROUGH_%`
 * union member must be used somewhere in source, or be named in
 * `UNUSED_ALLOWLIST` below with a reason — catching dead/renamed members.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.join(__dirname, "..", "..");
const PARTNER_REPOSITORY_PATH = path.join(
  SRC_ROOT,
  "repositories",
  "PartnerRepository.ts",
);

/**
 * FOR_%/THROUGH_% union members deliberately NOT referenced anywhere else in
 * core source, each with its reason named. Empty as of writing — every
 * member currently has at least one real call site outside the union
 * declaration (verified by grep before landing this test). If you add a new
 * union member that isn't wired up yet, list it here; don't leave it
 * unclassified.
 *
 * LIRA-126 note: THROUGH_BINANCE_SEND/RECEIVE and THROUGH_IPICK_SEND/
 * THROUGH_KATSH_SEND are template-composed at runtime by
 * FinancialServiceRepository.ts's THROUGH_PROVIDER_LEDGER_KEY map (never a
 * literal double-quoted string in that call site) — they do NOT need an
 * entry here because PartnerRepository.ts's own doc comment above the union
 * names all four by literal string (documenting what each one is for),
 * which this scanner's plain text match picks up as a real "used somewhere"
 * occurrence. If that comment is ever reworded away from the literal
 * strings, these four will need an UNUSED_ALLOWLIST entry instead.
 */
const UNUSED_ALLOWLIST: Record<string, string> = {};

const FOR_THROUGH_LITERAL = /"((?:FOR|THROUGH)_[A-Z_]+)"/g;

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") {
        continue;
      }
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Parse the `CreateLedgerEntryData.transaction_type` union literals directly
 * from `PartnerRepository.ts` source text (it's a TypeScript type — there is
 * no runtime value to import). The union is a block of `| "LITERAL"` lines
 * immediately following the `transaction_type?:` field declaration, ending
 * at the field's closing `;`.
 */
function parseTransactionTypeUnion(): string[] {
  const source = fs.readFileSync(PARTNER_REPOSITORY_PATH, "utf8");
  const match = source.match(/transaction_type\?:\s*((?:\s*\|\s*"[^"]+")+)/);
  if (!match) {
    throw new Error(
      "Could not locate CreateLedgerEntryData.transaction_type union in " +
        "PartnerRepository.ts — has the interface been restructured? Update " +
        "this test's parser (partnerLedgerTypes.guard.test.ts).",
    );
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

describe("PartnerRepository FOR_/THROUGH_ transaction_type — drift guard (CQ-1)", () => {
  const union = parseTransactionTypeUnion();
  const unionForThrough = union.filter((t) => /^(FOR|THROUGH)_/.test(t));

  const found = new Map<string, string[]>(); // literal → files it appears in
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(FOR_THROUGH_LITERAL)) {
      const literal = match[1];
      const rel = path.relative(SRC_ROOT, file);
      const files = found.get(literal) ?? [];
      if (!files.includes(rel)) files.push(rel);
      found.set(literal, files);
    }
  }

  it("every FOR_/THROUGH_ literal in core source is a member of CreateLedgerEntryData.transaction_type", () => {
    const unknown = [...found.entries()].filter(
      ([literal]) => !union.includes(literal),
    );
    if (unknown.length > 0) {
      const message = unknown
        .map(
          ([literal, files]) =>
            `'${literal}' (${files.join(", ")}) — not present in ` +
            `CreateLedgerEntryData.transaction_type ` +
            `(repositories/PartnerRepository.ts). If this is a genuine new ` +
            `partner-ledger FOR_%/THROUGH_% type, add it to the union; ` +
            `otherwise it's a typo/drift and must be fixed at the call site.`,
        )
        .join("\n");
      throw new Error(
        `Unclassified FOR_/THROUGH_ partner-ledger literal(s):\n${message}`,
      );
    }
  });

  it("every FOR_/THROUGH_ union member is used somewhere in core source (or named in UNUSED_ALLOWLIST)", () => {
    const dead = unionForThrough.filter(
      (t) => !found.has(t) && !(t in UNUSED_ALLOWLIST),
    );
    if (dead.length > 0) {
      throw new Error(
        `FOR_/THROUGH_ union member(s) with no usage found anywhere in core ` +
          `source: ${dead.join(", ")}. If deliberately reserved/deprecated, ` +
          `add it to UNUSED_ALLOWLIST here with a reason; otherwise remove it ` +
          `from CreateLedgerEntryData.transaction_type ` +
          `(repositories/PartnerRepository.ts).`,
      );
    }
  });

  it("UNUSED_ALLOWLIST carries no stale entries (every entry is an unused FOR_/THROUGH_ union member)", () => {
    const stale = Object.keys(UNUSED_ALLOWLIST).filter(
      (t) => !unionForThrough.includes(t) || found.has(t),
    );
    expect(stale).toEqual([]);
  });
});
