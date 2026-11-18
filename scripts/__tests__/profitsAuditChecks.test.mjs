#!/usr/bin/env node
/**
 * Node-native tests for `scripts/lib/profitsAuditChecks.mjs` (LIRA-397): the
 * ten Profits audit checks, run over a SYNTHETIC fixture (no real shop data).
 *
 * The fixture's clean baseline passes every check; each test then injects
 * exactly ONE violation and asserts that the matching check — and only that
 * check — reports it, with exactly one finding.
 *
 * Rule 17 history (2026-11-18): the first 23 tests were written before the
 * checks and run against an empty stub (every check PASS, no findings): 19
 * failed, 4 passed — the 4 negative cases ("tolerance", "skips settlement
 * allocation", "no drill-down is skipped", clean baseline) pass on a stub by
 * construction, so they are NOT proven failing-first. The formatReport test's
 * fixture was edited after that red run. The 2 CLI end-to-end tests and the 2
 * tests for the refunded/emptied "still owes" and free-text detail rules were
 * added later, each seen failing before its code change.
 *
 * The fixture is synthetic: names and figures are invented.
 *
 * Run directly: node --test scripts/__tests__/profitsAuditChecks.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
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
  runAllChecks,
  formatReport,
} from "../lib/profitsAuditChecks.mjs";

const CHECKS = [
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

function row(over) {
  return {
    id: 0,
    date: "2026-10-01",
    counterpart: "Walk-in",
    detail: "Item",
    amount_usd: 0,
    amount_lbp: 0,
    cost_usd: 0,
    cost_lbp: 0,
    profit_usd: 0,
    profit_lbp: 0,
    counted_pct: 100,
    counted_profit_usd: 0,
    counted_profit_lbp: 0,
    reason: null,
    fee_note: null,
    fee_note_kind: undefined,
    ...over,
  };
}

/** Clean baseline: every check passes. Three modules, total profit $13 + 90,000 LBP. */
function baseline() {
  return {
    byModule: [
      {
        module: "SALE",
        label: "Sales",
        profit_usd: 10,
        profit_lbp: 0,
        count: 1,
      },
      {
        module: "RECHARGE_MTC",
        label: "MTC",
        profit_usd: 2,
        profit_lbp: 90000,
        count: 2,
      },
      {
        module: "FINANCIAL_SERVICE_OMT",
        label: "OMT",
        profit_usd: 1,
        profit_lbp: 0,
        count: 1,
      },
    ],
    details: {
      SALE: {
        ok: true,
        data: {
          counted: [
            row({
              id: 1,
              counterpart: "Customer A",
              detail: "Phone case",
              amount_usd: 15,
              cost_usd: 5,
              profit_usd: 10,
              counted_profit_usd: 10,
            }),
          ],
          not_counted: [
            row({
              id: 2,
              counterpart: "Customer E",
              detail: "Charger",
              amount_usd: 20,
              cost_usd: 8,
              profit_usd: 12,
              counted_pct: 0,
              counted_profit_usd: 0,
              reason: "Customer still owes — paid $5.00 of $20.00.",
            }),
          ],
          counted_total_profit_usd: 10,
          counted_total_profit_lbp: 0,
        },
      },
      RECHARGE_MTC: {
        ok: true,
        data: {
          counted: [
            row({
              id: 3,
              counterpart: "Customer D",
              detail: "MTC $10 card",
              amount_usd: 11,
              cost_usd: 9,
              profit_usd: 2,
              counted_profit_usd: 2,
            }),
            row({
              id: 4,
              counterpart: "Customer D",
              detail: "MTC 5 days",
              amount_lbp: 450000,
              cost_lbp: 360000,
              profit_lbp: 90000,
              counted_profit_lbp: 90000,
            }),
          ],
          not_counted: [],
          counted_total_profit_usd: 2,
          counted_total_profit_lbp: 90000,
        },
      },
      FINANCIAL_SERVICE_OMT: {
        ok: true,
        data: {
          counted: [
            row({
              id: 5,
              counterpart: "Customer C",
              detail: "OMT send",
              amount_usd: 100,
              cost_usd: 99,
              profit_usd: 1,
              counted_profit_usd: 1,
            }),
          ],
          not_counted: [],
          counted_total_profit_usd: 1,
          counted_total_profit_lbp: 0,
        },
      },
    },
    summary: {
      totals: {
        gross_profit_usd: 13,
        gross_profit_lbp: 90000,
        net_profit_usd: 11,
        net_profit_lbp: 90000,
      },
    },
    byDate: [
      { date: "2026-10-01", profit_usd: 6, profit_lbp: 90000 },
      { date: "2026-10-02", profit_usd: 7, profit_lbp: 0 },
    ],
    byUser: [
      { user_id: 1, username: "admin", profit_usd: 13, profit_lbp: 90000 },
    ],
    byClient: [
      {
        client_id: 7,
        client_name: "Customer A",
        profit_usd: 10,
        profit_lbp: 0,
      },
    ],
    byPaymentMethod: [{ method: "CASH", total_usd: 146, total_lbp: 450000 }],
    timings: [{ endpoint: "/by-module", ms: 120 }],
    options: { strictZeroRows: false },
  };
}

const sale = (i) => i.details.SALE.data;
const mtc = (i) => i.details.RECHARGE_MTC.data;

/** Assert check `n` (1-based) has status `status` and exactly one finding; every other check of 1–9 has none. */
function expectOnly(input, n, status) {
  CHECKS.forEach((check, idx) => {
    const r = check(input);
    if (idx + 1 === n) {
      assert.equal(r.status, status, `check #${n} status`);
      assert.equal(
        r.findings.length,
        1,
        `check #${n} findings: ${JSON.stringify(r.findings)}`,
      );
    } else if (idx + 1 !== 10) {
      assert.equal(
        r.findings.length,
        0,
        `check #${idx + 1} should be clean: ${JSON.stringify(r.findings)}`,
      );
      assert.notEqual(r.status, "FAIL", `check #${idx + 1} should not FAIL`);
    }
  });
}

test("clean baseline: no check finds anything, none FAILs", () => {
  const input = baseline();
  CHECKS.forEach((check, idx) => {
    const r = check(input);
    assert.equal(r.id, idx + 1);
    assert.notEqual(r.status, "FAIL", `check #${idx + 1}`);
    if (idx + 1 !== 10) assert.equal(r.findings.length, 0, `check #${idx + 1}`);
  });
});

test("#1 module sums: a counted row that does not add up to the By Module row", () => {
  const input = baseline();
  mtc(input).counted[0].counted_profit_usd = 2.5; // Σ counted = 2.5, By Module and counted_total = 2
  expectOnly(input, 1, "FAIL");
  assert.equal(checkModuleSums(input).findings[0].module, "RECHARGE_MTC");
});

test("#1 tolerance: 0.01 USD / 1 LBP apart is not a finding", () => {
  const input = baseline();
  mtc(input).counted[0].counted_profit_usd = 2.01;
  mtc(input).counted[1].counted_profit_lbp = 90001;
  assert.equal(checkModuleSums(input).findings.length, 0);
});

test("#2 views agree: By User total differs from By Module", () => {
  const input = baseline();
  input.byUser[0].profit_usd = 14;
  expectOnly(input, 2, "FAIL");
  assert.match(checkViewsAgree(input).findings[0].message, /By User/);
});

test("#2 views agree: Summary gross profit (LBP) differs", () => {
  const input = baseline();
  input.summary.totals.gross_profit_lbp = 100000;
  expectOnly(input, 2, "FAIL");
  assert.match(checkViewsAgree(input).findings[0].message, /Summary/);
});

test("#3 price − cost: a sale row whose profit is not amount − cost", () => {
  const input = baseline();
  sale(input).counted[0].cost_usd = 6; // 15 − 6 = 9, profit says 10
  expectOnly(input, 3, "FAIL");
  assert.equal(checkPriceMinusCost(input).findings[0].row.id, 1);
});

test("#3 skips settlement-allocation rows and modules outside the list", () => {
  const input = baseline();
  input.details.FINANCIAL_SERVICE_OMT.data.counted[0].detail =
    "OMT send (settlement allocation)";
  input.details.FINANCIAL_SERVICE_OMT.data.counted[0].cost_usd = 50;
  assert.equal(checkPriceMinusCost(input).findings.length, 0);
});

test("#4 reason: negative amount paid", () => {
  const input = baseline();
  sale(input).not_counted[0].reason =
    "Customer still owes — paid $-5.00 of $20.00.";
  expectOnly(input, 4, "FAIL");
});

test("#4 reason: paid more than the total", () => {
  const input = baseline();
  sale(input).not_counted[0].reason =
    "Customer still owes — paid $25.00 of $20.00.";
  expectOnly(input, 4, "FAIL");
});

test("#4 reason: a refunded row that says the customer still owes", () => {
  const input = baseline();
  sale(input).not_counted[0].detail = "REFUND Charger";
  sale(input).not_counted[0].reason =
    "Customer still owes — Sale Debt not yet repaid.";
  expectOnly(input, 4, "FAIL");
});

test("#4 reason: an emptied row (amount, cost, profit all 0 — a refunded sale today) that says the customer still owes", () => {
  // Shape seen on the live run: a refunded on-account sale carries no
  // refunded marker in the row; it is all zeros with a "still owes" reason.
  const input = baseline();
  sale(input).not_counted.push(
    row({
      id: 11,
      counterpart: "Customer B",
      detail: "Charger",
      counted_pct: 0,
      reason: "Customer still owes — paid $0.00 of $40.00.",
    }),
  );
  expectOnly(input, 4, "FAIL");
});

test("#5 staff-typed upper-case text in MAINTENANCE / CUSTOM_SERVICE is not a raw code (blank still is)", () => {
  const input = baseline();
  input.byModule.push({
    module: "MAINTENANCE",
    label: "Maintenance",
    profit_usd: 0,
    profit_lbp: 0,
    count: 1,
  });
  input.details.MAINTENANCE = {
    ok: true,
    data: {
      counted: [],
      not_counted: [
        row({
          id: 12,
          counterpart: "Customer A",
          detail: "TECNO",
          counted_pct: 0,
          reason: "Customer still owes — Maintenance Debt not yet repaid.",
          amount_usd: 10,
          profit_usd: 10,
        }),
      ],
      counted_total_profit_usd: 0,
      counted_total_profit_lbp: 0,
    },
  };
  assert.equal(checkDetailText(input).findings.length, 0);
  input.details.MAINTENANCE.data.not_counted[0].detail = "";
  assert.equal(checkDetailText(input).findings.length, 1);
});

test("#5 detail: a raw enum as the detail", () => {
  const input = baseline();
  mtc(input).counted[0].detail = "RECHARGE_MTC";
  expectOnly(input, 5, "FAIL");
});

test("#5 detail: blank, null and generic '<number> credit' are each a finding", () => {
  for (const bad of [
    null,
    "   ",
    "10 credit",
    "FINANCIAL_SERVICE (settlement allocation)",
  ]) {
    const input = baseline();
    mtc(input).counted[0].detail = bad;
    assert.equal(
      checkDetailText(input).findings.length,
      1,
      `detail ${JSON.stringify(bad)}`,
    );
    assert.equal(checkDetailText(input).status, "FAIL");
  }
});

test("#6 counterpart: an auto-named basket 'Client12'", () => {
  const input = baseline();
  sale(input).counted[0].counterpart = "Client12";
  expectOnly(input, 6, "FAIL");
});

test("#7 zero rows: INFO by default, FAIL under --strict-zero-rows for SALE", () => {
  const input = baseline();
  sale(input).counted.push(
    row({ id: 9, counterpart: "Customer A", detail: "Free sticker" }),
  );
  expectOnly(input, 7, "INFO");
  input.options.strictZeroRows = true;
  expectOnly(input, 7, "FAIL");
});

test("#7 strict mode stays INFO for a module outside SALE/KEPT_CHANGE/TOPUP_BUYBACK", () => {
  const input = baseline();
  input.options.strictZeroRows = true;
  mtc(input).counted.push(
    row({ id: 9, counterpart: "Customer D", detail: "MTC 0 days" }),
  );
  expectOnly(input, 7, "INFO");
});

test("#8 negative profit: a not-counted loss row is INFO", () => {
  const input = baseline();
  sale(input).not_counted.push(
    row({
      id: 10,
      counterpart: "Customer A",
      detail: "Screen protector",
      amount_usd: 5,
      cost_usd: 7,
      profit_usd: -2,
      counted_pct: 0,
      reason: "Discount given",
    }),
  );
  expectOnly(input, 8, "INFO");
});

test("#9 not counted without a reason", () => {
  const input = baseline();
  sale(input).not_counted[0].reason = "";
  expectOnly(input, 9, "FAIL");
});

test("#10 row counts and timings are INFO lines", () => {
  const r = checkRowCounts(baseline());
  assert.equal(r.status, "INFO");
  const text = r.info.join("\n");
  assert.match(text, /SALE/);
  assert.match(text, /\/by-module/);
});

test("modules without a drill-down are skipped, not failed", () => {
  const input = baseline();
  input.byModule.push({
    module: "WAIVED",
    label: "Waived",
    profit_usd: 0,
    profit_lbp: 0,
    count: 0,
  });
  input.details.WAIVED = {
    ok: false,
    error: "No transaction-level detail is available",
  };
  expectOnly(input, 99, "PASS"); // no check finds anything
});

test("runAllChecks returns the ten results in order; formatReport caps examples at 5", () => {
  const input = baseline();
  for (let i = 0; i < 7; i++) {
    sale(input).not_counted.push(
      row({
        id: 100 + i,
        counterpart: `Client${i}`,
        detail: "Case",
        amount_usd: 1,
        profit_usd: 1,
        counted_pct: 0,
        reason: "Customer still owes — Sale Debt not yet repaid.",
      }),
    );
  }
  const result = runAllChecks(input);
  assert.deepEqual(
    result.checks.map((c) => c.id),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.equal(result.failed, true);
  const text = formatReport(result);
  assert.match(text, /FAIL\s+#6/);
  assert.match(text, /and 2 more/);
  const examples = text.split("\n").filter((l) => /Client\d/.test(l));
  assert.equal(examples.length, 5);
});

// --- CLI: refuses before any request, never echoes a secret -------------------
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, "..", "profits-audit.mjs");

test("CLI: missing env secrets → exit 2, no request", () => {
  const env = { ...process.env };
  delete env.LIRATEK_PASSWORD;
  delete env.LIRATEK_PROFITS_PASSWORD;
  const r = spawnSync(
    process.execPath,
    [
      CLI,
      "--host",
      "127.0.0.1:9",
      "--user",
      "u",
      "--from",
      "2026-01-01",
      "--to",
      "2026-01-02",
    ],
    { env, encoding: "utf8" },
  );
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /LIRATEK_PASSWORD/);
});

test("CLI: usage error never prints the secret values", () => {
  const env = {
    ...process.env,
    LIRATEK_PASSWORD: "s3cret-user-PW",
    LIRATEK_PROFITS_PASSWORD: "s3cret-profits-PW",
  };
  const r = spawnSync(process.execPath, [CLI, "--user", "u"], {
    env,
    encoding: "utf8",
  });
  assert.equal(r.status, 2);
  const out = r.stdout + r.stderr;
  assert.ok(
    !out.includes("s3cret-user-PW") && !out.includes("s3cret-profits-PW"),
  );
  assert.match(out, /--host/);
});

test("CLI: a password passed on the command line is refused", () => {
  const env = {
    ...process.env,
    LIRATEK_PASSWORD: "x",
    LIRATEK_PROFITS_PASSWORD: "y",
  };
  const r = spawnSync(
    process.execPath,
    [
      CLI,
      "--host",
      "h",
      "--user",
      "u",
      "--from",
      "2026-01-01",
      "--to",
      "2026-01-02",
      "--password",
      "argv-PW",
    ],
    { env, encoding: "utf8" },
  );
  assert.equal(r.status, 2);
  assert.ok(!(r.stdout + r.stderr).includes("argv-PW"));
});

// --- CLI end to end against a local mock server ------------------------------
// Proves the whole path (login → unlock → every view → checks → report) and the
// spec's safety rule: one request in flight at a time, each starting ≥ 300 ms
// after the previous response FINISHED (measured server-side).
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

const USER_PW = "mock-user-PW-1";
const PROFITS_PW = "mock-profits-PW-2";
const TOKEN = "mock-bearer-token-xyz";

function startMockServer(
  input,
  { slowPath = "/api/profits/summary", slowMs = 400 } = {},
) {
  const log = { requests: [], maxInFlight: 0, gaps: [], unauthorized: [] };
  let inFlight = 0;
  let lastFinish = null;
  const server = http.createServer((req, res) => {
    const arrived = Date.now();
    if (lastFinish !== null)
      log.gaps.push({ path: req.url, gap: arrived - lastFinish });
    inFlight++;
    log.maxInFlight = Math.max(log.maxInFlight, inFlight);
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://x");
      log.requests.push(url.pathname);
      if (
        url.pathname !== "/api/auth/login" &&
        req.headers.authorization !== `Bearer ${TOKEN}`
      )
        log.unauthorized.push(url.pathname);
      let payload;
      const p = url.pathname;
      if (p === "/api/auth/login") {
        const b = JSON.parse(body || "{}");
        payload =
          b.password === USER_PW
            ? { success: true, data: { token: TOKEN } }
            : { success: false, error: "Invalid credentials" };
      } else if (p === "/api/profits/unlock") {
        payload =
          JSON.parse(body || "{}").password === PROFITS_PW
            ? { success: true }
            : { success: false, error: "Incorrect password" };
      } else if (p === "/api/profits/lock" || p === "/api/auth/logout")
        payload = { success: true };
      else if (p === "/api/profits/by-module")
        payload = { success: true, data: input.byModule };
      else if (p === "/api/profits/module-detail") {
        const d = input.details[url.searchParams.get("module")];
        payload =
          d && d.ok
            ? { success: true, data: d.data }
            : {
                success: false,
                error: "No transaction-level detail is available",
              };
      } else if (p === "/api/profits/summary")
        payload = { success: true, data: input.summary };
      else if (p === "/api/profits/by-date")
        payload = { success: true, data: input.byDate };
      else if (p === "/api/profits/by-user")
        payload = { success: true, data: input.byUser };
      else if (p === "/api/profits/by-client")
        payload = { success: true, data: input.byClient };
      else if (p === "/api/profits/by-payment-method")
        payload = { success: true, data: input.byPaymentMethod };
      else payload = { success: false, error: "not found" };
      const send = () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload), () => {
          inFlight--;
          lastFinish = Date.now();
        });
      };
      if (p === slowPath) setTimeout(send, slowMs);
      else send();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, log, port: server.address().port }),
    ),
  );
}

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function mockInput() {
  const input = baseline();
  sale(input).counted[0].counterpart = "Client12"; // one violation: check #6
  input.byModule.push({
    module: "WAIVED",
    label: "Waived",
    profit_usd: 0,
    profit_lbp: 0,
    count: 0,
  });
  return input;
}

test("CLI end to end: report, exit 1, sequential with ≥ 300 ms idle gaps, bearer on every call, no secrets", async () => {
  const { server, log, port } = await startMockServer(mockInput());
  try {
    const r = await runCli(
      [
        "--host",
        `http://127.0.0.1:${port}`,
        "--user",
        "admin",
        "--from",
        "2026-10-01",
        "--to",
        "2026-10-31",
      ],
      { LIRATEK_PASSWORD: USER_PW, LIRATEK_PROFITS_PASSWORD: PROFITS_PW },
    );
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stdout, /FAIL\s+#6/);
    assert.match(r.stdout, /RESULT: FAIL \(#6\)/);
    assert.match(r.stdout, /WAIVED: no drill-down/);
    for (const s of [USER_PW, PROFITS_PW, TOKEN])
      assert.ok(!(r.stdout + r.stderr).includes(s), "secret leaked");
    assert.equal(log.maxInFlight, 1, "requests overlapped");
    assert.deepEqual(
      log.unauthorized,
      [],
      "a request after login had no bearer token",
    );
    const tooShort = log.gaps.filter((g) => g.gap < 290);
    assert.deepEqual(
      tooShort,
      [],
      "a request started < 300 ms after the previous response finished",
    );
    for (const p of [
      "/api/profits/unlock",
      "/api/profits/by-module",
      "/api/profits/summary",
      "/api/profits/by-date",
      "/api/profits/by-user",
      "/api/profits/by-client",
      "/api/profits/by-payment-method",
      "/api/profits/lock",
      "/api/auth/logout",
    ])
      assert.ok(log.requests.includes(p), `missing ${p}`);
    assert.equal(
      log.requests.filter((p) => p === "/api/profits/module-detail").length,
      4,
    );
  } finally {
    server.close();
  }
});

test("CLI --json parses; --save-input then --input replays offline with the same verdict", async () => {
  const { server, log, port } = await startMockServer(mockInput(), {
    slowMs: 0,
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "profits-audit-"));
  const saved = path.join(dir, "input.json");
  try {
    const r = await runCli(
      [
        "--host",
        `http://127.0.0.1:${port}`,
        "--user",
        "admin",
        "--from",
        "2026-10-01",
        "--to",
        "2026-10-31",
        "--json",
        "--save-input",
        saved,
      ],
      { LIRATEK_PASSWORD: USER_PW, LIRATEK_PROFITS_PASSWORD: PROFITS_PW },
    );
    assert.equal(r.code, 1, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.failed, true);
    assert.equal(json.checks.find((c) => c.id === 6).status, "FAIL");
    const file = fs.readFileSync(saved, "utf8");
    for (const s of [USER_PW, PROFITS_PW, TOKEN])
      assert.ok(!file.includes(s), "secret written to the saved input");
    const before = log.requests.length;
    const replay = await runCli(["--input", saved], {
      LIRATEK_PASSWORD: "",
      LIRATEK_PROFITS_PASSWORD: "",
    });
    assert.equal(replay.code, 1, replay.stderr);
    assert.match(replay.stdout, /RESULT: FAIL \(#6\)/);
    assert.equal(
      log.requests.length,
      before,
      "replay must not touch the network",
    );
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
