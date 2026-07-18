/**
 * Payment-legs gate guard — the S8 "class-killer" (mirrors
 * packages/core/src/constants/__tests__/moduleDebtTypes.guard.test.ts: scan
 * source at test time, fail anything unclassified, name the fix).
 *
 * The bug class (PAYMENT_LEGS_INTEGRITY_PLAN, S1): four forms used to gate
 * whether payment legs entered the submit payload on `isSplitPayment` (or an
 * equivalent split/multi-line check), silently dropping a single-line
 * payment's tender amount + currency — only the method survived, and the
 * backend then assumed tender currency == service currency (the
 * owner-reported Whish App LBP-as-USD bug). The fix (wave 6): forms forward
 * ALL legs whenever ANY payment line exists — never gate on split. This test
 * fails if that gate ever comes back, in either shape it took:
 *
 *   1. A named "structured payments" flag/payload variable whose initializer
 *      is gated by isSplitPayment (or `<paymentVar>.length > 1`):
 *        const useStructuredPayments = isSplitPayment || returnLegs.length > 0;
 *        const paymentsPayload = isSplitPayment || hasVoucherLeg ? … : undefined;
 *      → CHECK 1 (named declaration).
 *
 *   2. An inline ternary/&&-guard whose consequent directly wraps a
 *      `payments:` key or a toCamelLegs/toSnakeLegs(...) call:
 *        ...(isSplitPayment && paymentLines.length > 0 ? { payments: toCamelLegs(...) } : {})
 *      → CHECK 2 (inline wrap).
 *
 * Both checks operate on comment/string-stripped source and are scoped to
 * the LOCAL expression (bracket-depth-bounded), not a line-count window —
 * a naive line-window heuristic produces two confirmed false positives in
 * this exact codebase: (a) every one of the four wave-6 fixes carries an
 * explanatory comment that quotes "isSplitPayment" a few lines above the
 * fix itself; (b) `features/loto/pages/Loto/index.tsx` has
 * `payment_method: paymentLines.length > 1 ? "SPLIT" : …` as a sibling
 * property of `payments:` inside the SAME large ticket-payload object
 * literal — a legitimate display label, not a legs gate. Both are proven
 * clean by the "0 violations on the current tree" assertion below.
 *
 * Rule 17 (prove regression tests against the buggy code): each of the two
 * checks was confirmed to fire by temporarily reintroducing the exact
 * historical shape it targets (OmtWhishAppTransferForm's
 * `useStructuredPayments`/CHECK 1; Services' inline
 * `isSplitPayment && … ? { payments: toCamelLegs(...) } : {}`/CHECK 2) and
 * watching this test fail, then reverting — see the wave-8 report for the
 * transcript; that reintroduction is not committed here (it would defeat
 * the guard's own purpose).
 */
import * as fs from "node:fs";
import * as path from "node:path";

const SRC_ROOT = path.join(__dirname, "..", "..");

/** Known false positives — heuristic scans occasionally flag legitimate
 *  code. Add an entry ONLY after confirming BY HAND that the flagged
 *  expression does not actually gate `payments`/legs inclusion, and name
 *  why. Keyed by path relative to frontend/src. */
const ALLOWLIST: Record<string, string> = {};

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name === "node_modules") {
        continue;
      }
      out.push(...collectSourceFiles(full));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Blank out comments and string/template literals (same length, newlines
 *  preserved) so neither explanatory prose ("gating on isSplitPayment used
 *  to...") nor string contents can trigger a match — only real code can. */
function stripCommentsAndStrings(src: string): string {
  const RE =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
  return src.replace(RE, (m) => m.replace(/[^\n]/g, " "));
}

/** Forward-scan from `start`, tracking bracket depth, stopping at a
 *  depth-0 occurrence of a `stopChars` character or an unmatched closing
 *  bracket (which means we've exited the enclosing expression). This binds
 *  extraction to "this one expression/statement" instead of a line count —
 *  the reason the Loto false positive (a SIBLING object property several
 *  properties away, same enclosing object literal) doesn't trip CHECK 1. */
function extractForward(text: string, start: number, stopChars: string): string {
  let depth = 0;
  let i = start;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
    } else if (ch === ")" || ch === "}" || ch === "]") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && stopChars.includes(ch)) {
      break;
    }
  }
  return text.slice(start, i);
}

// Signal: the exact bare `isSplitPayment` identifier, or a `.length > 1`
// check on any identifier containing "payment" (case-insensitive) — the
// generic reintroduction shape the plan calls out as the alternative to a
// named isSplitPayment var.
const SIGNAL_RE =
  /\bisSplitPayment\b|\b[A-Za-z_$][\w$]*[Pp]ayment[\w$]*\.length\s*>\s*1\b/;

// A declaration whose NAME says "this holds the legs/payments payload" —
// deliberately narrower than "contains the word payment": "paymentMethod",
// "paidByMethod", "paymentLines", "paymentInputKey" must NOT match (they are
// legitimate non-gating identifiers used throughout every payment form for
// display/method labeling), so this requires the PLURAL "payments", or
// "payload"/"legs"/"structured".
const GATE_NAME_RE = /payments|payload|legs|structured/i;

// Inline wrap: signal → (short gap, no statement/brace/property crossing) →
// `?`/`&&` → an object literal whose FIRST property is `payments:` (no
// nested braces before it), or a direct toCamelLegs(/toSnakeLegs( call. Both
// gaps exclude `,` — not just `;{}` — so the scan cannot cross a sibling
// object-property boundary into a LATER, unrelated ternary: an early probe
// against this exact codebase matched `paidByMethod: isSplitPayment ?
// "MULTI" : paymentMethod,` (a legitimate display-label ternary, unrelated to
// legs) by skipping the comma and latching onto a DIFFERENT, later sibling
// property's `payments: useCryptoStructuredPayments ? toCamelLegs(...)`
// (itself legitimate — the flag name isn't isSplitPayment). Excluding `,`
// forces "same ternary" instead of "same enclosing object". This is
// deliberately narrow (unlike a bare "isSplitPayment near payments:" line
// window) because Services' original bug wraps payments: from OUTSIDE the
// object via exactly this shape, while `payment_method: paymentLines.length
// > 1 ? "SPLIT" : …` (Loto, legitimate) never reaches a
// `{`/toCamelLegs(/toSnakeLegs( after its `?`.
const WRAP_RE =
  /(?:\bisSplitPayment\b|\b[A-Za-z_$][\w$]*[Pp]ayment[\w$]*\.length\s*>\s*1\b)[^;{},]{0,150}?(?:\?|&&)\s*(?:\{[^{},]{0,200}?\bpayments\s*:|toCamelLegs\s*\(|toSnakeLegs\s*\()/g;

interface Violation {
  file: string;
  kind: "declaration" | "inline-wrap";
  detail: string;
}

function scan(): Violation[] {
  const violations: Violation[] = [];
  for (const absFile of collectSourceFiles(SRC_ROOT)) {
    const relFile = path.relative(SRC_ROOT, absFile);
    if (relFile in ALLOWLIST) continue;
    const raw = fs.readFileSync(absFile, "utf8");
    const cleaned = stripCommentsAndStrings(raw);

    // CHECK 1 — named "payments payload" declaration gated by the signal.
    const declRe = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?!=)/g;
    for (const m of cleaned.matchAll(declRe)) {
      const name = m[1];
      if (name === "isSplitPayment") continue; // the source-of-truth var itself
      if (!GATE_NAME_RE.test(name)) continue;
      const start = (m.index ?? 0) + m[0].length;
      const initializer = extractForward(cleaned, start, ";");
      if (SIGNAL_RE.test(initializer)) {
        violations.push({
          file: relFile,
          kind: "declaration",
          detail: `const/let ${name} = ${initializer.trim().slice(0, 160)}`,
        });
      }
    }

    // CHECK 2 — inline ternary/&&-guard wrapping `payments:`/toCamelLegs/toSnakeLegs.
    for (const m of cleaned.matchAll(WRAP_RE)) {
      violations.push({
        file: relFile,
        kind: "inline-wrap",
        detail: m[0].trim().slice(0, 160),
      });
    }
  }
  return violations;
}

function formatViolation(v: Violation): string {
  return (
    `${v.file} [${v.kind}]\n` +
    `  ${v.detail}\n` +
    `  Law: forms forward ALL legs whenever any line exists — never gate on ` +
    `split; see docs/plans/todo_plans/PAYMENT_LEGS_INTEGRITY_PLAN.md (S1).\n` +
    `  Fix: replace the isSplitPayment/split-length condition with ` +
    `"paymentLines.length > 0" (plus any return/change legs), matching ` +
    `KatchForm's shape.\n` +
    `  False positive? Add an entry to ALLOWLIST in this test file naming ` +
    `the reason.`
  );
}

describe("payment-legs gate guard (S8 class-killer)", () => {
  it("no form gates payment legs on isSplitPayment / a split-length check", () => {
    const violations = scan();
    if (violations.length > 0) {
      throw new Error(
        `${violations.length} payment-legs gate violation(s):\n\n` +
          violations.map(formatViolation).join("\n\n"),
      );
    }
  });

  it("sanity: the scanner actually finds source files (not a silent no-op)", () => {
    expect(collectSourceFiles(SRC_ROOT).length).toBeGreaterThan(100);
  });
});
