/**
 * LIRA-329 T008 — completeness guard: every transaction writer passes
 * `details`, unless it is listed below with the reason it does not (yet).
 *
 * Mechanism (same idea as `constants/__tests__/moduleDebtTypes.guard.test.ts`):
 * scan core source for every `createTransaction({ … })` call on the
 * TransactionRepository (`getTransactionRepository().`, `txnRepo.`, and
 * `this.` inside TransactionRepository itself), cut out its object literal,
 * and key the site by `<file>::<type expression>`. A site whose literal has
 * no `details` key must be in `NOT_YET_DELIVERED` (a later LIRA-329 phase)
 * or `NO_DETAILS_KIND` (no kind is defined for it in data-model.md).
 *
 * The allowlist shrinks phase by phase (tasks.md T015/T023/T027/T030/T035/
 * T039). It cannot rot silently: an entry that matches no real site, or a
 * listed site that now passes `details`, fails this test too.
 *
 * Second check: every kind in `TRANSACTION_DETAILS_KINDS` is either written
 * somewhere in core (`kind: "<kind>"` outside the validators) or listed in
 * `PENDING_KINDS`. This is what keeps a shared writer honest when only some
 * of its branches are delivered — e.g. FinancialServiceRepository's
 * FINANCIAL_SERVICE site passes `details` for OMT/Whish system transfers
 * (phase 3) while its catalog/bill/wallet/crypto kinds are still pending.
 *
 * Limits (stated, not hidden): this is static. It proves a site passes a
 * `details` key, not that every branch of that site fills every field —
 * that is each module's own `*.details.test.ts`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { TRANSACTION_DETAILS_KINDS } from "../validators/transactionDetails";

const SRC_ROOT = path.join(__dirname, "..");

/** Sites a later LIRA-329 phase will give `details`. */
const NOT_YET_DELIVERED: Record<string, string> = {
  // Phase 5 — POS, Maintenance, Warranty: delivered (SALE, MAINTENANCE,
  // WARRANTY_COST, and the warranty REFUND row — see PARTLY_DELIVERED).
  // Phase 6 — Exchange, Loto: delivered (EXCHANGE, LOTO, LOTO_CASH_PRIZE).
  // Phase 7 — Money & accounts: delivered (expenses, debts, suppliers,
  // partners). SupplierRepository's shared `addLedgerEntry` no-drawer branch
  // (`txnType as TransactionType`) passes `details` for the operator's own
  // entries only; its automatic sibling rows (is_auto) carry none — their
  // parent transaction holds the details (rule 26).
  // Phase 8 — session siblings, void, refund: delivered (EXTRA_CHARGE /
  // KEPT_CHANGE / WAIVED_SHORTFALL → `session_sibling`; every REFUND /
  // REFUND_UNDO and the COUNTERPARTY_DISCOUNT reversal → `reversal`). The
  // map stays, empty, so a future writer has somewhere to be listed.
};

/**
 * Sites that pass `details` on SOME of their branches only, so the static
 * scan sees them as delivered while a later phase still owes the rest. They
 * are exempt from the "site now passes details" half of the stale check (but
 * must still match a real site). Remove an entry once its phase lands.
 */
const PARTLY_DELIVERED: Record<string, string> = {
  // Phase 8: SalesRepository's REFUND site now always passes details — the
  // claim's `warranty_claim` details on a warranty refund, `reversal` on a
  // plain item refund.
};

const COMPLETE =
  "audit §2 'Complete already' / system bookkeeping — no details kind defined in data-model.md";

/** Sites with no details kind in the data model (owner-reviewed audit). */
const NO_DETAILS_KIND: Record<string, string> = {
  "repositories/CarrierLineRepository.ts::TRANSACTION_TYPES.CARRIER_LINE_ADJUSTMENT":
    COMPLETE,
  "repositories/ClientRepository.ts::TRANSACTION_TYPES.CLIENT_CREATED":
    COMPLETE,
  "repositories/ClientRepository.ts::TRANSACTION_TYPES.CLIENT_UPDATED":
    COMPLETE,
  "repositories/ClientRepository.ts::TRANSACTION_TYPES.CLIENT_DELETED":
    COMPLETE,
  "repositories/ClosingRepository.ts::TRANSACTION_TYPES.CHECKPOINT": COMPLETE,
  "repositories/DrawerCashoutRepository.ts::TRANSACTION_TYPES.DRAWER_CASHOUT":
    COMPLETE,
  // Katsh/iPick self-charge — audit §2 "Complete already" (shop's own line,
  // no customer); LIRA-329 phase 4 reviewed it.
  "repositories/FinancialServiceRepository.ts::TRANSACTION_TYPES.TELECOM_SELF_CHARGE":
    COMPLETE,
  "repositories/DrawerTopUpRepository.ts::TRANSACTION_TYPES.DRAWER_TOPUP":
    COMPLETE,
  "repositories/DrawerTopUpRepository.ts::TRANSACTION_TYPES.DRAWER_TRANSFER":
    COMPLETE,
  "repositories/LotoCheckpointRepository.ts::TRANSACTION_TYPES.LOTO_SETTLEMENT":
    COMPLETE,
  "repositories/LotoMonthlyFeeRepository.ts::TRANSACTION_TYPES.LOTO_MONTHLY_FEE":
    COMPLETE,
  "repositories/ResaleLineRepository.ts::TRANSACTION_TYPES.LINE_RECHARGE":
    COMPLETE,
  "repositories/SupplierRepository.ts::TRANSACTION_TYPES.SUPPLIER_STOCK_INTAKE as TransactionType":
    COMPLETE,
  "repositories/WalletExchangeRepository.ts::TRANSACTION_TYPES.WALLET_EXCHANGE":
    COMPLETE,
  // LIRA-321 forgiven "Customer pays" leftover: an automatic sibling
  // (`is_auto`, rule 26) written for its PARENT exchange / cash-out, which
  // holds the details. data-model.md: automatic sibling rows carry none.
  // (`session_sibling` does not fit: the row belongs to no session.)
  "repositories/forgivenShortfall.ts::TRANSACTION_TYPES.WAIVED_SHORTFALL":
    "automatic sibling (is_auto, rule 26) — its parent transaction holds the details",
};

/** Kinds no writer produces yet, with the phase that will. */
const PENDING_KINDS: Record<string, string> = {};

/** Fewer sites than this means the scan broke, not that writers vanished. */
const MIN_SITES = 55;

interface Site {
  key: string;
  line: number;
  passesDetails: boolean;
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["__tests__", "testHelpers", "node_modules"].includes(entry.name)) {
        continue;
      }
      out.push(...collectSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** The `{ … }` literal starting at `open` (balanced braces). */
function literalAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced literal at offset ${open}`);
}

const CALL =
  /(getTransactionRepository\(\)|\btxnRepo|\bthis)\s*\.\s*createTransaction\(\s*\{/g;
const DETAILS_KEY = /(^|[\s{,])details\s*(:|,|\}|$)/m;

function collectSites(): Site[] {
  const sites: Site[] = [];
  for (const file of collectSourceFiles(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(CALL)) {
      if (
        match[1] === "this" &&
        rel !== "repositories/TransactionRepository.ts"
      ) {
        continue; // a module's own `createTransaction` method, not ours
      }
      const literal = stripComments(
        literalAt(source, (match.index ?? 0) + match[0].length - 1),
      );
      const type = /\btype:\s*([^,\n]+)/.exec(literal)?.[1]?.trim() ?? "?";
      sites.push({
        key: `${rel}::${type}`,
        line: source.slice(0, match.index).split("\n").length,
        passesDetails: DETAILS_KEY.test(literal),
      });
    }
  }
  return sites;
}

describe("LIRA-329 — every transaction writer passes details (coverage guard)", () => {
  const sites = collectSites();
  const allowed = { ...NOT_YET_DELIVERED, ...NO_DETAILS_KIND };

  it(`finds the transaction writers (at least ${MIN_SITES})`, () => {
    expect(sites.length).toBeGreaterThanOrEqual(MIN_SITES);
  });

  it("every site passes details or is listed with its reason", () => {
    const missing = sites
      .filter((s) => !s.passesDetails && !(s.key in allowed))
      .map((s) => `${s.key} (line ${s.line})`);
    expect(missing).toEqual([]);
  });

  it("no listed entry is stale (matches no site, or the site now passes details)", () => {
    const stale = Object.keys(allowed).filter((key) => {
      const matching = sites.filter((s) => s.key === key);
      return matching.length === 0 || matching.every((s) => s.passesDetails);
    });
    expect(stale).toEqual([]);
  });

  it("every partly delivered entry still matches a real site", () => {
    const unmatched = Object.keys(PARTLY_DELIVERED).filter(
      (key) => !sites.some((s) => s.key === key),
    );
    expect(unmatched).toEqual([]);
  });

  it("every details kind is written somewhere, or listed as pending", () => {
    const written = new Set<string>();
    for (const file of collectSourceFiles(SRC_ROOT)) {
      if (file.includes(`${path.sep}validators${path.sep}`)) continue;
      const source = stripComments(fs.readFileSync(file, "utf8"));
      for (const m of source.matchAll(/\bkind:\s*"([a-z_]+)"/g)) {
        written.add(m[1]);
      }
    }
    const unwritten = TRANSACTION_DETAILS_KINDS.filter(
      (k) => !written.has(k) && !(k in PENDING_KINDS),
    );
    const stalePending = Object.keys(PENDING_KINDS).filter((k) =>
      written.has(k),
    );
    expect({ unwritten, stalePending }).toEqual({
      unwritten: [],
      stalePending: [],
    });
  });
});
