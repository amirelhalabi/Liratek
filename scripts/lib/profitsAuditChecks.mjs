/**
 * The Profits audit's checks (LIRA-397), kept pure so they can be unit-tested
 * over a synthetic fixture (`scripts/__tests__/profitsAuditChecks.test.mjs`).
 *
 * `scripts/profits-audit.mjs` fetches one shop's Profits views over the web
 * API and hands them here as one `AuditInput`:
 *
 *   {
 *     byModule:  [{ module, label, profit_usd, profit_lbp, count, … }],
 *     details:   { [module]: { ok: true, data: { counted, not_counted,
 *                                 counted_total_profit_usd, counted_total_profit_lbp } }
 *                            | { ok: false, error } },
 *     summary:   { totals: { gross_profit_usd, gross_profit_lbp, … } },
 *     byDate, byUser, byClient: [{ profit_usd, profit_lbp, … }],
 *     byPaymentMethod: [{ method, total_usd, total_lbp }],
 *     timings:   [{ endpoint, ms }],
 *     options:   { strictZeroRows: boolean },
 *   }
 *
 * Every check returns `{ id, key, title, status, findings, info }`, where
 * status is PASS / FAIL / INFO and each finding is `{ module?, message, row? }`.
 * See specs/397-profits-audit-script/spec.md for the table of checks.
 */

/** Money tolerances: 2 cents, 2 LBP. */
export const TOL_USD = 0.02;
export const TOL_LBP = 2;

/** Check #3 applies to these module keys (exact) … */
const PRICE_COST_MODULES = new Set([
  "SALE",
  "CUSTOM_SERVICE",
  "MAINTENANCE",
  "LOTO",
  "EXCHANGE",
]);
/** … and to every key with one of these prefixes. */
const PRICE_COST_PREFIXES = ["RECHARGE_", "FINANCIAL_SERVICE_"];

/** Check #7 FAILs (instead of INFO) for these modules under --strict-zero-rows. */
export const STRICT_ZERO_ROW_MODULES = new Set([
  "SALE",
  "KEPT_CHANGE",
  "TOPUP_BUYBACK",
]);

const ZERO_FIELDS = [
  "amount_usd",
  "amount_lbp",
  "cost_usd",
  "cost_lbp",
  "profit_usd",
  "profit_lbp",
];

/** Detail is staff-typed free text here (device name, service description): upper case is not a code. */
const FREE_TEXT_DETAIL_MODULES = new Set(["MAINTENANCE", "CUSTOM_SERVICE"]);

const SETTLEMENT_ALLOCATION = "(settlement allocation)";
const RAW_ENUM = /^[A-Z_]+( \(settlement allocation\))?$/;
const GENERIC_CREDIT = /^-?[\d.,]+\s+credits?$/i;
const AUTO_BASKET_CLIENT = /^Client\d+$/;
const PAID_OF = /paid \$?(-?[\d,]*\.?\d+) of \$?(-?[\d,]*\.?\d+)/i;
const STILL_OWES = /still owes/i;

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const parseMoney = (s) => num(String(s).replace(/,/g, ""));
const offUsd = (a, b) => Math.abs(num(a) - num(b)) > TOL_USD;
const offLbp = (a, b) => Math.abs(num(a) - num(b)) > TOL_LBP;
const isBlank = (s) => s === null || s === undefined || String(s).trim() === "";

export const fmtUsd = (n) => `$${num(n).toFixed(2)}`;
export const fmtLbp = (n) =>
  `${Math.round(num(n)).toLocaleString("en-US")} LBP`;
const fmtPair = (usd, lbp) => `${fmtUsd(usd)} / ${fmtLbp(lbp)}`;

/** Modules whose drill-down was fetched successfully: `[{ module, counted, notCounted, data }]`. */
function drillDowns(input) {
  const out = [];
  for (const [module, d] of Object.entries(input.details ?? {})) {
    if (!d || d.ok !== true || !d.data) continue;
    out.push({
      module,
      data: d.data,
      counted: Array.isArray(d.data.counted) ? d.data.counted : [],
      notCounted: Array.isArray(d.data.not_counted) ? d.data.not_counted : [],
    });
  }
  return out;
}

/** Every drill-down row with its module and which list it came from. */
function allRows(input) {
  const out = [];
  for (const dd of drillDowns(input)) {
    for (const row of dd.counted)
      out.push({ module: dd.module, list: "counted", row });
    for (const row of dd.notCounted)
      out.push({ module: dd.module, list: "not_counted", row });
  }
  return out;
}

function result(id, key, title, findings, info = [], failOnFindings = true) {
  let status = "PASS";
  if (findings.length > 0) status = failOnFindings ? "FAIL" : "INFO";
  return { id, key, title, status, findings, info };
}

const sumBy = (rows, field) =>
  (Array.isArray(rows) ? rows : []).reduce((s, r) => s + num(r?.[field]), 0);

// ---------------------------------------------------------------------------
// #1 — Σ counted rows = By Module row = counted_total
// ---------------------------------------------------------------------------
export function checkModuleSums(input) {
  const findings = [];
  for (const dd of drillDowns(input)) {
    const sumUsd = sumBy(dd.counted, "counted_profit_usd");
    const sumLbp = sumBy(dd.counted, "counted_profit_lbp");
    const bm = (input.byModule ?? []).find((r) => r.module === dd.module);
    const problems = [];
    if (!bm) {
      if (Math.abs(sumUsd) > TOL_USD || Math.abs(sumLbp) > TOL_LBP)
        problems.push("no By Module row");
    } else if (offUsd(sumUsd, bm.profit_usd) || offLbp(sumLbp, bm.profit_lbp)) {
      problems.push(`By Module ${fmtPair(bm.profit_usd, bm.profit_lbp)}`);
    }
    const tUsd = dd.data.counted_total_profit_usd;
    const tLbp = dd.data.counted_total_profit_lbp;
    if (offUsd(sumUsd, tUsd) || offLbp(sumLbp, tLbp))
      problems.push(`counted_total ${fmtPair(tUsd, tLbp)}`);
    if (problems.length > 0) {
      findings.push({
        module: dd.module,
        message: `${dd.module}: Σ counted rows ${fmtPair(sumUsd, sumLbp)} ≠ ${problems.join(", ")}`,
      });
    }
  }
  return result(
    1,
    "module-sums",
    "Drill-down rows add up to the By Module row",
    findings,
  );
}

// ---------------------------------------------------------------------------
// #2 — one total: By Module = By Date = By User = Summary gross profit
// ---------------------------------------------------------------------------
export function checkViewsAgree(input) {
  const ref = {
    usd: sumBy(input.byModule, "profit_usd"),
    lbp: sumBy(input.byModule, "profit_lbp"),
  };
  const views = [
    [
      "By Date",
      sumBy(input.byDate, "profit_usd"),
      sumBy(input.byDate, "profit_lbp"),
    ],
    [
      "By User",
      sumBy(input.byUser, "profit_usd"),
      sumBy(input.byUser, "profit_lbp"),
    ],
    [
      "Summary gross profit",
      num(input.summary?.totals?.gross_profit_usd),
      num(input.summary?.totals?.gross_profit_lbp),
    ],
  ];
  const findings = [];
  for (const [name, usd, lbp] of views) {
    if (offUsd(usd, ref.usd) || offLbp(lbp, ref.lbp)) {
      findings.push({
        message: `${name} ${fmtPair(usd, lbp)} ≠ By Module ${fmtPair(ref.usd, ref.lbp)} (Δ ${fmtPair(usd - ref.usd, lbp - ref.lbp)})`,
      });
    }
  }
  const info = [
    `By Module total ${fmtPair(ref.usd, ref.lbp)}`,
    `By Client (top ${(input.byClient ?? []).length}, informational) ${fmtPair(
      sumBy(input.byClient, "profit_usd"),
      sumBy(input.byClient, "profit_lbp"),
    )}`,
  ];
  return result(2, "views-agree", "All views show one total", findings, info);
}

// ---------------------------------------------------------------------------
// #3 — price − cost = profit per row
// ---------------------------------------------------------------------------
const priceCostModule = (m) =>
  PRICE_COST_MODULES.has(m) || PRICE_COST_PREFIXES.some((p) => m.startsWith(p));

export function checkPriceMinusCost(input) {
  const findings = [];
  for (const { module, row } of allRows(input)) {
    if (!priceCostModule(module)) continue;
    if (String(row.detail ?? "").includes(SETTLEMENT_ALLOCATION)) continue;
    const bad = [];
    if (num(row.amount_usd) !== 0 && num(row.cost_usd) !== 0) {
      const want = num(row.amount_usd) - num(row.cost_usd);
      if (offUsd(want, row.profit_usd))
        bad.push(
          `${fmtUsd(row.amount_usd)} − ${fmtUsd(row.cost_usd)} = ${fmtUsd(want)} but profit ${fmtUsd(row.profit_usd)}`,
        );
    }
    if (num(row.amount_lbp) !== 0 && num(row.cost_lbp) !== 0) {
      const want = num(row.amount_lbp) - num(row.cost_lbp);
      if (offLbp(want, row.profit_lbp))
        bad.push(
          `${fmtLbp(row.amount_lbp)} − ${fmtLbp(row.cost_lbp)} = ${fmtLbp(want)} but profit ${fmtLbp(row.profit_lbp)}`,
        );
    }
    if (bad.length > 0) findings.push({ module, row, message: bad.join("; ") });
  }
  return result(
    3,
    "price-minus-cost",
    "Price − cost = profit on every row",
    findings,
  );
}

// ---------------------------------------------------------------------------
// #4 — reason sanity: "paid $X of $Y" with 0 ≤ X ≤ Y; no "still owes" on refunds
// ---------------------------------------------------------------------------
/**
 * A row that cannot still be owed on: marked refunded, OR emptied — amount,
 * cost and profit all 0. The live API carries no refunded flag on a sale row
 * today; a refunded on-account sale shows up exactly as an all-zero row with
 * a "Customer still owes — paid $X of $Y." reason (LIRA-394).
 */
const isRefundedOrEmptied = (row) =>
  /^\s*REFUND/i.test(String(row.detail ?? "")) ||
  /\brefunded\b/i.test(String(row.detail ?? "")) ||
  row.refunded === true ||
  row.is_refunded === true ||
  ZERO_FIELDS.every((f) => num(row[f]) === 0);

export function checkReasonSanity(input) {
  const findings = [];
  for (const { module, row } of allRows(input)) {
    const reason = String(row.reason ?? "");
    const bad = [];
    const m = PAID_OF.exec(reason);
    if (m) {
      const paid = parseMoney(m[1]);
      const total = parseMoney(m[2]);
      if (paid < 0) bad.push(`negative amount paid (${m[1]})`);
      else if (paid > total + TOL_USD)
        bad.push(`paid ${m[1]} is more than ${m[2]}`);
    }
    if (STILL_OWES.test(reason) && isRefundedOrEmptied(row))
      bad.push('refunded / emptied row says "still owes"');
    if (bad.length > 0)
      findings.push({
        module,
        row,
        message: `${bad.join("; ")} — "${reason}"`,
      });
  }
  return result(
    4,
    "reason-sanity",
    "Reasons make sense (paid amounts, refunds)",
    findings,
  );
}

// ---------------------------------------------------------------------------
// #5 — detail text: not blank, not a raw enum, not "<number> credit"
// ---------------------------------------------------------------------------
export function checkDetailText(input) {
  const findings = [];
  for (const { module, row } of allRows(input)) {
    const d = row.detail;
    let why = null;
    if (isBlank(d) || String(d).trim() === "null") why = "blank detail";
    else if (
      !FREE_TEXT_DETAIL_MODULES.has(module) &&
      RAW_ENUM.test(String(d).trim())
    )
      why = "raw code as detail";
    else if (GENERIC_CREDIT.test(String(d).trim()))
      why = 'generic "<number> credit" detail';
    if (why) findings.push({ module, row, message: why });
  }
  return result(5, "detail-text", "Every row has a readable detail", findings);
}

// ---------------------------------------------------------------------------
// #6 — counterpart is not an auto-named basket (ClientN)
// ---------------------------------------------------------------------------
export function checkCounterpart(input) {
  const findings = [];
  for (const { module, row } of allRows(input)) {
    if (AUTO_BASKET_CLIENT.test(String(row.counterpart ?? "").trim()))
      findings.push({
        module,
        row,
        message: "auto-named basket as counterpart",
      });
  }
  return result(
    6,
    "counterpart",
    "No auto-named basket (ClientN) as counterpart",
    findings,
  );
}

// ---------------------------------------------------------------------------
// #7 — counted rows that are all zero (INFO; FAIL for some modules when strict)
// ---------------------------------------------------------------------------

export function checkZeroRows(input) {
  const strict = input.options?.strictZeroRows === true;
  const findings = [];
  const perModule = new Map();
  let strictHit = false;
  for (const dd of drillDowns(input)) {
    for (const row of dd.counted) {
      if (!ZERO_FIELDS.every((f) => num(row[f]) === 0)) continue;
      findings.push({
        module: dd.module,
        row,
        message: "counted row with amount, cost and profit all 0",
      });
      perModule.set(dd.module, (perModule.get(dd.module) ?? 0) + 1);
      if (STRICT_ZERO_ROW_MODULES.has(dd.module)) strictHit = true;
    }
  }
  const info = [...perModule].map(([m, n]) => `${m}: ${n} zero row(s)`);
  const r = result(
    7,
    "zero-rows",
    "Counted rows that are all zero",
    findings,
    info,
    false,
  );
  if (strict && strictHit) r.status = "FAIL";
  return r;
}

// ---------------------------------------------------------------------------
// #8 — negative-profit rows (INFO)
// ---------------------------------------------------------------------------
export function checkNegativeProfit(input) {
  const findings = [];
  const perModule = new Map();
  for (const { module, row } of allRows(input)) {
    if (num(row.profit_usd) < 0 || num(row.profit_lbp) < 0) {
      findings.push({ module, row, message: "negative profit" });
      perModule.set(module, (perModule.get(module) ?? 0) + 1);
    }
  }
  const info = [...perModule].map(([m, n]) => `${m}: ${n} negative row(s)`);
  return result(
    8,
    "negative-profit",
    "Negative-profit rows (refunds, discounts, waived …)",
    findings,
    info,
    false,
  );
}

// ---------------------------------------------------------------------------
// #9 — every not-counted row says why
// ---------------------------------------------------------------------------
export function checkNotCountedReason(input) {
  const findings = [];
  for (const dd of drillDowns(input)) {
    for (const row of dd.notCounted) {
      if (isBlank(row.reason))
        findings.push({
          module: dd.module,
          row,
          message: "not counted, no reason given",
        });
    }
  }
  return result(
    9,
    "not-counted-reason",
    "Every not-counted row has a reason",
    findings,
  );
}

// ---------------------------------------------------------------------------
// #10 — row counts per module, run time per endpoint (INFO)
// ---------------------------------------------------------------------------
export function checkRowCounts(input) {
  const info = [];
  for (const dd of drillDowns(input)) {
    info.push(
      `${dd.module}: ${dd.counted.length} counted, ${dd.notCounted.length} not counted`,
    );
  }
  for (const [module, d] of Object.entries(input.details ?? {})) {
    if (!d || d.ok !== true)
      info.push(`${module}: no drill-down (${d?.error ?? "not fetched"})`);
  }
  for (const t of input.timings ?? [])
    info.push(`${t.endpoint}: ${Math.round(num(t.ms))} ms`);
  return {
    id: 10,
    key: "row-counts",
    title: "Row counts and timings",
    status: "INFO",
    findings: [],
    info,
  };
}

export const ALL_CHECKS = [
  checkModuleSums,
  checkViewsAgree,
  checkPriceMinusCost,
  checkReasonSanity,
  checkDetailText,
  checkCounterpart,
  checkZeroRows,
  checkNegativeProfit,
  checkNotCountedReason,
  checkRowCounts,
];

/** Run all ten checks. `failed` is true when any check FAILs. */
export function runAllChecks(input) {
  const checks = ALL_CHECKS.map((c) => c(input));
  return { checks, failed: checks.some((c) => c.status === "FAIL") };
}

/** One example row as a single line. */
export function formatRow(module, row) {
  const parts = [
    `#${row.id ?? "?"}`,
    String(row.date ?? "").slice(0, 10),
    module,
    row.counterpart ?? "—",
    JSON.stringify(row.detail ?? null),
    `amount ${fmtPair(row.amount_usd, row.amount_lbp)}`,
    `cost ${fmtPair(row.cost_usd, row.cost_lbp)}`,
    `profit ${fmtPair(row.profit_usd, row.profit_lbp)}`,
  ];
  if (row.counted_pct !== undefined && row.counted_pct !== null)
    parts.push(`counted ${row.counted_pct}%`);
  return parts.join(" · ");
}

/** Plain-text report: one line per check, up to `maxExamples` examples each. */
export function formatReport(result, maxExamples = 5) {
  const lines = [];
  for (const c of result.checks) {
    const n = c.findings.length;
    const summary =
      c.id === 10
        ? ""
        : n === 0
          ? " — ok"
          : ` — ${n} finding${n === 1 ? "" : "s"}`;
    lines.push(`${c.status.padEnd(4)}  #${c.id} ${c.title}${summary}`);
    for (const f of c.findings.slice(0, maxExamples)) {
      lines.push(
        `        ${f.row ? `${formatRow(f.module, f.row)} — ` : ""}${f.message}`,
      );
    }
    if (n > maxExamples) lines.push(`        … and ${n - maxExamples} more`);
    for (const i of c.info ?? []) lines.push(`        · ${i}`);
  }
  const fails = result.checks
    .filter((c) => c.status === "FAIL")
    .map((c) => `#${c.id}`);
  lines.push("");
  lines.push(
    fails.length ? `RESULT: FAIL (${fails.join(", ")})` : "RESULT: PASS",
  );
  return lines.join("\n");
}
